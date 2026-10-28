import {
	PROTOCOL_VERSION,
	ProtocolMismatch,
	WidgetCrashed,
	type CoreToWidget,
	type WidgetId,
	type WidgetToCore,
} from "@tv/protocol";
import { describe, expect, it } from "vitest";
import { createFakeWorker } from "../testing/fake-worker";
import {
	createWorkerTransport,
	type WorkerTransport,
	type WorkerTransportFailure,
} from "./worker-transport";

const village = "village" as WidgetId;

const setup = () => {
	const worker = createFakeWorker();
	const failures: WorkerTransportFailure[] = [];
	const transport: WorkerTransport = createWorkerTransport({
		worker,
		widgetId: village,
		onFailure: (error) => failures.push(error),
	});
	return { worker, failures, transport };
};

const readyEnvelope = (overrides: Record<string, unknown> = {}) => ({
	protocolVersion: PROTOCOL_VERSION,
	message: {
		_tag: "Ready",
		widgetId: village,
		protocolVersion: PROTOCOL_VERSION,
		...overrides,
	},
});

const openTransport = () => {
	const state = setup();
	state.worker.emitMessage(readyEnvelope());
	return state;
};

describe("createWorkerTransport", () => {
	it("stays waiting until Ready and then opens", () => {
		const { worker, transport } = setup();
		expect(transport.state).toBe("waiting");

		worker.emitMessage(readyEnvelope());

		expect(transport.state).toBe("open");
	});

	it("delivers the Ready envelope to subscribers", () => {
		const { worker, transport } = setup();
		const received: WidgetToCore[] = [];
		transport.transport.subscribe((message) => received.push(message));

		worker.emitMessage(readyEnvelope());

		expect(received).toEqual([readyEnvelope()]);
	});

	it("posts outgoing envelopes before Ready", () => {
		const { worker, transport } = setup();
		const init: CoreToWidget = {
			protocolVersion: PROTOCOL_VERSION,
			message: {
				_tag: "Init",
				widgetId: village,
				config: {},
				viewport: { w: 1920, h: 1080 },
			},
		};

		transport.transport.send(init);

		expect(worker.posted).toEqual([init]);
	});

	it("delivers render commands after Ready", () => {
		const { worker, transport } = openTransport();
		const received: WidgetToCore[] = [];
		transport.transport.subscribe((message) => received.push(message));

		const command = {
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "SetTransform", nodeId: "avatar:42", x: 10 },
		};
		worker.emitMessage(command);

		expect(received).toEqual([command]);
	});

	it("stops delivering to an unsubscribed handler", () => {
		const { worker, transport } = openTransport();
		const received: WidgetToCore[] = [];
		const unsubscribe = transport.transport.subscribe((message) =>
			received.push(message),
		);
		unsubscribe();

		worker.emitMessage({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Heartbeat", tick: 2 },
		});

		expect(received).toEqual([]);
	});

	it("reports ProtocolMismatch and terminates on a foreign envelope version", () => {
		const { worker, failures, transport } = setup();

		worker.emitMessage({ ...readyEnvelope(), protocolVersion: 2 });

		expect(failures).toHaveLength(1);
		const failure = failures[0];
		expect(failure).toBeInstanceOf(ProtocolMismatch);
		if (failure instanceof ProtocolMismatch) {
			expect(failure.actualVersion).toBe(2);
			expect(failure.expectedVersion).toBe(PROTOCOL_VERSION);
		}
		expect(transport.state).toBe("closed");
		expect(worker.terminated).toBe(true);
	});

	it("reports ProtocolMismatch when Ready carries a foreign version", () => {
		const { worker, failures } = setup();

		worker.emitMessage(readyEnvelope({ protocolVersion: 2 }));

		expect(failures[0]).toBeInstanceOf(ProtocolMismatch);
		expect(worker.terminated).toBe(true);
	});

	it("rejects a first message that is not Ready", () => {
		const { worker, failures, transport } = setup();

		worker.emitMessage({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Heartbeat", tick: 1 },
		});

		expect(failures[0]).toBeInstanceOf(WidgetCrashed);
		expect(transport.state).toBe("closed");
		expect(worker.terminated).toBe(true);
	});

	it("rejects Ready for another widget", () => {
		const { worker, failures } = setup();

		worker.emitMessage(readyEnvelope({ widgetId: "other" }));

		expect(failures[0]).toBeInstanceOf(WidgetCrashed);
		expect(worker.terminated).toBe(true);
	});

	it("reports WidgetCrashed on a message outside the schema", () => {
		const { worker, failures } = setup();

		worker.emitMessage({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Heartbeat", tick: 1, extra: true },
		});

		expect(failures[0]).toBeInstanceOf(WidgetCrashed);
		expect(worker.terminated).toBe(true);
	});

	it("reports WidgetCrashed on a worker error", () => {
		const { worker, failures } = setup();

		worker.emitError("boom");

		expect(failures[0]).toBeInstanceOf(WidgetCrashed);
		expect(failures[0]?.message).toContain("boom");
		expect(worker.terminated).toBe(true);
	});

	it("reports WidgetCrashed on an undeliverable message", () => {
		const { worker, failures } = setup();

		worker.emitMessageError();

		expect(failures[0]).toBeInstanceOf(WidgetCrashed);
		expect(worker.terminated).toBe(true);
	});

	it("reports a failure once and detaches the worker", () => {
		const { worker, failures } = setup();

		worker.emitError("boom");
		worker.emitError("again");
		worker.emitMessage(readyEnvelope());

		expect(failures).toHaveLength(1);
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
		expect(worker.onmessageerror).toBeNull();
	});

	it("terminates and detaches on dispose, then ignores sends", () => {
		const { worker, transport } = openTransport();

		transport.dispose();
		transport.dispose();
		transport.transport.send({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Dispose" },
		});

		expect(transport.state).toBe("closed");
		expect(worker.posted).toEqual([]);
		expect(worker.terminated).toBe(true);
		expect(worker.onmessage).toBeNull();
	});
});

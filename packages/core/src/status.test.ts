import {
	RenderFailed,
	UnknownNode,
	type NodeId,
	type WidgetId,
} from "@tv/protocol";
import { describe, expect, it } from "vitest";
import {
	createStatusStore,
	type CounterName,
	type ErrorCounterName,
	type StatusStore,
	type WidgetStatus,
} from "./status";

const widgetId = "village" as WidgetId;
const otherId = "alerts" as WidgetId;
const nodeId = "avatar:1" as NodeId;

const zeroCounters: Readonly<Record<CounterName | ErrorCounterName, number>> = {
	AssetNotFound: 0,
	EffectCompileFailed: 0,
	EffectNotFound: 0,
	InvalidCommand: 0,
	InvalidEffectParam: 0,
	RenderFailed: 0,
	UnknownNode: 0,
	heartbeat: 0,
	dropped: 0,
	skipped: 0,
};

const statusOf = (store: StatusStore, id: WidgetId): WidgetStatus => {
	const status = store.get(id);
	if (status === undefined) {
		throw new Error(`no status for ${id}`);
	}
	return status;
};

describe("StatusStore", () => {
	it("registers a widget as loading with zero counters and no error", () => {
		const store = createStatusStore({});

		store.register(widgetId);

		expect(store.get(widgetId)).toEqual({
			widgetId,
			state: "loading",
			counters: zeroCounters,
			lastError: null,
		});
	});

	it("notifies subscribers on registration and state change", () => {
		const store = createStatusStore({});
		const seen: string[] = [];

		store.subscribe((status) => seen.push(status.state));
		store.register(widgetId);
		store.setState(widgetId, "active");

		expect(seen).toEqual(["loading", "active"]);
	});

	it("stops notifying after unsubscribe", () => {
		const store = createStatusStore({});
		let calls = 0;

		const unsubscribe = store.subscribe(() => {
			calls += 1;
		});
		store.register(widgetId);
		unsubscribe();
		store.setState(widgetId, "degraded");

		expect(calls).toBe(1);
	});

	it("records the tag, the counter and the timestamp of an error", () => {
		const store = createStatusStore({ now: () => 1234 });

		store.register(widgetId);
		store.recordError(
			widgetId,
			new UnknownNode({ widgetId, message: "Unknown node ghost", nodeId }),
		);

		const status = statusOf(store, widgetId);
		expect(status.counters.UnknownNode).toBe(1);
		expect(status.lastError).toEqual({
			tag: "UnknownNode",
			message: "Unknown node ghost",
			at: 1234,
		});
	});

	it("keeps the latest error but counts every tag separately", () => {
		const store = createStatusStore({ now: () => 10 });

		store.register(widgetId);
		store.recordError(
			widgetId,
			new UnknownNode({ widgetId, message: "first", nodeId }),
		);
		store.recordError(
			widgetId,
			new UnknownNode({ widgetId, message: "second", nodeId }),
		);
		store.recordError(
			widgetId,
			new RenderFailed({ widgetId, message: "pixi blew up" }),
		);

		const status = statusOf(store, widgetId);
		expect(status.counters.UnknownNode).toBe(2);
		expect(status.counters.RenderFailed).toBe(1);
		expect(status.lastError).toEqual({
			tag: "RenderFailed",
			message: "pixi blew up",
			at: 10,
		});
	});

	it("counts by name, one by default and any amount explicitly", () => {
		const store = createStatusStore({});

		store.register(widgetId);
		store.count(widgetId, "skipped");
		store.count(widgetId, "dropped", 5);
		store.count(widgetId, "heartbeat", 3);

		const { counters } = statusOf(store, widgetId);
		expect(counters.skipped).toBe(1);
		expect(counters.dropped).toBe(5);
		expect(counters.heartbeat).toBe(3);
	});

	it("uses performance.now when no clock is injected", () => {
		const store = createStatusStore({});

		store.register(widgetId);
		store.recordError(
			widgetId,
			new RenderFailed({ widgetId, message: "boom" }),
		);

		const at = statusOf(store, widgetId).lastError?.at;
		expect(typeof at).toBe("number");
		expect(Number.isFinite(at)).toBe(true);
		expect(at).toBeGreaterThan(0);
	});

	it("reset zeroes counters and lastError and returns the widget to loading", () => {
		const store = createStatusStore({ now: () => 7 });

		store.register(widgetId);
		store.setState(widgetId, "crashed");
		store.count(widgetId, "dropped", 2);
		store.recordError(
			widgetId,
			new RenderFailed({ widgetId, message: "boom" }),
		);

		store.reset(widgetId);

		expect(store.get(widgetId)).toEqual({
			widgetId,
			state: "loading",
			counters: zeroCounters,
			lastError: null,
		});
	});

	it("notifies at once on reset and drops the pending counters", () => {
		const store = createStatusStore({});
		const seen: WidgetStatus[] = [];

		store.register(widgetId);
		store.subscribe((status) => seen.push(status));
		store.count(widgetId, "skipped");
		store.reset(widgetId);

		expect(seen).toHaveLength(1);
		expect(seen[0]?.counters.skipped).toBe(0);

		store.flush(widgetId);

		expect(seen).toHaveLength(1);
	});

	it("keeps the status of one widget out of another", () => {
		const store = createStatusStore({});

		store.register(widgetId);
		store.register(otherId);
		store.count(widgetId, "skipped", 4);
		store.setState(otherId, "active");

		expect(statusOf(store, widgetId).counters.skipped).toBe(4);
		expect(statusOf(store, otherId).counters.skipped).toBe(0);
		expect(statusOf(store, otherId).state).toBe("active");
	});

	it("returns undefined for an unknown widget", () => {
		const store = createStatusStore({});

		expect(store.get(widgetId)).toBeUndefined();
		expect(() => store.flush(widgetId)).not.toThrow();
	});

	it("rejects a duplicate registration", () => {
		const store = createStatusStore({});

		store.register(widgetId);

		expect(() => store.register(widgetId)).toThrow(
			"Widget village is already registered",
		);
	});

	it("forgets the widget on remove and notifies nobody", () => {
		const store = createStatusStore({});
		let calls = 0;

		store.register(widgetId);
		store.subscribe(() => {
			calls += 1;
		});
		store.remove(widgetId);

		expect(store.get(widgetId)).toBeUndefined();
		expect(calls).toBe(0);
	});

	it("delivers the new status to a subscriber added later", () => {
		const store = createStatusStore({});
		store.register(widgetId);

		let seen: WidgetStatus | undefined;
		store.subscribe((status) => {
			seen = status;
		});
		store.setState(widgetId, "active");

		expect(seen?.state).toBe("active");
	});

	it("batches counter changes until flush", () => {
		const store = createStatusStore({ now: () => 1234 });
		const seen: WidgetStatus[] = [];

		store.register(widgetId);
		store.subscribe((status) => seen.push(status));
		store.count(widgetId, "skipped", 2);
		store.recordError(
			widgetId,
			new RenderFailed({ widgetId, message: "boom", nodeId }),
		);

		expect(seen).toHaveLength(0);

		store.flush(widgetId);

		expect(seen).toHaveLength(1);
		expect(seen[0]?.counters.skipped).toBe(2);
		expect(seen[0]?.counters.RenderFailed).toBe(1);
		expect(seen[0]?.lastError).toEqual({
			tag: "RenderFailed",
			message: "boom",
			at: 1234,
		});

		store.flush(widgetId);

		expect(seen).toHaveLength(1);
	});

	it("hands out a copy of the counters", () => {
		const store = createStatusStore({});
		store.register(widgetId);

		const first = statusOf(store, widgetId);
		Object.assign(first.counters, { skipped: 5 });

		expect(statusOf(store, widgetId).counters.skipped).toBe(0);
	});
});

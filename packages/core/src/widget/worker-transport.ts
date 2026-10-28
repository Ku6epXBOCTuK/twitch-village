import {
	PROTOCOL_VERSION,
	ProtocolMismatch,
	WidgetCrashed,
	decodeWidgetToCore,
	isCompatible,
	type CoreToWidget,
	type Transport,
	type WidgetId,
	type WidgetToCore,
} from "@tv/protocol";

export interface WorkerPort {
	postMessage(message: unknown): void;
	terminate(): void;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
}

export type WorkerTransportFailure = WidgetCrashed | ProtocolMismatch;

export interface WorkerTransportOptions {
	readonly worker: WorkerPort;
	readonly widgetId: WidgetId;
	readonly onFailure: (error: WorkerTransportFailure) => void;
}

export type WorkerTransportState = "waiting" | "open" | "closed";

export interface WorkerTransport {
	readonly transport: Transport<CoreToWidget, WidgetToCore>;
	readonly state: WorkerTransportState;
	dispose(): void;
}

export function createWorkerTransport(
	options: WorkerTransportOptions,
): WorkerTransport {
	const { worker, widgetId } = options;
	const listeners = new Set<(message: WidgetToCore) => void>();
	let state: WorkerTransportState = "waiting";

	function close(): void {
		if (state === "closed") return;
		state = "closed";
		listeners.clear();
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}

	function fail(error: WorkerTransportFailure): void {
		if (state === "closed") return;
		close();
		options.onFailure(error);
	}

	function crashed(message: string): WidgetCrashed {
		return new WidgetCrashed({ widgetId, message });
	}

	function mismatch(actualVersion: number, message: string): ProtocolMismatch {
		return new ProtocolMismatch({
			widgetId,
			message,
			expectedVersion: PROTOCOL_VERSION,
			actualVersion,
		});
	}

	function handleIncoming(raw: unknown): void {
		if (state === "closed") return;

		const decoded = decodeWidgetToCore(raw);
		if (decoded._tag === "Failure") {
			fail(
				crashed(
					`Worker sent a message that does not match the protocol: ${decoded.failure.message}`,
				),
			);
			return;
		}

		const envelope = decoded.success;
		if (!isCompatible(envelope.protocolVersion)) {
			fail(
				mismatch(
					envelope.protocolVersion,
					`Envelope protocol version ${envelope.protocolVersion} is not compatible with ${PROTOCOL_VERSION}`,
				),
			);
			return;
		}

		if (state === "waiting") {
			const message = envelope.message;
			if (message._tag !== "Ready") {
				fail(
					crashed(`First worker message is ${message._tag}, expected Ready`),
				);
				return;
			}
			if (!isCompatible(message.protocolVersion)) {
				fail(
					mismatch(
						message.protocolVersion,
						`Worker protocol version ${message.protocolVersion} is not compatible with ${PROTOCOL_VERSION}`,
					),
				);
				return;
			}
			if (message.widgetId !== widgetId) {
				fail(
					crashed(
						`Worker reported id ${message.widgetId}, expected ${widgetId}`,
					),
				);
				return;
			}
			state = "open";
		}

		for (const listener of listeners) {
			listener(envelope);
		}
	}

	worker.onmessage = (event) => {
		handleIncoming(event.data);
	};
	worker.onerror = (event) => {
		fail(crashed(`Worker error: ${event.message || "unknown error"}`));
	};
	worker.onmessageerror = () => {
		fail(crashed("Worker sent a message that cannot be deserialized"));
	};

	const transport: Transport<CoreToWidget, WidgetToCore> = {
		send(message) {
			if (state === "closed") return;
			worker.postMessage(message);
		},
		subscribe(handler) {
			listeners.add(handler);
			return () => {
				listeners.delete(handler);
			};
		},
		dispose: close,
	};

	return {
		transport,
		get state() {
			return state;
		},
		dispose: close,
	};
}

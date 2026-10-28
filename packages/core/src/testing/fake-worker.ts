import type { WorkerPort } from "../widget/worker-transport";

export interface FakeWorker extends WorkerPort {
	readonly posted: readonly unknown[];
	readonly terminated: boolean;
	emitMessage(data: unknown): void;
	emitError(message: string): void;
	emitMessageError(): void;
}

export function createFakeWorker(): FakeWorker {
	const posted: unknown[] = [];
	let terminated = false;

	const worker: FakeWorker = {
		posted,
		get terminated() {
			return terminated;
		},
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		postMessage(message: unknown): void {
			posted.push(message);
		},
		terminate(): void {
			terminated = true;
		},
		emitMessage(data: unknown): void {
			worker.onmessage?.(new MessageEvent("message", { data }));
		},
		emitError(message: string): void {
			worker.onerror?.(new ErrorEvent("error", { message }));
		},
		emitMessageError(): void {
			worker.onmessageerror?.(new MessageEvent("messageerror"));
		},
	};

	return worker;
}

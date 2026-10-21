export interface Transport<Outgoing, Incoming> {
	send(message: Outgoing): void;
	subscribe(handler: (message: Incoming) => void): () => void;
	dispose(): void;
}

export function createDirectTransportPair<A, B>(): [
	Transport<A, B>,
	Transport<B, A>,
] {
	type SideAListener = (message: B) => void;
	type SideBListener = (message: A) => void;
	const sideAListeners: Set<SideAListener> = new Set();
	const sideBListeners: Set<SideBListener> = new Set();
	let disposed: boolean = false;

	const sideA: Transport<A, B> = {
		send(message: A) {
			if (disposed) return;
			sideBListeners.forEach((listener) => listener(message));
		},
		subscribe(handler: SideAListener) {
			sideAListeners.add(handler);
			return () => {
				sideAListeners.delete(handler);
			};
		},
		dispose() {
			sideAListeners.clear();
			sideBListeners.clear();
			disposed = true;
		},
	};

	const sideB: Transport<B, A> = {
		send(message: B) {
			if (disposed) return;
			sideAListeners.forEach((listener) => listener(message));
		},
		subscribe(handler: (message: A) => void) {
			sideBListeners.add(handler);
			return () => {
				sideBListeners.delete(handler);
			};
		},
		dispose() {
			sideAListeners.clear();
			sideBListeners.clear();
			disposed = true;
		},
	};

	return [sideA, sideB];
}

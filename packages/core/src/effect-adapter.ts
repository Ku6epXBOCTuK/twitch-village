import type { Effect } from "effect";

export interface SyncRuntime {
	runSync<A, E>(effect: Effect.Effect<A, E, never>): A;
}

export interface EffectAdapterOptions {
	readonly runtime: SyncRuntime;
	readonly program: Effect.Effect<unknown, unknown>;
	readonly onError?: (error: unknown) => void;
}

export interface EffectAdapter {
	frame(): void;
	dispose(): void;
}

export function createEffectAdapter(
	options: EffectAdapterOptions,
): EffectAdapter {
	let disposed = false;

	return {
		frame: () => {
			if (disposed) return;
			try {
				options.runtime.runSync(options.program);
			} catch (error) {
				options.onError?.(error);
			}
		},
		dispose: () => {
			disposed = true;
		},
	};
}

import { Effect, Fiber, Queue, type Scope } from "effect";

export const HEARTBEAT_INTERVAL_MS = 500;
export const HEARTBEAT_TIMEOUT_MS = 2000;

export interface WatchdogOptions {
	readonly timeoutMs?: number;
}

export interface Watchdog {
	readonly paused: boolean;
	start(
		scope: Scope.Scope,
		onTimeout: Effect.Effect<void>,
	): Effect.Effect<void>;
	beat(): void;
	pause(): Effect.Effect<void>;
	resume(
		scope: Scope.Scope,
		onTimeout: Effect.Effect<void>,
	): Effect.Effect<void>;
	stop(): Effect.Effect<void>;
}

export function createWatchdog(options: WatchdogOptions = {}): Watchdog {
	const timeoutMs = options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS;
	let paused: boolean = false;
	let beats: Queue.Queue<void> | null = null;
	let fiber: Fiber.Fiber<void> | null = null;

	const watch = (
		queue: Queue.Queue<void>,
		onTimeout: Effect.Effect<void>,
	): Effect.Effect<void> =>
		Effect.gen(function* () {
			while (true) {
				yield* Queue.take(queue).pipe(Effect.timeout(timeoutMs));
			}
		}).pipe(Effect.catchTag("TimeoutError", () => onTimeout));

	const start = (
		scope: Scope.Scope,
		onTimeout: Effect.Effect<void>,
	): Effect.Effect<void> =>
		Effect.gen(function* () {
			yield* stop();
			const queue = yield* Queue.unbounded<void>();
			beats = queue;
			paused = false;
			fiber = yield* Effect.forkIn(
				watch(queue, onTimeout).pipe(
					Effect.onExit(() =>
						Effect.sync(() => {
							if (beats !== queue) return;
							beats = null;
							fiber = null;
						}),
					),
				),
				scope,
			);
		});

	const stop = (): Effect.Effect<void> =>
		Effect.gen(function* () {
			paused = false;
			beats = null;
			const current = fiber;
			fiber = null;
			if (current !== null) {
				yield* Fiber.interrupt(current);
			}
		});

	return {
		get paused() {
			return paused;
		},
		start,
		beat() {
			if (paused || beats === null) return;
			Queue.offerUnsafe(beats, undefined);
		},
		pause: () =>
			Effect.gen(function* () {
				if (paused) return;
				paused = true;
				beats = null;
				const current = fiber;
				fiber = null;
				if (current !== null) {
					yield* Fiber.interrupt(current);
				}
			}),
		resume: (scope, onTimeout) =>
			Effect.gen(function* () {
				if (!paused) return;
				yield* start(scope, onTimeout);
			}),
		stop,
	};
}

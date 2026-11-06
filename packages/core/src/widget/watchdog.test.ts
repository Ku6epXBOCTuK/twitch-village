import { Effect, type Scope, Ref } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import {
	createWatchdog,
	HEARTBEAT_TIMEOUT_MS,
	type Watchdog,
} from "./watchdog";

interface Harness {
	readonly watchdog: Watchdog;
	readonly scope: Scope.Scope;
	readonly fired: Ref.Ref<number>;
}

const withWatchdog = (
	program: (harness: Harness) => Generator<Effect.Effect<void>, void, unknown>,
): Promise<void> =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const scope = yield* Effect.scope;
				const fired = yield* Ref.make(0);
				const watchdog = createWatchdog();
				yield* Effect.gen(() => program({ watchdog, scope, fired }));
			}),
		).pipe(Effect.provide(TestClock.layer())),
	);

const onTimeout = (fired: Ref.Ref<number>) =>
	Ref.update(fired, (count) => count + 1);

const tick = Effect.yieldNow;

describe("createWatchdog", () => {
	it("is not paused by default", () => {
		expect(createWatchdog().paused).toBe(false);
	});

	it("times out after two seconds of silence", () =>
		withWatchdog(function* ({ watchdog, scope, fired }) {
			yield* watchdog.start(scope, onTimeout(fired));

			yield* TestClock.adjust(HEARTBEAT_TIMEOUT_MS - 1);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(0);

			yield* TestClock.adjust(1);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(1);
		}));

	it("restarts the countdown on every heartbeat", () =>
		withWatchdog(function* ({ watchdog, scope, fired }) {
			yield* watchdog.start(scope, onTimeout(fired));

			yield* TestClock.adjust(HEARTBEAT_TIMEOUT_MS - 500);
			watchdog.beat();
			yield* tick;

			yield* TestClock.adjust(HEARTBEAT_TIMEOUT_MS - 500);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(0);

			yield* TestClock.adjust(500);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(1);
		}));

	it("does not count time while paused", () =>
		withWatchdog(function* ({ watchdog, scope, fired }) {
			yield* watchdog.start(scope, onTimeout(fired));
			yield* TestClock.adjust(1000);
			yield* watchdog.pause();

			yield* TestClock.adjust(60_000);
			yield* tick;
			expect(watchdog.paused).toBe(true);
			expect(yield* Ref.get(fired)).toBe(0);

			yield* watchdog.resume(scope, onTimeout(fired));
			yield* TestClock.adjust(HEARTBEAT_TIMEOUT_MS - 1);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(0);

			yield* TestClock.adjust(1);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(1);
		}));

	it("stops counting after stop", () =>
		withWatchdog(function* ({ watchdog, scope, fired }) {
			yield* watchdog.start(scope, onTimeout(fired));
			yield* watchdog.stop();

			yield* TestClock.adjust(60_000);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(0);
		}));

	it("ignores heartbeats before start and while paused", () =>
		withWatchdog(function* ({ watchdog, scope, fired }) {
			watchdog.beat();
			yield* TestClock.adjust(60_000);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(0);

			yield* watchdog.start(scope, onTimeout(fired));
			yield* watchdog.pause();
			watchdog.beat();
			yield* TestClock.adjust(60_000);
			yield* tick;
			expect(yield* Ref.get(fired)).toBe(0);
		}));
});

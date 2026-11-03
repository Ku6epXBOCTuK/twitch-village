import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createEffectAdapter } from "./effect-adapter";

function runSync<A, E>(effect: Effect.Effect<A, E, never>): A {
	return Effect.runSync(effect);
}

describe("createEffectAdapter", () => {
	it("runs the program once per frame", () => {
		let frames = 0;
		const adapter = createEffectAdapter({
			runtime: { runSync },
			program: Effect.sync(() => {
				frames += 1;
			}),
		});

		adapter.frame();
		adapter.frame();

		expect(frames).toBe(2);
	});

	it("reports a failed frame to onError instead of throwing", () => {
		const errors: unknown[] = [];
		const adapter = createEffectAdapter({
			runtime: { runSync },
			program: Effect.sync(() => {
				throw new Error("boom");
			}),
			onError: (error) => {
				errors.push(error);
			},
		});

		expect(() => adapter.frame()).not.toThrow();
		expect(errors).toHaveLength(1);
	});

	it("keeps running after a failed frame", () => {
		let frames = 0;
		const adapter = createEffectAdapter({
			runtime: { runSync },
			program: Effect.sync(() => {
				frames += 1;
				if (frames === 1) throw new Error("boom");
			}),
		});

		adapter.frame();
		adapter.frame();

		expect(frames).toBe(2);
	});

	it("reports a typed failure to onError", () => {
		const errors: unknown[] = [];
		const adapter = createEffectAdapter({
			runtime: { runSync },
			program: Effect.fail("refused"),
			onError: (error) => {
				errors.push(error);
			},
		});

		expect(() => adapter.frame()).not.toThrow();
		expect(errors).toHaveLength(1);
	});

	it("ignores frames after dispose", () => {
		let frames = 0;
		const adapter = createEffectAdapter({
			runtime: { runSync },
			program: Effect.sync(() => {
				frames += 1;
			}),
		});

		adapter.frame();
		adapter.dispose();
		adapter.frame();

		expect(frames).toBe(1);
	});
});

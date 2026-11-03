import type { Application } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { EffectAdapter } from "../effect-adapter";
import { createTicker } from "./ticker";

describe("createTicker", () => {
	function setup() {
		const handlers = new Set<() => void>();
		const app = {
			ticker: {
				add: (handler: () => void) => {
					handlers.add(handler);
				},
				remove: (handler: () => void) => {
					handlers.delete(handler);
				},
			},
		} as unknown as Application;
		let frames = 0;
		const adapter: EffectAdapter = {
			frame: () => {
				frames += 1;
			},
			dispose: () => {},
		};

		return {
			app,
			adapter,
			handlers,
			frames: () => frames,
			fire: () => {
				for (const handler of handlers) handler();
			},
			ticker: () => createTicker({ app, adapter }),
		};
	}

	it("drives the adapter every frame", () => {
		const fake = setup();
		const ticker = fake.ticker();

		ticker.start();
		fake.fire();
		fake.fire();

		expect(fake.frames()).toBe(2);
	});

	it("stops driving the adapter after stop", () => {
		const fake = setup();
		const ticker = fake.ticker();

		ticker.start();
		fake.fire();
		ticker.stop();
		fake.fire();

		expect(fake.frames()).toBe(1);
		expect(fake.handlers.size).toBe(0);
	});

	it("registers a single handler when start is called twice", () => {
		const fake = setup();
		const ticker = fake.ticker();

		ticker.start();
		ticker.start();
		fake.fire();

		expect(fake.handlers.size).toBe(1);
		expect(fake.frames()).toBe(1);
	});

	it("does nothing when stopped before start", () => {
		const fake = setup();
		const ticker = fake.ticker();

		expect(() => ticker.stop()).not.toThrow();
		expect(fake.handlers.size).toBe(0);
	});

	it("does not dispose the adapter, so the ticker can be started again", () => {
		const handlers = new Set<() => void>();
		const app = {
			ticker: {
				add: (handler: () => void) => {
					handlers.add(handler);
				},
				remove: (handler: () => void) => {
					handlers.delete(handler);
				},
			},
		} as unknown as Application;
		let disposed = 0;
		let frames = 0;
		const adapter: EffectAdapter = {
			frame: () => {
				frames += 1;
			},
			dispose: () => {
				disposed += 1;
			},
		};
		const ticker = createTicker({ app, adapter });

		ticker.start();
		ticker.stop();
		ticker.start();
		for (const handler of handlers) handler();

		expect(disposed).toBe(0);
		expect(frames).toBe(1);
	});
});

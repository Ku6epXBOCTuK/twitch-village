import type { Application } from "pixi.js";
import { describe, expect, it } from "vitest";
import { createCoreApp } from "./create-app";
import type { CorePixiOptions } from "./types";

function createFakeFactory() {
	const calls: CorePixiOptions[] = [];
	const app = { stage: {} } as unknown as Application;
	const createApplication = (options: CorePixiOptions) => {
		calls.push(options);
		return app;
	};
	return { app, calls, createApplication };
}

describe("createCoreApp", () => {
	it("returns the application created by the injected factory", async () => {
		const { app, calls, createApplication } = createFakeFactory();

		const result = await createCoreApp(
			{ width: 1920, height: 1080 },
			{ createApplication },
		);

		expect(result).toBe(app);
		expect(calls).toHaveLength(1);
	});

	it("passes the requested size and the default render options", async () => {
		const { calls, createApplication } = createFakeFactory();

		await createCoreApp({ width: 1920, height: 1080 }, { createApplication });

		expect(calls[0]).toMatchObject({
			width: 1920,
			height: 1080,
			background: 0x000000,
			backgroundAlpha: 0,
			autoDensity: true,
			antialias: true,
		});
	});

	it("respects an explicit background alpha", async () => {
		const { calls, createApplication } = createFakeFactory();

		await createCoreApp(
			{ width: 800, height: 600, backgroundAlpha: 1 },
			{ createApplication },
		);

		expect(calls[0]).toMatchObject({ backgroundAlpha: 1 });
	});

	it("falls back to resolution 1 and no resize target outside the browser", async () => {
		const { calls, createApplication } = createFakeFactory();

		await createCoreApp({ width: 800, height: 600 }, { createApplication });

		expect(calls[0]).toMatchObject({ resolution: 1 });
		expect(calls[0]).not.toHaveProperty("resizeTo");
	});
});

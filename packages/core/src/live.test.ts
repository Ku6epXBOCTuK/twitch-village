import type { WidgetId } from "@tv/protocol";
import { Context, Layer, ManagedRuntime } from "effect";
import type { Application } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
	Clock,
	CoreApp,
	RenderTargets,
	clockLayer,
	renderTargetsLayer,
} from "./live";

function testLayer(app: Application) {
	return Layer.mergeAll(
		Layer.succeed(CoreApp, app),
		clockLayer,
		renderTargetsLayer,
	);
}

describe("coreLive", () => {
	it("exposes the services from a built graph", async () => {
		const app = { stage: {} } as unknown as Application;
		const runtime = ManagedRuntime.make(testLayer(app));

		const context = await runtime.context();

		expect(Context.get(context, CoreApp)).toBe(app);
		expect(typeof Context.get(context, Clock).now()).toBe("number");
		expect(typeof Context.get(context, RenderTargets).create).toBe("function");

		await runtime.dispose();
	});

	it("creates a separate render target per widget", async () => {
		const app = { stage: {} } as unknown as Application;
		const runtime = ManagedRuntime.make(testLayer(app));
		const context = await runtime.context();
		const targets = Context.get(context, RenderTargets);

		const first = targets.create("village#1" as WidgetId);
		const second = targets.create("village#1" as WidgetId);

		expect(first).not.toBe(second);

		await runtime.dispose();
	});
});

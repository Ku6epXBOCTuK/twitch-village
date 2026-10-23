import type { WidgetId } from "@tv/protocol";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { Application } from "pixi.js";
import { createPixiRenderTarget } from "./nodes/pixi-render-target";
import type { RenderTarget } from "./nodes/render-target";
import { createPixiApp } from "./pixi/create-app";
import type { CoreAppOptions } from "./pixi/types";

export class CoreApp extends Context.Service<CoreApp, Application>()(
	"CoreApp",
) {}

export class Clock extends Context.Service<
	Clock,
	{ readonly now: () => number }
>()("Clock") {}

export interface RenderTargetFactory {
	readonly create: (widgetId: WidgetId) => RenderTarget;
}

export class RenderTargets extends Context.Service<
	RenderTargets,
	RenderTargetFactory
>()("RenderTargets") {}

export function coreAppLayer(options: CoreAppOptions): Layer.Layer<CoreApp> {
	return Layer.effect(
		CoreApp,
		Effect.promise(() => createPixiApp(options)),
	);
}

export const clockLayer: Layer.Layer<Clock> = Layer.succeed(Clock, {
	now: () => performance.now(),
});

export const renderTargetsLayer: Layer.Layer<RenderTargets> = Layer.succeed(
	RenderTargets,
	{
		create: (widgetId) => createPixiRenderTarget({ widgetId }),
	},
);

export type CoreServices = CoreApp | Clock | RenderTargets;

export function coreLive(options: CoreAppOptions): Layer.Layer<CoreServices> {
	return Layer.mergeAll(coreAppLayer(options), clockLayer, renderTargetsLayer);
}

export function createCoreRuntime(options: CoreAppOptions) {
	return ManagedRuntime.make(coreLive(options));
}

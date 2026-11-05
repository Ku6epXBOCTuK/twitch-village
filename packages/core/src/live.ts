import type { ManifestLoadFailed, WidgetId } from "@tv/protocol";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { Application } from "pixi.js";
import type { AssetRegistry } from "./assets/asset-registry";
import type { EffectManifest } from "./effects/effect-manifest";
import type { EffectCompiler } from "./effects/effect-registry";
import { createPixiRenderTarget } from "./nodes/pixi-render-target";
import type { RenderTarget } from "./nodes/render-target";
import { createPixiApp } from "./pixi/create-app";
import type { CoreAppOptions } from "./pixi/types";
import { type CommandBusFactory, createCommandBus } from "./queue/command-bus";
import type { StatusStore } from "./status";
import type { Viewport } from "./viewport";
import type { WorkerPort } from "./widget/worker-transport";

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

export type WorkerFactory = (workerUrl: URL) => WorkerPort;

export class Workers extends Context.Service<Workers, WorkerFactory>()(
	"Workers",
) {}

export interface AssetRegistryFactory {
	readonly create: (widgetId: WidgetId) => AssetRegistry;
}

export class Assets extends Context.Service<Assets, AssetRegistryFactory>()(
	"Assets",
) {}

export class Effects extends Context.Service<Effects, EffectCompiler>()(
	"Effects",
) {}

export interface EffectManifestLoader {
	readonly load: (
		url: URL,
	) => Effect.Effect<EffectManifest, ManifestLoadFailed>;
}

export class Manifests extends Context.Service<
	Manifests,
	EffectManifestLoader
>()("Manifests") {}

export class Statuses extends Context.Service<Statuses, StatusStore>()(
	"Statuses",
) {}

export type ViewportSource = () => Viewport;

export class Viewports extends Context.Service<Viewports, ViewportSource>()(
	"Viewports",
) {}

export interface CommandBusFactoryService {
	readonly create: CommandBusFactory;
}

export class CommandBuses extends Context.Service<
	CommandBuses,
	CommandBusFactoryService
>()("CommandBuses") {}

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

export type CoreServices = CoreApp | Clock | CommandBuses | RenderTargets;

export const commandBusesLayer: Layer.Layer<CommandBuses> = Layer.succeed(
	CommandBuses,
	{ create: createCommandBus },
);

export const workersLayer: Layer.Layer<Workers> = Layer.succeed(
	Workers,
	(workerUrl) => new Worker(workerUrl, { type: "module" }),
);

export function coreLive(options: CoreAppOptions): Layer.Layer<CoreServices> {
	return Layer.mergeAll(
		coreAppLayer(options),
		clockLayer,
		commandBusesLayer,
		renderTargetsLayer,
	);
}

export function createCoreRuntime(options: CoreAppOptions) {
	return ManagedRuntime.make(coreLive(options));
}

import type { Application } from "pixi.js";
import type { CoreAppDeps, CoreAppOptions, CorePixiOptions } from "./types";

export async function createCoreApp(
	options: CoreAppOptions,
	deps: CoreAppDeps,
): Promise<Application> {
	const pixiOptions: CorePixiOptions = {
		width: options.width,
		height: options.height,
		background: 0x000000,
		backgroundAlpha: options.backgroundAlpha ?? 0,
		autoDensity: true,
		antialias: true,
		...(typeof window !== "undefined"
			? { resizeTo: window, resolution: window.devicePixelRatio ?? 1 }
			: { resolution: 1 }),
	};

	const app = await deps.createApplication(pixiOptions);
	return app;
}

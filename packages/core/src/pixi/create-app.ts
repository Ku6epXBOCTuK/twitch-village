import { Application } from "pixi.js";
import type { CoreAppOptions, CorePixiOptions } from "./types";

export function buildPixiOptions(options: CoreAppOptions): CorePixiOptions {
	return {
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
}

export async function createPixiApp(
	options: CoreAppOptions,
): Promise<Application> {
	const app = new Application();
	await app.init(buildPixiOptions(options));
	return app;
}

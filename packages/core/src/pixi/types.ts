import type { Application, ApplicationOptions } from "pixi.js";

export interface CoreAppOptions {
	width: number;
	height: number;
	backgroundAlpha?: number;
}

export type CorePixiOptions = Partial<ApplicationOptions> & {
	width: number;
	height: number;
};

export interface CoreAppDeps {
	createApplication: (
		options: CorePixiOptions,
	) => Promise<Application> | Application;
}

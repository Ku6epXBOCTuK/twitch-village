import type { ApplicationOptions } from "pixi.js";

export interface CoreAppOptions {
	width: number;
	height: number;
	backgroundAlpha?: number;
}

export type CorePixiOptions = Partial<ApplicationOptions> & {
	width: number;
	height: number;
};

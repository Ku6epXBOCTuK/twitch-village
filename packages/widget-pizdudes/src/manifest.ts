import type { WidgetId } from "@tv/protocol";
import { ASSET_BUNDLE } from "./assets";

export const PIZDUDES_WIDGET_ID = "pizdudes" as WidgetId;

export interface PizdudesWidgetDefinition {
	readonly id: WidgetId;
	readonly assetBundle: string;
	readonly workerUrl: URL;
}

export const pizdudesWidget: PizdudesWidgetDefinition = {
	id: PIZDUDES_WIDGET_ID,
	assetBundle: ASSET_BUNDLE,
	workerUrl: new URL("./worker.ts", import.meta.url),
};

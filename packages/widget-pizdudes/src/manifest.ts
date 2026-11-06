import type { BundleId, WidgetId } from "@tv/protocol";
import { ASSET_BUNDLE } from "./assets";
import { PIZDUDES_WIDGET_ID } from "./constants";

export { PIZDUDES_WIDGET_ID };

export interface PizdudesWidgetDefinition {
	readonly id: WidgetId;
	readonly assetBundle: BundleId;
}

export const pizdudesWidget: PizdudesWidgetDefinition = {
	id: PIZDUDES_WIDGET_ID,
	assetBundle: ASSET_BUNDLE,
};

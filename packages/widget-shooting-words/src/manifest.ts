import type { BundleId, WidgetId } from "@tv/protocol";
import {
	SHOOTING_WORDS_ASSET_BUNDLE,
	SHOOTING_WORDS_WIDGET_ID,
} from "./constants";

export interface ShootingWordsWidgetDefinition {
	readonly id: WidgetId;
	readonly assetBundle: BundleId;
}

export const shootingWordsWidget: ShootingWordsWidgetDefinition = {
	id: SHOOTING_WORDS_WIDGET_ID,
	assetBundle: SHOOTING_WORDS_ASSET_BUNDLE,
};

export { SHOOTING_WORDS_ASSET_BUNDLE, SHOOTING_WORDS_WIDGET_ID };

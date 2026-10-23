import type { WidgetId } from "@tv/protocol";
import { describeRenderTargetContract } from "./render-target.contract";
import { createPixiRenderTarget } from "./pixi-render-target";

describeRenderTargetContract("PixiRenderTarget", (widgetId: WidgetId) =>
	createPixiRenderTarget({ widgetId }),
);

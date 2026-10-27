import type { NodeId, WidgetId } from "@tv/protocol";
import { describe, expect, it } from "vitest";
import { createPixiRenderTarget } from "./pixi-render-target";
import { describeRenderTargetContract } from "./render-target.contract";

const asNodeId = (value: string): NodeId => value as NodeId;

describeRenderTargetContract("PixiRenderTarget", (widgetId: WidgetId) =>
	createPixiRenderTarget({ widgetId }),
);

describe("PixiRenderTarget", () => {
	it("moves the view back under the root when the parent is null", () => {
		const target = createPixiRenderTarget({
			widgetId: "village" as WidgetId,
		});
		target.createNode(asNodeId("parent"), "container");
		target.createNode(asNodeId("child"), "sprite");
		target.setParent(asNodeId("child"), asNodeId("parent"), 0);
		expect(target.root.children).toHaveLength(1);

		target.setParent(asNodeId("child"), null, 0);

		expect(target.root.children).toHaveLength(2);
	});
});

import type { NodeId, WidgetId } from "@tv/protocol";
import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { createPixiRenderTarget } from "./pixi-render-target";
import { describeRenderTargetContract } from "./render-target.contract";

const asNodeId = (value: string): NodeId => value as NodeId;

// NOTE: AnimatedSprite.play starts Pixi's ticker, which needs requestAnimationFrame absent in Node
Object.assign(globalThis, {
	cancelAnimationFrame: () => {},
	requestAnimationFrame: () => 0,
});

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

	it("colors the sprite that carries the node content", () => {
		const target = createPixiRenderTarget({ widgetId: "village" as WidgetId });
		target.createNode(asNodeId("avatar"), "sprite");
		target.setSprite(asNodeId("avatar"), Texture.WHITE);

		target.setTint(asNodeId("avatar"), "#ff8800");

		expect(contentOf(target).tint).toBe(0xff8800);
	});

	it("clears the tint back to white when the command gives no color", () => {
		const target = createPixiRenderTarget({ widgetId: "village" as WidgetId });
		target.createNode(asNodeId("avatar"), "sprite");
		target.setSprite(asNodeId("avatar"), Texture.WHITE);
		target.setTint(asNodeId("avatar"), "#ff8800");

		target.setTint(asNodeId("avatar"), null);

		expect(contentOf(target).tint).toBe(0xffffff);
	});

	it("keeps the tint when the content is replaced", () => {
		const target = createPixiRenderTarget({ widgetId: "village" as WidgetId });
		target.createNode(asNodeId("avatar"), "sprite");
		target.setTint(asNodeId("avatar"), "#00ff00");

		target.setSprite(asNodeId("avatar"), Texture.WHITE);

		expect(contentOf(target).tint).toBe(0x00ff00);
	});

	it("runs an animation slower than one frame per second", () => {
		const target = createPixiRenderTarget({ widgetId: "village" as WidgetId });
		target.createNode(asNodeId("chef"), "sprite");

		target.setAnimation(asNodeId("chef"), [Texture.WHITE], 0.25, true);

		expect(contentOf(target)).toMatchObject({ animationSpeed: 0.25 / 60 });
	});
});

const contentOf = (
	target: ReturnType<typeof createPixiRenderTarget>,
): { tint: number; animationSpeed?: number } => {
	const content = target.root.children[0]?.children[0];
	if (content === undefined) {
		throw new Error("No content in the target");
	}
	return content as { tint: number; animationSpeed?: number };
};

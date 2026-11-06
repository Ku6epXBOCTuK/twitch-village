import { type NodeId, UnknownNode, type WidgetId } from "@tv/protocol";
import { Container, Graphics, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
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
	it("reports UnknownNode when the state has a node but its view is missing", () => {
		const target = createPixiRenderTarget({ widgetId: "village" as WidgetId });
		const nodeId = asNodeId("ghost");
		const addChild = vi.spyOn(Container.prototype, "addChild");
		addChild.mockImplementationOnce(() => {
			throw new Error("view was not attached");
		});

		try {
			expect(() => target.createNode(nodeId, "container")).toThrow(
				"view was not attached",
			);
		} finally {
			addChild.mockRestore();
		}

		let error: unknown;
		try {
			target.setTransform(nodeId, { x: 1 });
		} catch (cause: unknown) {
			error = cause;
		}
		expect(error).toBeInstanceOf(UnknownNode);
	});

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
	it("draws a rect as Graphics content", () => {
		const target = createPixiRenderTarget({ widgetId: "village" as WidgetId });
		target.createNode(asNodeId("plate"), "rect");

		target.setRectStyle(asNodeId("plate"), rectStyle());

		expect(contentViewOf(target)).toBeInstanceOf(Graphics);
	});

	it("replaces the previous Graphics when the rect style changes", () => {
		const target = createPixiRenderTarget({ widgetId: "village" as WidgetId });
		target.createNode(asNodeId("plate"), "rect");
		target.setRectStyle(asNodeId("plate"), rectStyle());
		const first = contentViewOf(target);

		target.setRectStyle(asNodeId("plate"), rectStyle({ width: 4 }));

		expect(first.destroyed).toBe(true);
		expect(contentViewOf(target)).not.toBe(first);
	});

	it("applies the rect alpha and keeps the tint", () => {
		const target = createPixiRenderTarget({ widgetId: "village" as WidgetId });
		target.createNode(asNodeId("plate"), "rect");
		target.setTint(asNodeId("plate"), "#00ff00");

		target.setRectStyle(asNodeId("plate"), rectStyle({ alpha: 0.5 }));

		expect(contentOf(target)).toMatchObject({ tint: 0x00ff00 });
		expect((contentOf(target) as { alpha?: number }).alpha).toBe(0.5);
	});
});

const rectStyle = (
	overrides: Partial<{
		width: number;
		height: number;
		radius: number;
		fill: string;
		alpha: number;
	}> = {},
): {
	width: number;
	height: number;
	radius: number;
	fill: string;
	alpha: number;
} => ({
	width: 120,
	height: 24,
	radius: 6,
	fill: "#ff8800",
	alpha: 1,
	...overrides,
});

const contentViewOf = (
	target: ReturnType<typeof createPixiRenderTarget>,
): Container => {
	const content = target.root.children[0]?.children[0];
	if (content === undefined) {
		throw new Error("No content in the target");
	}
	return content;
};

const contentOf = (
	target: ReturnType<typeof createPixiRenderTarget>,
): { tint: number; animationSpeed?: number } =>
	contentViewOf(target) as unknown as { tint: number; animationSpeed?: number };

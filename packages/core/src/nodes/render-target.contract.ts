import type { NodeId, WidgetId } from "@tv/protocol";
import { UnknownNode } from "@tv/protocol";
import type { Filter } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { RenderTarget } from "./render-target";

const asNodeId = (value: string): NodeId => value as NodeId;

const stubFilter = (): Filter => ({ uniforms: {} }) as unknown as Filter;

const widgetId = "village" as WidgetId;

export function describeRenderTargetContract(
	name: string,
	create: (widgetId: WidgetId) => RenderTarget,
): void {
	describe(name, () => {
		it("reports a created node in the snapshot", () => {
			const target = create(widgetId);

			target.createNode(asNodeId("avatar:1"), "container");

			const nodes = target.snapshot().nodes;
			expect(nodes).toHaveLength(1);
			expect(nodes[0]?.nodeId).toBe("avatar:1");
			expect(nodes[0]?.kind).toBe("container");
			expect(nodes[0]?.content).toBe("none");
			expect(nodes[0]?.parentId).toBeUndefined();
		});

		it("keeps the parent and the order of a node", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("root"), "container");
			target.createNode(asNodeId("child"), "sprite");

			target.setParent(asNodeId("child"), asNodeId("root"), 3);

			const child = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "child");
			expect(child?.parentId).toBe("root");
			expect(child?.order).toBe(3);
		});

		it("merges partial transforms", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.setTransform(asNodeId("avatar:1"), { x: 10, y: 20 });
			target.setTransform(asNodeId("avatar:1"), { alpha: 0.5 });

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "avatar:1");
			expect(node?.transform.x).toBe(10);
			expect(node?.transform.y).toBe(20);
			expect(node?.transform.alpha).toBe(0.5);
		});

		it("marks the node as a sprite", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.setSprite(asNodeId("avatar:1"), undefined as never);

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "avatar:1");
			expect(node?.content).toBe("sprite");
		});

		it("marks the node as an animation", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "animated");

			target.setAnimation(asNodeId("avatar:1"), [], 12, false);

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "avatar:1");
			expect(node?.content).toBe("animated");
			expect(node?.animation?.fps).toBe(12);
			expect(node?.animation?.loop).toBe(false);
			expect(node?.animation?.frameCount).toBe(0);
		});

		it("marks the node as text and keeps the style", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("label"), "text");

			target.setText(asNodeId("label"), "hello", {
				fontSize: 18,
				fill: "#ffffff",
				align: "center",
			});

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "label");
			expect(node?.content).toBe("text");
			expect(node?.text).toBe("hello");
			expect(node?.textStyle?.fontSize).toBe(18);
			expect(node?.textStyle?.align).toBe("center");
		});

		it("adds and removes filters", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.addFilter(asNodeId("avatar:1"), "glow", stubFilter());
			target.addFilter(asNodeId("avatar:1"), "shadow", stubFilter());
			target.removeFilter(asNodeId("avatar:1"), "glow");

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "avatar:1");
			expect(node?.filterIds).toEqual(["shadow"]);
		});

		it("records filter parameters", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.setFilterParam(asNodeId("avatar:1"), "glow", "intensity", 0.7);

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "avatar:1");
			expect(node?.filterParams).toEqual([
				{ effectId: "glow", param: "intensity", value: 0.7 },
			]);
		});

		it("removes a node together with its children", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("root"), "container");
			target.createNode(asNodeId("child"), "sprite");
			target.setParent(asNodeId("child"), asNodeId("root"), 0);

			target.removeNode(asNodeId("root"));

			expect(target.snapshot().nodes).toHaveLength(0);
		});

		it("rejects operations on an unknown node", () => {
			const target = create(widgetId);

			expect(() => target.setTransform(asNodeId("ghost"), { x: 1 })).toThrow(
				UnknownNode,
			);
		});
	});
}

import type { EffectId, NodeId, WidgetId } from "@tv/protocol";
import { InvalidCommand, UnknownNode } from "@tv/protocol";
import type { Filter } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { RenderTarget } from "./render-target";

const asNodeId = (value: string): NodeId => value as NodeId;
const asEffectId = (value: string): EffectId => value as EffectId;

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

		it("starts a node without a tint", () => {
			const target = create(widgetId);

			target.createNode(asNodeId("avatar:1"), "sprite");

			expect(
				target.snapshot().nodes.find((node) => node.nodeId === "avatar:1")
					?.tint,
			).toBeNull();
		});

		it("keeps the tint of a node in the snapshot", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.setTint(asNodeId("avatar:1"), "#ff8800");

			expect(
				target.snapshot().nodes.find((node) => node.nodeId === "avatar:1")
					?.tint,
			).toBe("#ff8800");
		});

		it("clears the tint when the command gives no color", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");
			target.setTint(asNodeId("avatar:1"), "#ff8800");

			target.setTint(asNodeId("avatar:1"), null);

			expect(
				target.snapshot().nodes.find((node) => node.nodeId === "avatar:1")
					?.tint,
			).toBeNull();
		});

		it("keeps the tint when the transform changes", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");
			target.setTint(asNodeId("avatar:1"), "#00ff00");

			target.setTransform(asNodeId("avatar:1"), { x: 5, y: 7 });

			const node = target
				.snapshot()
				.nodes.find((snapshot) => snapshot.nodeId === "avatar:1");
			expect(node?.tint).toBe("#00ff00");
			expect(node?.transform.x).toBe(5);
		});

		it("rejects a tint for an unknown node with UnknownNode", () => {
			const target = create(widgetId);

			expect(() => target.setTint(asNodeId("ghost"), "#ff8800")).toThrow(
				UnknownNode,
			);
		});

		it("detaches a node to the root when the parent is null", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("parent"), "container");
			target.createNode(asNodeId("child"), "sprite");
			target.setParent(asNodeId("child"), asNodeId("parent"), 0);

			target.setParent(asNodeId("child"), null, 0);

			const child = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "child");
			expect(child?.parentId).toBeUndefined();
		});

		it("removes a re-parented node with its new parent", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("root"), "container");
			target.createNode(asNodeId("other"), "container");
			target.createNode(asNodeId("child"), "sprite");
			target.setParent(asNodeId("child"), asNodeId("root"), 0);
			target.setParent(asNodeId("child"), asNodeId("other"), 0);

			const removed = target.removeNode(asNodeId("other"));

			expect([...removed].sort()).toEqual(["child", "other"]);
			expect(target.has(asNodeId("root"))).toBe(true);
			expect(target.has(asNodeId("child"))).toBe(false);
		});

		it("keeps a re-parented node when its old parent is removed", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("root"), "container");
			target.createNode(asNodeId("other"), "container");
			target.createNode(asNodeId("child"), "sprite");
			target.setParent(asNodeId("child"), asNodeId("root"), 0);
			target.setParent(asNodeId("child"), asNodeId("other"), 0);

			target.removeNode(asNodeId("root"));

			expect(target.has(asNodeId("child"))).toBe(true);
			expect(target.has(asNodeId("other"))).toBe(true);
		});

		it("rejects self-parenting with InvalidCommand", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			expect(() =>
				target.setParent(asNodeId("avatar:1"), asNodeId("avatar:1"), 0),
			).toThrow(InvalidCommand);

			const node = target
				.snapshot()
				.nodes.find((item) => item.nodeId === "avatar:1");
			expect(node?.parentId).toBeUndefined();
		});

		it("rejects a parent from the node's own subtree with InvalidCommand", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("parent"), "container");
			target.createNode(asNodeId("child"), "sprite");
			target.setParent(asNodeId("child"), asNodeId("parent"), 0);

			expect(() =>
				target.setParent(asNodeId("parent"), asNodeId("child"), 0),
			).toThrow(InvalidCommand);

			const parent = target
				.snapshot()
				.nodes.find((item) => item.nodeId === "parent");
			expect(parent?.parentId).toBeUndefined();
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
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.setAnimation(asNodeId("avatar:1"), [], 12, false);

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "avatar:1");
			expect(node?.content).toBe("animated");
			expect(node?.animation?.fps).toBe(12);
			expect(node?.animation?.loop).toBe(false);
			expect(node?.animation?.frameCount).toBe(0);
		});

		it("keeps a fractional fps in the snapshot", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.setAnimation(asNodeId("avatar:1"), [], 0.25, true);

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "avatar:1");
			expect(node?.animation?.fps).toBe(0.25);
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

		it("marks the node as a rect and keeps its style", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("plate"), "rect");

			target.setRectStyle(asNodeId("plate"), {
				width: 120,
				height: 24,
				radius: 6,
				fill: "#ff8800",
				alpha: 1,
			});

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "plate");
			expect(node?.kind).toBe("rect");
			expect(node?.content).toBe("rect");
			expect(node?.rect).toEqual({
				width: 120,
				height: 24,
				radius: 6,
				fill: "#ff8800",
				alpha: 1,
			});
		});

		it("replaces the rect style on the next command", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("plate"), "rect");
			target.setRectStyle(asNodeId("plate"), {
				width: 120,
				height: 24,
				radius: 6,
				fill: "#ff8800",
				alpha: 1,
			});

			target.setRectStyle(asNodeId("plate"), {
				width: 4,
				height: 200,
				radius: 0,
				fill: "#0000ff",
				alpha: 0.5,
			});

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "plate");
			expect(node?.rect).toMatchObject({
				width: 4,
				height: 200,
				radius: 0,
				fill: "#0000ff",
				alpha: 0.5,
			});
		});

		it("adds and removes filters", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.addFilter(asNodeId("avatar:1"), asEffectId("glow"), stubFilter());
			target.addFilter(
				asNodeId("avatar:1"),
				asEffectId("shadow"),
				stubFilter(),
			);
			target.removeFilter(asNodeId("avatar:1"), asEffectId("glow"));

			const node = target
				.snapshot()
				.nodes.find((node) => node.nodeId === "avatar:1");
			expect(node?.filterIds).toEqual(["shadow"]);
		});

		it("records filter parameters", () => {
			const target = create(widgetId);
			target.createNode(asNodeId("avatar:1"), "sprite");

			target.setFilterParam(
				asNodeId("avatar:1"),
				asEffectId("glow"),
				"intensity",
				0.7,
			);

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
			target.createNode(asNodeId("survivor"), "sprite");
			target.setParent(asNodeId("child"), asNodeId("root"), 0);

			const removed = target.removeNode(asNodeId("root"));

			expect(target.snapshot().nodes.map((node) => node.nodeId)).toEqual([
				"survivor",
			]);
			expect([...removed].sort()).toEqual(["child", "root"]);
			expect(target.has(asNodeId("root"))).toBe(false);
			expect(target.has(asNodeId("child"))).toBe(false);
			expect(target.has(asNodeId("survivor"))).toBe(true);
		});

		it("reports whether a node exists", () => {
			const target = create(widgetId);

			expect(target.has(asNodeId("avatar:1"))).toBe(false);

			target.createNode(asNodeId("avatar:1"), "sprite");

			expect(target.has(asNodeId("avatar:1"))).toBe(true);
		});

		it("rejects removing an unknown node", () => {
			const target = create(widgetId);

			expect(() => target.removeNode(asNodeId("ghost"))).toThrow(UnknownNode);
		});

		it("rejects operations on an unknown node", () => {
			const target = create(widgetId);

			expect(() => target.setTransform(asNodeId("ghost"), { x: 1 })).toThrow(
				UnknownNode,
			);
		});
	});
}

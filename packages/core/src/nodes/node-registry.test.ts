import type { NodeId, WidgetId } from "@tv/protocol";
import { InvalidCommand, UnknownNode } from "@tv/protocol";
import { describe, expect, it } from "vitest";
import { createFakeRenderTarget } from "../testing/fake-render-target";
import { createNodeRegistry, type NodeRegistry } from "./node-registry";

const widgetId = "village" as WidgetId;

const asNodeId = (value: string): NodeId => value as NodeId;

const setup = (): {
	registry: NodeRegistry;
	target: ReturnType<typeof createFakeRenderTarget>;
} => {
	const target = createFakeRenderTarget({ widgetId });
	return { registry: createNodeRegistry({ widgetId, target }), target };
};

const removeCalls = (
	calls: ReturnType<typeof createFakeRenderTarget>["calls"],
): readonly NodeId[] =>
	calls
		.filter((call) => call.method === "removeNode")
		.map((call) => call.args[0] as NodeId);

describe("NodeRegistry", () => {
	it("creates a node through the render target", () => {
		const { registry, target } = setup();

		const handle = registry.create(asNodeId("avatar:1"), "sprite");

		expect(handle).toEqual({ nodeId: "avatar:1", kind: "sprite" });
		expect(target.calls).toEqual([
			{ method: "createNode", args: ["avatar:1", "sprite"] },
		]);
		expect(target.snapshot().nodes).toHaveLength(1);
	});

	it("keeps top-level nodes under the widget root", () => {
		const { registry, target } = setup();

		registry.create(asNodeId("avatar:1"), "sprite");

		expect(target.snapshot().nodes[0]?.parentId).toBeUndefined();
	});

	it("lists the handles in insertion order", () => {
		const { registry } = setup();

		registry.create(asNodeId("root"), "container");
		registry.create(asNodeId("child"), "sprite");
		registry.create(asNodeId("label"), "text");

		expect(registry.list().map((handle) => handle.nodeId)).toEqual([
			"root",
			"child",
			"label",
		]);
	});

	it("returns a registered handle with get and has", () => {
		const { registry } = setup();
		registry.create(asNodeId("avatar:1"), "sprite");

		expect(registry.has(asNodeId("avatar:1"))).toBe(true);
		expect(registry.get(asNodeId("avatar:1"))).toEqual({
			nodeId: "avatar:1",
			kind: "sprite",
		});
		expect(registry.has(asNodeId("ghost"))).toBe(false);
	});

	it("rejects a duplicate node id", () => {
		const { registry, target } = setup();
		registry.create(asNodeId("avatar:1"), "sprite");

		expect(() => registry.create(asNodeId("avatar:1"), "sprite")).toThrow(
			InvalidCommand,
		);
		expect(registry.list()).toHaveLength(1);
		expect(
			target.calls.filter((call) => call.method === "createNode"),
		).toHaveLength(1);
	});

	it("rejects get on an unknown node", () => {
		const { registry } = setup();

		expect(() => registry.get(asNodeId("ghost"))).toThrow(UnknownNode);
	});

	it("rejects remove on an unknown node", () => {
		const { registry } = setup();

		expect(() => registry.remove(asNodeId("ghost"))).toThrow(UnknownNode);
	});

	it("removes a node together with its subtree", () => {
		const { registry, target } = setup();
		registry.create(asNodeId("root"), "container");
		registry.create(asNodeId("child"), "container");
		registry.create(asNodeId("grandchild"), "sprite");
		registry.create(asNodeId("survivor"), "sprite");
		target.setParent(asNodeId("child"), asNodeId("root"), 0);
		target.setParent(asNodeId("grandchild"), asNodeId("child"), 0);

		registry.remove(asNodeId("root"));

		expect(removeCalls(target.calls)).toEqual(["grandchild", "child", "root"]);
		expect(registry.list().map((handle) => handle.nodeId)).toEqual([
			"survivor",
		]);
		expect(target.snapshot().nodes.map((node) => node.nodeId)).toEqual([
			"survivor",
		]);
	});

	it("removes every node with removeAll", () => {
		const { registry, target } = setup();
		registry.create(asNodeId("root"), "container");
		registry.create(asNodeId("child"), "sprite");
		target.setParent(asNodeId("child"), asNodeId("root"), 0);
		registry.create(asNodeId("label"), "text");

		registry.removeAll();

		expect(registry.list()).toEqual([]);
		expect(target.snapshot().nodes).toEqual([]);
		expect(new Set(removeCalls(target.calls))).toEqual(
			new Set(["root", "child", "label"]),
		);
	});

	it("does nothing on removeAll with an empty registry", () => {
		const { registry, target } = setup();

		registry.removeAll();

		expect(removeCalls(target.calls)).toEqual([]);
		expect(registry.list()).toEqual([]);
	});
});

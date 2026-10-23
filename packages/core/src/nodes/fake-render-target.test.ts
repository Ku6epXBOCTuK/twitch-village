import type { NodeId, WidgetId } from "@tv/protocol";
import { describe, expect, it } from "vitest";
import { createFakeRenderTarget } from "../testing/fake-render-target";
import { describeRenderTargetContract } from "./render-target.contract";

const asNodeId = (value: string): NodeId => value as NodeId;

describeRenderTargetContract("FakeRenderTarget", (widgetId: WidgetId) =>
	createFakeRenderTarget({ widgetId }),
);

describe("FakeRenderTarget", () => {
	it("records the calls it received", () => {
		const target = createFakeRenderTarget({
			widgetId: "village" as WidgetId,
		});

		target.createNode(asNodeId("avatar:1"), "sprite");
		target.setTransform(asNodeId("avatar:1"), { x: 1 });

		expect(target.calls.map((call) => call.method)).toEqual([
			"createNode",
			"setTransform",
		]);
	});
});

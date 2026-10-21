import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import * as protocol from "./index";
import type { NodeId, WidgetId } from "./ids";

const expectedValues = [
	"PROTOCOL_VERSION",
	"PROTOCOL_MAJOR",
	"isCompatible",
	"NodeId",
	"AssetId",
	"EffectId",
	"ViewerId",
	"WidgetId",
	"CreateNode",
	"RemoveNode",
	"SetParent",
	"SetTransform",
	"SetSprite",
	"SetAnimation",
	"SetText",
	"AddFilter",
	"RemoveFilter",
	"SetFilterParam",
	"Batch",
	"Ready",
	"Heartbeat",
	"LeafCommandSchema",
	"RenderCommandSchema",
	"ViewerJoined",
	"ViewerMessage",
	"ViewerGift",
	"ViewerLeft",
	"ViewerEventSchema",
	"WidgetInit",
	"WidgetViewerEvent",
	"WidgetViewport",
	"WidgetPause",
	"WidgetResume",
	"WidgetDispose",
	"WidgetEventSchema",
	"CoreToWidgetSchema",
	"WidgetToCoreSchema",
	"InvalidCommand",
	"UnknownNode",
	"AssetNotFound",
	"EffectNotFound",
	"EffectCompileFailed",
	"InvalidEffectParam",
	"RenderFailed",
	"QueueOverflow",
	"WidgetTimeout",
	"WidgetCrashed",
	"ProtocolMismatch",
	"createDirectTransportPair",
];

describe("public api of @tv/protocol", () => {
	it("exports every public value", () => {
		const missing = expectedValues.filter(
			(name) =>
				!(name in protocol) ||
				protocol[name as keyof typeof protocol] === undefined,
		);

		expect(missing).toEqual([]);
	});

	it("does not leak internal helpers", () => {
		expect("identifier" in protocol).toBe(false);
	});

	it("decodes a command through the barrel", () => {
		const decoded = Schema.decodeUnknownSync(protocol.RenderCommandSchema)({
			_tag: "CreateNode",
			nodeId: "avatar:42",
			kind: "sprite",
		});

		expect(decoded).toEqual({
			_tag: "CreateNode",
			nodeId: "avatar:42",
			kind: "sprite",
		});
	});

	it("decodes an event through the barrel", () => {
		const decoded = Schema.decodeUnknownSync(protocol.WidgetEventSchema)({
			_tag: "Viewport",
			w: 1920,
			h: 1080,
		});

		expect(decoded).toEqual({ _tag: "Viewport", w: 1920, h: 1080 });
	});

	it("exposes the error classes", () => {
		const error = new protocol.UnknownNode({
			widgetId: "village" as WidgetId,
			message: "node not found",
			nodeId: "avatar:42" as NodeId,
		});

		expect(error._tag).toBe("UnknownNode");
	});
});

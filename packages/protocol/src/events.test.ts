import { Match } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { describe, expect, it } from "vitest";
import {
	CoreToWidgetSchema,
	ViewerEventSchema,
	WidgetEventSchema,
	WidgetToCoreSchema,
} from "./events";

type WidgetEvent = Schema.Schema.Type<typeof WidgetEventSchema>;

declare const structuredClone: <T>(value: T) => T;

const formatIssue = SchemaIssue.makeFormatterDefault();

const tagOf = (input: unknown): string => {
	if (typeof input === "object" && input !== null && "_tag" in input) {
		return String(input._tag);
	}

	return typeof input;
};

const reader = (schema: Schema.Decoder<unknown>) => {
	return {
		decode: (input: unknown): unknown => {
			const result = Schema.decodeUnknownResult(schema)(input, {
				onExcessProperty: "error",
			});

			if (result._tag === "Failure") {
				throw new Error(
					`${tagOf(input)} was rejected:\n${formatIssue(result.failure.issue)}`,
				);
			}

			return result.success;
		},
		expectInvalid: (input: unknown): void => {
			const result = Schema.decodeUnknownResult(schema)(input, {
				onExcessProperty: "error",
			});

			if (result._tag === "Success") {
				throw new Error(
					`${tagOf(input)} was accepted, but should be rejected: ${JSON.stringify(result.success)}`,
				);
			}
		},
	};
};

const viewer = reader(ViewerEventSchema);
const widget = reader(WidgetEventSchema);
const fromCore = reader(CoreToWidgetSchema);
const toCore = reader(WidgetToCoreSchema);

const viewerId = "123456";

const describeEvent = (event: WidgetEvent): string => {
	return Match.valueTags(event, {
		Init: (e) => e._tag,
		ViewerEvent: (e) => e._tag,
		Viewport: (e) => e._tag,
		Pause: (e) => e._tag,
		Resume: (e) => e._tag,
		Dispose: (e) => e._tag,
	});
};

describe("ViewerEventSchema", () => {
	it("accepts every viewer event", () => {
		const events: ReadonlyArray<unknown> = [
			{
				_tag: "ViewerJoined",
				viewerId,
				displayName: "Ку6ep",
				color: "#ff00aa",
			},
			{ _tag: "ViewerJoined", viewerId, displayName: "Ку6ep" },
			{ _tag: "ViewerMessage", viewerId, text: "привет", isCommand: false },
			{ _tag: "ViewerMessage", viewerId, text: "!sounds", isCommand: true },
			{ _tag: "ViewerGift", viewerId, amount: 100, kind: "bits" },
			{ _tag: "ViewerGift", viewerId, amount: 1, kind: "sub" },
			{ _tag: "ViewerGift", viewerId, amount: 5, kind: "giftSub" },
			{ _tag: "ViewerLeft", viewerId },
		];

		for (const [index, event] of events.entries()) {
			expect(
				() => viewer.decode(event),
				`viewer event #${index}`,
			).not.toThrow();
		}
	});

	it("rejects an unknown tag", () => {
		viewer.expectInvalid({ _tag: "ViewerRaid", viewerId });
	});

	it("rejects a malformed viewerId", () => {
		viewer.expectInvalid({ _tag: "ViewerLeft", viewerId: "a b" });
	});

	it("rejects an empty display name", () => {
		viewer.expectInvalid({
			_tag: "ViewerJoined",
			viewerId,
			displayName: "",
		});
	});

	it("rejects a color that is not hex", () => {
		viewer.expectInvalid({
			_tag: "ViewerJoined",
			viewerId,
			displayName: "Ку6ep",
			color: "red",
		});
	});

	it("rejects an empty message", () => {
		viewer.expectInvalid({ _tag: "ViewerMessage", viewerId, text: "" });
	});

	it("rejects gift kinds outside bits, sub, giftSub", () => {
		viewer.expectInvalid({
			_tag: "ViewerGift",
			viewerId,
			amount: 1,
			kind: "raid",
		});
	});

	it("rejects a gift amount below 1", () => {
		viewer.expectInvalid({
			_tag: "ViewerGift",
			viewerId,
			amount: 0,
			kind: "bits",
		});
	});

	it("rejects extra properties", () => {
		viewer.expectInvalid({ _tag: "ViewerLeft", viewerId, extra: true });
	});
});

describe("WidgetEventSchema", () => {
	it("accepts every widget event", () => {
		const events: ReadonlyArray<unknown> = [
			{
				_tag: "Init",
				widgetId: "village",
				config: { maxViewers: 20 },
				viewport: { w: 1920, h: 1080 },
			},
			{
				_tag: "ViewerEvent",
				event: { _tag: "ViewerLeft", viewerId },
			},
			{ _tag: "Viewport", w: 1280, h: 720 },
			{ _tag: "Pause" },
			{ _tag: "Resume" },
			{ _tag: "Dispose" },
		];

		for (const [index, event] of events.entries()) {
			expect(
				() => widget.decode(event),
				`widget event #${index}`,
			).not.toThrow();
		}
	});

	it("init requires widgetId, config and viewport", () => {
		widget.expectInvalid({
			_tag: "Init",
			config: {},
			viewport: { w: 1920, h: 1080 },
		});
		widget.expectInvalid({ _tag: "Init", widgetId: "village", config: {} });
	});

	it("rejects an unknown viewer event inside ViewerEvent", () => {
		widget.expectInvalid({
			_tag: "ViewerEvent",
			event: { _tag: "ViewerRaid", viewerId },
		});
	});

	it("rejects a missing viewport size", () => {
		widget.expectInvalid({ _tag: "Viewport", w: 1280 });
	});

	it("matches every variant exhaustively", () => {
		expect(describeEvent(widget.decode({ _tag: "Pause" }) as WidgetEvent)).toBe(
			"Pause",
		);
		expect(
			describeEvent(widget.decode({ _tag: "Dispose" }) as WidgetEvent),
		).toBe("Dispose");
	});
});

describe("envelopes", () => {
	it("CoreToWidget carries protocolVersion and a widget event", () => {
		expect(
			fromCore.decode({ protocolVersion: 1, message: { _tag: "Pause" } }),
		).toEqual({ protocolVersion: 1, message: { _tag: "Pause" } });
	});

	it("WidgetToCore carries protocolVersion and a render command", () => {
		expect(
			toCore.decode({
				protocolVersion: 1,
				message: { _tag: "Heartbeat", tick: 7 },
			}),
		).toEqual({
			protocolVersion: 1,
			message: { _tag: "Heartbeat", tick: 7 },
		});
	});

	it("rejects a missing protocolVersion", () => {
		fromCore.expectInvalid({ message: { _tag: "Pause" } });
		toCore.expectInvalid({ message: { _tag: "Heartbeat", tick: 7 } });
	});

	it("rejects a non-integer protocolVersion", () => {
		fromCore.expectInvalid({
			protocolVersion: "1",
			message: { _tag: "Pause" },
		});
		toCore.expectInvalid({
			protocolVersion: 1.5,
			message: { _tag: "Heartbeat", tick: 7 },
		});
	});

	it("rejects extra fields in the envelope", () => {
		fromCore.expectInvalid({
			protocolVersion: 1,
			message: { _tag: "Pause" },
			extra: true,
		});
	});

	it("roundtrips through structuredClone", () => {
		const envelope = {
			protocolVersion: 1,
			message: {
				_tag: "ViewerEvent",
				event: {
					_tag: "ViewerMessage",
					viewerId,
					text: "hi",
					isCommand: false,
				},
			},
		};

		expect(() => fromCore.decode(structuredClone(envelope))).not.toThrow();
	});
});

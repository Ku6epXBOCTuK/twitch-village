import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
	CoreToWidgetSchema,
	PROTOCOL_MAJOR,
	PROTOCOL_VERSION,
	RenderCommandSchema,
	WidgetEventSchema,
	WidgetToCoreSchema,
	createDirectTransportPair,
	isCompatible,
} from "./index";
import type { CoreToWidget, WidgetToCore } from "./index";
import type { WidgetId } from "./ids";

declare const structuredClone: <T>(value: T) => T;

const widgetId = "village" as WidgetId;

const initEvent = {
	_tag: "Init",
	widgetId,
	config: { theme: "day" },
	viewport: { w: 1920, h: 1080 },
} as const;

describe("protocol integration", () => {
	it("delivers an event from core to the widget and a command back", () => {
		const [coreSide, widgetSide] = createDirectTransportPair<
			CoreToWidget,
			WidgetToCore
		>();

		const receivedEvents: unknown[] = [];
		const receivedCommands: unknown[] = [];

		widgetSide.subscribe((envelope) => {
			const decoded = Schema.decodeUnknownSync(CoreToWidgetSchema)(envelope);
			receivedEvents.push(
				Schema.decodeUnknownSync(WidgetEventSchema)(decoded.message),
			);
		});

		coreSide.subscribe((envelope) => {
			const decoded = Schema.decodeUnknownSync(WidgetToCoreSchema)(envelope);
			receivedCommands.push(
				Schema.decodeUnknownSync(RenderCommandSchema)(decoded.message),
			);
		});

		coreSide.send({
			protocolVersion: PROTOCOL_VERSION,
			message: initEvent,
		});

		widgetSide.send({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Ready", widgetId, protocolVersion: PROTOCOL_VERSION },
		});

		expect(receivedEvents).toHaveLength(1);
		expect(receivedEvents[0]).toEqual(initEvent);
		expect(receivedCommands).toHaveLength(1);
		expect(receivedCommands[0]).toEqual({
			_tag: "Ready",
			widgetId,
			protocolVersion: PROTOCOL_VERSION,
		});
	});

	it("rejects an envelope with an incompatible protocol version", () => {
		const [coreSide, widgetSide] = createDirectTransportPair<
			CoreToWidget,
			WidgetToCore
		>();

		const mismatches: string[] = [];
		const receivedEvents: unknown[] = [];

		widgetSide.subscribe((envelope) => {
			if (!isCompatible(envelope.protocolVersion)) {
				mismatches.push(
					`expected ${PROTOCOL_MAJOR}, got ${envelope.protocolVersion}`,
				);
				return;
			}
			receivedEvents.push(envelope.message);
		});

		coreSide.send({
			protocolVersion: PROTOCOL_MAJOR + 1,
			message: initEvent,
		});

		expect(mismatches).toHaveLength(1);
		expect(receivedEvents).toHaveLength(0);
	});

	it("rejects a command with an unknown tag", () => {
		const [coreSide, widgetSide] = createDirectTransportPair<
			CoreToWidget,
			WidgetToCore
		>();

		coreSide.subscribe((envelope) => {
			Schema.decodeUnknownSync(WidgetToCoreSchema)(envelope);
			Schema.decodeUnknownSync(RenderCommandSchema)(envelope.message);
		});

		expect(() => {
			widgetSide.send({
				protocolVersion: PROTOCOL_VERSION,
				message: {
					_tag: "NoSuchCommand",
				} as unknown as WidgetToCore["message"],
			});
		}).toThrow();
	});

	it("keeps the heartbeat loop alive", () => {
		const [coreSide, widgetSide] = createDirectTransportPair<
			CoreToWidget,
			WidgetToCore
		>();

		const ticks: number[] = [];

		coreSide.subscribe((envelope) => {
			const decoded = Schema.decodeUnknownSync(WidgetToCoreSchema)(envelope);
			const command = Schema.decodeUnknownSync(RenderCommandSchema)(
				decoded.message,
			);
			if (command._tag === "Heartbeat") {
				ticks.push(command.tick);
			}
		});

		widgetSide.send({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Heartbeat", tick: 1 },
		});
		widgetSide.send({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Heartbeat", tick: 2 },
		});

		expect(ticks).toEqual([1, 2]);
	});

	it("survives the structured clone boundary", () => {
		const envelope = {
			protocolVersion: PROTOCOL_VERSION,
			message: initEvent,
		};

		const cloned = structuredClone(envelope);
		const decoded = Schema.decodeUnknownSync(CoreToWidgetSchema)(cloned);
		const event = Schema.decodeUnknownSync(WidgetEventSchema)(decoded.message);

		expect(event).toEqual(initEvent);
	});
});

import { Schema } from "effect";
import { RenderCommandSchema, ServiceMessageSchema } from "./commands";
import { ViewerId, WidgetId } from "./ids";

export const ViewerJoined = Schema.TaggedStruct("ViewerJoined", {
	viewerId: ViewerId,
	displayName: Schema.NonEmptyString,
	color: Schema.optional(
		Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
	),
});

export const ViewerMessage = Schema.TaggedStruct("ViewerMessage", {
	viewerId: ViewerId,
	text: Schema.NonEmptyString,
	isCommand: Schema.Boolean,
});

export const ViewerGift = Schema.TaggedStruct("ViewerGift", {
	viewerId: ViewerId,
	amount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
	kind: Schema.Literals(["bits", "sub", "giftSub"]),
});

export const ViewerLeft = Schema.TaggedStruct("ViewerLeft", {
	viewerId: ViewerId,
});

export const ViewerEventSchema = Schema.Union([
	ViewerJoined,
	ViewerMessage,
	ViewerGift,
	ViewerLeft,
]);

export const WidgetInit = Schema.TaggedStruct("Init", {
	widgetId: WidgetId,
	config: Schema.Unknown,
	viewport: Schema.Struct({
		w: Schema.Number,
		h: Schema.Number,
	}),
});

export const WidgetViewerEvent = Schema.TaggedStruct("ViewerEvent", {
	event: ViewerEventSchema,
});

export const WidgetViewport = Schema.TaggedStruct("Viewport", {
	w: Schema.Int,
	h: Schema.Int,
});

export const WidgetPause = Schema.TaggedStruct("Pause", {});
export const WidgetResume = Schema.TaggedStruct("Resume", {});
export const WidgetDispose = Schema.TaggedStruct("Dispose", {});

export const WidgetEventSchema = Schema.Union([
	WidgetInit,
	WidgetViewerEvent,
	WidgetViewport,
	WidgetPause,
	WidgetResume,
	WidgetDispose,
]);

export const CoreToWidgetSchema = Schema.Struct({
	protocolVersion: Schema.Int,
	message: WidgetEventSchema,
});

export const WidgetToCoreMessageSchema = Schema.Union([
	RenderCommandSchema,
	ServiceMessageSchema,
]);

export const WidgetToCoreSchema = Schema.Struct({
	protocolVersion: Schema.Int,
	message: WidgetToCoreMessageSchema,
});

export type ViewerEvent = Schema.Schema.Type<typeof ViewerEventSchema>;
export type WidgetEvent = Schema.Schema.Type<typeof WidgetEventSchema>;
export type CoreToWidget = Schema.Schema.Type<typeof CoreToWidgetSchema>;
export type WidgetToCore = Schema.Schema.Type<typeof WidgetToCoreSchema>;

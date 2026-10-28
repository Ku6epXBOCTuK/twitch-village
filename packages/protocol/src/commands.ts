import { Schema } from "effect";
import { AssetId, EffectId, NodeId, WidgetId } from "./ids";

export const CreateNode = Schema.TaggedStruct("CreateNode", {
	nodeId: NodeId,
	kind: Schema.Literals(["container", "sprite", "text"]),
});

export const RemoveNode = Schema.TaggedStruct("RemoveNode", {
	nodeId: NodeId,
});

export const SetParent = Schema.TaggedStruct("SetParent", {
	nodeId: NodeId,
	parentId: Schema.NullOr(NodeId),
	order: Schema.Int,
});

export const SetTransform = Schema.TaggedStruct("SetTransform", {
	nodeId: NodeId,
	x: Schema.optional(Schema.Number),
	y: Schema.optional(Schema.Number),
	scaleX: Schema.optional(Schema.Number),
	scaleY: Schema.optional(Schema.Number),
	rotation: Schema.optional(Schema.Number),
	alpha: Schema.optional(
		Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
	),
	visible: Schema.optional(Schema.Boolean),
});

export const SetSprite = Schema.TaggedStruct("SetSprite", {
	nodeId: NodeId,
	assetId: AssetId,
});

export const SetAnimation = Schema.TaggedStruct("SetAnimation", {
	nodeId: NodeId,
	assetIds: Schema.Array(AssetId),
	fps: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
	loop: Schema.Boolean,
});

export const SetText = Schema.TaggedStruct("SetText", {
	nodeId: NodeId,
	text: Schema.String,
	style: Schema.Struct({
		fontSize: Schema.Number,
		fill: Schema.String,
		align: Schema.Literals(["left", "center", "right"]),
	}),
});

export const AddFilter = Schema.TaggedStruct("AddFilter", {
	nodeId: NodeId,
	effectId: EffectId,
});

export const RemoveFilter = Schema.TaggedStruct("RemoveFilter", {
	nodeId: NodeId,
	effectId: EffectId,
});

export const SetFilterParam = Schema.TaggedStruct("SetFilterParam", {
	nodeId: NodeId,
	effectId: EffectId,
	param: Schema.String,
	value: Schema.Number,
});

export const LeafCommandSchema = Schema.Union([
	CreateNode,
	RemoveNode,
	SetParent,
	SetTransform,
	SetSprite,
	SetAnimation,
	SetText,
	AddFilter,
	RemoveFilter,
	SetFilterParam,
]);
export type LeafCommand = Schema.Schema.Type<typeof LeafCommandSchema>;

export const Batch = Schema.TaggedStruct("Batch", {
	commands: Schema.Array(LeafCommandSchema).check(Schema.isMaxLength(2048)),
});

export const Ready = Schema.TaggedStruct("Ready", {
	widgetId: WidgetId,
	protocolVersion: Schema.Int,
});

export const Heartbeat = Schema.TaggedStruct("Heartbeat", {
	tick: Schema.Int,
});

export const ServiceMessageSchema = Schema.Union([Ready, Heartbeat]);
export type ServiceMessage = Schema.Schema.Type<typeof ServiceMessageSchema>;

export const RenderCommandSchema = Schema.Union([
	...LeafCommandSchema.members,
	Batch,
]);
export type RenderCommand = Schema.Schema.Type<typeof RenderCommandSchema>;

import { Data } from "effect";
import type { AssetId, EffectId, NodeId, WidgetId } from "./ids";

export class InvalidCommand extends Data.TaggedError("InvalidCommand")<{
	widgetId: WidgetId;
	message: string;
	nodeId?: NodeId;
}> {}

export class UnknownNode extends Data.TaggedError("UnknownNode")<{
	widgetId: WidgetId;
	message: string;
	nodeId: NodeId;
}> {}

export class AssetNotFound extends Data.TaggedError("AssetNotFound")<{
	widgetId: WidgetId;
	message: string;
	assetId: AssetId;
}> {}

export class EffectNotFound extends Data.TaggedError("EffectNotFound")<{
	widgetId: WidgetId;
	message: string;
	effectId: EffectId;
}> {}

export class EffectCompileFailed extends Data.TaggedError(
	"EffectCompileFailed",
)<{
	widgetId: WidgetId;
	message: string;
	effectId: EffectId;
}> {}

export class InvalidEffectParam extends Data.TaggedError("InvalidEffectParam")<{
	widgetId: WidgetId;
	message: string;
	effectId: EffectId;
	param: string;
}> {}

export class RenderFailed extends Data.TaggedError("RenderFailed")<{
	widgetId: WidgetId;
	message: string;
	nodeId?: NodeId;
}> {}

export class QueueOverflow extends Data.TaggedError("QueueOverflow")<{
	widgetId: WidgetId;
	message: string;
}> {}

export class WidgetTimeout extends Data.TaggedError("WidgetTimeout")<{
	widgetId: WidgetId;
	message: string;
}> {}

export class WidgetCrashed extends Data.TaggedError("WidgetCrashed")<{
	widgetId: WidgetId;
	message: string;
}> {}

export class ProtocolMismatch extends Data.TaggedError("ProtocolMismatch")<{
	widgetId: WidgetId;
	message: string;
	expectedVersion: number;
	actualVersion: number;
}> {}

export class BundleLoadFailed extends Data.TaggedError("BundleLoadFailed")<{
	widgetId: WidgetId;
	message: string;
	bundleId: string;
}> {}

import { Schema } from "effect";

export const identifier = Schema.String.check(
	Schema.isPattern(/^[A-Za-z0-9:_-]+$/),
	Schema.isMaxLength(128),
);

export const NodeId = identifier.pipe(Schema.brand("NodeId"));
export const AssetId = identifier.pipe(Schema.brand("AssetId"));
export const EffectId = identifier.pipe(Schema.brand("EffectId"));
export const ViewerId = identifier.pipe(Schema.brand("ViewerId"));
export const WidgetId = identifier.pipe(Schema.brand("WidgetId"));

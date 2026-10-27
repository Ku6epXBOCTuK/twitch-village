import { Schema } from "effect";

const identifier = Schema.String.check(
	Schema.isPattern(/^[A-Za-z0-9:_-]+$/),
	Schema.isMaxLength(128),
);

// NOTE: an asset alias is a path inside its bundle, so it keeps `/` unlike
// the flat identifiers around it.
const assetPath = Schema.String.check(
	Schema.isPattern(/^[A-Za-z0-9:_/-]+$/),
	Schema.isMaxLength(128),
);

export const NodeId = identifier.pipe(Schema.brand("NodeId"));
export const AssetId = assetPath.pipe(Schema.brand("AssetId"));
export const EffectId = identifier.pipe(Schema.brand("EffectId"));
export const ViewerId = identifier.pipe(Schema.brand("ViewerId"));
export const WidgetId = identifier.pipe(Schema.brand("WidgetId"));

export type NodeId = Schema.Schema.Type<typeof NodeId>;
export type AssetId = Schema.Schema.Type<typeof AssetId>;
export type EffectId = Schema.Schema.Type<typeof EffectId>;
export type ViewerId = Schema.Schema.Type<typeof ViewerId>;
export type WidgetId = Schema.Schema.Type<typeof WidgetId>;

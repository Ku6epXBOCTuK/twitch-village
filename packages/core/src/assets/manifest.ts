import { AssetId, BundleId } from "@tv/protocol";
import { Schema } from "effect";

const AssetAlias = Schema.Union([AssetId, Schema.Array(AssetId)]);

const ManifestPath = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

export const AssetEntrySchema = Schema.Struct({
	alias: AssetAlias,
	src: ManifestPath,
	data: Schema.optional(Schema.Unknown),
});

export type AssetEntry = Schema.Schema.Type<typeof AssetEntrySchema>;

export const AssetBundleSchema = Schema.Struct({
	name: BundleId,
	assets: Schema.Array(AssetEntrySchema),
});

export type AssetBundle = Schema.Schema.Type<typeof AssetBundleSchema>;

export const AssetManifestSchema = Schema.Struct({
	bundles: Schema.Array(AssetBundleSchema),
});

export type AssetManifest = Schema.Schema.Type<typeof AssetManifestSchema>;

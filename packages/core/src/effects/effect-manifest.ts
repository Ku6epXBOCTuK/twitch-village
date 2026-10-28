import { EffectId } from "@tv/protocol";
import { Schema } from "effect";

export const EffectParamSchema = Schema.Struct({
	name: Schema.String,
	min: Schema.Number,
	max: Schema.Number,
	default: Schema.Number,
});

export type EffectParam = Schema.Schema.Type<typeof EffectParamSchema>;

export const EffectDefinitionSchema = Schema.Struct({
	effectId: EffectId,
	vertex: Schema.String,
	fragment: Schema.String,
	params: Schema.Array(EffectParamSchema),
});

export type EffectDefinition = Schema.Schema.Type<
	typeof EffectDefinitionSchema
>;

export const EffectManifestSchema = Schema.Struct({
	effects: Schema.Array(EffectDefinitionSchema),
});

export type EffectManifest = Schema.Schema.Type<typeof EffectManifestSchema>;

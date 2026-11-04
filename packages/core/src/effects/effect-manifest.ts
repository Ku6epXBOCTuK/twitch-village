import { EffectId } from "@tv/protocol";
import { Schema } from "effect";

const Vec2 = Schema.Tuple([Schema.Number, Schema.Number]);
const Vec3 = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]);
const Vec4 = Schema.Tuple([
	Schema.Number,
	Schema.Number,
	Schema.Number,
	Schema.Number,
]);

export const EffectParamSchema = Schema.Union([
	Schema.Struct({
		type: Schema.Literal("number"),
		name: Schema.String,
		min: Schema.Number,
		max: Schema.Number,
		default: Schema.Number,
	}),
	Schema.Struct({
		type: Schema.Literal("vec2"),
		name: Schema.String,
		default: Vec2,
	}),
	Schema.Struct({
		type: Schema.Literal("vec3"),
		name: Schema.String,
		default: Vec3,
	}),
	Schema.Struct({
		type: Schema.Literal("vec4"),
		name: Schema.String,
		default: Vec4,
	}),
]);

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

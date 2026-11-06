import { Filter, GlProgram, defaultFilterVert } from "pixi.js";
import type { EffectDefinition, EffectParam } from "./effect-manifest";
import type { EffectCompiler } from "./effect-registry";

type UniformType = "f32" | "vec2<f32>" | "vec3<f32>" | "vec4<f32>";

const uniformType = (type: EffectParam["type"]): UniformType => {
	switch (type) {
		case "number":
			return "f32";
		case "vec2":
			return "vec2<f32>";
		case "vec3":
			return "vec3<f32>";
		case "vec4":
			return "vec4<f32>";
	}
};

const compile = (definition: EffectDefinition): Filter => {
	const uniforms: Record<string, { value: unknown; type: UniformType }> = {};
	for (const param of definition.params) {
		uniforms[param.name] = {
			value: param.default,
			type: uniformType(param.type),
		};
	}

	return new Filter({
		glProgram: GlProgram.from({
			vertex: definition.vertex === "" ? defaultFilterVert : definition.vertex,
			fragment: definition.fragment,
		}),
		resources: { uniforms },
	});
};

export function createPixiEffectCompiler(): EffectCompiler {
	return { compile };
}

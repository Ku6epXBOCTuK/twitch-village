import type { EffectId } from "@tv/protocol";
import { describe, expect, it } from "vitest";
import type { EffectDefinition } from "./effect-manifest";
import { createPixiEffectCompiler } from "./pixi-effect-compiler";

Object.assign(globalThis, {
	document: { createElement: () => ({ getContext: () => null }) },
});

const definition = (): EffectDefinition => ({
	effectId: "aura" as EffectId,
	vertex: "",
	fragment: `
		in vec2 vTextureCoord;
		out vec4 finalColor;
		uniform sampler2D uTexture;
		uniform float uIntensity;
		uniform vec3 uColor;
		void main() {
			vec4 color = texture(uTexture, vTextureCoord);
			finalColor = vec4(color.rgb + uColor * color.a * uIntensity, color.a);
		}
	`,
	params: [
		{ type: "number", name: "uIntensity", min: 0, max: 1, default: 0.65 },
		{ type: "vec3", name: "uColor", default: [1, 0.2, 0.15] },
	],
});

describe("createPixiEffectCompiler", () => {
	it("builds a filter with uniforms from the manifest defaults", () => {
		const filter = createPixiEffectCompiler().compile(definition());
		const uniforms = (
			filter.resources.uniforms as {
				uniforms: Record<string, unknown>;
			}
		).uniforms;

		expect(uniforms.uIntensity).toBe(0.65);
		expect(uniforms.uColor).toEqual([1, 0.2, 0.15]);
		filter.destroy();
	});
});

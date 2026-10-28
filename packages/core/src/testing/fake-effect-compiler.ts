import type { Filter } from "pixi.js";
import type { EffectDefinition } from "../effects/effect-manifest";
import type { EffectCompiler } from "../effects/effect-registry";

export interface FakeEffectCompiler extends EffectCompiler {
	readonly compiled: readonly EffectDefinition[];
	readonly failures: Map<string, unknown>;
	readonly filters: readonly Filter[];
}

export function createFakeEffectCompiler(): FakeEffectCompiler {
	const compiled: EffectDefinition[] = [];
	const failures = new Map<string, unknown>();
	const filters: Filter[] = [];

	return {
		compiled,
		failures,
		filters,
		compile(definition: EffectDefinition): Filter {
			compiled.push(definition);
			const failure = failures.get(definition.effectId);
			if (failure !== undefined) {
				throw failure;
			}
			const filter = {
				effectId: definition.effectId,
				uniforms: {},
			} as unknown as Filter;
			filters.push(filter);
			return filter;
		},
	};
}

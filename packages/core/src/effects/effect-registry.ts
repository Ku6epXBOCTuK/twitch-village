import {
	EffectCompileFailed,
	EffectNotFound,
	InvalidEffectParam,
	type EffectId,
	type NodeId,
	type WidgetId,
} from "@tv/protocol";
import type { Filter } from "pixi.js";
import type { EffectDefinition, EffectManifest } from "./effect-manifest";

export interface EffectCompiler {
	compile(definition: EffectDefinition): Filter;
}

export interface EffectRegistryOptions {
	readonly widgetId: WidgetId;
	readonly compiler: EffectCompiler;
}

export interface EffectRegistry {
	// NOTE: registration only stores definitions; shaders compile lazily on
	// the first get, and a failed compile is not retried until clear.
	register(manifest: EffectManifest): void;
	// NOTE: the cache key is the effect and the node, so two nodes never
	// share one Filter instance.
	get(effectId: EffectId, nodeId: NodeId): Filter;
	// NOTE: the registry only validates against the manifest bounds; applying
	// the uniform stays in the render target.
	setParam(effectId: EffectId, param: string, value: number): void;
	isBroken(effectId: EffectId): boolean;
	clear(): void;
}

export function createEffectRegistry(
	options: EffectRegistryOptions,
): EffectRegistry {
	const definitions = new Map<EffectId, EffectDefinition>();
	const brokenEffects = new Set<EffectId>();
	const instances = new Map<EffectId, Map<NodeId, Filter>>();

	function definitionOf(effectId: EffectId): EffectDefinition {
		const effect = definitions.get(effectId);
		if (effect === undefined)
			throw new EffectNotFound({
				widgetId: options.widgetId,
				message: `Effect ${effectId} is not found in widget ${options.widgetId}`,
				effectId,
			});
		return effect;
	}

	function toEffectCompileFailed(effectId: EffectId, message: string): never {
		throw new EffectCompileFailed({
			widgetId: options.widgetId,
			message,
			effectId,
		});
	}

	return {
		register: (manifest: EffectManifest) => {
			const effectIds = new Set<EffectId>();
			for (const effect of manifest.effects) {
				if (effectIds.has(effect.effectId)) {
					throw new Error(
						`Manifest error: duplicate effectId ${effect.effectId}`,
					);
				}
				effectIds.add(effect.effectId);
				for (const param of effect.params) {
					if (param.max < param.min) {
						throw new Error(
							`Manifest error: bounds are inverted for param ${param.name} in effect ${effect.effectId}`,
						);
					}
					if (param.default > param.max || param.default < param.min) {
						throw new Error(
							`Manifest error: invalid default value for param ${param.name} in effect ${effect.effectId}`,
						);
					}
				}
			}

			for (const effect of manifest.effects) {
				definitions.set(effect.effectId, effect);
			}
		},
		get: (effectId: EffectId, nodeId: NodeId): Filter => {
			const effect = definitionOf(effectId);
			if (brokenEffects.has(effectId))
				toEffectCompileFailed(
					effectId,
					`Effect ${effectId} is broken in widget ${options.widgetId}; it stays off until the widget restarts`,
				);
			let byNode = instances.get(effectId);
			if (byNode === undefined) {
				byNode = new Map();
				instances.set(effectId, byNode);
			}
			let filter = byNode.get(nodeId);
			if (filter === undefined) {
				try {
					filter = options.compiler.compile(effect);
				} catch (error) {
					brokenEffects.add(effectId);
					toEffectCompileFailed(
						effectId,
						`Effect ${effectId} failed to compile in widget ${options.widgetId}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			byNode.set(nodeId, filter);

			return filter;
		},
		setParam: (effectId: EffectId, param: string, value: number) => {
			const effect = definitionOf(effectId);
			const effectParam = effect.params.find(
				(paramDef) => paramDef.name === param,
			);
			if (effectParam === undefined)
				throw new InvalidEffectParam({
					widgetId: options.widgetId,
					message: `Effect ${effectId} has no param ${param} in widget ${options.widgetId}`,
					effectId,
					param,
				});
			if (value < effectParam.min || value > effectParam.max)
				throw new InvalidEffectParam({
					widgetId: options.widgetId,
					message: `Effect ${effectId} param ${param}=${value}  is outside ${effectParam.min}..${effectParam.max} in widget ${options.widgetId}`,
					effectId,
					param,
				});
		},
		isBroken: (effectId: EffectId) => brokenEffects.has(effectId),
		clear: () => {
			brokenEffects.clear();
			instances.clear();
		},
	};
}

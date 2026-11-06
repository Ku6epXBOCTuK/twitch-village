import {
	type AssetId,
	type AssetNotFound,
	type EffectCompileFailed,
	type EffectId,
	type EffectNotFound,
	type FilterParamValue,
	type InvalidEffectParam,
	type LeafCommand,
	type NodeId,
	type RenderCommand,
	RenderFailed,
	UnknownNode,
	type WidgetId,
} from "@tv/protocol";
import { Effect, Match } from "effect";
import type { Filter, Texture } from "pixi.js";
import { isContractError, type RenderError } from "../errors";
import type { RenderTarget } from "./render-target";

function toRenderFailed(
	ctx: ApplyCommandContext,
	command: RenderCommand,
	error: unknown,
) {
	return new RenderFailed({
		widgetId: ctx.widgetId,
		message: `Unexpected render error: widgetId ${ctx.widgetId}, command ${command._tag}, err ${error}`,
		...("nodeId" in command ? { nodeId: command.nodeId } : {}),
	});
}

export interface TextureSource {
	getTexture(assetId: AssetId): Effect.Effect<Texture, AssetNotFound>;
}

export interface FilterSource {
	get(
		effectId: EffectId,
		nodeId: NodeId,
	): Effect.Effect<Filter, EffectNotFound | EffectCompileFailed>;
	setParam(
		effectId: EffectId,
		param: string,
		value: FilterParamValue,
	): Effect.Effect<void, EffectNotFound | InvalidEffectParam>;
	release(nodeId: NodeId): Effect.Effect<void>;
}

export interface ApplyCommandContext {
	readonly widgetId: WidgetId;
	readonly target: RenderTarget;
	readonly textures: TextureSource;
	readonly effects: FilterSource;
}

export interface ApplyCommandResult {
	readonly errors: readonly RenderError[];
	readonly skipped: number;
}

export const DEFAULT_MAX_BATCH_ERRORS = 16;

const noErrors: ApplyCommandResult = { errors: [], skipped: 0 };

const asResult = <A>(
	effect: Effect.Effect<A, RenderError>,
): Effect.Effect<ApplyCommandResult> =>
	Effect.match(effect, {
		onFailure: (error) => ({ errors: [error], skipped: 0 }),
		onSuccess: () => noErrors,
	});

const checkLeaf = (
	ctx: ApplyCommandContext,
	command: LeafCommand,
): RenderError | null => {
	if (command._tag !== "CreateNode" && !ctx.target.has(command.nodeId)) {
		return new UnknownNode({
			widgetId: ctx.widgetId,
			message: `Unknown node ${command.nodeId}`,
			nodeId: command.nodeId,
		});
	}
	if (
		command._tag === "SetParent" &&
		command.parentId !== null &&
		!ctx.target.has(command.parentId)
	) {
		return new UnknownNode({
			widgetId: ctx.widgetId,
			message: `Unknown parent node ${command.parentId}`,
			nodeId: command.parentId,
		});
	}
	return null;
};

const isSimpleLeaf = (command: LeafCommand): boolean => {
	switch (command._tag) {
		case "CreateNode":
		case "SetParent":
		case "SetTransform":
		case "SetText":
		case "SetRectStyle":
		case "SetTint":
		case "RemoveFilter":
			return true;
		default:
			return false;
	}
};

const applySimpleLeaf = (
	ctx: ApplyCommandContext,
	command: LeafCommand,
): RenderError | null => {
	const invalid = checkLeaf(ctx, command);
	if (invalid !== null) return invalid;

	try {
		switch (command._tag) {
			case "CreateNode":
				ctx.target.createNode(command.nodeId, command.kind);
				return null;
			case "SetParent":
				ctx.target.setParent(command.nodeId, command.parentId, command.order);
				return null;
			case "SetTransform": {
				const { nodeId, _tag, ...transform } = command;
				ctx.target.setTransform(nodeId, transform);
				return null;
			}
			case "SetText":
				ctx.target.setText(command.nodeId, command.text, command.style);
				return null;
			case "SetRectStyle": {
				const { nodeId, _tag, alpha, ...style } = command;
				ctx.target.setRectStyle(nodeId, { ...style, alpha: alpha ?? 1 });
				return null;
			}
			case "SetTint":
				ctx.target.setTint(command.nodeId, command.tint);
				return null;
			case "RemoveFilter":
				ctx.target.removeFilter(command.nodeId, command.effectId);
				return null;
			default:
				return null;
		}
	} catch (error) {
		return isContractError(error) ? error : toRenderFailed(ctx, command, error);
	}
};

const applyLeaf = Effect.fnUntraced(function* (
	ctx: ApplyCommandContext,
	command: LeafCommand,
): Effect.fn.Return<void, RenderError> {
	function attemptForeign<A>(run: () => A): Effect.Effect<A, RenderError> {
		return Effect.try({
			try: run,
			catch: (error) =>
				isContractError(error) ? error : toRenderFailed(ctx, command, error),
		});
	}

	const invalid = checkLeaf(ctx, command);
	if (invalid !== null) {
		return yield* Effect.fail(invalid);
	}

	yield* Match.valueTags(command, {
		CreateNode: ({ nodeId, kind }) =>
			attemptForeign(() => ctx.target.createNode(nodeId, kind)),
		RemoveNode: ({ nodeId }) =>
			Effect.flatMap(
				attemptForeign(() => ctx.target.removeNode(nodeId)),
				(removed) =>
					Effect.forEach(
						removed,
						(removedId) => ctx.effects.release(removedId),
						{
							discard: true,
						},
					),
			),
		SetParent: ({ nodeId, parentId, order }) =>
			attemptForeign(() => ctx.target.setParent(nodeId, parentId, order)),
		SetTransform: ({ nodeId, _tag, ...rest }) =>
			attemptForeign(() => ctx.target.setTransform(nodeId, rest)),
		SetSprite: ({ nodeId, assetId }) =>
			Effect.flatMap(ctx.textures.getTexture(assetId), (texture) =>
				attemptForeign(() => ctx.target.setSprite(nodeId, texture)),
			),
		SetAnimation: ({ nodeId, assetIds, fps, loop }) =>
			Effect.flatMap(
				Effect.forEach(assetIds, (assetId) => ctx.textures.getTexture(assetId)),
				(textures) =>
					attemptForeign(() =>
						ctx.target.setAnimation(nodeId, textures, fps, loop),
					),
			),
		SetText: ({ nodeId, text, style }) =>
			attemptForeign(() => ctx.target.setText(nodeId, text, style)),
		SetRectStyle: ({ nodeId, _tag, alpha, ...style }) =>
			attemptForeign(() =>
				ctx.target.setRectStyle(nodeId, { ...style, alpha: alpha ?? 1 }),
			),
		SetTint: ({ nodeId, tint }) =>
			attemptForeign(() => ctx.target.setTint(nodeId, tint)),
		AddFilter: ({ nodeId, effectId }) =>
			Effect.flatMap(ctx.effects.get(effectId, nodeId), (filter) =>
				attemptForeign(() => ctx.target.addFilter(nodeId, effectId, filter)),
			),
		RemoveFilter: ({ nodeId, effectId }) =>
			attemptForeign(() => ctx.target.removeFilter(nodeId, effectId)),
		SetFilterParam: ({ nodeId, effectId, param, value }) =>
			Effect.flatMap(ctx.effects.setParam(effectId, param, value), () =>
				attemptForeign(() =>
					ctx.target.setFilterParam(nodeId, effectId, param, value),
				),
			),
	});
});

const applyBatch = Effect.fnUntraced(function* (
	ctx: ApplyCommandContext,
	commands: readonly LeafCommand[],
): Effect.fn.Return<ApplyCommandResult> {
	const resultErrors: RenderError[] = [];

	for (const [index, leaf] of commands.entries()) {
		if (isSimpleLeaf(leaf)) {
			const error = applySimpleLeaf(ctx, leaf);
			if (error !== null) {
				resultErrors.push(error);
			}
		} else {
			yield* Effect.match(applyLeaf(ctx, leaf), {
				onFailure: (error) => {
					resultErrors.push(error);
				},
				onSuccess: () => {},
			});
		}

		if (resultErrors.length >= DEFAULT_MAX_BATCH_ERRORS) {
			return {
				errors: resultErrors,
				skipped: commands.length - index - 1,
			};
		}
	}

	return {
		errors: resultErrors,
		skipped: 0,
	};
});

export const applyCommand = Effect.fnUntraced(function* (
	ctx: ApplyCommandContext,
	command: RenderCommand,
): Effect.fn.Return<ApplyCommandResult> {
	return yield* Match.value(command).pipe(
		Match.tag("Batch", ({ commands }) => applyBatch(ctx, commands)),
		Match.orElse((leaf) => asResult(applyLeaf(ctx, leaf))),
	);
});

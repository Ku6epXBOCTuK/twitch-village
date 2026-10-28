import {
	RenderFailed,
	UnknownNode,
	type AssetId,
	type AssetNotFound,
	type EffectCompileFailed,
	type EffectId,
	type EffectNotFound,
	type InvalidEffectParam,
	type LeafCommand,
	type NodeId,
	type RenderCommand,
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
		value: number,
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

	if (command._tag !== "CreateNode") {
		if (!ctx.target.has(command.nodeId)) {
			return yield* Effect.fail(
				new UnknownNode({
					widgetId: ctx.widgetId,
					message: `Unknown node ${command.nodeId}`,
					nodeId: command.nodeId,
				}),
			);
		}
	}

	if (
		command._tag === "SetParent" &&
		command.parentId !== null &&
		!ctx.target.has(command.parentId)
	) {
		return yield* Effect.fail(
			new UnknownNode({
				widgetId: ctx.widgetId,
				message: `Unknown parent node ${command.parentId}`,
				nodeId: command.parentId,
			}),
		);
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
		yield* Effect.match(applyLeaf(ctx, leaf), {
			onFailure: (error) => {
				resultErrors.push(error);
			},
			onSuccess: () => {},
		});

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

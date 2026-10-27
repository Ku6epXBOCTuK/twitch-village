import {
	AssetNotFound,
	EffectCompileFailed,
	EffectNotFound,
	InvalidCommand,
	InvalidEffectParam,
	RenderFailed,
	UnknownNode,
	type AssetId,
	type EffectId,
	type LeafCommand,
	type RenderCommand,
	type WidgetId,
} from "@tv/protocol";
import { Effect, Match } from "effect";
import type { Filter, Texture } from "pixi.js";
import type { NodeRegistry } from "./node-registry";
import type { RenderTarget } from "./render-target";

export type RenderError =
	| AssetNotFound
	| EffectCompileFailed
	| EffectNotFound
	| InvalidCommand
	| InvalidEffectParam
	| RenderFailed
	| UnknownNode;

type RenderErrorTags = RenderError["_tag"];

const RENDER_ERROR_TAGS: Record<RenderErrorTags, true> = {
	AssetNotFound: true,
	EffectCompileFailed: true,
	EffectNotFound: true,
	InvalidCommand: true,
	InvalidEffectParam: true,
	RenderFailed: true,
	UnknownNode: true,
};

export const isRenderError = (error: unknown): error is RenderError => {
	return (
		error !== null &&
		typeof error === "object" &&
		"_tag" in error &&
		Object.hasOwn(RENDER_ERROR_TAGS, (error as { _tag: RenderErrorTags })._tag)
	);
};

function toRenderError(
	ctx: ApplyCommandContext,
	command: RenderCommand,
	error: unknown,
) {
	return isRenderError(error)
		? error
		: new RenderFailed({
				widgetId: ctx.widgetId,
				message: `Unexpected render error: widgetId ${ctx.widgetId}, command ${command._tag}, err ${error}`,
				...("nodeId" in command ? { nodeId: command.nodeId } : {}),
			});
}

export interface TextureSource {
	getTexture(assetId: AssetId): Texture;
}

export interface FilterSource {
	get(effectId: EffectId, nodeKey: string): Filter;
}

export interface ApplyCommandContext {
	readonly widgetId: WidgetId;
	readonly registry: NodeRegistry;
	readonly target: RenderTarget;
	readonly textures: TextureSource;
	readonly effects: FilterSource;
}

const applyLeaf = Effect.fnUntraced(function* (
	ctx: ApplyCommandContext,
	command: LeafCommand,
): Effect.fn.Return<void, RenderError> {
	function attempt<A>(run: () => A) {
		return Effect.try({
			try: run,
			catch: (error) => toRenderError(ctx, command, error),
		});
	}

	if (command._tag !== "CreateNode") {
		if (!ctx.registry.has(command.nodeId)) {
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
		!ctx.registry.has(command.parentId)
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
			attempt(() => ctx.registry.create(nodeId, kind)),
		RemoveNode: ({ nodeId }) => attempt(() => ctx.registry.remove(nodeId)),
		SetParent: ({ nodeId, parentId, order }) =>
			attempt(() => ctx.target.setParent(nodeId, parentId, order)),
		SetTransform: ({ nodeId, _tag, ...rest }) =>
			attempt(() => ctx.target.setTransform(nodeId, rest)),
		SetSprite: ({ nodeId, assetId }) =>
			attempt(() =>
				ctx.target.setSprite(nodeId, ctx.textures.getTexture(assetId)),
			),
		SetAnimation: ({ nodeId, assetIds, fps, loop }) =>
			attempt(() =>
				ctx.target.setAnimation(
					nodeId,
					assetIds.map((assetId) => ctx.textures.getTexture(assetId)),
					fps,
					loop,
				),
			),
		SetText: ({ nodeId, text, style }) =>
			attempt(() => ctx.target.setText(nodeId, text, style)),
		AddFilter: ({ nodeId, effectId }) =>
			attempt(() =>
				ctx.target.addFilter(
					nodeId,
					effectId,
					ctx.effects.get(effectId, nodeId),
				),
			),
		RemoveFilter: ({ nodeId, effectId }) =>
			attempt(() => ctx.target.removeFilter(nodeId, effectId)),
		SetFilterParam: ({ nodeId, effectId, param, value }) =>
			attempt(() => ctx.target.setFilterParam(nodeId, effectId, param, value)),
	});
});

export const applyCommand = Effect.fnUntraced(function* (
	ctx: ApplyCommandContext,
	command: RenderCommand,
): Effect.fn.Return<void, RenderError> {
	yield* Match.value(command).pipe(
		Match.tag("Batch", ({ commands }) =>
			Effect.forEach(commands, (leaf) => applyLeaf(ctx, leaf), {
				concurrency: 1,
				discard: true,
			}),
		),
		Match.tag("Heartbeat", () =>
			Effect.fail(
				new InvalidCommand({
					widgetId: ctx.widgetId,
					message: "Heartbeat must not be applied to the render tree",
				}),
			),
		),
		Match.tag("Ready", () =>
			Effect.fail(
				new InvalidCommand({
					widgetId: ctx.widgetId,
					message: "Ready must not be applied to the render tree",
				}),
			),
		),
		Match.orElse((leaf) => applyLeaf(ctx, leaf)),
	);
});

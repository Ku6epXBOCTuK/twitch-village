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
	type RenderCommand,
	type WidgetId,
} from "@tv/protocol";
import { Effect, Match } from "effect";
import type { Filter, Texture } from "pixi.js";
import type { NodeRegistry } from "./node-registry";
import type { NodeTransform, RenderTarget } from "./render-target";

export type RenderError =
	| AssetNotFound
	| EffectCompileFailed
	| EffectNotFound
	| InvalidCommand
	| InvalidEffectParam
	| RenderFailed
	| UnknownNode;

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

export function applyCommand(
	ctx: ApplyCommandContext,
	command: RenderCommand,
): Effect.Effect<void, RenderError> {
	return Effect.gen(function* () {
		const needsNodeCheck = Match.value(command).pipe(
			Match.tag("CreateNode", () => false),
			Match.orElse((cmd) => "nodeId" in cmd),
		);

		if (needsNodeCheck && "nodeId" in command) {
			if (!ctx.registry.has(command.nodeId)) {
				yield* Effect.fail(
					new UnknownNode({
						widgetId: ctx.widgetId,
						message: `Unknown node ${command.nodeId}`,
						nodeId: command.nodeId,
					}),
				);
			}
		}

		yield* Match.value(command).pipe(
			Match.tag("CreateNode", ({ nodeId, kind }) =>
				Effect.succeed(ctx.registry.create(nodeId, kind)),
			),
			Match.tag("RemoveNode", ({ nodeId }) =>
				Effect.succeed(ctx.registry.remove(nodeId)),
			),
			Match.tag("SetParent", ({ nodeId, parentId, order }) =>
				Effect.succeed(ctx.target.setParent(nodeId, parentId!, order)),
			),
			Match.tag("SetTransform", ({ nodeId, ...rest }) => {
				const transform: NodeTransform = {
					...(rest.x === undefined ? {} : { x: rest.x }),
					...(rest.y === undefined ? {} : { y: rest.y }),
					...(rest.scaleX === undefined ? {} : { scaleX: rest.scaleX }),
					...(rest.scaleY === undefined ? {} : { scaleY: rest.scaleY }),
					...(rest.alpha === undefined ? {} : { alpha: rest.alpha }),
					...(rest.rotation === undefined ? {} : { rotation: rest.rotation }),
					...(rest.visible === undefined ? {} : { visible: rest.visible }),
				};
				return Effect.try({
					try: () => ctx.target.setTransform(nodeId, transform),
					catch: (_err) =>
						new RenderFailed({
							widgetId: ctx.widgetId,
							message: `Render failed for ${nodeId}, set tranform command, pixi exploded`,
							nodeId,
						}),
				});
			}),
			Match.tag("SetSprite", ({ nodeId, assetId }) => {
				const texture = ctx.textures.getTexture(assetId);
				return Effect.succeed(ctx.target.setSprite(nodeId, texture));
			}),
			Match.tag("SetAnimation", ({ nodeId, assetIds, fps, loop }) => {
				const textures = assetIds.map((assetId) =>
					ctx.textures.getTexture(assetId),
				);
				return Effect.succeed(
					ctx.target.setAnimation(nodeId, textures, fps, loop),
				);
			}),
			Match.tag("SetText", ({ nodeId, text, style }) => {
				return Effect.succeed(ctx.target.setText(nodeId, text, style));
			}),
			Match.tag("AddFilter", ({ nodeId, effectId }) => {
				const filter = ctx.effects.get(effectId, nodeId);
				return Effect.succeed(ctx.target.addFilter(nodeId, effectId, filter));
			}),
			Match.tag("RemoveFilter", ({ nodeId, effectId }) => {
				return Effect.succeed(ctx.target.removeFilter(nodeId, effectId));
			}),
			Match.tag("SetFilterParam", ({ nodeId, effectId, param, value }) => {
				return Effect.succeed(
					ctx.target.setFilterParam(nodeId, effectId, param, value),
				);
			}),
			Match.tag("Batch", ({ commands }) =>
				Effect.all(commands.map((command) => applyCommand(ctx, command))),
			),
			Match.tag("Heartbeat", () =>
				Effect.fail(
					new InvalidCommand({
						widgetId: ctx.widgetId,
						message: "Heartbeat command is not RenderCommand",
					}),
				),
			),
			Match.tag("Ready", () =>
				Effect.fail(
					new InvalidCommand({
						widgetId: ctx.widgetId,
						message: "Ready command is not RenderCommand",
					}),
				),
			),
			Match.exhaustive,
			Effect.catchDefect((_) => {
				return Effect.fail(
					new RenderFailed({
						widgetId: ctx.widgetId,
						message: `Unexpected render error: widgetId ${ctx.widgetId}, command ${command._tag}`,
					}),
				);
			}),
		);
	});
}

import type {
	AssetId,
	EffectId,
	NodeId,
	RenderCommand,
	WidgetId,
} from "@tv/protocol";
import { Effect } from "effect";
import type { Filter, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { createFakeRenderTarget } from "../testing/fake-render-target";
import {
	applyCommand,
	type ApplyCommandContext,
	type FilterSource,
	type RenderError,
	type TextureSource,
} from "./apply-command";
import { createNodeRegistry } from "./node-registry";

const widgetId = "village" as WidgetId;

const asNodeId = (value: string): NodeId => value as NodeId;
const asAssetId = (value: string): AssetId => value as AssetId;
const asEffectId = (value: string): EffectId => value as EffectId;

const rootId = asNodeId("root");
const nodeId = asNodeId("avatar:1");

const createTextures = (): TextureSource & {
	readonly requested: AssetId[];
} => {
	const requested: AssetId[] = [];
	const cache = new Map<AssetId, Texture>();

	return {
		requested,
		getTexture(assetId: AssetId): Texture {
			requested.push(assetId);
			const cached = cache.get(assetId);
			if (cached !== undefined) return cached;
			const texture = { assetId } as unknown as Texture;
			cache.set(assetId, texture);
			return texture;
		},
	};
};

const createEffects = (): FilterSource & {
	readonly requested: ReadonlyArray<{
		readonly effectId: EffectId;
		readonly nodeKey: string;
	}>;
} => {
	const requested: Array<{ effectId: EffectId; nodeKey: string }> = [];

	return {
		requested,
		get(effectId: EffectId, nodeKey: string): Filter {
			requested.push({ effectId, nodeKey });
			return { effectId, nodeKey } as unknown as Filter;
		},
	};
};

const setup = () => {
	const target = createFakeRenderTarget({ widgetId });
	const registry = createNodeRegistry({ widgetId, target });
	const textures = createTextures();
	const effects = createEffects();
	const ctx: ApplyCommandContext = {
		widgetId,
		registry,
		target,
		textures,
		effects,
	};

	registry.create(rootId, "container");
	registry.create(nodeId, "sprite");
	const baseCallCount = target.calls.length;

	return {
		ctx,
		target,
		registry,
		textures,
		effects,
		calls: () => target.calls.slice(baseCallCount),
	};
};

const run = (ctx: ApplyCommandContext, command: RenderCommand): Promise<void> =>
	Effect.runPromise(applyCommand(ctx, command));

const runError = (
	ctx: ApplyCommandContext,
	command: RenderCommand,
): Promise<RenderError> =>
	Effect.runPromise(Effect.flip(applyCommand(ctx, command)));

describe("applyCommand", () => {
	it("CreateNode creates a node through the registry", async () => {
		const { ctx, registry, calls } = setup();
		const created = asNodeId("label:1");

		await run(ctx, { _tag: "CreateNode", nodeId: created, kind: "text" });

		expect(calls()).toEqual([
			{ method: "createNode", args: [created, "text"] },
		]);
		expect(registry.has(created)).toBe(true);
	});

	it("RemoveNode removes the node and its subtree", async () => {
		const { ctx, registry, target } = setup();
		const child = asNodeId("avatar:1:hat");
		registry.create(child, "sprite");
		target.setParent(child, nodeId, 0);
		const baseCallCount = target.calls.length;

		await run(ctx, { _tag: "RemoveNode", nodeId });

		expect(target.calls.slice(baseCallCount)).toEqual([
			{ method: "removeNode", args: [child] },
			{ method: "removeNode", args: [nodeId] },
		]);
		expect(registry.has(nodeId)).toBe(false);
	});

	it("SetParent reparents the node with the requested order", async () => {
		const { ctx, calls } = setup();

		await run(ctx, { _tag: "SetParent", nodeId, parentId: rootId, order: 2 });

		expect(calls()).toEqual([
			{ method: "setParent", args: [nodeId, rootId, 2] },
		]);
	});

	it.todo("SetParent with null make node root???");

	it("SetTransform forwards only the provided fields", async () => {
		const { ctx, calls } = setup();

		await run(ctx, {
			_tag: "SetTransform",
			nodeId,
			x: 10,
			y: -5,
			alpha: 0.5,
			visible: false,
		});

		expect(calls()).toEqual([
			{
				method: "setTransform",
				args: [nodeId, { x: 10, y: -5, alpha: 0.5, visible: false }],
			},
		]);
	});

	it("SetSprite resolves the texture and applies it", async () => {
		const { ctx, textures, calls } = setup();
		const assetId = asAssetId("avatar_hat");

		await run(ctx, { _tag: "SetSprite", nodeId, assetId });

		expect(textures.requested).toEqual([assetId]);
		expect(calls()).toHaveLength(1);
		expect(calls()[0]?.method).toBe("setSprite");
		expect(calls()[0]?.args[0]).toBe(nodeId);
		expect(calls()[0]?.args[1]).toMatchObject({ assetId });
	});

	it("SetAnimation resolves every frame in order", async () => {
		const { ctx, textures, calls } = setup();
		const frames = [asAssetId("walk_1"), asAssetId("walk_2")];

		await run(ctx, {
			_tag: "SetAnimation",
			nodeId,
			assetIds: frames,
			fps: 12,
			loop: true,
		});

		expect(textures.requested).toEqual(frames);
		expect(calls()).toHaveLength(1);
		expect(calls()[0]?.method).toBe("setAnimation");
		expect(calls()[0]?.args[0]).toBe(nodeId);
		expect(calls()[0]?.args[1]).toMatchObject([
			{ assetId: "walk_1" },
			{ assetId: "walk_2" },
		]);
		expect(calls()[0]?.args[2]).toBe(12);
		expect(calls()[0]?.args[3]).toBe(true);
	});

	it("SetText forwards the text and the style", async () => {
		const { ctx, calls } = setup();
		const style = { fontSize: 18, fill: "#ffffff", align: "center" as const };

		await run(ctx, { _tag: "SetText", nodeId, text: "hello", style });

		expect(calls()).toEqual([
			{ method: "setText", args: [nodeId, "hello", style] },
		]);
	});

	it("AddFilter resolves the filter for the node key", async () => {
		const { ctx, effects, calls } = setup();
		const effectId = asEffectId("glow");

		await run(ctx, { _tag: "AddFilter", nodeId, effectId });

		expect(effects.requested).toEqual([{ effectId, nodeKey: nodeId }]);
		expect(calls()).toHaveLength(1);
		expect(calls()[0]?.method).toBe("addFilter");
		expect(calls()[0]?.args[0]).toBe(nodeId);
		expect(calls()[0]?.args[1]).toBe(effectId);
		expect(calls()[0]?.args[2]).toMatchObject({ effectId, nodeKey: nodeId });
	});

	it("RemoveFilter forwards the effect id", async () => {
		const { ctx, calls } = setup();
		const effectId = asEffectId("glow");

		await run(ctx, { _tag: "RemoveFilter", nodeId, effectId });

		expect(calls()).toEqual([
			{ method: "removeFilter", args: [nodeId, effectId] },
		]);
	});

	it("SetFilterParam forwards the uniform value", async () => {
		const { ctx, calls } = setup();
		const effectId = asEffectId("glow");

		await run(ctx, {
			_tag: "SetFilterParam",
			nodeId,
			effectId,
			param: "intensity",
			value: 0.7,
		});

		expect(calls()).toEqual([
			{
				method: "setFilterParam",
				args: [nodeId, effectId, "intensity", 0.7],
			},
		]);
	});

	it("Batch applies leaf commands in order", async () => {
		const { ctx, calls } = setup();
		const style = { fontSize: 12, fill: "#000000", align: "left" as const };

		await run(ctx, {
			_tag: "Batch",
			commands: [
				{ _tag: "SetTransform", nodeId, x: 1 },
				{ _tag: "SetText", nodeId, text: "hi", style },
			],
		});

		expect(calls().map((call) => call.method)).toEqual([
			"setTransform",
			"setText",
		]);
	});

	it("Batch stops at the first failing command", async () => {
		const { ctx, calls } = setup();
		const ghost = asNodeId("ghost");

		const error = await runError(ctx, {
			_tag: "Batch",
			commands: [
				{ _tag: "SetTransform", nodeId: ghost, x: 1 },
				{ _tag: "SetTransform", nodeId, x: 2 },
			],
		});

		expect(error._tag).toBe("UnknownNode");
		expect(calls()).toEqual([]);
	});

	it("rejects an unknown node from the render target", async () => {
		const { ctx } = setup();

		const error = await runError(ctx, {
			_tag: "SetTransform",
			nodeId: asNodeId("ghost"),
			x: 1,
		});

		expect(error._tag).toBe("UnknownNode");
	});

	it.todo("which commands can cause exceptions?");

	it("turns a Pixi exception into RenderFailed", async () => {
		const { ctx, target } = setup();
		const crashing = {
			...target,
			setTransform(): void {
				throw new Error("pixi exploded");
			},
		};

		const error = await runError(
			{ ...ctx, target: crashing },
			{ _tag: "SetTransform", nodeId, x: 1 },
		);

		expect(error._tag).toBe("RenderFailed");
		expect(error.message).toContain("pixi exploded");
		expect(error).toMatchObject({ nodeId });
	});

	it("rejects Ready as a render command", async () => {
		const { ctx } = setup();

		const error = await runError(ctx, {
			_tag: "Ready",
			widgetId,
			protocolVersion: 1,
		});

		expect(error._tag).toBe("InvalidCommand");
	});

	it("rejects Heartbeat as a render command", async () => {
		const { ctx } = setup();

		const error = await runError(ctx, { _tag: "Heartbeat", tick: 1 });

		expect(error._tag).toBe("InvalidCommand");
	});
});

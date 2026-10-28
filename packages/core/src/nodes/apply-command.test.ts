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
import type { RenderTarget } from "./render-target";

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
		readonly nodeId: NodeId;
	}>;
	readonly params: ReadonlyArray<{
		readonly effectId: EffectId;
		readonly param: string;
		readonly value: number;
	}>;
} => {
	const requested: Array<{ effectId: EffectId; nodeId: NodeId }> = [];
	const params: Array<{ effectId: EffectId; param: string; value: number }> =
		[];

	return {
		requested,
		params,
		get(effectId: EffectId, nodeId: NodeId): Filter {
			requested.push({ effectId, nodeId });
			return { effectId, nodeId } as unknown as Filter;
		},
		setParam(effectId: EffectId, param: string, value: number): void {
			params.push({ effectId, param, value });
		},
	};
};

const setup = (options: { readonly crashOn?: CrashableMethod } = {}) => {
	const fake = createFakeRenderTarget({ widgetId });
	const { crashOn } = options;
	// NOTE: registry must share ctx.target, and the crash arms after seeding
	// because seeding itself calls the crashed method.
	let armed = false;
	const target: RenderTarget =
		crashOn === undefined
			? fake
			: ({
					...fake,
					[crashOn]: (...args: unknown[]) => {
						if (!armed) {
							return (fake[crashOn] as (...args: unknown[]) => unknown)(
								...args,
							);
						}
						throw new Error("boom-42");
					},
				} as RenderTarget);
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
	const baseCallCount = fake.calls.length;
	armed = true;

	return {
		ctx,
		target,
		registry,
		textures,
		effects,
		calls: () => fake.calls.slice(baseCallCount),
	};
};

const run = (ctx: ApplyCommandContext, command: RenderCommand): Promise<void> =>
	Effect.runPromise(applyCommand(ctx, command));

const runError = (
	ctx: ApplyCommandContext,
	command: RenderCommand,
): Promise<RenderError> =>
	Effect.runPromise(Effect.flip(applyCommand(ctx, command)));

const expectTag: <Tag extends RenderError["_tag"]>(
	error: RenderError,
	tag: Tag,
) => asserts error is Extract<RenderError, { _tag: Tag }> = (error, tag) => {
	expect(error._tag).toBe(tag);
};

type CrashableMethod = Exclude<
	keyof RenderTarget,
	"widgetId" | "root" | "snapshot"
>;

const crashFixtures: ReadonlyArray<{
	readonly method: CrashableMethod;
	readonly command: RenderCommand;
}> = [
	{
		method: "createNode",
		command: { _tag: "CreateNode", nodeId: asNodeId("fresh"), kind: "sprite" },
	},
	{ method: "removeNode", command: { _tag: "RemoveNode", nodeId } },
	{
		method: "setParent",
		command: { _tag: "SetParent", nodeId, parentId: rootId, order: 0 },
	},
	{ method: "setTransform", command: { _tag: "SetTransform", nodeId, x: 1 } },
	{
		method: "setSprite",
		command: { _tag: "SetSprite", nodeId, assetId: asAssetId("tex") },
	},
	{
		method: "setAnimation",
		command: {
			_tag: "SetAnimation",
			nodeId,
			assetIds: [asAssetId("walk_1")],
			fps: 10,
			loop: false,
		},
	},
	{
		method: "setText",
		command: {
			_tag: "SetText",
			nodeId,
			text: "hi",
			style: { fontSize: 10, fill: "#000000", align: "left" },
		},
	},
	{
		method: "addFilter",
		command: { _tag: "AddFilter", nodeId, effectId: asEffectId("glow") },
	},
	{
		method: "removeFilter",
		command: { _tag: "RemoveFilter", nodeId, effectId: asEffectId("glow") },
	},
	{
		method: "setFilterParam",
		command: {
			_tag: "SetFilterParam",
			nodeId,
			effectId: asEffectId("glow"),
			param: "intensity",
			value: 1,
		},
	},
];

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

	it("rejects a duplicate CreateNode with InvalidCommand", async () => {
		const { ctx, calls } = setup();

		const error = await runError(ctx, {
			_tag: "CreateNode",
			nodeId,
			kind: "sprite",
		});

		expectTag(error, "InvalidCommand");
		expect(error.nodeId).toBe(nodeId);
		expect(calls()).toEqual([]);
	});

	it("RemoveNode removes the node and its subtree", async () => {
		const { ctx, registry, target, calls } = setup();
		const child = asNodeId("avatar:1:hat");
		registry.create(child, "sprite");
		target.setParent(child, nodeId, 0);
		const base = calls().length;

		await run(ctx, { _tag: "RemoveNode", nodeId });

		expect(calls().slice(base)).toEqual([
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

	it("SetParent with null detaches the node to the widget root", async () => {
		const { ctx, calls } = setup();

		await run(ctx, { _tag: "SetParent", nodeId, parentId: rootId, order: 0 });
		await run(ctx, { _tag: "SetParent", nodeId, parentId: null, order: 1 });

		expect(calls()).toEqual([
			{ method: "setParent", args: [nodeId, rootId, 0] },
			{ method: "setParent", args: [nodeId, null, 1] },
		]);
	});

	it("rejects SetParent to an unknown parent with UnknownNode", async () => {
		const { ctx, calls } = setup();
		const ghost = asNodeId("ghost");

		const error = await runError(ctx, {
			_tag: "SetParent",
			nodeId,
			parentId: ghost,
			order: 0,
		});

		expectTag(error, "UnknownNode");
		expect(error.nodeId).toBe(ghost);
		expect(calls()).toEqual([]);
	});

	it("rejects SetParent of a node into its own subtree with InvalidCommand", async () => {
		const { ctx } = setup();

		await run(ctx, { _tag: "SetParent", nodeId, parentId: rootId, order: 0 });

		const error = await runError(ctx, {
			_tag: "SetParent",
			nodeId: rootId,
			parentId: nodeId,
			order: 0,
		});

		expectTag(error, "InvalidCommand");
	});

	it("rejects self-parenting with InvalidCommand", async () => {
		const { ctx } = setup();

		const error = await runError(ctx, {
			_tag: "SetParent",
			nodeId,
			parentId: nodeId,
			order: 0,
		});

		expectTag(error, "InvalidCommand");
	});

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

	it("AddFilter resolves the filter for the node", async () => {
		const { ctx, effects, calls } = setup();
		const effectId = asEffectId("glow");

		await run(ctx, { _tag: "AddFilter", nodeId, effectId });

		expect(effects.requested).toEqual([{ effectId, nodeId }]);
		expect(calls()).toHaveLength(1);
		expect(calls()[0]?.method).toBe("addFilter");
		expect(calls()[0]?.args[0]).toBe(nodeId);
		expect(calls()[0]?.args[1]).toBe(effectId);
		expect(calls()[0]?.args[2]).toMatchObject({ effectId, nodeId });
	});

	it("RemoveFilter forwards the effect id", async () => {
		const { ctx, calls } = setup();
		const effectId = asEffectId("glow");

		await run(ctx, { _tag: "RemoveFilter", nodeId, effectId });

		expect(calls()).toEqual([
			{ method: "removeFilter", args: [nodeId, effectId] },
		]);
	});

	it("SetFilterParam validates the uniform value before applying it", async () => {
		const { ctx, effects, calls } = setup();
		const effectId = asEffectId("glow");

		await run(ctx, {
			_tag: "SetFilterParam",
			nodeId,
			effectId,
			param: "intensity",
			value: 0.7,
		});

		expect(effects.params).toEqual([
			{ effectId, param: "intensity", value: 0.7 },
		]);
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

		expectTag(error, "UnknownNode");
		expect(calls()).toEqual([]);
	});

	it("Batch keeps the commands applied before the failure", async () => {
		const { ctx, calls } = setup();
		const ghost = asNodeId("ghost");

		const error = await runError(ctx, {
			_tag: "Batch",
			commands: [
				{ _tag: "SetTransform", nodeId, x: 1 },
				{ _tag: "SetTransform", nodeId: ghost, x: 2 },
				{ _tag: "SetTransform", nodeId, x: 3 },
			],
		});

		expectTag(error, "UnknownNode");
		expect(calls()).toEqual([
			{ method: "setTransform", args: [nodeId, { x: 1 }] },
		]);
	});

	it("rejects an unknown node from the render target", async () => {
		const { ctx } = setup();

		const error = await runError(ctx, {
			_tag: "SetTransform",
			nodeId: asNodeId("ghost"),
			x: 1,
		});

		expectTag(error, "UnknownNode");
	});

	describe("when the render target throws", () => {
		it.each(crashFixtures)(
			"propagates a crash in $method into RenderFailed with the cause",
			async ({ method, command }) => {
				const { ctx } = setup({ crashOn: method });

				const error = await runError(ctx, command);

				expectTag(error, "RenderFailed");
				expect(error.message).toContain("boom-42");
			},
		);
	});

	it("rejects Ready as a render command", async () => {
		const { ctx } = setup();

		const error = await runError(ctx, {
			_tag: "Ready",
			widgetId,
			protocolVersion: 1,
		});

		expectTag(error, "InvalidCommand");
	});

	it("rejects Heartbeat as a render command", async () => {
		const { ctx } = setup();

		const error = await runError(ctx, { _tag: "Heartbeat", tick: 1 });

		expectTag(error, "InvalidCommand");
	});
});

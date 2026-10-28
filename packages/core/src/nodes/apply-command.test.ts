import {
	AssetNotFound,
	InvalidEffectParam,
	type AssetId,
	type EffectId,
	type NodeId,
	type RenderCommand,
	type WidgetId,
} from "@tv/protocol";
import { Effect } from "effect";
import type { Filter, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { createFakeRenderTarget } from "../testing/fake-render-target";
import {
	applyCommand,
	type ApplyCommandContext,
	type ApplyCommandResult,
	type FilterSource,
	type TextureSource,
} from "./apply-command";
import type { RenderError } from "../errors";
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
		getTexture(assetId: AssetId) {
			requested.push(assetId);
			const cached = cache.get(assetId);
			if (cached !== undefined) return Effect.succeed(cached);
			const texture = { assetId } as unknown as Texture;
			cache.set(assetId, texture);
			return Effect.succeed(texture);
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
	readonly released: NodeId[];
} => {
	const requested: Array<{ effectId: EffectId; nodeId: NodeId }> = [];
	const params: Array<{ effectId: EffectId; param: string; value: number }> =
		[];
	const released: NodeId[] = [];

	return {
		requested,
		params,
		released,
		get(effectId: EffectId, nodeId: NodeId) {
			requested.push({ effectId, nodeId });
			return Effect.succeed({ effectId, nodeId } as unknown as Filter);
		},
		setParam(effectId: EffectId, param: string, value: number) {
			params.push({ effectId, param, value });
			return Effect.void;
		},
		release(nodeId: NodeId) {
			released.push(nodeId);
			return Effect.void;
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
	const textures = createTextures();
	const effects = createEffects();
	const ctx: ApplyCommandContext = {
		widgetId,
		target,
		textures,
		effects,
	};

	target.createNode(rootId, "container");
	target.createNode(nodeId, "sprite");
	const baseCallCount = fake.calls.length;
	armed = true;

	return {
		ctx,
		target,
		textures,
		effects,
		calls: () => fake.calls.slice(baseCallCount),
	};
};

const run = (
	ctx: ApplyCommandContext,
	command: RenderCommand,
): Promise<ApplyCommandResult> => Effect.runPromise(applyCommand(ctx, command));

const onlyError = (errors: readonly RenderError[]): RenderError => {
	const [error] = errors;
	if (error === undefined) {
		throw new Error("Expected the command to report an error");
	}
	return error;
};

const runError = async (
	ctx: ApplyCommandContext,
	command: RenderCommand,
): Promise<RenderError> => onlyError((await run(ctx, command)).errors);

const expectTag: <Tag extends RenderError["_tag"]>(
	error: RenderError,
	tag: Tag,
) => asserts error is Extract<RenderError, { _tag: Tag }> = (error, tag) => {
	expect(error._tag).toBe(tag);
};

type CrashableMethod = Exclude<
	keyof RenderTarget,
	"widgetId" | "root" | "snapshot" | "has"
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
	it("CreateNode creates a node through the render target", async () => {
		const { ctx, target, calls } = setup();
		const created = asNodeId("label:1");

		await run(ctx, { _tag: "CreateNode", nodeId: created, kind: "text" });

		expect(calls()).toEqual([
			{ method: "createNode", args: [created, "text"] },
		]);
		expect(target.has(created)).toBe(true);
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

	it("RemoveNode removes the subtree and releases its filters", async () => {
		const { ctx, target, effects, calls } = setup();
		const child = asNodeId("avatar:1:hat");
		target.createNode(child, "sprite");
		target.setParent(child, nodeId, 0);
		const base = calls().length;

		await run(ctx, { _tag: "RemoveNode", nodeId });

		expect(calls().slice(base)).toEqual([
			{ method: "removeNode", args: [nodeId] },
		]);
		expect(target.has(nodeId)).toBe(false);
		expect(target.has(child)).toBe(false);
		expect(effects.released).toEqual([nodeId, child]);
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

		const { errors, skipped } = await run(ctx, {
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
		expect(errors).toEqual([]);
		expect(skipped).toBe(0);
	});

	it("Batch applies the commands after a failing one", async () => {
		const { ctx, calls } = setup();

		const { errors, skipped } = await run(ctx, {
			_tag: "Batch",
			commands: [
				{ _tag: "SetTransform", nodeId: asNodeId("ghost"), x: 1 },
				{ _tag: "SetTransform", nodeId, x: 2 },
			],
		});

		expectTag(onlyError(errors), "UnknownNode");
		expect(skipped).toBe(0);
		expect(calls()).toEqual([
			{ method: "setTransform", args: [nodeId, { x: 2 }] },
		]);
	});

	it("Batch reports every failing command", async () => {
		const { ctx, calls } = setup();

		const { errors } = await run(ctx, {
			_tag: "Batch",
			commands: [
				{ _tag: "SetTransform", nodeId: asNodeId("ghost:1"), x: 1 },
				{ _tag: "SetTransform", nodeId, x: 2 },
				{ _tag: "SetTransform", nodeId: asNodeId("ghost:2"), x: 3 },
			],
		});

		expect(errors.map((error) => error._tag)).toEqual([
			"UnknownNode",
			"UnknownNode",
		]);
		expect(calls()).toEqual([
			{ method: "setTransform", args: [nodeId, { x: 2 }] },
		]);
	});

	it("Batch keeps the commands applied before the failure", async () => {
		const { ctx, calls } = setup();

		const { errors } = await run(ctx, {
			_tag: "Batch",
			commands: [
				{ _tag: "SetTransform", nodeId, x: 1 },
				{ _tag: "SetTransform", nodeId: asNodeId("ghost"), x: 2 },
				{ _tag: "SetTransform", nodeId, x: 3 },
			],
		});

		expectTag(onlyError(errors), "UnknownNode");
		expect(calls()).toEqual([
			{ method: "setTransform", args: [nodeId, { x: 1 }] },
			{ method: "setTransform", args: [nodeId, { x: 3 }] },
		]);
	});

	it("Batch drops the rest after 16 errors", async () => {
		const { ctx, calls } = setup();
		const ghosts = Array.from({ length: 20 }, (_, index) => ({
			_tag: "SetTransform" as const,
			nodeId: asNodeId(`ghost:${index}`),
			x: index,
		}));

		const { errors, skipped } = await run(ctx, {
			_tag: "Batch",
			commands: [...ghosts, { _tag: "SetTransform", nodeId, x: 100 }],
		});

		expect(errors).toHaveLength(16);
		expect(skipped).toBe(5);
		expect(calls()).toEqual([]);
	});

	it("Batch skips nothing when the limit hits the last command", async () => {
		const { ctx, calls } = setup();
		const ghosts = Array.from({ length: 15 }, (_, index) => ({
			_tag: "SetTransform" as const,
			nodeId: asNodeId(`ghost:${index}`),
			x: index,
		}));

		const { errors, skipped } = await run(ctx, {
			_tag: "Batch",
			commands: [
				...ghosts,
				{ _tag: "SetTransform", nodeId, x: 7 },
				{ _tag: "SetTransform", nodeId: asNodeId("ghost:last"), x: 99 },
			],
		});

		expect(errors).toHaveLength(16);
		expect(skipped).toBe(0);
		expect(calls()).toEqual([
			{ method: "setTransform", args: [nodeId, { x: 7 }] },
		]);
	});

	it("treats an unexpected throw from a port as a defect", async () => {
		const { ctx } = setup();
		const broken: ApplyCommandContext = {
			...ctx,
			textures: {
				getTexture() {
					throw new Error("boom-42");
				},
			},
		};

		await expect(
			Effect.runPromise(
				applyCommand(broken, {
					_tag: "SetSprite",
					nodeId,
					assetId: asAssetId("tex"),
				}),
			),
		).rejects.toThrow("boom-42");
	});

	it("reports an AssetNotFound from the texture port", async () => {
		const { ctx, calls } = setup();
		const assetId = asAssetId("gone");
		const missing: ApplyCommandContext = {
			...ctx,
			textures: {
				getTexture: () =>
					Effect.fail(
						new AssetNotFound({
							widgetId,
							message: `Asset ${assetId} is not found`,
							assetId,
						}),
					),
			},
		};

		const error = await runError(missing, {
			_tag: "SetSprite",
			nodeId,
			assetId,
		});

		expectTag(error, "AssetNotFound");
		expect(calls()).toEqual([]);
	});

	it("Batch keeps applying after an asset miss", async () => {
		const { ctx, calls } = setup();
		const assetId = asAssetId("gone");
		const missing: ApplyCommandContext = {
			...ctx,
			textures: {
				getTexture: () =>
					Effect.fail(
						new AssetNotFound({
							widgetId,
							message: `Asset ${assetId} is not found`,
							assetId,
						}),
					),
			},
		};

		const { errors } = await run(missing, {
			_tag: "Batch",
			commands: [
				{ _tag: "SetSprite", nodeId, assetId },
				{ _tag: "SetTransform", nodeId, x: 2 },
			],
		});

		expectTag(onlyError(errors), "AssetNotFound");
		expect(calls()).toEqual([
			{ method: "setTransform", args: [nodeId, { x: 2 }] },
		]);
	});

	it("reports a rejected filter param and skips the uniform", async () => {
		const { ctx, calls } = setup();
		const effectId = asEffectId("glow");
		const rejecting: ApplyCommandContext = {
			...ctx,
			effects: {
				get: ctx.effects.get,
				release: ctx.effects.release,
				setParam: () =>
					Effect.fail(
						new InvalidEffectParam({
							widgetId,
							message: "value is outside the manifest bounds",
							effectId,
							param: "intensity",
						}),
					),
			},
		};

		const error = await runError(rejecting, {
			_tag: "SetFilterParam",
			nodeId,
			effectId,
			param: "intensity",
			value: 9,
		});

		expectTag(error, "InvalidEffectParam");
		expect(calls()).toEqual([]);
	});

	it("reports a single failing command instead of failing the effect", async () => {
		const { ctx } = setup();

		const { errors, skipped } = await run(ctx, {
			_tag: "SetTransform",
			nodeId: asNodeId("ghost"),
			x: 1,
		});

		expectTag(onlyError(errors), "UnknownNode");
		expect(skipped).toBe(0);
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
});

import {
	EffectCompileFailed,
	EffectNotFound,
	InvalidEffectParam,
	type EffectId,
	type NodeId,
	type WidgetId,
} from "@tv/protocol";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	createFakeEffectCompiler,
	type FakeEffectCompiler,
} from "../testing/fake-effect-compiler";
import type { EffectDefinition, EffectManifest } from "./effect-manifest";
import { createEffectRegistry, type EffectRegistry } from "./effect-registry";

const village = "village" as WidgetId;

const asEffectId = (value: string): EffectId => value as EffectId;

const asNodeId = (value: string): NodeId => value as NodeId;

const glow = asEffectId("glow_pulse");
const outline = asEffectId("outline");

const nodeOne = asNodeId("node-1");
const nodeTwo = asNodeId("node-2");

const glowDefinition: EffectDefinition = {
	effectId: glow,
	vertex: "vertex",
	fragment: "fragment",
	params: [
		{ name: "uIntensity", min: 0, max: 1, default: 0.5 },
		{ name: "uTime", min: 0, max: 1000, default: 0 },
	],
};

const outlineDefinition: EffectDefinition = {
	effectId: outline,
	vertex: "vertex",
	fragment: "fragment",
	params: [{ name: "uWidth", min: 1, max: 8, default: 2 }],
};

const manifest: EffectManifest = {
	effects: [glowDefinition, outlineDefinition],
};

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
	Effect.runPromise(effect);

const failureOf = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
	Effect.runPromise(Effect.flip(effect));

const setup = (): {
	registry: EffectRegistry;
	compiler: FakeEffectCompiler;
} => {
	const compiler = createFakeEffectCompiler();
	return {
		registry: createEffectRegistry({ widgetId: village, compiler }),
		compiler,
	};
};

const withGlow = (): ReturnType<typeof setup> => {
	const state = setup();
	state.registry.register(manifest);
	return state;
};

describe("EffectRegistry", () => {
	it("does not compile on registration", () => {
		const { registry, compiler } = setup();

		registry.register(manifest);

		expect(compiler.compiled).toEqual([]);
	});

	it("reports an effect that was never registered", async () => {
		const { registry } = withGlow();

		expect(
			await failureOf(registry.get(asEffectId("blur"), nodeOne)),
		).toMatchObject({
			_tag: "EffectNotFound",
			widgetId: village,
			effectId: "blur",
		});
	});

	it("compiles once per node and reuses the instance", async () => {
		const { registry, compiler } = withGlow();

		const first = await run(registry.get(glow, nodeOne));
		const second = await run(registry.get(glow, nodeOne));

		expect(compiler.compiled).toHaveLength(1);
		expect(second).toBe(first);
	});

	it("compiles a separate instance for another node", async () => {
		const { registry, compiler } = withGlow();

		const first = await run(registry.get(glow, nodeOne));
		const second = await run(registry.get(glow, nodeTwo));

		expect(compiler.compiled).toHaveLength(2);
		expect(second).not.toBe(first);
	});

	it("reports a failed compile as EffectCompileFailed", async () => {
		const { registry, compiler } = withGlow();
		compiler.failures.set(glow, new Error("shader rejected"));

		expect(await failureOf(registry.get(glow, nodeOne))).toBeInstanceOf(
			EffectCompileFailed,
		);
	});

	it("does not retry a broken effect", async () => {
		const { registry, compiler } = withGlow();
		compiler.failures.set(glow, new Error("shader rejected"));

		await failureOf(registry.get(glow, nodeOne));
		await failureOf(registry.get(glow, nodeTwo));

		expect(compiler.compiled).toHaveLength(1);
	});

	it("keeps a broken effect from breaking other effects", async () => {
		const { registry, compiler } = withGlow();
		compiler.failures.set(glow, new Error("shader rejected"));

		await failureOf(registry.get(glow, nodeOne));

		expect(await run(registry.get(outline, nodeOne))).toBeDefined();
		expect(registry.isBroken(glow)).toBe(true);
		expect(registry.isBroken(outline)).toBe(false);
	});

	it("accepts a param inside the bounds", async () => {
		const { registry, compiler } = withGlow();

		await run(registry.setParam(glow, "uIntensity", 0.25));

		expect(compiler.compiled).toEqual([]);
	});

	it("accepts both bounds of a param", async () => {
		const { registry } = withGlow();

		await run(registry.setParam(glow, "uIntensity", 0));
		await run(registry.setParam(glow, "uIntensity", 1));

		expect(registry.isBroken(glow)).toBe(false);
	});

	it("rejects a param below the lower bound", async () => {
		const { registry } = withGlow();

		expect(
			await failureOf(registry.setParam(glow, "uIntensity", -0.1)),
		).toMatchObject({
			_tag: "InvalidEffectParam",
			effectId: glow,
			param: "uIntensity",
		});
	});

	it("rejects a param above the upper bound", async () => {
		const { registry } = withGlow();

		expect(
			await failureOf(registry.setParam(glow, "uIntensity", 2)),
		).toBeInstanceOf(InvalidEffectParam);
	});

	it("rejects a param that the effect does not declare", async () => {
		const { registry } = withGlow();

		expect(
			await failureOf(registry.setParam(glow, "uSpeed", 1)),
		).toBeInstanceOf(InvalidEffectParam);
	});

	it("rejects a param of an unknown effect", async () => {
		const { registry } = withGlow();

		expect(
			await failureOf(registry.setParam(asEffectId("blur"), "uSmooth", 1)),
		).toBeInstanceOf(EffectNotFound);
	});

	it("destroys instances and drops broken state on clear", async () => {
		const { registry, compiler } = withGlow();
		await run(registry.get(glow, nodeOne));
		compiler.failures.set(glow, new Error("shader rejected"));
		await failureOf(registry.get(glow, nodeTwo));

		await run(registry.clear());
		compiler.failures.delete(glow);
		const filter = await run(registry.get(glow, nodeOne));

		expect(filter).toBeDefined();
		expect(registry.isBroken(glow)).toBe(false);
		expect(compiler.compiled).toHaveLength(3);
		expect(compiler.destroyed).toHaveLength(1);
	});

	it("replaces the definitions and destroys old instances on register", async () => {
		const { registry, compiler } = withGlow();
		await run(registry.get(glow, nodeOne));

		registry.register({ effects: [outlineDefinition] });

		expect(await failureOf(registry.get(glow, nodeOne))).toBeInstanceOf(
			EffectNotFound,
		);
		expect(await run(registry.get(outline, nodeOne))).toBeDefined();
		expect(compiler.destroyed).toHaveLength(1);
	});

	it("releases the filters of one node and keeps the others", async () => {
		const { registry, compiler } = withGlow();
		const first = await run(registry.get(glow, nodeOne));
		const second = await run(registry.get(glow, nodeTwo));

		await run(registry.release(nodeOne));

		expect(compiler.destroyed).toEqual([first]);
		expect(await run(registry.get(glow, nodeTwo))).toBe(second);
		expect(await run(registry.get(glow, nodeOne))).not.toBe(first);
	});

	it("releases every effect of a node", async () => {
		const { registry, compiler } = withGlow();
		await run(registry.get(glow, nodeOne));
		await run(registry.get(outline, nodeOne));

		await run(registry.release(nodeOne));

		expect(compiler.destroyed).toHaveLength(2);
	});

	it("treats a release of an unknown node as a no-op", async () => {
		const { registry, compiler } = withGlow();

		await run(registry.release(asNodeId("node-404")));

		expect(compiler.destroyed).toEqual([]);
	});

	it("rejects a duplicate effect id in one manifest", () => {
		const { registry } = setup();

		expect(() =>
			registry.register({ effects: [glowDefinition, glowDefinition] }),
		).toThrow(/glow_pulse/);
	});

	it("rejects a param whose default is outside its bounds", () => {
		const { registry } = setup();
		const broken: EffectManifest = {
			effects: [
				{
					...glowDefinition,
					params: [{ name: "uIntensity", min: 0, max: 1, default: 2 }],
				},
			],
		};

		expect(() => registry.register(broken)).toThrow(/uIntensity/);
	});

	it("rejects a param whose bounds are inverted", () => {
		const { registry } = setup();
		const broken: EffectManifest = {
			effects: [
				{
					...glowDefinition,
					params: [{ name: "uIntensity", min: 1, max: 0, default: 0.5 }],
				},
			],
		};

		expect(() => registry.register(broken)).toThrow(/uIntensity/);
	});
});

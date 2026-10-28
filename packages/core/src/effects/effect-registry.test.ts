import {
	EffectCompileFailed,
	EffectNotFound,
	InvalidEffectParam,
	type EffectId,
	type NodeId,
	type WidgetId,
} from "@tv/protocol";
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

	it("rejects an effect that was never registered", () => {
		const { registry } = withGlow();

		expect(registry.get(asEffectId("blur"), asNodeId("node-1"))).toMatchObject({
			_tag: "EffectNotFound",
			widgetId: village,
			effectId: "blur",
		});
	});

	it("compiles once per node and reuses the instance", () => {
		const { registry, compiler } = withGlow();

		const first = registry.get(glow, asNodeId("node-1"));
		const second = registry.get(glow, asNodeId("node-1"));

		expect(compiler.compiled).toHaveLength(1);
		expect(second).toBe(first);
	});

	it("compiles a separate instance for another node", () => {
		const { registry, compiler } = withGlow();

		const first = registry.get(glow, asNodeId("node-1"));
		const second = registry.get(glow, asNodeId("node-2"));

		expect(compiler.compiled).toHaveLength(2);
		expect(second).not.toBe(first);
	});

	it("reports a failed compile as EffectCompileFailed", () => {
		const { registry, compiler } = withGlow();
		compiler.failures.set(glow, new Error("shader rejected"));

		expect(registry.get(glow, asNodeId("node-1"))).toBeInstanceOf(
			EffectCompileFailed,
		);
	});

	it("does not retry a broken effect", () => {
		const { registry, compiler } = withGlow();
		compiler.failures.set(glow, new Error("shader rejected"));

		expect(registry.get(glow, asNodeId("node-1"))).toBeInstanceOf(
			EffectCompileFailed,
		);
		expect(registry.get(glow, asNodeId("node-2"))).toBeInstanceOf(
			EffectCompileFailed,
		);

		expect(compiler.compiled).toHaveLength(1);
	});

	it("keeps a broken effect from breaking other effects", () => {
		const { registry, compiler } = withGlow();
		compiler.failures.set(glow, new Error("shader rejected"));

		expect(registry.get(glow, asNodeId("node-1"))).toBeInstanceOf(
			EffectCompileFailed,
		);
		expect(registry.get(outline, asNodeId("node-1"))).toBeDefined();
		expect(registry.isBroken(glow)).toBe(true);
		expect(registry.isBroken(outline)).toBe(false);
	});

	it("accepts a param inside the bounds", () => {
		const { registry, compiler } = withGlow();

		registry.setParam(glow, "uIntensity", 0.25);

		expect(compiler.compiled).toEqual([]);
	});

	it("accepts both bounds of a param", () => {
		const { registry } = withGlow();

		registry.setParam(glow, "uIntensity", 0);
		registry.setParam(glow, "uIntensity", 1);

		expect(registry.isBroken(glow)).toBe(false);
	});

	it("rejects a param below the lower bound", () => {
		const { registry } = withGlow();

		expect(registry.setParam(glow, "uIntensity", -0.1)).toMatchObject({
			_tag: "InvalidEffectParam",
			effectId: glow,
			param: "uIntensity",
		});
	});

	it("rejects a param above the upper bound", () => {
		const { registry } = withGlow();

		expect(registry.setParam(glow, "uIntensity", 2)).toBeInstanceOf(
			InvalidEffectParam,
		);
	});

	it("rejects a param that the effect does not declare", () => {
		const { registry } = withGlow();

		expect(registry.setParam(glow, "uSpeed", 1)).toBeInstanceOf(
			InvalidEffectParam,
		);
	});

	it("rejects a param of an unknown effect", () => {
		const { registry } = withGlow();

		expect(registry.setParam(asEffectId("blur"), "uSmooth", 1)).toBeInstanceOf(
			EffectNotFound,
		);
	});

	it("clears instances and broken state", () => {
		const { registry, compiler } = withGlow();
		compiler.failures.set(glow, new Error("shader rejected"));
		expect(registry.get(glow, asNodeId("node-1"))).toBeInstanceOf(
			EffectCompileFailed,
		);

		registry.clear();
		compiler.failures.delete(glow);
		const filter = registry.get(glow, asNodeId("node-1"));

		expect(filter).toBeDefined();
		expect(registry.isBroken(glow)).toBe(false);
		expect(compiler.compiled).toHaveLength(2);
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

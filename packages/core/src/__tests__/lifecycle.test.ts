import {
	type BundleId,
	type EffectId,
	type NodeId,
	PROTOCOL_VERSION,
	type WidgetId,
} from "@tv/protocol";
import { Effect, Layer } from "effect";
import type { Application } from "pixi.js";
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { AssetRegistry } from "../assets/asset-registry";
import { createAssetRegistry } from "../assets/asset-registry";
import type { EffectManifestLoader } from "../live";
import {
	Assets,
	Clock,
	CommandBuses,
	CoreApp,
	Effects,
	Manifests,
	RenderTargets,
	Statuses,
	Viewports,
	Workers,
} from "../live";
import { runFrame } from "../loop/ticker";
import { createCommandBus } from "../queue/command-bus";
import { createStatusStore } from "../status";
import { createFakeAssetBackend } from "../testing/fake-asset-backend";
import { createFakeEffectCompiler } from "../testing/fake-effect-compiler";
import {
	createFakeRenderTarget,
	type FakeRenderTarget,
} from "../testing/fake-render-target";
import { createFakeWorker, type FakeWorker } from "../testing/fake-worker";
import type { WidgetDescriptor } from "../widget/widget-host";
import { createSceneManager, type SceneManager } from "../scene/scene-manager";

const villageId = "village" as WidgetId;
const arenaId = "arena" as WidgetId;
const bundleId = "bundle" as BundleId;
const widgetIds: readonly WidgetId[] = [villageId, arenaId];
const CYCLES = 20;

interface PostedEnvelope {
	readonly protocolVersion: number;
	readonly message: { readonly _tag: string } & Record<string, unknown>;
}

const descriptorOf = (id: WidgetId): WidgetDescriptor => ({
	id,
	workerUrl: new URL(`http://localhost/${id}.js`),
	assetBundle: bundleId,
	effectsManifest: new URL(`http://localhost/${id}-effects.json`),
	config: {},
});

const workerIdOf = (workerUrl: URL): WidgetId =>
	workerUrl.pathname.slice(1, -".js".length) as WidgetId;

const setup = async () => {
	const backend = createFakeAssetBackend();
	const registries = new Map<WidgetId, AssetRegistry>();
	const compiler = createFakeEffectCompiler();
	const stage = new Container();
	const app = { stage } as unknown as Application;
	const targets: FakeRenderTarget[] = [];
	const workers: FakeWorker[] = [];
	const workersById = new Map<WidgetId, FakeWorker[]>();

	for (const id of widgetIds) {
		const registry = createAssetRegistry({ widgetId: id, backend });
		await Effect.runPromise(
			registry.init({ bundles: [{ name: bundleId, assets: [] }] }),
		);
		registries.set(id, registry);
	}

	const manifests: EffectManifestLoader = {
		load: () =>
			Effect.succeed({
				effects: [
					{
						effectId: "aura" as EffectId,
						vertex: "",
						fragment: "",
						params: [],
					},
				],
			}),
	};

	const layer = Layer.mergeAll(
		Layer.succeed(CoreApp, app),
		Layer.succeed(Assets, {
			create: (id) => {
				const registry = registries.get(id);
				if (registry === undefined) {
					throw new Error(`Unknown widget ${id}`);
				}
				return registry;
			},
		}),
		Layer.succeed(Clock, { now: () => 0 }),
		Layer.succeed(CommandBuses, { create: createCommandBus }),
		Layer.succeed(Effects, compiler),
		Layer.succeed(Manifests, manifests),
		Layer.succeed(RenderTargets, {
			create: (id) => {
				const target = createFakeRenderTarget({
					widgetId: id,
					root: new Container(),
				});
				targets.push(target);
				return target;
			},
		}),
		Layer.succeed(Statuses, createStatusStore({})),
		Layer.succeed(Viewports, () => ({ width: 1280, height: 720 })),
		Layer.succeed(Workers, (workerUrl) => {
			const id = workerIdOf(workerUrl);
			const worker = createFakeWorker();
			worker.onPost = (message) => {
				const envelope = message as PostedEnvelope;
				if (envelope.message._tag !== "Init") return;
				worker.emitMessage({
					protocolVersion: PROTOCOL_VERSION,
					message: {
						_tag: "Ready",
						widgetId: id,
						protocolVersion: PROTOCOL_VERSION,
					},
				});
			};
			workers.push(worker);
			const created = workersById.get(id) ?? [];
			created.push(worker);
			workersById.set(id, created);
			return worker;
		}),
	);

	const manager: SceneManager = await Effect.runPromise(
		createSceneManager().pipe(Effect.provide(layer)),
	);

	const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
		Effect.runPromise(
			effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E>,
		);

	const workerOf = (id: WidgetId): FakeWorker => {
		const worker = workersById.get(id)?.at(-1);
		if (worker === undefined) {
			throw new Error(`No worker was created for ${id}`);
		}
		return worker;
	};

	const emitCommands = (id: WidgetId): void => {
		workerOf(id).emitMessage({
			protocolVersion: PROTOCOL_VERSION,
			message: {
				_tag: "Batch",
				commands: [
					{
						_tag: "CreateNode",
						nodeId: "node:1" as NodeId,
						kind: "container",
					},
					{
						_tag: "AddFilter",
						nodeId: "node:1" as NodeId,
						effectId: "aura" as EffectId,
					},
				],
			},
		});
	};

	return {
		backend,
		compiler,
		emitCommands,
		manager,
		registries,
		run,
		stage,
		targets,
		workers,
	};
};

describe("widget lifecycle", () => {
	it("leaves no scene, workers, assets or effect instances after twenty switches", async () => {
		const {
			backend,
			compiler,
			emitCommands,
			manager,
			registries,
			run,
			stage,
			targets,
			workers,
		} = await setup();

		for (let cycle = 0; cycle < CYCLES; cycle += 1) {
			for (const id of widgetIds) {
				await run(manager.activate(descriptorOf(id)));
			}

			for (const id of widgetIds) {
				emitCommands(id);
			}
			await run(
				Effect.forEach([1, 2, 3], () => Effect.yieldNow, { discard: true }),
			);
			await run(runFrame(manager));

			for (const id of widgetIds) {
				expect(registries.get(id)?.isLoaded(bundleId)).toBe(true);
			}
			expect(compiler.filters.length).toBe((cycle + 1) * widgetIds.length);

			for (const id of widgetIds) {
				await run(manager.deactivate(id));
			}

			expect(manager.list()).toEqual([]);
			expect(stage.children).toHaveLength(0);
			expect(workers).toHaveLength((cycle + 1) * widgetIds.length);
			expect(workers.every((worker) => worker.terminated)).toBe(true);

			for (const id of widgetIds) {
				expect(manager.status(id)).toBeUndefined();
				expect(registries.get(id)?.isLoaded(bundleId)).toBe(false);
			}

			expect(compiler.destroyed).toHaveLength(compiler.filters.length);
			for (const target of targets.slice(-widgetIds.length)) {
				expect(target.snapshot().nodes).toHaveLength(0);
			}
		}

		const unloaded = backend.calls.filter(
			(call) => call.method === "unloadBundle",
		);
		expect(unloaded).toHaveLength(CYCLES * widgetIds.length);
	});
});

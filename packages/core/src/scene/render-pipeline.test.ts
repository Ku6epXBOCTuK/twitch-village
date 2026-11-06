import { type BundleId, PROTOCOL_VERSION, type WidgetId } from "@tv/protocol";
import { Effect, Layer } from "effect";
import type { Application } from "pixi.js";
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { AssetRegistry } from "../assets/asset-registry";
import { createAssetRegistry } from "../assets/asset-registry";
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
	type FakeRenderCall,
	type FakeRenderTarget,
} from "../testing/fake-render-target";
import { createFakeWorker, type FakeWorker } from "../testing/fake-worker";
import type { WidgetDescriptor } from "../widget/widget-host";
import { createSceneManager, type SceneManager } from "./scene-manager";

const villageId = "village" as WidgetId;
const arenaId = "arena" as WidgetId;
const villageBundle = "village" as BundleId;

interface PostedEnvelope {
	readonly protocolVersion: number;
	readonly message: { readonly _tag: string } & Record<string, unknown>;
}

const descriptorOf = (id: WidgetId): WidgetDescriptor => ({
	id,
	workerUrl: new URL(`http://localhost/${id}.js`),
	assetBundle: villageBundle,
	config: { speed: 1 },
});

const workerIdOf = (workerUrl: URL): WidgetId =>
	workerUrl.pathname.slice(1, -".js".length) as WidgetId;

const browseCommand = (nodeId: string, x: number, y: number) => ({
	_tag: "Batch",
	commands: [
		{ _tag: "CreateNode", nodeId, kind: "sprite" },
		{ _tag: "SetTransform", nodeId, x, y },
	],
});

const setup = async () => {
	const backend = createFakeAssetBackend();
	const registries = new Map<WidgetId, AssetRegistry>();
	for (const id of [villageId, arenaId]) {
		const registry = createAssetRegistry({ widgetId: id, backend });
		await Effect.runPromise(
			registry.init({ bundles: [{ name: villageBundle, assets: [] }] }),
		);
		registries.set(id, registry);
	}

	const status = createStatusStore({});
	const targets = new Map<WidgetId, FakeRenderTarget>();
	const workers = new Map<WidgetId, FakeWorker>();

	const layer = Layer.mergeAll(
		Layer.succeed(CoreApp, {
			stage: new Container(),
		} as unknown as Application),
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
		Layer.succeed(Effects, createFakeEffectCompiler()),
		Layer.succeed(Manifests, {
			load: () => Effect.succeed({ effects: [] }),
		}),
		Layer.succeed(RenderTargets, {
			create: (id) => {
				const target = createFakeRenderTarget({
					widgetId: id,
					root: new Container(),
				});
				targets.set(id, target);
				return target;
			},
		}),
		Layer.succeed(Statuses, status),
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
			workers.set(id, worker);
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
		const worker = workers.get(id);
		if (worker === undefined) {
			throw new Error(`No worker was created for ${id}`);
		}
		return worker;
	};

	return {
		activate: (id: WidgetId) => run(manager.activate(descriptorOf(id))),
		deactivate: (id: WidgetId) => run(manager.deactivate(id)),
		frame: () => run(runFrame(manager)),
		manager,
		send: (id: WidgetId, message: unknown) => {
			workerOf(id).emitMessage({
				protocolVersion: PROTOCOL_VERSION,
				message,
			});
		},
		status,
		targetOf: (id: WidgetId): FakeRenderTarget => {
			const target = targets.get(id);
			if (target === undefined) {
				throw new Error(`No render target was created for ${id}`);
			}
			return target;
		},
		callsOf: (id: WidgetId): readonly FakeRenderCall[] =>
			targets.get(id)?.calls ?? [],
	};
};

const findCall = (calls: readonly FakeRenderCall[], method: string) =>
	calls.find((call) => call.method === method);

describe("frame loop over the scene", () => {
	it("renders the nodes a widget sends, from the queue to the render target", async () => {
		const { activate, frame, send, targetOf, callsOf } = await setup();

		await activate(villageId);
		send(villageId, browseCommand("avatar:1", 10, 20));

		expect(findCall(callsOf(villageId), "createNode")).toBeUndefined();

		await frame();

		const created = findCall(callsOf(villageId), "createNode");
		expect(created?.args).toEqual(["avatar:1", "sprite"]);

		const moved = findCall(callsOf(villageId), "setTransform");
		expect(moved?.args[0]).toBe("avatar:1");
		expect((moved?.args[1] as { x: number }).x).toBe(10);

		expect(targetOf(villageId).snapshot().nodes).toHaveLength(1);
	});

	it("keeps the other widget rendering when one command fails", async () => {
		const { activate, frame, send, status, targetOf, callsOf } = await setup();

		await activate(villageId);
		await activate(arenaId);
		send(villageId, {
			_tag: "Batch",
			commands: [{ _tag: "SetTransform", nodeId: "ghost", x: 1, y: 1 }],
		});
		send(arenaId, browseCommand("avatar:2", 5, 5));

		await frame();

		expect(status.get(villageId)?.counters.UnknownNode).toBe(1);
		expect(targetOf(villageId).snapshot().nodes).toHaveLength(0);
		expect(targetOf(arenaId).snapshot().nodes).toHaveLength(1);
		expect(findCall(callsOf(arenaId), "createNode")?.args).toEqual([
			"avatar:2",
			"sprite",
		]);
	});

	it("drops the queued commands of a widget that was deactivated before the frame", async () => {
		const { activate, deactivate, frame, send, targetOf } = await setup();

		await activate(villageId);
		send(villageId, browseCommand("avatar:1", 10, 20));
		await deactivate(villageId);

		await frame();

		expect(targetOf(villageId).snapshot().nodes).toHaveLength(0);
	});

	it("keeps the queue until a frame drains it", async () => {
		const { activate, frame, send, manager } = await setup();

		await activate(villageId);
		send(villageId, browseCommand("avatar:1", 10, 20));
		send(villageId, browseCommand("avatar:2", 30, 40));

		expect(manager.frames()).toHaveLength(1);
		const bus = manager.frames()[0]?.bus;
		expect(bus).toBeDefined();

		const queued = async () =>
			bus === undefined
				? 0
				: (await Effect.runPromise(bus.stats(villageId))).queued;

		expect(await queued()).toBe(4);

		await frame();

		expect(await queued()).toBe(0);
	});
});

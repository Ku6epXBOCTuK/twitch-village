import {
	type BundleId,
	type NodeId,
	PROTOCOL_VERSION,
	type WidgetId,
} from "@tv/protocol";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import type { AssetRegistry } from "../assets/asset-registry";
import { createAssetRegistry } from "../assets/asset-registry";
import type { EffectManifestLoader } from "../live";
import {
	Assets,
	Clock,
	CommandBuses,
	Effects,
	Manifests,
	RenderTargets,
	Statuses,
	Viewports,
	Workers,
} from "../live";
import { createCommandBus } from "../queue/command-bus";
import { createStatusStore } from "../status";
import { createFakeAssetBackend } from "../testing/fake-asset-backend";
import { createFakeEffectCompiler } from "../testing/fake-effect-compiler";
import {
	createFakeRenderTarget,
	type FakeRenderTarget,
} from "../testing/fake-render-target";
import { createFakeWorker, type FakeWorker } from "../testing/fake-worker";
import {
	createWidgetHost,
	MAX_QUEUE_LENGTH,
	type WidgetDescriptor,
	type WidgetHost,
} from "../widget/widget-host";

const bundleId = "bundle" as BundleId;

interface PostedEnvelope {
	readonly protocolVersion: number;
	readonly message: { readonly _tag: string } & Record<string, unknown>;
}

const descriptorOf = (id: WidgetId): WidgetDescriptor => ({
	id,
	workerUrl: new URL(`http://localhost/${id}.js`),
	assetBundle: bundleId,
	config: {},
});

const readyEnvelope = (id: WidgetId, version = PROTOCOL_VERSION) => ({
	protocolVersion: version,
	message: {
		_tag: "Ready",
		widgetId: id,
		protocolVersion: version,
	},
});

const heartbeatEnvelope = {
	protocolVersion: PROTOCOL_VERSION,
	message: { _tag: "Heartbeat", tick: 1 },
};

interface RigWidget {
	readonly host: WidgetHost;
	readonly worker: FakeWorker;
	readonly target: FakeRenderTarget;
}

const setup = async (ids: readonly WidgetId[]) => {
	const now = 0;
	const status = createStatusStore({ now: () => now });
	const backends = new Map<
		WidgetId,
		ReturnType<typeof createFakeAssetBackend>
	>();
	const registries = new Map<WidgetId, AssetRegistry>();
	const targets = new Map<WidgetId, FakeRenderTarget>();
	const workers = new Map<WidgetId, FakeWorker>();
	const manifests: EffectManifestLoader = {
		load: () => Effect.succeed({ effects: [] }),
	};

	for (const id of ids) {
		const backend = createFakeAssetBackend();
		const registry = createAssetRegistry({ widgetId: id, backend });
		await Effect.runPromise(
			registry.init({ bundles: [{ name: bundleId, assets: [] }] }),
		);
		backends.set(id, backend);
		registries.set(id, registry);
		targets.set(id, createFakeRenderTarget({ widgetId: id }));
		workers.set(id, createFakeWorker());
	}

	const workerIdOf = (workerUrl: URL): WidgetId =>
		workerUrl.pathname.slice(1, -".js".length) as WidgetId;

	const layer = Layer.mergeAll(
		Layer.succeed(Assets, {
			create: (id) => {
				const registry = registries.get(id);
				if (registry === undefined) {
					throw new Error(`Unknown widget ${id}`);
				}
				return registry;
			},
		}),
		Layer.succeed(Clock, { now: () => now }),
		Layer.succeed(CommandBuses, { create: createCommandBus }),
		Layer.succeed(Effects, createFakeEffectCompiler()),
		Layer.succeed(Manifests, manifests),
		Layer.succeed(RenderTargets, {
			create: (id) => {
				const target = targets.get(id);
				if (target === undefined) {
					throw new Error(`Unknown widget ${id}`);
				}
				return target;
			},
		}),
		Layer.succeed(Statuses, status),
		Layer.succeed(Viewports, () => ({ width: 1280, height: 720 })),
		Layer.succeed(Workers, (workerUrl) => {
			const worker = workers.get(workerIdOf(workerUrl));
			if (worker === undefined) {
				throw new Error(`Unknown worker ${workerUrl.href}`);
			}
			return worker;
		}),
	);

	const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
		Effect.runPromise(
			effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E>,
		);

	const runWithTestClock = <A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Promise<A> =>
		Effect.runPromise(
			effect.pipe(
				Effect.provide(Layer.mergeAll(layer, TestClock.layer())),
			) as Effect.Effect<A, E>,
		);

	const widgetOf = async (id: WidgetId): Promise<RigWidget> => {
		const target = targets.get(id);
		const worker = workers.get(id);
		if (target === undefined || worker === undefined) {
			throw new Error(`Widget ${id} is not configured`);
		}
		const host = await run(createWidgetHost(descriptorOf(id)));
		return { host, target, worker };
	};

	const prepare = async (id: WidgetId): Promise<RigWidget> => {
		const rig = await widgetOf(id);
		rig.worker.onPost = (message) => {
			if ((message as PostedEnvelope).message._tag !== "Init") return;
			rig.worker.emitMessage(readyEnvelope(id));
		};
		return rig;
	};

	const activate = async (id: WidgetId): Promise<RigWidget> => {
		const rig = await prepare(id);
		await run(rig.host.start());
		return rig;
	};

	return {
		activate,
		backendOf: (id: WidgetId) => backends.get(id),
		prepare,
		run,
		runWithTestClock,
		status,
		widgetOf,
	};
};

const floodAndHealthy = ["flood", "healthy"] as const;
const floodId = floodAndHealthy[0] as WidgetId;
const healthyId = floodAndHealthy[1] as WidgetId;
const silentAndLive = ["silent", "live"] as const;
const silentId = silentAndLive[0] as WidgetId;
const liveId = silentAndLive[1] as WidgetId;
const crashedId = "crashed" as WidgetId;
const mismatchId = "mismatch" as WidgetId;

describe("widget resilience", () => {
	it("marks a flooding widget degraded and leaves the other active", async () => {
		const rig = await setup([floodId, healthyId]);
		const flood = await rig.activate(floodId);
		const healthy = await rig.activate(healthyId);
		const commands = Array.from({ length: 2048 }, (_, index) => ({
			_tag: "CreateNode" as const,
			nodeId: `node:${index}` as NodeId,
			kind: "container" as const,
		}));

		for (let index = 0; index < 50; index += 1) {
			flood.worker.emitMessage({
				protocolVersion: PROTOCOL_VERSION,
				message: { _tag: "Batch", commands },
			});
		}
		await rig.run(
			Effect.forEach(
				Array.from({ length: 200 }, (_, index) => index),
				() => Effect.yieldNow,
				{ discard: true },
			),
		);

		const stats = await rig.run(flood.host.bus.stats(floodId));
		expect(stats.dropped).toBeGreaterThan(MAX_QUEUE_LENGTH);
		expect(rig.status.get(floodId)?.state).toBe("degraded");
		expect(flood.target.root.visible).toBe(true);
		expect(rig.status.get(healthyId)?.state).toBe("active");
		expect(healthy.target.root.visible).toBe(true);
	});

	it("crashes a silent widget after two seconds and keeps the other alive", async () => {
		const rig = await setup([silentId, liveId]);
		const silent = await rig.prepare(silentId);
		const live = await rig.prepare(liveId);

		await rig.runWithTestClock(
			Effect.gen(function* () {
				yield* silent.host.start();
				yield* live.host.start();
				yield* TestClock.adjust("1 second");
				live.worker.emitMessage(heartbeatEnvelope);
				yield* Effect.yieldNow;
				yield* TestClock.adjust("1001 millis");
				yield* Effect.forEach([1, 2, 3], () => Effect.yieldNow, {
					discard: true,
				});
			}),
		);

		const silentStatus = rig.status.get(silentId);
		expect(silentStatus?.state).toBe("crashed");
		expect(silentStatus?.lastError?.tag).toBe("WidgetTimeout");
		expect(silent.target.root.visible).toBe(false);
		expect(rig.status.get(liveId)?.state).toBe("active");
		expect(live.target.root.visible).toBe(true);
	});

	it("crashes on a worker error and terminates it once", async () => {
		const rig = await setup([crashedId]);
		const crashed = await rig.activate(crashedId);
		let terminates = 0;
		const terminate = crashed.worker.terminate.bind(crashed.worker);
		crashed.worker.terminate = () => {
			terminates += 1;
			terminate();
		};

		crashed.worker.emitError("boom");

		const crashedStatus = rig.status.get(crashedId);
		expect(crashedStatus?.state).toBe("crashed");
		expect(crashedStatus?.lastError?.tag).toBe("WidgetCrashed");
		expect(crashed.target.root.visible).toBe(false);
		expect(terminates).toBe(1);
	});

	it("rejects a protocol mismatch without activating the widget", async () => {
		const rig = await setup([mismatchId]);
		const mismatch = await rig.widgetOf(mismatchId);
		mismatch.worker.onPost = (message) => {
			if ((message as PostedEnvelope).message._tag !== "Init") return;
			mismatch.worker.emitMessage(
				readyEnvelope(mismatchId, PROTOCOL_VERSION + 1),
			);
		};

		await expect(rig.run(mismatch.host.start())).rejects.toMatchObject({
			_tag: "ProtocolMismatch",
		});

		const mismatchStatus = rig.status.get(mismatchId);
		expect(mismatchStatus?.state).toBe("crashed");
		expect(mismatchStatus?.lastError?.tag).toBe("ProtocolMismatch");
		expect(mismatch.target.root.visible).toBe(false);
		expect(mismatch.worker.terminated).toBe(true);
	});
});

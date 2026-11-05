import { PROTOCOL_VERSION, type WidgetId } from "@tv/protocol";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
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
import {
	type ActivateOptions,
	createSceneManager,
	type SceneManager,
} from "./scene-manager";

const villageId = "village" as WidgetId;
const arenaId = "arena" as WidgetId;
const knownIds: readonly WidgetId[] = [villageId, arenaId];

interface PostedEnvelope {
	readonly protocolVersion: number;
	readonly message: { readonly _tag: string } & Record<string, unknown>;
}

const descriptorOf = (
	id: WidgetId,
	patch: Partial<WidgetDescriptor> = {},
): WidgetDescriptor => ({
	id,
	workerUrl: new URL(`http://localhost/${id}.js`),
	assetBundle: "village",
	config: { speed: 1 },
	...patch,
});

const workerIdOf = (workerUrl: URL): WidgetId =>
	workerUrl.pathname.slice(1, -".js".length) as WidgetId;

const setup = async (autoReady = true) => {
	const backend = createFakeAssetBackend();
	const registries = new Map<WidgetId, AssetRegistry>();
	for (const id of knownIds) {
		const registry = createAssetRegistry({ widgetId: id, backend });
		await Effect.runPromise(
			registry.init({ bundles: [{ name: "village", assets: [] }] }),
		);
		registries.set(id, registry);
	}

	const status = createStatusStore({});
	const stage = new Container();
	const app = { stage } as unknown as Application;
	const targets = new Map<WidgetId, FakeRenderTarget>();
	const workers = new Map<WidgetId, FakeWorker[]>();

	let ready = autoReady;

	const firstInit = Deferred.makeUnsafe<void>();
	const manifests: EffectManifestLoader = {
		load: () => Effect.succeed({ effects: [] }),
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
		Layer.succeed(Effects, createFakeEffectCompiler()),
		Layer.succeed(Manifests, manifests),
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
				Deferred.doneUnsafe(firstInit, Effect.succeed(undefined));
				if (!ready) return;
				worker.emitMessage({
					protocolVersion: PROTOCOL_VERSION,
					message: {
						_tag: "Ready",
						widgetId: id,
						protocolVersion: PROTOCOL_VERSION,
					},
				});
			};
			const created = workers.get(id) ?? [];
			created.push(worker);
			workers.set(id, created);
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

	const activate = (descriptor: WidgetDescriptor, options?: ActivateOptions) =>
		run(manager.activate(descriptor, options));

	return {
		activate,
		app,
		backend,
		firstInit,
		manager,
		run,
		stage,
		status,
		targets,
		workersOf: (id: WidgetId) => workers.get(id) ?? [],
		initPostedOf: (id: WidgetId) =>
			(workers.get(id) ?? []).some((worker) =>
				(worker.posted as readonly PostedEnvelope[]).some(
					(envelope) => envelope.message._tag === "Init",
				),
			),
		postedOf: (id: WidgetId, tag: string) =>
			(workers.get(id) ?? []).flatMap((worker) =>
				(worker.posted as readonly PostedEnvelope[]).filter(
					(envelope) => envelope.message._tag === tag,
				),
			),
		setReady: (value: boolean) => {
			ready = value;
		},
		emitReady: (id: WidgetId) => {
			const worker = (workers.get(id) ?? []).at(-1);
			if (worker === undefined) {
				throw new Error(`No worker was created for ${id}`);
			}
			worker.emitMessage({
				protocolVersion: PROTOCOL_VERSION,
				message: {
					_tag: "Ready",
					widgetId: id,
					protocolVersion: PROTOCOL_VERSION,
				},
			});
		},
	};
};

describe("SceneManager", () => {
	it("attaches every widget root to the stage in activation order", async () => {
		const { activate, stage, targets } = await setup();

		await activate(descriptorOf(villageId));
		await activate(descriptorOf(arenaId));

		expect(stage.children).toEqual([
			targets.get(villageId)?.root,
			targets.get(arenaId)?.root,
		]);
		expect(targets.get(villageId)?.root.zIndex).toBe(0);
		expect(targets.get(arenaId)?.root.zIndex).toBe(1);
	});

	it("lists widgets in activation order and reports their status", async () => {
		const { activate, manager } = await setup();

		await activate(descriptorOf(villageId));
		await activate(descriptorOf(arenaId));

		expect(manager.list()).toEqual([villageId, arenaId]);
		expect(manager.status(villageId)?.state).toBe("active");
	});

	it("returns undefined status for an unknown widget", async () => {
		const { manager } = await setup();

		expect(manager.status(villageId)).toBeUndefined();
	});

	it("does not activate the same widget twice", async () => {
		const { activate, stage, workersOf } = await setup();

		await activate(descriptorOf(villageId));
		await activate(descriptorOf(villageId));

		expect(workersOf(villageId)).toHaveLength(1);
		expect(stage.children).toHaveLength(1);
	});

	it("resolves a concurrent activation only after the widget is active", async () => {
		const { emitReady, firstInit, manager, run, stage, status, workersOf } =
			await setup(false);

		const settled: string[] = [];
		let childrenWhenJoined = 0;
		let stateWhenJoined: string | undefined;

		await run(
			Effect.gen(function* () {
				const first = yield* Effect.forkChild(
					manager.activate(descriptorOf(villageId)).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								settled.push("first");
							}),
						),
					),
				);
				yield* Effect.forkChild(
					manager.activate(descriptorOf(villageId)).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								settled.push("second");
								childrenWhenJoined = stage.children.length;
								stateWhenJoined = status.get(villageId)?.state;
							}),
						),
					),
				);
				yield* Deferred.await(firstInit);
				yield* Effect.forEach([1, 2, 3], () => Effect.yieldNow);

				expect(settled).toEqual([]);
				expect(status.get(villageId)?.state).toBe("loading");
				expect(stage.children).toHaveLength(0);

				emitReady(villageId);
				yield* Fiber.join(first);
			}),
		);

		expect(settled).toHaveLength(2);
		expect(childrenWhenJoined).toBe(1);
		expect(stateWhenJoined).toBe("active");
		expect(workersOf(villageId)).toHaveLength(1);
		expect(stage.children).toHaveLength(1);
		expect(status.get(villageId)?.state).toBe("active");
	});

	it("restarts a widget when restart is requested", async () => {
		const { activate, stage, workersOf } = await setup();

		await activate(descriptorOf(villageId));
		await activate(descriptorOf(villageId), { restart: true });

		expect(workersOf(villageId)).toHaveLength(2);
		expect(workersOf(villageId)[0]?.terminated).toBe(true);
		expect(stage.children).toHaveLength(1);
	});

	it("removes the container and stops the widget on deactivate", async () => {
		const { activate, manager, run, stage, status, postedOf, workersOf } =
			await setup();

		await activate(descriptorOf(villageId));
		await run(manager.deactivate(villageId));

		expect(stage.children).toHaveLength(0);
		expect(workersOf(villageId)[0]?.terminated).toBe(true);
		expect(postedOf(villageId, "Dispose")).toHaveLength(1);
		expect(status.get(villageId)).toBeUndefined();
		expect(manager.list()).toEqual([]);
	});

	it("ignores deactivate for a widget that is not active", async () => {
		const { manager, run } = await setup();

		await expect(run(manager.deactivate(villageId))).resolves.toBeUndefined();
	});

	it("keeps the other widgets alive when one is deactivated", async () => {
		const { activate, manager, run, stage, targets, workersOf } = await setup();

		await activate(descriptorOf(villageId));
		await activate(descriptorOf(arenaId));
		await run(manager.deactivate(villageId));

		expect(manager.list()).toEqual([arenaId]);
		expect(stage.children).toEqual([targets.get(arenaId)?.root]);
		expect(workersOf(arenaId)[0]?.terminated).toBe(false);
		expect(manager.status(arenaId)?.state).toBe("active");
	});

	it("forgets the widget on deactivate", async () => {
		const { activate, manager, run, status } = await setup();

		await activate(descriptorOf(villageId));
		await run(manager.deactivate(villageId));

		expect(manager.status(villageId)).toBeUndefined();
		expect(status.get(villageId)).toBeUndefined();
	});

	it("activates a widget that is asked to restart but was never active", async () => {
		const { activate, manager, stage } = await setup();

		await activate(descriptorOf(villageId), { restart: true });

		expect(manager.list()).toEqual([villageId]);
		expect(stage.children).toHaveLength(1);
		expect(manager.status(villageId)?.state).toBe("active");
	});

	it("re-activates a widget after deactivate", async () => {
		const { activate, manager, run, stage, workersOf } = await setup();

		await activate(descriptorOf(villageId));
		await run(manager.deactivate(villageId));
		await activate(descriptorOf(villageId));

		expect(workersOf(villageId)).toHaveLength(2);
		expect(stage.children).toHaveLength(1);
		expect(manager.status(villageId)?.state).toBe("active");
	});

	it("forgets a widget whose activation fails", async () => {
		const { activate, backend, manager, run, stage, status } = await setup();
		backend.failures.set("missing", new Error("bundle is broken"));

		const exit = await run(
			Effect.exit(
				manager.activate(descriptorOf(villageId, { assetBundle: "missing" })),
			),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		expect(manager.list()).toEqual([]);
		expect(manager.status(villageId)).toBeUndefined();
		expect(status.get(villageId)).toBeUndefined();
		expect(stage.children).toHaveLength(0);

		await activate(descriptorOf(villageId));
		expect(manager.status(villageId)?.state).toBe("active");
		expect(stage.children).toHaveLength(1);
	});

	it("cancels an activation that is still waiting for Ready when deactivated", async () => {
		const { firstInit, manager, run, stage, status, workersOf } =
			await setup(false);

		const exit = await run(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(
					manager.activate(descriptorOf(villageId)),
				);
				yield* Deferred.await(firstInit);
				yield* manager.deactivate(villageId);
				return yield* Effect.exit(Fiber.join(fiber));
			}),
		);

		expect(Exit.isSuccess(exit)).toBe(false);
		expect(stage.children).toHaveLength(0);
		expect(workersOf(villageId)[0]?.terminated).toBe(true);
		expect(status.get(villageId)).toBeUndefined();
	});

	it("leaves no trace of a widget whose activation is interrupted", async () => {
		const { activate, firstInit, manager, run, setReady, stage, status } =
			await setup(false);

		await run(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(
					manager.activate(descriptorOf(villageId)),
				);
				yield* Deferred.await(firstInit);
				yield* Fiber.interrupt(fiber);
			}),
		);

		expect(manager.list()).toEqual([]);
		expect(manager.status(villageId)).toBeUndefined();
		expect(status.get(villageId)).toBeUndefined();
		expect(stage.children).toHaveLength(0);

		setReady(true);
		await activate(descriptorOf(villageId));

		expect(manager.status(villageId)?.state).toBe("active");
		expect(stage.children).toHaveLength(1);
	});

	it("puts a re-activated widget above the widgets that stayed", async () => {
		const { activate, manager, run, stage, targets } = await setup();

		await activate(descriptorOf(villageId));
		await activate(descriptorOf(arenaId));
		await run(manager.deactivate(villageId));
		await activate(descriptorOf(villageId));

		expect(stage.children).toHaveLength(2);
		expect(targets.get(arenaId)?.root.zIndex).toBe(1);
		expect(targets.get(villageId)?.root.zIndex).toBe(2);
		expect(manager.list()).toEqual([arenaId, villageId]);
	});
});

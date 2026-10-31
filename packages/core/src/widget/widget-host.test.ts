import {
	ManifestLoadFailed,
	PROTOCOL_VERSION,
	type NodeId,
	type ViewerId,
	type WidgetId,
} from "@tv/protocol";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { createAssetRegistry } from "../assets/asset-registry";
import type { EffectManifestLoader } from "../live";
import {
	Assets,
	Clock,
	Effects,
	Manifests,
	RenderTargets,
	Statuses,
	Viewports,
	Workers,
} from "../live";
import { createStatusStore } from "../status";
import { callsOf, createFakeAssetBackend } from "../testing/fake-asset-backend";
import { createFakeEffectCompiler } from "../testing/fake-effect-compiler";
import { createFakeRenderTarget } from "../testing/fake-render-target";
import { createFakeWorker } from "../testing/fake-worker";
import {
	createWidgetHost,
	MAX_PENDING_EVENTS,
	MAX_QUEUE_LENGTH,
	type WidgetDescriptor,
	type WidgetHost,
} from "./widget-host";

const widgetId = "village" as WidgetId;
const rootId = "root" as NodeId;
const readyEnvelope = {
	protocolVersion: PROTOCOL_VERSION,
	message: {
		_tag: "Ready" as const,
		widgetId,
		protocolVersion: PROTOCOL_VERSION,
	},
};

const serviceEnvelope = (tag: "Heartbeat" | "Pause" | "Resume") => ({
	protocolVersion: PROTOCOL_VERSION,
	message: tag === "Heartbeat" ? { _tag: tag, tick: 1 } : { _tag: tag },
});

interface PostedEnvelope {
	readonly protocolVersion: number;
	readonly message: { readonly _tag: string } & Record<string, unknown>;
}

const setup = async (
	descriptorPatch: Partial<WidgetDescriptor> = {},
	autoReady = true,
	manifestFailure?: ManifestLoadFailed,
) => {
	const backend = createFakeAssetBackend();
	const registry = createAssetRegistry({ widgetId, backend });
	await Effect.runPromise(
		registry.init({ bundles: [{ name: "village", assets: [] }] }),
	);

	const compiler = createFakeEffectCompiler();
	const target = createFakeRenderTarget({ widgetId });
	const status = createStatusStore({});
	const manifestLoads: string[] = [];
	const manifests: EffectManifestLoader = {
		load: (url) => {
			manifestLoads.push(url.href);
			return manifestFailure === undefined
				? Effect.succeed({ effects: [] })
				: Effect.fail(manifestFailure);
		},
	};

	const worker = createFakeWorker();
	let workerCreations = 0;
	let now = 0;
	const descriptor: WidgetDescriptor = {
		id: widgetId,
		workerUrl: new URL("http://localhost/village.js"),
		assetBundle: "village",
		config: { speed: 1 },
		...descriptorPatch,
	};

	const layer = Layer.mergeAll(
		Layer.succeed(Assets, { create: () => registry }),
		Layer.succeed(Clock, { now: () => now }),
		Layer.succeed(Effects, compiler),
		Layer.succeed(Manifests, manifests),
		Layer.succeed(RenderTargets, { create: () => target }),
		Layer.succeed(Statuses, status),
		Layer.succeed(Viewports, () => ({ width: 1280, height: 720 })),
		Layer.succeed(Workers, () => {
			workerCreations += 1;
			return worker;
		}),
	);

	const host: WidgetHost = await Effect.runPromise(
		createWidgetHost(descriptor).pipe(Effect.provide(layer)),
	);

	const initPosted = Deferred.makeUnsafe<void>();
	worker.onPost = (message) => {
		const envelope = message as PostedEnvelope;
		if (envelope.message._tag !== "Init") return;
		Deferred.doneUnsafe(initPosted, Effect.succeed(undefined));
		if (!autoReady) return;
		worker.emitMessage(readyEnvelope);
	};

	const postedOf = (tag: string) =>
		(worker.posted as readonly PostedEnvelope[]).filter(
			(envelope) => envelope.message._tag === tag,
		);

	return {
		backend,
		initPosted,
		manifestLoads,
		status,
		target,
		worker,
		workerCreations: () => workerCreations,
		host,
		postedOf,
		advance: (ms: number) => {
			now += ms;
		},
		now: () => now,
	};
};

describe("WidgetHost", () => {
	it("registers itself as loading before start", async () => {
		const { host } = await setup();

		expect(host.status().state).toBe("loading");
	});

	it("loads the bundle, sends Init and becomes active after Ready", async () => {
		const { backend, status, worker, host, postedOf } = await setup();
		await Effect.runPromise(host.start());

		expect(callsOf(backend, "loadBundle")).toEqual([["village"]]);
		expect(postedOf("Init")).toEqual([
			{
				protocolVersion: PROTOCOL_VERSION,
				message: {
					_tag: "Init",
					widgetId,
					config: { speed: 1 },
					viewport: { w: 1280, h: 720 },
				},
			},
		]);
		expect(worker.terminated).toBe(false);
		expect(host.status().state).toBe("active");
		expect(status.get(widgetId)?.state).toBe("active");
	});

	it("loads the effects manifest from the descriptor", async () => {
		const { manifestLoads, host } = await setup({
			effectsManifest: new URL("http://localhost/effects.json"),
		});
		await Effect.runPromise(host.start());

		expect(manifestLoads).toEqual(["http://localhost/effects.json"]);
	});

	it("queues commands from the worker instead of applying them", async () => {
		const { host, worker } = await setup();
		await Effect.runPromise(host.start());

		worker.emitMessage({
			protocolVersion: PROTOCOL_VERSION,
			message: {
				_tag: "Batch",
				commands: [{ _tag: "CreateNode", nodeId: rootId, kind: "container" }],
			},
		});

		expect(host.bus.drain(widgetId)).toEqual([
			{ _tag: "CreateNode", nodeId: rootId, kind: "container" },
		]);
	});

	it("forwards viewer events and viewport to the worker", async () => {
		const { host, postedOf } = await setup();
		await Effect.runPromise(host.start());

		host.onCoreEvent({
			_tag: "ViewerJoined",
			viewerId: "viewer:1" as ViewerId,
			displayName: "Ku6ep",
		});
		host.setViewport({ width: 1920, height: 1080 });

		expect(postedOf("ViewerEvent")).toEqual([
			{
				protocolVersion: PROTOCOL_VERSION,
				message: {
					_tag: "ViewerEvent",
					event: {
						_tag: "ViewerJoined",
						viewerId: "viewer:1",
						displayName: "Ku6ep",
					},
				},
			},
		]);
		expect(postedOf("Viewport")).toEqual([
			{
				protocolVersion: PROTOCOL_VERSION,
				message: { _tag: "Viewport", w: 1920, h: 1080 },
			},
		]);
	});

	it("removes nodes before unloading the bundle on stop", async () => {
		const { backend, target, host } = await setup();
		await Effect.runPromise(host.start());
		target.createNode(rootId, "container");

		const order: string[] = [];
		const removeNode = target.removeNode.bind(target);
		target.removeNode = (nodeId: NodeId): readonly NodeId[] => {
			order.push("remove");
			return removeNode(nodeId);
		};
		const unloadBundle = backend.unloadBundle.bind(backend);
		backend.unloadBundle = async (bundleId: string): Promise<void> => {
			order.push("unload");
			await unloadBundle(bundleId);
		};

		await Effect.runPromise(host.stop());

		expect(order).toEqual(["remove", "unload"]);
	});

	it("keeps crashed status when the worker fails right after Ready", async () => {
		const { worker, host } = await setup({}, false);
		worker.onPost = (message) => {
			const envelope = message as PostedEnvelope;
			if (envelope.message._tag !== "Init") return;
			worker.emitMessage({
				protocolVersion: PROTOCOL_VERSION,
				message: {
					_tag: "Ready",
					widgetId,
					protocolVersion: PROTOCOL_VERSION,
				},
			});
			worker.emitError("boom");
		};

		await Effect.runPromise(host.start());

		expect(host.status().state).toBe("crashed");
	});

	it("creates one worker when start is called twice", async () => {
		const { workerCreations, host } = await setup();

		await Effect.runPromise(
			Effect.all([host.start(), host.start()], { concurrency: "unbounded" }),
		);

		expect(workerCreations()).toBe(1);
	});

	it("disposes the worker, unloads the bundle and removes nodes", async () => {
		const { backend, target, worker, host, postedOf } = await setup();
		await Effect.runPromise(host.start());
		target.createNode(rootId, "container");

		await Effect.runPromise(host.stop());

		expect(postedOf("Dispose")).toHaveLength(1);
		expect(worker.terminated).toBe(true);
		expect(callsOf(backend, "unloadBundle")).toEqual([["village"]]);
		expect(target.snapshot().nodes).toEqual([]);
		expect(host.status().state).toBe("loading");
	});

	it("fails with WidgetTimeout, terminates the worker and hides the container when Ready never arrives", async () => {
		const { target, worker, host } = await setup({}, false);

		const program = Effect.gen(function* () {
			const fiber = yield* Effect.forkChild(host.start());
			yield* TestClock.adjust("5 seconds");
			yield* Fiber.join(fiber);
		});

		await expect(
			Effect.runPromise(Effect.provide(program, TestClock.layer())),
		).rejects.toMatchObject({ _tag: "WidgetTimeout" });
		expect(worker.terminated).toBe(true);
		expect(target.root.visible).toBe(false);
		expect(host.status().state).toBe("crashed");
	});

	it("counts dropped commands when the queue overflows", async () => {
		const { host, worker } = await setup();
		await Effect.runPromise(host.start());
		const batchSize = Math.ceil(MAX_QUEUE_LENGTH / 2);
		const commands = Array.from({ length: batchSize }, (_, index) => ({
			_tag: "CreateNode" as const,
			nodeId: `node:${index}` as NodeId,
			kind: "container" as const,
		}));

		for (let index = 0; index < 3; index += 1) {
			worker.emitMessage({
				protocolVersion: PROTOCOL_VERSION,
				message: { _tag: "Batch", commands },
			});
		}

		expect(host.bus.stats(widgetId).dropped).toBeGreaterThan(0);
		expect(host.status().counters.dropped).toBe(
			host.bus.stats(widgetId).dropped,
		);
	});

	it("does not double-count dropped commands after a second overflow", async () => {
		const { host, worker } = await setup();
		await Effect.runPromise(host.start());
		const batchSize = Math.ceil(MAX_QUEUE_LENGTH / 2);
		const commands = Array.from({ length: batchSize }, (_, index) => ({
			_tag: "CreateNode" as const,
			nodeId: `node:${index}` as NodeId,
			kind: "container" as const,
		}));
		const overflow = () => {
			for (let index = 0; index < 3; index += 1) {
				worker.emitMessage({
					protocolVersion: PROTOCOL_VERSION,
					message: { _tag: "Batch", commands },
				});
			}
		};

		overflow();
		const firstDropped = host.bus.stats(widgetId).dropped;
		overflow();

		expect(host.status().counters.dropped).toBe(firstDropped * 2);
		expect(host.status().counters.dropped).toBe(
			host.bus.stats(widgetId).dropped,
		);
	});

	it("unloads the bundle and marks crashed when the effects manifest fails to load", async () => {
		const failure = new ManifestLoadFailed({
			widgetId,
			message: "boom",
			url: "http://localhost/effects.json",
		});
		const { backend, host } = await setup(
			{ effectsManifest: new URL("http://localhost/effects.json") },
			true,
			failure,
		);

		await expect(Effect.runPromise(host.start())).rejects.toMatchObject({
			_tag: "ManifestLoadFailed",
		});
		expect(callsOf(backend, "loadBundle")).toEqual([["village"]]);
		expect(callsOf(backend, "unloadBundle")).toEqual([["village"]]);
		expect(host.status().state).toBe("crashed");
	});

	it("clears stale nodes when started after a crash", async () => {
		const { target, worker, host } = await setup();
		await Effect.runPromise(host.start());
		target.createNode(rootId, "container");
		worker.emitError("boom");

		await Effect.runPromise(host.start());

		expect(target.snapshot().nodes).toEqual([]);
		expect(host.status().state).toBe("active");
	});

	it("crashes on a worker error", async () => {
		const { status, target, worker, host } = await setup();
		await Effect.runPromise(host.start());
		worker.emitMessage({
			protocolVersion: PROTOCOL_VERSION,
			message: {
				_tag: "Batch",
				commands: [{ _tag: "CreateNode", nodeId: rootId, kind: "container" }],
			},
		});
		expect(host.bus.stats(widgetId).queued).toBe(1);

		worker.emitError("boom");

		expect(host.status().state).toBe("crashed");
		expect(status.get(widgetId)?.state).toBe("crashed");
		expect(target.root.visible).toBe(false);
		expect(host.bus.stats(widgetId).queued).toBe(0);
	});

	it("starts again after a crash and shows the container", async () => {
		const { target, worker, host } = await setup();
		await Effect.runPromise(host.start());
		worker.emitError("boom");

		await Effect.runPromise(host.start());

		expect(host.status().state).toBe("active");
		expect(target.root.visible).toBe(true);
	});

	it("resolves a concurrent start only after the widget becomes active", async () => {
		const { worker, workerCreations, host } = await setup({}, false);
		const initPosted = Deferred.makeUnsafe<void>();
		worker.onPost = (message) => {
			if ((message as PostedEnvelope).message._tag === "Init") {
				Deferred.doneUnsafe(initPosted, Effect.succeed(undefined));
			}
		};

		await Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* Effect.forkChild(host.start());
				const second = yield* Effect.forkChild(host.start());
				yield* Deferred.await(initPosted);

				expect(workerCreations()).toBe(1);
				expect(host.status().state).toBe("loading");

				worker.emitMessage(readyEnvelope);
				yield* Fiber.join(first);
				yield* Fiber.join(second);
			}),
		);

		expect(host.status().state).toBe("active");
	});

	it("fails a concurrent start with the same WidgetTimeout", async () => {
		const { worker, host } = await setup({}, false);

		const program = Effect.gen(function* () {
			const first = yield* Effect.forkChild(Effect.flip(host.start()));
			const second = yield* Effect.forkChild(Effect.flip(host.start()));
			yield* Effect.yieldNow;
			yield* TestClock.adjust("5 seconds");
			return [yield* Fiber.join(first), yield* Fiber.join(second)] as const;
		});

		const [firstError, secondError] = await Effect.runPromise(
			Effect.provide(program, TestClock.layer()),
		);

		expect(firstError).toMatchObject({ _tag: "WidgetTimeout" });
		expect(secondError).toMatchObject({ _tag: "WidgetTimeout" });
		expect(worker.terminated).toBe(true);
		expect(host.status().state).toBe("crashed");
	});

	it("buffers viewer events until the widget is active and flushes them in order", async () => {
		const { worker, host, postedOf, initPosted } = await setup({}, false);
		const firstEvent = {
			_tag: "ViewerJoined" as const,
			viewerId: "viewer:1" as ViewerId,
			displayName: "one",
		};
		const secondEvent = {
			_tag: "ViewerJoined" as const,
			viewerId: "viewer:2" as ViewerId,
			displayName: "two",
		};

		await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(host.start());
				yield* Deferred.await(initPosted);

				host.onCoreEvent(firstEvent);
				host.onCoreEvent(secondEvent);
				expect(postedOf("ViewerEvent")).toEqual([]);

				worker.emitMessage(readyEnvelope);
				yield* Fiber.join(fiber);
			}),
		);

		expect(
			postedOf("ViewerEvent").map((envelope) => envelope.message.event),
		).toEqual([firstEvent, secondEvent]);
	});

	it("drops the oldest buffered events when the buffer is full", async () => {
		const { worker, host, postedOf, initPosted } = await setup({}, false);
		const events = Array.from(
			{ length: MAX_PENDING_EVENTS + 1 },
			(_, index) => ({
				_tag: "ViewerJoined" as const,
				viewerId: `viewer:${index}` as ViewerId,
				displayName: `name-${index}`,
			}),
		);

		await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(host.start());
				yield* Deferred.await(initPosted);
				for (const event of events) {
					host.onCoreEvent(event);
				}

				worker.emitMessage(readyEnvelope);
				yield* Fiber.join(fiber);
			}),
		);

		const flushed = postedOf("ViewerEvent").map(
			(envelope) => envelope.message.event,
		);
		expect(flushed).toHaveLength(MAX_PENDING_EVENTS);
		expect(flushed[0]).toMatchObject({ displayName: "name-1" });
		expect(host.status().counters.dropped).toBe(1);
	});

	it("drops buffered events when the widget fails before activation", async () => {
		const { worker, host, postedOf, initPosted } = await setup({}, false);

		await Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* Effect.forkChild(Effect.exit(host.start()));
				yield* Deferred.await(initPosted);
				host.onCoreEvent({
					_tag: "ViewerJoined",
					viewerId: "viewer:1" as ViewerId,
					displayName: "one",
				});
				worker.emitError("boom");
				yield* Fiber.join(first);

				worker.onPost = (message) => {
					if ((message as PostedEnvelope).message._tag === "Init") {
						worker.emitMessage(readyEnvelope);
					}
				};
				yield* host.start();
			}),
		);

		expect(postedOf("ViewerEvent")).toEqual([]);
	});

	it("sends the last viewport set before activation", async () => {
		const { worker, host, postedOf, initPosted } = await setup({}, false);
		host.setViewport({ width: 800, height: 600 });

		await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(host.start());
				yield* Deferred.await(initPosted);
				worker.emitMessage(readyEnvelope);
				yield* Fiber.join(fiber);
			}),
		);

		expect(postedOf("Viewport")).toEqual([
			{
				protocolVersion: PROTOCOL_VERSION,
				message: { _tag: "Viewport", w: 800, h: 600 },
			},
		]);
	});

	it("sends only the last viewport when it changes before activation", async () => {
		const { worker, host, postedOf, initPosted } = await setup({}, false);
		host.setViewport({ width: 800, height: 600 });
		host.setViewport({ width: 1024, height: 768 });
		host.setViewport({ width: 1600, height: 900 });

		await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(host.start());
				yield* Deferred.await(initPosted);
				worker.emitMessage(readyEnvelope);
				yield* Fiber.join(fiber);
			}),
		);

		expect(postedOf("Viewport")).toEqual([
			{
				protocolVersion: PROTOCOL_VERSION,
				message: { _tag: "Viewport", w: 1600, h: 900 },
			},
		]);
	});

	it("stays active while heartbeats arrive within the timeout", async () => {
		const { worker, host, advance } = await setup();
		await Effect.runPromise(host.start());

		advance(1000);
		worker.emitMessage(serviceEnvelope("Heartbeat"));
		advance(1000);
		worker.emitMessage(serviceEnvelope("Heartbeat"));
		host.ensureAlive();

		expect(host.status().state).toBe("active");
	});

	it("crashes and terminates the worker when heartbeats stop", async () => {
		const { worker, host, advance } = await setup();
		await Effect.runPromise(host.start());

		advance(2001);
		host.ensureAlive();

		expect(host.status().state).toBe("crashed");
		expect(worker.terminated).toBe(true);
		expect(host.status().lastError?.tag).toBe("WidgetTimeout");
	});

	it("does not repeat Pause and Resume envelopes", async () => {
		const { host, postedOf } = await setup();
		await Effect.runPromise(host.start());

		host.pause();
		host.pause();
		expect(postedOf("Pause")).toHaveLength(1);

		host.resume();
		host.resume();
		expect(postedOf("Resume")).toHaveLength(1);
	});

	it("counts every heartbeat", async () => {
		const { worker, host } = await setup();
		await Effect.runPromise(host.start());

		worker.emitMessage(serviceEnvelope("Heartbeat"));
		worker.emitMessage(serviceEnvelope("Heartbeat"));

		expect(host.status().counters.heartbeat).toBe(2);
	});

	it("pauses the watchdog on Pause and resumes it on Resume", async () => {
		const { host, advance, postedOf } = await setup();
		await Effect.runPromise(host.start());

		host.pause();
		expect(postedOf("Pause")).toHaveLength(1);
		advance(60_000);
		host.ensureAlive();
		expect(host.status().state).toBe("paused");

		host.resume();
		expect(postedOf("Resume")).toHaveLength(1);
		advance(2000);
		host.ensureAlive();
		expect(host.status().state).toBe("active");

		advance(1);
		host.ensureAlive();
		expect(host.status().state).toBe("crashed");
	});

	it("does not pause or crash a widget that is not active", async () => {
		const { host, advance, postedOf } = await setup();

		host.pause();
		expect(host.status().state).toBe("loading");
		expect(postedOf("Pause")).toHaveLength(0);

		host.resume();
		expect(host.status().state).toBe("loading");
		expect(postedOf("Resume")).toHaveLength(0);

		advance(60_000);
		host.ensureAlive();
		expect(host.status().state).toBe("loading");
		expect(host.status().lastError).toBeNull();
	});

	it("stops watching the widget after stop", async () => {
		const { host, advance } = await setup();
		await Effect.runPromise(host.start());
		await Effect.runPromise(host.stop());

		advance(60_000);
		host.ensureAlive();

		expect(host.status().state).toBe("loading");
		expect(host.status().lastError).toBeNull();
	});

	it("gives the restarted widget a fresh watchdog", async () => {
		const { host, advance } = await setup();
		await Effect.runPromise(host.start());
		advance(2001);
		host.ensureAlive();
		expect(host.status().state).toBe("crashed");

		await Effect.runPromise(host.start());
		host.ensureAlive();
		expect(host.status().state).toBe("active");

		advance(2000);
		host.ensureAlive();
		expect(host.status().state).toBe("active");

		advance(1);
		host.ensureAlive();
		expect(host.status().state).toBe("crashed");
	});
});

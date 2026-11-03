import {
	type BundleLoadFailed,
	type CoreToWidget,
	type ManifestLoadFailed,
	PROTOCOL_VERSION,
	type ProtocolMismatch,
	type ViewerEvent,
	type WidgetCrashed,
	type WidgetId,
	WidgetTimeout,
} from "@tv/protocol";
import { Deferred, Effect, Exit, Match } from "effect";
import type { Container } from "pixi.js";
import { createEffectRegistry } from "../effects/effect-registry";
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
import type { WidgetFrame } from "../loop/ticker";
import { type CommandBus, createCommandBus } from "../queue/command-bus";
import type { WidgetStatus } from "../status";
import type { Viewport } from "../viewport";
import { createWatchdog } from "./watchdog";
import {
	createWorkerTransport,
	type WorkerTransport,
	type WorkerTransportFailure,
} from "./worker-transport";

export const MAX_QUEUE_LENGTH = 4096;
export const MAX_COMMANDS_PER_FRAME = 512;
export const MAX_DRAIN_MS = 4;
export const MAX_PENDING_EVENTS = 256;
const READY_TIMEOUT = "5 seconds";

export interface WidgetDescriptor {
	readonly id: WidgetId;
	readonly workerUrl: URL;
	readonly assetBundle: string;
	readonly effectsManifest?: URL;
	readonly config?: unknown;
}

export type WidgetError =
	| BundleLoadFailed
	| ManifestLoadFailed
	| ProtocolMismatch
	| WidgetCrashed
	| WidgetTimeout;

export type WidgetHostServices =
	| Assets
	| Clock
	| Effects
	| Manifests
	| RenderTargets
	| Statuses
	| Viewports
	| Workers;

export interface WidgetHost {
	readonly widgetId: WidgetId;
	readonly bus: CommandBus;
	readonly root: Container;
	start(): Effect.Effect<void, WidgetError>;
	stop(): Effect.Effect<void>;
	onCoreEvent(event: ViewerEvent): void;
	setViewport(viewport: Viewport): void;
	pause(): void;
	resume(): void;
	ensureAlive(): void;
	frame(): WidgetFrame;
	status(): WidgetStatus;
}

function createDisposeEvent(): CoreToWidget {
	return {
		protocolVersion: PROTOCOL_VERSION,
		message: {
			_tag: "Dispose",
		},
	};
}

function createInitEvent(
	id: WidgetId,
	viewport: Viewport,
	config: unknown,
): CoreToWidget {
	return {
		protocolVersion: PROTOCOL_VERSION,
		message: {
			_tag: "Init",
			widgetId: id,
			config,
			viewport: {
				w: viewport.width,
				h: viewport.height,
			},
		},
	};
}

function createPauseEvent(): CoreToWidget {
	return {
		protocolVersion: PROTOCOL_VERSION,
		message: {
			_tag: "Pause",
		},
	};
}

function createResumeEvent(): CoreToWidget {
	return {
		protocolVersion: PROTOCOL_VERSION,
		message: {
			_tag: "Resume",
		},
	};
}

function createViewerEvent(event: ViewerEvent): CoreToWidget {
	return {
		protocolVersion: PROTOCOL_VERSION,
		message: {
			_tag: "ViewerEvent",
			event,
		},
	};
}

function createViewportEvent(viewport: Viewport): CoreToWidget {
	return {
		protocolVersion: PROTOCOL_VERSION,
		message: {
			_tag: "Viewport",
			w: viewport.width,
			h: viewport.height,
		},
	};
}

export function createWidgetHost(
	descriptor: WidgetDescriptor,
): Effect.Effect<WidgetHost, never, WidgetHostServices> {
	return Effect.gen(function* () {
		const assets = yield* Assets;
		const compiler = yield* Effects;
		const renderTargets = yield* RenderTargets;
		const statusStore = yield* Statuses;
		const viewportSource = yield* Viewports;
		const workerFactory = yield* Workers;
		const manifestLoader = yield* Manifests;
		const clock = yield* Clock;

		const watchdog = createWatchdog();
		const id = descriptor.id;
		const assetRegistry = assets.create(id);
		const effectRegistry = createEffectRegistry({
			widgetId: id,
			compiler,
		});
		const target = renderTargets.create(id);

		const pendingEvents: ViewerEvent[] = [];
		let lastViewport: Viewport | null = null;
		let reportedDropped = 0;
		let workerTransport: WorkerTransport | null = null;
		let starting: Deferred.Deferred<void, WidgetError> | null = null;
		let widgetIsAttached = false;

		statusStore.register(id);

		const commandBus = createCommandBus({
			maxQueueLength: MAX_QUEUE_LENGTH,
			maxCommandsPerFrame: MAX_COMMANDS_PER_FRAME,
			maxDrainMs: MAX_DRAIN_MS,
			onOverflow: (_) => {
				const total = commandBus.stats(id).dropped;
				statusStore.count(id, "dropped", total - reportedDropped);
				reportedDropped = total;
			},
		});

		function transportToSend(): WorkerTransport | null {
			return widgetIsAttached ? workerTransport : null;
		}

		function sendToWorker(message: ViewerEvent) {
			const transport = transportToSend();
			if (transport !== null) {
				transport.transport.send(createViewerEvent(message));
			} else {
				if (pendingEvents.length >= MAX_PENDING_EVENTS) {
					pendingEvents.shift();
					statusStore.count(id, "dropped", 1);
				}
				pendingEvents.push(message);
			}
		}

		function disposeTransport() {
			if (workerTransport !== null) {
				workerTransport.transport.send(createDisposeEvent());
				workerTransport.dispose();
				workerTransport = null;
			}
		}

		function reset() {
			widgetIsAttached = false;
			lastViewport = null;
			pendingEvents.length = 0;
			disposeTransport();
			commandBus.clear(id);
		}

		function markFailed() {
			statusStore.setState(id, "crashed");
			target.root.visible = false;
			reset();
		}

		function clearScene() {
			return Effect.forEach(
				target.snapshot().nodes,
				(node) => {
					target.removeNode(node.nodeId);
					return effectRegistry.release(node.nodeId);
				},
				{ discard: true },
			);
		}

		const unloadAssets = assetRegistry
			.unloadBundle(descriptor.assetBundle)
			.pipe(Effect.ignore());

		const ensureAlive = () => {
			if (!widgetIsAttached) return;
			if (!watchdog.overdue(clock.now())) return;

			statusStore.recordError(
				id,
				new WidgetTimeout({
					widgetId: id,
					message: "Widget watchdog timeout",
				}),
			);
			markFailed();
		};

		return {
			widgetId: id,
			bus: commandBus,
			root: target.root,

			start: () =>
				Effect.onExit(
					Effect.gen(function* () {
						if (workerTransport !== null) {
							return;
						}
						if (starting !== null) {
							yield* Deferred.await(starting);
							return;
						}
						const gate = Deferred.makeUnsafe<void, WidgetError>();
						starting = gate;

						yield* clearScene();
						statusStore.setState(id, "loading");

						const ready = yield* Deferred.make<void, WidgetError>();

						const stage = Effect.gen(function* () {
							yield* assetRegistry.loadBundle(descriptor.assetBundle);
							if (descriptor.effectsManifest !== undefined) {
								const manifest = yield* manifestLoader.load(
									descriptor.effectsManifest,
								);
								effectRegistry.register(manifest);
							}
						});

						const cleanup = Effect.gen(function* () {
							yield* unloadAssets;
							markFailed();
						});

						yield* stage.pipe(Effect.onError(() => cleanup));
						target.root.visible = true;

						const worker = workerFactory(descriptor.workerUrl);
						workerTransport = createWorkerTransport({
							worker,
							widgetId: id,
							onFailure: function (error: WorkerTransportFailure): void {
								if (!Deferred.doneUnsafe(ready, Effect.fail(error))) {
									markFailed();
								}
							},
						});
						workerTransport.transport.subscribe(({ message }) => {
							Match.value(message).pipe(
								Match.tag("Ready", () => {
									Deferred.doneUnsafe(ready, Effect.succeed(undefined));
								}),
								Match.tag("Batch", ({ commands }) => {
									commandBus.push(id, commands);
								}),
								Match.tag("Heartbeat", () => {
									statusStore.count(id, "heartbeat");
									watchdog.beat(clock.now());
								}),
							);
						});

						const viewport = viewportSource();
						workerTransport.transport.send(
							createInitEvent(id, viewport, descriptor.config),
						);

						yield* Deferred.await(ready).pipe(
							Effect.timeoutOrElse({
								duration: READY_TIMEOUT,
								orElse: () =>
									Effect.fail(
										new WidgetTimeout({
											widgetId: id,
											message: "Widget did not respond to init message",
										}),
									),
							}),
							Effect.onError(() => Effect.sync(markFailed)),
						);

						if (workerTransport === null) {
							return;
						}
						watchdog.reset(clock.now());
						statusStore.setState(id, "active");
						widgetIsAttached = true;
						if (lastViewport !== null) {
							const transport = transportToSend();
							if (transport !== null) {
								transport.transport.send(createViewportEvent(lastViewport));
							}
						}
						const queued = pendingEvents.splice(0);
						for (const event of queued) {
							sendToWorker(event);
						}
					}),
					(exit) =>
						Effect.sync(() => {
							if (starting === null) return;
							const gate = starting;
							starting = null;
							if (Exit.isSuccess(exit)) {
								Deferred.doneUnsafe(gate, Effect.succeed(undefined));
							} else {
								Deferred.doneUnsafe(gate, Effect.failCause(exit.cause));
							}
						}),
				),
			stop: () =>
				Effect.gen(function* () {
					reset();
					yield* clearScene();
					yield* unloadAssets;
					statusStore.setState(id, "loading");
				}),
			onCoreEvent: (event) => {
				sendToWorker(event);
			},
			setViewport: (viewport) => {
				const transport = transportToSend();
				if (transport !== null) {
					transport.transport.send(createViewportEvent(viewport));
				} else {
					lastViewport = viewport;
				}
			},
			pause: () => {
				if (widgetIsAttached && !watchdog.paused) {
					watchdog.pause();
					statusStore.setState(id, "paused");
					const transport = transportToSend();
					if (transport !== null) {
						transport.transport.send(createPauseEvent());
					}
				}
			},
			resume: () => {
				if (widgetIsAttached && watchdog.paused) {
					watchdog.resume(clock.now());
					statusStore.setState(id, "active");
					const transport = transportToSend();
					if (transport !== null) {
						transport.transport.send(createResumeEvent());
					}
				}
			},
			ensureAlive,
			frame: () => ({
				widgetId: id,
				bus: commandBus,
				context: {
					widgetId: id,
					target,
					textures: assetRegistry,
					effects: effectRegistry,
				},
				ensureAlive,
			}),
			status: () => {
				const status = statusStore.get(id);
				if (status === undefined) {
					throw new Error(
						"Widget must be registered before status can be queried",
					);
				}
				return status;
			},
		};
	});
}

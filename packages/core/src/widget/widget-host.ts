import {
	type BundleLoadFailed,
	type BundleLoadTimeout,
	type CoreToWidget,
	type ManifestLoadFailed,
	PROTOCOL_VERSION,
	type ProtocolMismatch,
	type RenderCommand,
	type ViewerEvent,
	type WidgetCrashed,
	type WidgetId,
	WidgetTimeout,
} from "@tv/protocol";
import { Cause, Deferred, Effect, Exit, Match, Scope } from "effect";
import type { Container } from "pixi.js";
import { createEffectRegistry } from "../effects/effect-registry";
import {
	Assets,
	CommandBuses,
	Effects,
	Manifests,
	RenderTargets,
	Statuses,
	Viewports,
	Workers,
} from "../live";
import type { WidgetFrame } from "../loop/ticker";
import type { CommandBus } from "../queue/command-bus";
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
	| BundleLoadTimeout
	| ManifestLoadFailed
	| ProtocolMismatch
	| WidgetCrashed
	| WidgetTimeout;

export type WidgetHostServices =
	| Assets
	| CommandBuses
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
	pause(): Effect.Effect<void>;
	resume(): Effect.Effect<void>;
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
		const commandBuses = yield* CommandBuses;

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
		let activationScope: Scope.Closeable | null = null;

		let phase: "idle" | "starting" | "active" = "idle";

		statusStore.register(id);

		const commandBus = yield* commandBuses.create({
			maxQueueLength: MAX_QUEUE_LENGTH,
			maxCommandsPerFrame: MAX_COMMANDS_PER_FRAME,
			maxDrainMs: MAX_DRAIN_MS,
		});

		const pushCommands = (commands: readonly RenderCommand[]) => {
			Effect.runFork(
				commandBus.push(id, commands).pipe(
					Effect.catchTag("QueueOverflow", () =>
						commandBus.stats(id).pipe(
							Effect.flatMap(({ dropped }) =>
								Effect.sync(() => {
									statusStore.count(id, "dropped", dropped - reportedDropped);
									reportedDropped = dropped;
									if (phase === "active") {
										statusStore.setState(id, "degraded");
									}
								}),
							),
						),
					),
				),
			);
		};

		function transportToSend(): WorkerTransport | null {
			return phase === "active" ? workerTransport : null;
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

		function closeActivation(): Effect.Effect<void> {
			return Effect.gen(function* () {
				phase = "idle";
				lastViewport = null;
				pendingEvents.length = 0;
				yield* watchdog.stop();
				yield* commandBus.clear(id);

				const scope = activationScope;
				activationScope = null;
				if (scope !== null) {
					yield* Scope.close(scope, Exit.void);
				}
			});
		}

		function markFailed() {
			statusStore.setState(id, "crashed");
			target.root.visible = false;
		}

		function failActivation(): Effect.Effect<void> {
			return Effect.gen(function* () {
				markFailed();
				yield* closeActivation();
			});
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

		const onWatchdogTimeout = Effect.gen(function* () {
			statusStore.recordError(
				id,
				new WidgetTimeout({
					widgetId: id,
					message: "Widget watchdog timeout",
				}),
			);
			markFailed();
			yield* Effect.forkDetach(closeActivation());
		});

		return {
			widgetId: id,
			bus: commandBus,
			root: target.root,

			start: () =>
				Effect.onExit(
					Effect.gen(function* () {
						if (phase === "active") return;
						if (phase === "starting") {
							const previousGate = starting;
							if (previousGate !== null) {
								yield* Deferred.await(previousGate);
							}
							return;
						}
						phase = "starting";
						const gate = Deferred.makeUnsafe<void, WidgetError>();
						starting = gate;

						const ready = yield* Deferred.make<void, WidgetError>();

						statusStore.setState(id, "loading");

						activationScope = yield* Scope.make();

						yield* Scope.provide(
							Effect.gen(function* () {
								yield* Effect.acquireRelease(
									assetRegistry.loadBundle(descriptor.assetBundle),
									() =>
										Effect.gen(function* () {
											yield* assetRegistry
												.unloadBundle(descriptor.assetBundle)
												.pipe(Effect.ignore());
										}),
								);

								if (descriptor.effectsManifest !== undefined) {
									const manifest = yield* manifestLoader.load(
										descriptor.effectsManifest,
									);
									effectRegistry.register(manifest);
								}

								yield* Effect.acquireRelease(
									Effect.gen(function* () {
										const worker = workerFactory(descriptor.workerUrl);
										const transport = createWorkerTransport({
											worker,
											widgetId: id,
											onFailure: (error: WorkerTransportFailure) => {
												statusStore.recordError(id, error);
												if (!Deferred.doneUnsafe(ready, Effect.fail(error))) {
													markFailed();
													Effect.runFork(closeActivation());
												}
											},
										});
										transport.transport.subscribe(({ message }) => {
											Match.value(message).pipe(
												Match.tag("Ready", () => {
													Deferred.doneUnsafe(ready, Effect.succeed(undefined));
												}),
												Match.tag("Batch", ({ commands }) => {
													pushCommands(commands);
												}),
												Match.tag("Heartbeat", () => {
													statusStore.count(id, "heartbeat");
													watchdog.beat();
												}),
											);
										});
										const viewport = viewportSource();
										transport.transport.send(
											createInitEvent(id, viewport, descriptor.config),
										);
										workerTransport = transport;
										return transport;
									}),
									(transport) =>
										Effect.sync(() => {
											transport.transport.send(createDisposeEvent());
											transport.dispose();
											if (workerTransport === transport) workerTransport = null;
										}),
								);

								yield* Effect.addFinalizer(() => clearScene());
							}),
							activationScope,
						).pipe(
							Effect.onExit((exit) => {
								if (Exit.isSuccess(exit)) return Effect.void;
								if (Cause.hasInterruptsOnly(exit.cause)) {
									const scope = activationScope;
									activationScope = null;
									if (scope !== null) {
										return Scope.close(scope, Exit.void);
									}
									return Effect.void;
								}
								return failActivation();
							}),
						);

						target.root.visible = true;

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
							Effect.onError(() => failActivation()),
						);

						if (phase !== "starting") return;
						statusStore.setState(id, "active");
						phase = "active";
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

						const scope = activationScope;
						if (scope !== null) {
							yield* watchdog.start(scope, onWatchdogTimeout);
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
					yield* closeActivation();

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
			pause: () =>
				Effect.gen(function* () {
					if (phase !== "active" || watchdog.paused) return;
					yield* watchdog.pause();
					statusStore.setState(id, "paused");
					const transport = transportToSend();
					if (transport !== null) {
						transport.transport.send(createPauseEvent());
					}
				}),
			resume: () =>
				Effect.gen(function* () {
					if (phase !== "active" || !watchdog.paused) return;
					const scope = activationScope;
					if (scope === null) return;
					yield* watchdog.resume(scope, onWatchdogTimeout);
					statusStore.setState(id, "active");
					const transport = transportToSend();
					if (transport !== null) {
						transport.transport.send(createResumeEvent());
					}
				}),
			frame: () => ({
				widgetId: id,
				bus: commandBus,
				context: {
					widgetId: id,
					target,
					textures: assetRegistry,
					effects: effectRegistry,
				},
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

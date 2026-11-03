import type { WidgetId } from "@tv/protocol";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { CoreApp, Statuses } from "../live";
import type { WidgetStatus } from "../status";
import {
	createWidgetHost,
	type WidgetDescriptor,
	type WidgetError,
	type WidgetHost,
	type WidgetHostServices,
} from "../widget/widget-host";

export interface ActivateOptions {
	readonly restart?: boolean;
}

export interface SceneManager {
	activate(
		descriptor: WidgetDescriptor,
		options?: ActivateOptions,
	): Effect.Effect<void, WidgetError, WidgetHostServices>;
	deactivate(widgetId: WidgetId): Effect.Effect<void>;
	status(widgetId: WidgetId): WidgetStatus | undefined;
	list(): readonly WidgetId[];
}

export type SceneManagerServices = CoreApp | WidgetHostServices;

export function createSceneManager(): Effect.Effect<
	SceneManager,
	never,
	SceneManagerServices
> {
	return Effect.gen(function* () {
		const app = yield* CoreApp;
		const statuses = yield* Statuses;

		const hosts = new Map<WidgetId, WidgetHost>();
		const starting = new Map<WidgetId, Deferred.Deferred<void, WidgetError>>();
		const runningFibers = new Map<WidgetId, Fiber.Fiber<void, WidgetError>>();
		let nextZIndex = 0;

		const dropWidget = Effect.fnUntraced(function* (
			widgetId: WidgetId,
			host: WidgetHost,
		) {
			if (host.root.parent !== null) {
				app.stage.removeChild(host.root);
			}
			yield* host.stop();
			statuses.remove(widgetId);
			hosts.delete(widgetId);
			starting.delete(widgetId);
			runningFibers.delete(widgetId);
		});

		const startWidget = Effect.fnUntraced(function* (
			descriptor: WidgetDescriptor,
			gate: Deferred.Deferred<void, WidgetError>,
		) {
			const host = yield* createWidgetHost(descriptor);
			hosts.set(descriptor.id, host);

			const fiber = yield* Effect.forkChild(host.start());
			runningFibers.set(descriptor.id, fiber);
			yield* Fiber.join(fiber);

			app.stage.addChild(host.root);
			host.root.zIndex = nextZIndex++;
			Deferred.doneUnsafe(gate, Effect.succeed(undefined));
			starting.delete(descriptor.id);
			runningFibers.delete(descriptor.id);
		});

		return {
			list: () => [...hosts.keys()],
			activate: (descriptor, options) =>
				Effect.gen(function* () {
					const oldGate = starting.get(descriptor.id);
					if (oldGate !== undefined) {
						yield* Deferred.await(oldGate);
						return;
					}

					if (options?.restart) {
						const host = hosts.get(descriptor.id);
						if (host !== undefined) {
							yield* dropWidget(descriptor.id, host);
						}
					}

					if (hosts.has(descriptor.id)) {
						return;
					}

					const gate = Deferred.makeUnsafe<void, WidgetError>();
					starting.set(descriptor.id, gate);

					yield* startWidget(descriptor, gate).pipe(
						Effect.onExit((exit) =>
							Effect.gen(function* () {
								if (Exit.isSuccess(exit)) {
									return;
								}

								const host = hosts.get(descriptor.id);

								if (host !== undefined) {
									yield* dropWidget(descriptor.id, host);
								}

								starting.delete(descriptor.id);

								return Deferred.doneUnsafe(gate, Effect.failCause(exit.cause));
							}),
						),
					);
				}),
			deactivate: (widgetId) =>
				Effect.gen(function* () {
					const fiber = runningFibers.get(widgetId);
					if (fiber !== undefined) {
						yield* Fiber.interrupt(fiber);
						return;
					}

					const host = hosts.get(widgetId);
					if (host !== undefined) {
						yield* dropWidget(widgetId, host);
					}
				}),
			status: (widgetId) => hosts.get(widgetId)?.status(),
		};
	});
}

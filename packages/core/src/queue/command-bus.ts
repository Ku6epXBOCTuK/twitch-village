import { QueueOverflow, type RenderCommand, type WidgetId } from "@tv/protocol";
import { Effect, Exit, Queue, Ref, SynchronizedRef } from "effect";

export interface CommandBusConfig {
	readonly maxQueueLength: number;
	readonly maxCommandsPerFrame: number;
	readonly maxDrainMs: number;
	readonly now?: () => number;
}

export interface CommandBusStats {
	readonly queued: number;
	readonly dropped: number;
	readonly processed: number;
}

export interface CommandBus {
	readonly push: (
		widgetId: WidgetId,
		commands: readonly RenderCommand[],
	) => Effect.Effect<void, QueueOverflow>;
	readonly drain: (
		widgetId: WidgetId,
	) => Effect.Effect<readonly RenderCommand[]>;
	readonly commit: (widgetId: WidgetId, applied: number) => Effect.Effect<void>;
	readonly stats: (widgetId: WidgetId) => Effect.Effect<CommandBusStats>;
	readonly clear: (widgetId: WidgetId) => Effect.Effect<void>;
}

export type CommandBusFactory = (
	config: CommandBusConfig,
) => Effect.Effect<CommandBus>;

function isCount(value: number): boolean {
	return Number.isInteger(value) && value > 0;
}

function validateConfig(config: CommandBusConfig): void {
	if (!isCount(config.maxQueueLength)) {
		throw new Error(
			`maxQueueLength must be a positive integer, got ${config.maxQueueLength}`,
		);
	}
	if (!isCount(config.maxCommandsPerFrame)) {
		throw new Error(
			`maxCommandsPerFrame must be a positive integer, got ${config.maxCommandsPerFrame}`,
		);
	}
	if (!Number.isFinite(config.maxDrainMs) || config.maxDrainMs < 0) {
		throw new Error(
			`maxDrainMs must be a non-negative finite number, got ${config.maxDrainMs}`,
		);
	}
}

function drainAll<T>(queue: Queue.Queue<T>): number {
	let exit = Queue.takeUnsafe(queue);
	let count = 0;
	while (exit !== undefined && Exit.isSuccess(exit)) {
		count++;
		exit = Queue.takeUnsafe(queue);
	}
	return count;
}

interface State {
	queue: Queue.Queue<RenderCommand>;
	dropped: Ref.Ref<number>;
	processed: Ref.Ref<number>;
}

const EMPTY_COMMANDS: readonly RenderCommand[] = Object.freeze([]);
const EMPTY_STATS: CommandBusStats = Object.freeze({
	queued: 0,
	dropped: 0,
	processed: 0,
});

export const createCommandBus: CommandBusFactory = (
	config: CommandBusConfig,
) => {
	const now = config.now ?? (() => performance.now());

	return Effect.gen(function* () {
		validateConfig(config);

		const states = yield* SynchronizedRef.make(new Map<WidgetId, State>());

		const stateFor = (widgetId: WidgetId) =>
			SynchronizedRef.modifyEffect(states, (byWidget) => {
				const existing = byWidget.get(widgetId);
				if (existing !== undefined) {
					return Effect.succeed([existing, byWidget] as const);
				}
				return Effect.gen(function* () {
					const queue = yield* Queue.bounded<RenderCommand>(
						config.maxQueueLength,
					);
					const state: State = {
						queue,
						dropped: yield* Ref.make(0),
						processed: yield* Ref.make(0),
					};
					return [state, new Map(byWidget).set(widgetId, state)] as const;
				});
			});

		return {
			push: (widgetId, commands) =>
				Effect.gen(function* () {
					const state = yield* stateFor(widgetId);
					const size = yield* Queue.size(state.queue);
					const totalSize = commands.length + size;
					if (totalSize > config.maxQueueLength) {
						const discarded = drainAll(state.queue);
						const total = discarded + commands.length;

						yield* Ref.update(state.dropped, (dropped) => dropped + total);

						return yield* Effect.fail(
							new QueueOverflow({
								widgetId,
								message: `Queue overflow: was queued ${discarded}, new incoming ${commands.length}, total dropped ${total}`,
							}),
						);
					}
					const dropped = yield* Queue.offerAll(state.queue, commands);
					if (dropped.length > 0) {
						throw new Error(
							`Queue.offerAll left ${dropped} commands although the queue had room in widget ${widgetId}`,
						);
					}
				}),
			drain: (widgetId) =>
				Effect.gen(function* () {
					const byWidget = yield* SynchronizedRef.get(states);
					const state = byWidget.get(widgetId);

					if (state === undefined) {
						return EMPTY_COMMANDS;
					}
					const size = Queue.sizeUnsafe(state.queue);
					if (size === 0) {
						return EMPTY_COMMANDS;
					}

					const deadline = now() + config.maxDrainMs;
					const maxToProcess = Math.min(config.maxCommandsPerFrame, size);
					const result: RenderCommand[] = [];

					for (let i = 0; i < maxToProcess; i++) {
						const commandExit = Queue.takeUnsafe(state.queue);
						if (commandExit === undefined) {
							break;
						}
						if (Exit.isSuccess(commandExit)) {
							result.push(commandExit.value);
						}
						if (now() > deadline) {
							break;
						}
					}
					return result;
				}),
			commit: (widgetId, applied) => {
				return Effect.gen(function* () {
					if (!Number.isInteger(applied) || applied < 0) {
						throw new Error(
							`Commit applied must be a non-negative integer in widget ${widgetId}`,
						);
					}

					const byWidget = yield* SynchronizedRef.get(states);
					const state = byWidget.get(widgetId);
					if (state === undefined) return;
					yield* Ref.update(
						state.processed,
						(processed) => processed + applied,
					);
				});
			},
			stats: (widgetId) =>
				Effect.gen(function* () {
					const byWidget = yield* SynchronizedRef.get(states);
					const state = byWidget.get(widgetId);
					if (state === undefined) {
						return EMPTY_STATS;
					}
					return {
						queued: Queue.sizeUnsafe(state.queue),
						dropped: yield* Ref.get(state.dropped),
						processed: yield* Ref.get(state.processed),
					};
				}),
			clear: (widgetId) =>
				Effect.map(SynchronizedRef.get(states), (byWidget) => {
					const state = byWidget.get(widgetId);
					if (state === undefined) return;
					drainAll(state.queue);
				}),
		};
	});
};

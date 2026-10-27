import { QueueOverflow, type RenderCommand, type WidgetId } from "@tv/protocol";

export interface CommandBusConfig {
	readonly maxQueueLength: number;
	readonly maxCommandsPerFrame: number;
	readonly maxDrainMs: number;
	readonly now?: () => number;
	readonly onOverflow?: (error: QueueOverflow) => void;
}

export interface CommandBusStats {
	readonly queued: number;
	readonly dropped: number;
	readonly processed: number;
}

interface State {
	commands: RenderCommand[];
	dropped: number;
	processed: number;
}

export interface CommandBus {
	// NOTE: a batch that does not fit clears the queue, counts into dropped
	// and calls onOverflow once; the widget goes degraded, not the bus.
	push(widgetId: WidgetId, commands: readonly RenderCommand[]): void;
	// NOTE: applies at most maxCommandsPerFrame and stops after the command
	// that crosses maxDrainMs, so the budget is checked after each command.
	drain(widgetId: WidgetId): readonly RenderCommand[];
	stats(widgetId: WidgetId): CommandBusStats;
	clear(widgetId: WidgetId): void;
}

export function createCommandBus(config: CommandBusConfig): CommandBus {
	const states: Map<WidgetId, State> = new Map();
	const now = config.now ?? (() => performance.now());

	function stateFor(widgetId: WidgetId): State {
		const state = states.get(widgetId);
		if (state !== undefined) return state;
		const newState: State = { commands: [], dropped: 0, processed: 0 };
		states.set(widgetId, newState);
		return newState;
	}

	return {
		push: (widgetId: WidgetId, commands: readonly RenderCommand[]) => {
			const state = stateFor(widgetId);
			const current = state.commands.length;
			if (current + commands.length > config.maxQueueLength) {
				const queued = state.commands.length;
				const incoming = commands.length;
				const total = queued + incoming;

				config.onOverflow?.(
					new QueueOverflow({
						widgetId,
						message: `Queue overflow: was queued ${queued}, new incoming ${incoming}, total dropped ${total}`,
					}),
				);
				state.dropped += commands.length + current;
				state.commands.length = 0;
			} else {
				state.commands.push(...commands);
			}
		},
		drain: (widgetId: WidgetId): readonly RenderCommand[] => {
			const state = stateFor(widgetId);
			const start = now();
			const deadline = start + config.maxDrainMs;
			const result: RenderCommand[] = [];
			const maxToProcess = Math.min(
				config.maxCommandsPerFrame,
				state.commands.length,
			);
			const commandsToProcess = state.commands.splice(0, maxToProcess);
			for (const [index, command] of commandsToProcess.entries()) {
				state.processed += 1;
				result.push(command);
				if (now() > deadline) {
					state.commands.unshift(...commandsToProcess.slice(index + 1));
					break;
				}
			}

			return result;
		},
		stats: (widgetId: WidgetId): CommandBusStats => {
			const state = stateFor(widgetId);
			return {
				queued: state.commands.length,
				dropped: state.dropped,
				processed: state.processed,
			};
		},
		clear: (widgetId: WidgetId) => {
			const state = stateFor(widgetId);
			state.commands.length = 0;
		},
	};
}

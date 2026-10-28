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
	// NOTE: drain only hands commands out; processed grows when the caller
	// reports how many it actually applied.
	commit(widgetId: WidgetId, applied: number): void;
	stats(widgetId: WidgetId): CommandBusStats;
	clear(widgetId: WidgetId): void;
}

const EMPTY_COMMANDS: readonly RenderCommand[] = Object.freeze([]);
const EMPTY_STATS: CommandBusStats = Object.freeze({
	queued: 0,
	dropped: 0,
	processed: 0,
});

function validateConfig(config: CommandBusConfig): void {
	const isCount = (value: number) => Number.isInteger(value) && value > 0;

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

export function createCommandBus(config: CommandBusConfig): CommandBus {
	validateConfig(config);

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
			const state = states.get(widgetId);
			if (state === undefined || state.commands.length === 0) {
				return EMPTY_COMMANDS;
			}

			const deadline = now() + config.maxDrainMs;
			const maxToProcess = Math.min(
				config.maxCommandsPerFrame,
				state.commands.length,
			);
			const commandsToProcess = state.commands.splice(0, maxToProcess);
			const result: RenderCommand[] = [];
			for (const [index, command] of commandsToProcess.entries()) {
				result.push(command);
				if (now() > deadline) {
					state.commands.unshift(...commandsToProcess.slice(index + 1));
					break;
				}
			}

			return result;
		},
		commit: (widgetId: WidgetId, applied: number) => {
			if (!Number.isInteger(applied) || applied < 0) {
				throw new Error(
					`applied must be a non-negative integer, got ${applied}`,
				);
			}
			const state = states.get(widgetId);
			if (state !== undefined) {
				state.processed += applied;
			}
		},
		stats: (widgetId: WidgetId): CommandBusStats => {
			const state = states.get(widgetId);
			if (state === undefined) return EMPTY_STATS;
			return {
				queued: state.commands.length,
				dropped: state.dropped,
				processed: state.processed,
			};
		},
		clear: (widgetId: WidgetId) => {
			const state = states.get(widgetId);
			if (state !== undefined) {
				state.commands.length = 0;
			}
		},
	};
}

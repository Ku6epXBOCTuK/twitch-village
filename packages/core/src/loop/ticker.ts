import type { WidgetId } from "@tv/protocol";
import { Effect } from "effect";
import type { Application } from "pixi.js";
import type { EffectAdapter } from "../effect-adapter";
import { Statuses } from "../live";
import { type ApplyCommandContext, applyCommand } from "../nodes/apply-command";
import type { CommandBus } from "../queue/command-bus";

export interface WidgetFrame {
	readonly widgetId: WidgetId;
	readonly bus: CommandBus;
	readonly context: ApplyCommandContext;
	readonly ensureAlive: () => void;
}

export interface FrameSource {
	frames(): readonly WidgetFrame[];
}

export const runFrame = Effect.fnUntraced(function* (source: FrameSource) {
	const statusStore = yield* Statuses;
	const frames = source.frames();

	for (const frame of frames) {
		const widgetId = frame.widgetId;
		if (!statusStore.has(widgetId)) continue;
		const commands = yield* frame.bus.drain(widgetId);
		const ctx = frame.context;

		for (const command of commands) {
			const { errors, skipped } = yield* applyCommand(ctx, command);

			for (const error of errors) {
				statusStore.recordError(widgetId, error);
			}

			if (skipped > 0) {
				statusStore.count(widgetId, "skipped", skipped);
			}
		}
		yield* frame.bus.commit(widgetId, commands.length);

		frame.ensureAlive();
	}
});

export interface Ticker {
	start(): void;
	stop(): void;
}

export interface TickerOptions {
	readonly app: Application;
	readonly adapter: EffectAdapter;
}

export function createTicker(options: TickerOptions): Ticker {
	const handler = () => {
		options.adapter.frame();
	};
	let started = false;

	return {
		start: () => {
			if (started) return;
			started = true;
			options.app.ticker.add(handler);
		},
		stop: () => {
			if (!started) return;
			started = false;
			options.app.ticker.remove(handler);
		},
	};
}

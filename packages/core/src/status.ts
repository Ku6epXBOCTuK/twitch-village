import type { WidgetId } from "@tv/protocol";
import type { RenderError } from "./errors";

export type WidgetState =
	"loading" | "active" | "paused" | "degraded" | "crashed";

export type ErrorCounterName = RenderError["_tag"];
export type CounterName = "heartbeat" | "dropped" | "skipped";

export interface WidgetErrorInfo {
	readonly tag: RenderError["_tag"];
	readonly message: string;
	readonly at: number;
}

export interface WidgetStatus {
	readonly widgetId: WidgetId;
	readonly state: WidgetState;
	readonly counters: Readonly<Record<CounterName | ErrorCounterName, number>>;
	readonly lastError: WidgetErrorInfo | null;
}

interface StatusRecord {
	state: WidgetState;
	counters: Record<CounterName | ErrorCounterName, number>;
	lastError: WidgetErrorInfo | null;
}

export interface StatusStoreOptions {
	readonly now?: () => number;
}

export interface StatusStore {
	register(widgetId: WidgetId): void;
	get(widgetId: WidgetId): WidgetStatus | undefined;
	setState(widgetId: WidgetId, state: WidgetState): void;
	count(widgetId: WidgetId, name: CounterName, by?: number): void;
	recordError(widgetId: WidgetId, error: RenderError): void;
	flush(widgetId: WidgetId): void;
	subscribe(listener: (status: WidgetStatus) => void): () => void;
	reset(widgetId: WidgetId): void;
	remove(widgetId: WidgetId): void;
}

function emptyCounters(): Record<CounterName | ErrorCounterName, number> {
	return {
		AssetNotFound: 0,
		InvalidCommand: 0,
		EffectCompileFailed: 0,
		EffectNotFound: 0,
		InvalidEffectParam: 0,
		RenderFailed: 0,
		UnknownNode: 0,
		heartbeat: 0,
		dropped: 0,
		skipped: 0,
	};
}

function emptyStatus(): StatusRecord {
	return { state: "loading", counters: emptyCounters(), lastError: null };
}

function toStatus(widgetId: WidgetId, status: StatusRecord): WidgetStatus {
	return { ...status, widgetId, counters: { ...status.counters } };
}

// NOTE: counters and errors are batched until flush, while registration and
// state changes notify at once, so a crash reaches the panel immediately.
export function createStatusStore(options: StatusStoreOptions): StatusStore {
	const now = options.now ?? (() => performance.now());
	const statuses = new Map<WidgetId, StatusRecord>();
	const dirty = new Set<WidgetId>();
	const listeners = new Set<(status: WidgetStatus) => void>();

	function mutableOf(widgetId: WidgetId): StatusRecord {
		const status = statuses.get(widgetId);
		if (status === undefined) {
			throw new Error(`Widget ${widgetId} not registered`);
		}
		return status;
	}

	function notifyListeners(widgetId: WidgetId, status: StatusRecord) {
		for (const listener of listeners) {
			listener(toStatus(widgetId, status));
		}
	}

	return {
		register(widgetId) {
			if (statuses.has(widgetId)) {
				throw new Error(`Widget ${widgetId} is already registered`);
			}
			const status = emptyStatus();
			statuses.set(widgetId, status);
			notifyListeners(widgetId, status);
		},
		get(widgetId) {
			const status = statuses.get(widgetId);
			return status === undefined ? undefined : toStatus(widgetId, status);
		},
		setState(widgetId, state) {
			const status = mutableOf(widgetId);
			status.state = state;
			notifyListeners(widgetId, status);
		},
		count(widgetId, name, by = 1) {
			const status = mutableOf(widgetId);
			status.counters[name] += by;
			dirty.add(widgetId);
		},
		recordError(widgetId, error) {
			const status = mutableOf(widgetId);
			status.counters[error._tag] += 1;
			status.lastError = { tag: error._tag, message: error.message, at: now() };
			dirty.add(widgetId);
		},
		flush(widgetId) {
			if (!dirty.delete(widgetId)) return;
			const status = statuses.get(widgetId);
			if (status !== undefined) {
				notifyListeners(widgetId, status);
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		reset(widgetId) {
			const status = mutableOf(widgetId);
			Object.assign(status, emptyStatus());
			dirty.delete(widgetId);
			notifyListeners(widgetId, status);
		},
		remove(widgetId) {
			statuses.delete(widgetId);
			dirty.delete(widgetId);
		},
	};
}

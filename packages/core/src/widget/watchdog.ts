export const HEARTBEAT_INTERVAL_MS = 500;
export const HEARTBEAT_TIMEOUT_MS = 2000;

export interface WatchdogOptions {
	readonly timeoutMs?: number;
}

export interface Watchdog {
	readonly paused: boolean;
	beat(now: number): void;
	pause(): void;
	resume(now: number): void;
	reset(now: number): void;
	overdue(now: number): boolean;
}

export function createWatchdog(options: WatchdogOptions = {}): Watchdog {
	const timeoutMs = options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS;
	let paused: boolean = false;
	let lastBeat: number | null = null;

	function startCountdown(now: number) {
		paused = false;
		lastBeat = now;
	}

	return {
		get paused() {
			return paused;
		},
		beat(now: number) {
			lastBeat = now;
		},
		pause() {
			paused = true;
		},
		resume(now: number) {
			startCountdown(now);
		},
		reset(now: number) {
			startCountdown(now);
		},
		overdue(now: number) {
			return !paused && lastBeat !== null && now - lastBeat > timeoutMs;
		},
	};
}

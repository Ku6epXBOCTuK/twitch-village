export const TICK_MS = 100;
export const MAX_STEPS_PER_ADVANCE = 5;

export interface TickClock {
	advance(now: number): number;
	reset(now: number): void;
}

export function createTickClock(): TickClock {
	let timer = 0;
	let partial = 0;
	return {
		advance: (now: number): number => {
			const delta = now - timer;
			if (delta < 0) return 0;
			timer = now;
			let steps = Math.floor(delta / TICK_MS);
			if (steps > MAX_STEPS_PER_ADVANCE) steps = MAX_STEPS_PER_ADVANCE;
			partial += delta % TICK_MS;
			if (partial >= TICK_MS) {
				partial -= TICK_MS;
				steps += 1;
			}
			return steps;
		},
		reset: (now: number): void => {
			timer = now;
			partial = 0;
		},
	};
}

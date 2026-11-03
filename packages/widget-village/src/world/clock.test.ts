import { describe, expect, it } from "vitest";
import { createTickClock, MAX_STEPS_PER_ADVANCE, TICK_MS } from "./clock";

describe("fixed tick", () => {
	it("counts one step per tick", () => {
		const clock = createTickClock();
		clock.advance(0);

		expect(clock.advance(TICK_MS)).toBe(1);
	});

	it("counts ten steps for one second spread over ten calls", () => {
		const clock = createTickClock();
		clock.advance(0);

		let steps = 0;
		for (let index = 1; index <= 10; index += 1) {
			steps += clock.advance(index * TICK_MS);
		}

		expect(steps).toBe(10);
	});

	it("caps a single call that covers a whole second", () => {
		const clock = createTickClock();
		clock.advance(0);

		expect(clock.advance(1000)).toBe(MAX_STEPS_PER_ADVANCE);
	});

	it("keeps the rest of a partial tick for the next call", () => {
		const clock = createTickClock();
		clock.advance(0);

		expect(clock.advance(150)).toBe(1);
		expect(clock.advance(199)).toBe(0);
		expect(clock.advance(200)).toBe(1);
	});

	it("returns no steps for the same moment", () => {
		const clock = createTickClock();
		clock.advance(1000);

		expect(clock.advance(1000)).toBe(0);
	});

	it("caps the steps after a long lag and forgets the backlog", () => {
		const clock = createTickClock();
		clock.advance(0);

		expect(clock.advance(10_000)).toBe(MAX_STEPS_PER_ADVANCE);
		expect(clock.advance(10_000)).toBe(0);
		expect(clock.advance(10_000 + TICK_MS)).toBe(1);
	});

	it("counts nothing when the time goes backwards", () => {
		const clock = createTickClock();
		clock.advance(1000);

		expect(clock.advance(500)).toBe(0);
		expect(clock.advance(1100)).toBe(1);
	});

	it("starts counting from the moment of the reset", () => {
		const clock = createTickClock();
		clock.advance(0);

		clock.reset(5000);

		expect(clock.advance(5000)).toBe(0);
		expect(clock.advance(5100)).toBe(1);
	});

	it("forgets the rest of a partial tick on reset", () => {
		const clock = createTickClock();
		clock.advance(0);
		clock.advance(150);

		clock.reset(10_000);

		expect(clock.advance(10_050)).toBe(0);
		expect(clock.advance(10_100)).toBe(1);
	});
});

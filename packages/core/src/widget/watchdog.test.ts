import { describe, expect, it } from "vitest";
import {
	HEARTBEAT_TIMEOUT_MS,
	createWatchdog,
	type Watchdog,
} from "./watchdog";

const beatEvery = (watchdog: Watchdog, from: number, to: number): void => {
	for (let now = from; now <= to; now += 500) {
		watchdog.beat(now);
	}
};

describe("createWatchdog", () => {
	it("is not paused by default", () => {
		expect(createWatchdog().paused).toBe(false);
	});

	it("does not time out before the first heartbeat", () => {
		const watchdog = createWatchdog();

		expect(watchdog.overdue(10_000_000)).toBe(false);
	});

	it("does not time out while heartbeats keep coming", () => {
		const watchdog = createWatchdog();
		beatEvery(watchdog, 0, 10_000);

		expect(watchdog.overdue(10_500)).toBe(false);
	});

	it("does not time out exactly at the timeout boundary", () => {
		const watchdog = createWatchdog();
		watchdog.beat(1000);

		expect(watchdog.overdue(1000 + HEARTBEAT_TIMEOUT_MS)).toBe(false);
	});

	it("times out one millisecond after the boundary", () => {
		const watchdog = createWatchdog();
		watchdog.beat(1000);

		expect(watchdog.overdue(1001 + HEARTBEAT_TIMEOUT_MS)).toBe(true);
	});

	it("restarts the countdown on every heartbeat", () => {
		const watchdog = createWatchdog();
		watchdog.beat(1000);
		watchdog.beat(2500);

		expect(watchdog.overdue(4000)).toBe(false);
		expect(watchdog.overdue(4501)).toBe(true);
	});

	it("does not time out while paused", () => {
		const watchdog = createWatchdog();
		watchdog.beat(1000);
		watchdog.pause();

		expect(watchdog.overdue(1000 + HEARTBEAT_TIMEOUT_MS * 10)).toBe(false);
	});

	it("counts from the resume moment, not from the last heartbeat", () => {
		const watchdog = createWatchdog();
		watchdog.beat(1000);
		watchdog.pause();
		watchdog.resume(50_000);

		expect(watchdog.overdue(50_000 + HEARTBEAT_TIMEOUT_MS)).toBe(false);
		expect(watchdog.overdue(50_001 + HEARTBEAT_TIMEOUT_MS)).toBe(true);
	});

	it("unpauses on resume", () => {
		const watchdog = createWatchdog();
		watchdog.pause();
		watchdog.resume(0);

		expect(watchdog.paused).toBe(false);
	});

	it("ignores heartbeats while paused", () => {
		const watchdog = createWatchdog();
		watchdog.beat(1000);
		watchdog.pause();
		watchdog.beat(9000);

		expect(watchdog.paused).toBe(true);
		expect(watchdog.overdue(9000)).toBe(false);
		expect(watchdog.overdue(1001 + HEARTBEAT_TIMEOUT_MS)).toBe(false);
	});

	it("counts from the reset moment, not from the last heartbeat", () => {
		const watchdog = createWatchdog();
		watchdog.beat(1000);
		watchdog.reset(50_000);

		expect(watchdog.overdue(50_000 + HEARTBEAT_TIMEOUT_MS)).toBe(false);
		expect(watchdog.overdue(50_001 + HEARTBEAT_TIMEOUT_MS)).toBe(true);
	});

	it("unpauses on reset", () => {
		const watchdog = createWatchdog();
		watchdog.pause();
		watchdog.reset(1000);

		expect(watchdog.paused).toBe(false);
		expect(watchdog.overdue(1001 + HEARTBEAT_TIMEOUT_MS)).toBe(true);
	});

	it("uses the configured timeout", () => {
		const watchdog = createWatchdog({ timeoutMs: 100 });
		watchdog.beat(0);

		expect(watchdog.overdue(100)).toBe(false);
		expect(watchdog.overdue(101)).toBe(true);
	});
});

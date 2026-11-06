import { Schema } from "effect";
import {
	ViewerEventSchema,
	type ViewerEvent,
	type ViewerId,
} from "@tv/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockEventSource } from "./mock-source";

const decodeEvent = Schema.decodeUnknownSync(ViewerEventSchema);

const collectAuto = (seed: number, count: number): ViewerEvent[] => {
	const source = new MockEventSource();
	const events: ViewerEvent[] = [];
	source.subscribe((event) => {
		events.push(event);
	});
	source.start({
		seed,
		mode: "auto",
		minIntervalMs: 1000,
		maxIntervalMs: 1000,
	});
	for (let index = 0; index < count; index += 1) {
		vi.advanceTimersByTime(1000);
	}
	source.stop();
	return events;
};

const joined = (viewerId: string): ViewerEvent => ({
	_tag: "ViewerJoined",
	viewerId: viewerId as ViewerId,
	displayName: "Mira",
	color: "#60a5fa",
});

afterEach(() => {
	vi.useRealTimers();
});

describe("MockEventSource", () => {
	it("produces the same event sequence for the same seed", () => {
		vi.useFakeTimers();

		const first = collectAuto(42, 8);
		const second = collectAuto(42, 8);

		expect(first).toEqual(second);
		expect(first).toHaveLength(8);
	});

	it("produces different sequences for different seeds", () => {
		vi.useFakeTimers();

		const first = collectAuto(42, 8);
		const second = collectAuto(7, 8);

		expect(first).not.toEqual(second);
	});

	it("emits only schema-valid events", () => {
		vi.useFakeTimers();

		const events = collectAuto(42, 12);

		for (const event of events) {
			expect(decodeEvent(event)).toMatchObject({ _tag: event._tag });
		}
	});

	it("stops producing auto events after stop", () => {
		vi.useFakeTimers();
		const source = new MockEventSource();
		const events: ViewerEvent[] = [];
		source.subscribe((event) => {
			events.push(event);
		});
		source.start({
			seed: 42,
			mode: "auto",
			minIntervalMs: 1000,
			maxIntervalMs: 1000,
		});

		vi.advanceTimersByTime(1000);
		expect(events).toHaveLength(1);

		source.stop();
		vi.advanceTimersByTime(10000);

		expect(events).toHaveLength(1);
	});

	it("ignores manual events after stop", () => {
		const source = new MockEventSource();
		const events: ViewerEvent[] = [];
		source.subscribe((event) => {
			events.push(event);
		});
		source.start({ mode: "manual" });
		source.stop();

		source.emit(joined("viewer-1"));

		expect(events).toEqual([]);
	});

	it("does not schedule auto events in manual mode", () => {
		vi.useFakeTimers();
		const source = new MockEventSource();
		const events: ViewerEvent[] = [];
		source.subscribe((event) => {
			events.push(event);
		});
		source.start({ mode: "manual" });

		vi.advanceTimersByTime(10000);

		expect(events).toEqual([]);
	});

	it("publishes manual events to subscribers", () => {
		const source = new MockEventSource();
		const events: ViewerEvent[] = [];
		source.subscribe((event) => {
			events.push(event);
		});
		source.start({ mode: "manual" });

		const event = joined("viewer-1");
		source.emit(event);

		expect(events).toEqual([event]);
	});

	it("stops delivering events after unsubscribe", () => {
		const source = new MockEventSource();
		const events: ViewerEvent[] = [];
		const unsubscribe = source.subscribe((event) => {
			events.push(event);
		});
		source.start({ mode: "manual" });

		unsubscribe();
		source.emit(joined("viewer-1"));

		expect(events).toEqual([]);
	});
});

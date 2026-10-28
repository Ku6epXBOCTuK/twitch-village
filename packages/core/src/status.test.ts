import {
	RenderFailed,
	UnknownNode,
	type NodeId,
	type WidgetId,
} from "@tv/protocol";
import { describe, expect, it } from "vitest";
import {
	createStatusStore,
	type CounterName,
	type WidgetStatus,
} from "./status";

const widgetId = "village" as WidgetId;
const otherId = "alerts" as WidgetId;
const nodeId = "avatar:1" as NodeId;

const zeroCounters: Readonly<Record<CounterName, number>> = {
	AssetNotFound: 0,
	EffectCompileFailed: 0,
	EffectNotFound: 0,
	InvalidCommand: 0,
	InvalidEffectParam: 0,
	RenderFailed: 0,
	UnknownNode: 0,
	heartbeat: 0,
	dropped: 0,
	skipped: 0,
};

describe("StatusStore", () => {
	it("registers a widget as loading with zero counters and no error", () => {
		const store = createStatusStore({});

		store.register(widgetId);

		expect(store.get(widgetId)).toEqual({
			widgetId,
			state: "loading",
			counters: zeroCounters,
			lastError: null,
		});
	});

	it("notifies subscribers on every change", () => {
		const store = createStatusStore({});
		const seen: string[] = [];

		store.subscribe((status) => seen.push(status.state));
		store.register(widgetId);
		store.setState(widgetId, "active");

		expect(seen).toEqual(["loading", "active"]);
	});

	it("stops notifying after unsubscribe", () => {
		const store = createStatusStore({});
		let calls = 0;

		const unsubscribe = store.subscribe(() => {
			calls += 1;
		});
		store.register(widgetId);
		unsubscribe();
		store.setState(widgetId, "degraded");

		expect(calls).toBe(1);
	});

	it("records the tag, the counter and the timestamp of an error", () => {
		const store = createStatusStore({ now: () => 1234 });

		store.register(widgetId);
		store.recordError(
			widgetId,
			new UnknownNode({ widgetId, message: "Unknown node ghost", nodeId }),
		);

		const status = store.get(widgetId);
		expect(status.counters.UnknownNode).toBe(1);
		expect(status.lastError).toEqual({
			tag: "UnknownNode",
			message: "Unknown node ghost",
			at: 1234,
		});
	});

	it("keeps the latest error but counts every tag separately", () => {
		const store = createStatusStore({ now: () => 10 });

		store.register(widgetId);
		store.recordError(
			widgetId,
			new UnknownNode({ widgetId, message: "first", nodeId }),
		);
		store.recordError(
			widgetId,
			new UnknownNode({ widgetId, message: "second", nodeId }),
		);
		store.recordError(
			widgetId,
			new RenderFailed({ widgetId, message: "pixi blew up" }),
		);

		const status = store.get(widgetId);
		expect(status.counters.UnknownNode).toBe(2);
		expect(status.counters.RenderFailed).toBe(1);
		expect(status.lastError).toEqual({
			tag: "RenderFailed",
			message: "pixi blew up",
			at: 10,
		});
	});

	it("counts by name, one by default and any amount explicitly", () => {
		const store = createStatusStore({});

		store.register(widgetId);
		store.count(widgetId, "skipped");
		store.count(widgetId, "dropped", 5);
		store.count(widgetId, "heartbeat", 3);

		const { counters } = store.get(widgetId);
		expect(counters.skipped).toBe(1);
		expect(counters.dropped).toBe(5);
		expect(counters.heartbeat).toBe(3);
	});

	it("reset zeroes counters and lastError and returns the widget to loading", () => {
		const store = createStatusStore({ now: () => 7 });

		store.register(widgetId);
		store.setState(widgetId, "crashed");
		store.count(widgetId, "dropped", 2);
		store.recordError(
			widgetId,
			new RenderFailed({ widgetId, message: "boom" }),
		);

		store.reset(widgetId);

		expect(store.get(widgetId)).toEqual({
			widgetId,
			state: "loading",
			counters: zeroCounters,
			lastError: null,
		});
	});

	it("keeps the status of one widget out of another", () => {
		const store = createStatusStore({});

		store.register(widgetId);
		store.register(otherId);
		store.count(widgetId, "skipped", 4);
		store.setState(otherId, "active");

		expect(store.get(widgetId).counters.skipped).toBe(4);
		expect(store.get(otherId).counters.skipped).toBe(0);
		expect(store.get(otherId).state).toBe("active");
	});

	it("throws on an unknown widget", () => {
		const store = createStatusStore({});

		expect(() => store.get(widgetId)).toThrow(/village/);
	});

	it("rejects a duplicate registration", () => {
		const store = createStatusStore({});

		store.register(widgetId);

		expect(() => store.register(widgetId)).toThrow(
			"Widget village is already registered",
		);
	});

	it("forgets the widget on remove and notifies nobody", () => {
		const store = createStatusStore({});
		let calls = 0;

		store.register(widgetId);
		store.subscribe(() => {
			calls += 1;
		});
		store.remove(widgetId);

		expect(() => store.get(widgetId)).toThrow(/village/);
		expect(calls).toBe(0);
	});

	it("delivers the new status to a subscriber added later", () => {
		const store = createStatusStore({});
		store.register(widgetId);

		let seen: WidgetStatus | undefined;
		store.subscribe((status) => {
			seen = status;
		});
		store.setState(widgetId, "active");

		expect(seen?.state).toBe("active");
	});

	it("notifies subscribers after the counter and the error are stored", () => {
		const store = createStatusStore({ now: () => 1234 });
		const seen: WidgetStatus[] = [];

		store.register(widgetId);
		store.subscribe((status) => seen.push(status));
		store.recordError(
			widgetId,
			new RenderFailed({ widgetId, message: "boom", nodeId }),
		);

		expect(seen).toHaveLength(1);
		expect(seen[0]?.counters.RenderFailed).toBe(1);
		expect(seen[0]?.lastError).toEqual({
			tag: "RenderFailed",
			message: "boom",
			at: 1234,
		});
	});

	it("hands out a copy of the counters", () => {
		const store = createStatusStore({});
		store.register(widgetId);

		const first = store.get(widgetId);
		Object.assign(first.counters, { skipped: 5 });

		expect(store.get(widgetId).counters.skipped).toBe(0);
	});
});

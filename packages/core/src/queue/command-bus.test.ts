import type { NodeId, RenderCommand, WidgetId } from "@tv/protocol";
import { QueueOverflow } from "@tv/protocol";
import { describe, expect, it, vi } from "vitest";
import { createCommandBus, type CommandBusConfig } from "./command-bus";

const village = "village" as WidgetId;
const alerts = "alerts" as WidgetId;

const asNodeId = (value: string): NodeId => value as NodeId;

const command = (id: string): RenderCommand => ({
	_tag: "CreateNode",
	nodeId: asNodeId(id),
	kind: "container",
});

const commands = (count: number, prefix = "node"): readonly RenderCommand[] =>
	Array.from({ length: count }, (_, index) => command(`${prefix}${index}`));

const nodeIds = (batch: readonly RenderCommand[]): readonly NodeId[] =>
	batch.flatMap((item) => (item._tag === "CreateNode" ? [item.nodeId] : []));

const config = (
	overrides: Partial<CommandBusConfig> = {},
): CommandBusConfig => ({
	maxQueueLength: 100,
	maxCommandsPerFrame: 100,
	maxDrainMs: 1000,
	...overrides,
});

const steppedClock = (steps: readonly number[]): (() => number) => {
	let index = 0;
	return () => {
		const value = steps[Math.min(index, steps.length - 1)] ?? 0;
		index += 1;
		return value;
	};
};

describe("CommandBus", () => {
	it("drains commands in the order they were pushed", () => {
		const bus = createCommandBus(config());
		bus.push(village, commands(2, "first"));
		bus.push(village, commands(2, "second"));

		expect(nodeIds(bus.drain(village))).toEqual([
			"first0",
			"first1",
			"second0",
			"second1",
		]);
		expect(bus.drain(village)).toEqual([]);
	});

	it("keeps a separate queue per widget", () => {
		const bus = createCommandBus(config());
		bus.push(village, commands(1, "village"));
		bus.push(alerts, commands(1, "alerts"));

		expect(bus.stats(village).queued).toBe(1);
		expect(bus.stats(alerts).queued).toBe(1);
		expect(nodeIds(bus.drain(alerts))).toEqual(["alerts0"]);
		expect(nodeIds(bus.drain(village))).toEqual(["village0"]);
	});

	it("stops at the command budget and keeps the rest for the next frame", () => {
		const bus = createCommandBus(config({ maxCommandsPerFrame: 2 }));
		bus.push(village, commands(5));

		expect(nodeIds(bus.drain(village))).toEqual(["node0", "node1"]);
		expect(nodeIds(bus.drain(village))).toEqual(["node2", "node3"]);
		expect(nodeIds(bus.drain(village))).toEqual(["node4"]);
		expect(bus.drain(village)).toEqual([]);
	});

	it("stops after the command that crosses the time budget", () => {
		const bus = createCommandBus(
			config({ maxDrainMs: 4, now: steppedClock([0, 100]) }),
		);
		bus.push(village, commands(5));

		expect(nodeIds(bus.drain(village))).toEqual(["node0"]);
		expect(bus.stats(village).queued).toBe(4);
	});

	it("reports queued and processed counters", () => {
		const bus = createCommandBus(config({ maxCommandsPerFrame: 2 }));
		bus.push(village, commands(5));

		bus.drain(village);
		bus.commit(village, 2);

		expect(bus.stats(village)).toEqual({
			queued: 3,
			dropped: 0,
			processed: 2,
		});

		bus.drain(village);
		bus.commit(village, 2);

		expect(bus.stats(village)).toEqual({
			queued: 1,
			dropped: 0,
			processed: 4,
		});
	});

	it("clears the queue once the batch does not fit", () => {
		const onOverflow = vi.fn();
		const bus = createCommandBus(config({ maxQueueLength: 3, onOverflow }));
		bus.push(village, commands(2));

		bus.push(village, commands(3, "overflow"));

		expect(bus.stats(village).queued).toBe(0);
		expect(bus.stats(village).dropped).toBeGreaterThanOrEqual(2);
		expect(bus.drain(village)).toEqual([]);
		expect(onOverflow).toHaveBeenCalledTimes(1);

		const error = onOverflow.mock.calls[0]?.[0];
		expect(error).toBeInstanceOf(QueueOverflow);
		expect((error as QueueOverflow).widgetId).toBe(village);
	});

	it("accepts commands again after an overflow", () => {
		const bus = createCommandBus(config({ maxQueueLength: 2 }));
		bus.push(village, commands(5));

		bus.push(village, commands(1, "after"));

		expect(nodeIds(bus.drain(village))).toEqual(["after0"]);
	});

	it("clears a queue without touching the counters", () => {
		const bus = createCommandBus(config());
		bus.push(village, commands(3));
		bus.drain(village);
		bus.commit(village, 3);

		bus.push(village, commands(2, "pending"));
		bus.clear(village);

		expect(bus.stats(village)).toEqual({
			queued: 0,
			dropped: 0,
			processed: 3,
		});
		expect(bus.drain(village)).toEqual([]);
	});

	it("ignores an empty batch", () => {
		const bus = createCommandBus(config());

		bus.push(village, []);

		expect(bus.stats(village)).toEqual({
			queued: 0,
			dropped: 0,
			processed: 0,
		});
	});

	it("answers for a widget that never pushed anything", () => {
		const bus = createCommandBus(config());

		expect(bus.drain(village)).toEqual([]);
		expect(bus.stats(village)).toEqual({
			queued: 0,
			dropped: 0,
			processed: 0,
		});
	});

	it("does not count a command before the caller applies it", () => {
		const bus = createCommandBus(config());
		bus.push(village, commands(3));

		expect(bus.drain(village)).toHaveLength(3);
		expect(bus.stats(village).processed).toBe(0);

		bus.commit(village, 2);

		expect(bus.stats(village).processed).toBe(2);

		bus.commit(village, 0);

		expect(bus.stats(village).processed).toBe(2);
	});

	it("returns a shared empty list when the queue is empty", () => {
		const bus = createCommandBus(config());
		bus.push(village, commands(1));
		bus.drain(village);

		expect(bus.drain(village)).toBe(bus.drain(village));
	});

	it("rejects an invalid configuration", () => {
		expect(() => createCommandBus(config({ maxQueueLength: 0 }))).toThrow(
			/maxQueueLength/,
		);
		expect(() => createCommandBus(config({ maxCommandsPerFrame: -1 }))).toThrow(
			/maxCommandsPerFrame/,
		);
		expect(() =>
			createCommandBus(config({ maxCommandsPerFrame: 1.5 })),
		).toThrow(/maxCommandsPerFrame/);
		expect(() => createCommandBus(config({ maxDrainMs: -1 }))).toThrow(
			/maxDrainMs/,
		);
		expect(() => createCommandBus(config({ maxDrainMs: Number.NaN }))).toThrow(
			/maxDrainMs/,
		);
	});

	it("accepts a zero drain budget", () => {
		const bus = createCommandBus(config({ maxDrainMs: 0 }));
		bus.push(village, commands(1));

		expect(bus.drain(village)).toHaveLength(1);
	});

	it("rejects committing a non-integer count", () => {
		const bus = createCommandBus(config());

		expect(() => bus.commit(village, -1)).toThrow(/applied/);
		expect(() => bus.commit(village, 1.5)).toThrow(/applied/);
	});
});

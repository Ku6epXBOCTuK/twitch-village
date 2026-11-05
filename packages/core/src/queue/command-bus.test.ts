import type { NodeId, RenderCommand, WidgetId } from "@tv/protocol";
import { QueueOverflow } from "@tv/protocol";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	type CommandBus,
	type CommandBusConfig,
	createCommandBus,
} from "./command-bus";

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

const busOf = (overrides: Partial<CommandBusConfig> = {}) =>
	Effect.runPromise(createCommandBus(config(overrides)));

const push = (
	bus: CommandBus,
	widgetId: WidgetId,
	batch: readonly RenderCommand[],
) => Effect.runPromise(bus.push(widgetId, batch));

const drain = (
	bus: CommandBus,
	widgetId: WidgetId,
): Promise<readonly RenderCommand[]> =>
	Effect.runPromise(bus.drain(widgetId)).then((batch) => batch);

const commit = (bus: CommandBus, widgetId: WidgetId, applied: number) =>
	Effect.runPromise(bus.commit(widgetId, applied));

const stats = (bus: CommandBus, widgetId: WidgetId) =>
	Effect.runPromise(bus.stats(widgetId));

describe("CommandBus", () => {
	it("drains commands in the order they were pushed", async () => {
		const bus = await busOf();
		await push(bus, village, commands(2, "first"));
		await push(bus, village, commands(2, "second"));

		expect(nodeIds(await drain(bus, village))).toEqual([
			"first0",
			"first1",
			"second0",
			"second1",
		]);
		expect(await drain(bus, village)).toEqual([]);
	});

	it("keeps a separate queue per widget", async () => {
		const bus = await busOf();
		await push(bus, village, commands(1, "village"));
		await push(bus, alerts, commands(1, "alerts"));

		expect((await stats(bus, village)).queued).toBe(1);
		expect((await stats(bus, alerts)).queued).toBe(1);
		expect(nodeIds(await drain(bus, alerts))).toEqual(["alerts0"]);
		expect(nodeIds(await drain(bus, village))).toEqual(["village0"]);
	});

	it("stops at the command budget and keeps the rest for the next frame", async () => {
		const bus = await busOf({ maxCommandsPerFrame: 2 });
		await push(bus, village, commands(5));

		expect(nodeIds(await drain(bus, village))).toEqual(["node0", "node1"]);
		expect(nodeIds(await drain(bus, village))).toEqual(["node2", "node3"]);
		expect(nodeIds(await drain(bus, village))).toEqual(["node4"]);
		expect(await drain(bus, village)).toEqual([]);
	});

	it("stops after the command that crosses the time budget", async () => {
		const bus = await busOf({
			maxDrainMs: 4,
			now: steppedClock([0, 100]),
		});
		await push(bus, village, commands(5));

		expect(nodeIds(await drain(bus, village))).toEqual(["node0"]);
		expect((await stats(bus, village)).queued).toBe(4);
	});

	it("reports queued and processed counters", async () => {
		const bus = await busOf({ maxCommandsPerFrame: 2 });
		await push(bus, village, commands(5));

		await drain(bus, village);
		await commit(bus, village, 2);

		expect(await stats(bus, village)).toEqual({
			queued: 3,
			dropped: 0,
			processed: 2,
		});

		await drain(bus, village);
		await commit(bus, village, 2);

		expect(await stats(bus, village)).toEqual({
			queued: 1,
			dropped: 0,
			processed: 4,
		});
	});

	it("clears the queue once the batch does not fit", async () => {
		const bus = await busOf({ maxQueueLength: 3 });
		await push(bus, village, commands(2));

		const failure = await Effect.runPromiseExit(
			bus.push(village, commands(3, "overflow")),
		);

		expect(failure._tag).toBe("Failure");
		expect((await stats(bus, village)).queued).toBe(0);
		expect((await stats(bus, village)).dropped).toBeGreaterThanOrEqual(2);
		expect(await drain(bus, village)).toEqual([]);
	});

	it("reports the overflow on the widget that overfilled", async () => {
		const bus = await busOf({ maxQueueLength: 2 });

		const error = await Effect.runPromise(bus.push(village, commands(5))).then(
			() => null,
			(reason: unknown) => reason,
		);

		expect(error).toBeInstanceOf(QueueOverflow);
		expect((error as QueueOverflow).widgetId).toBe(village);
	});

	it("accepts commands again after an overflow", async () => {
		const bus = await busOf({ maxQueueLength: 2 });
		await Effect.runPromiseExit(bus.push(village, commands(5)));

		await push(bus, village, commands(1, "after"));

		expect(nodeIds(await drain(bus, village))).toEqual(["after0"]);
	});

	it("clears a queue without touching the counters", async () => {
		const bus = await busOf();
		await push(bus, village, commands(3));
		await drain(bus, village);
		await commit(bus, village, 3);

		await push(bus, village, commands(2, "pending"));
		await Effect.runPromise(bus.clear(village));

		expect(await stats(bus, village)).toEqual({
			queued: 0,
			dropped: 0,
			processed: 3,
		});
		expect(await drain(bus, village)).toEqual([]);
	});

	it("ignores an empty batch", async () => {
		const bus = await busOf();

		await push(bus, village, []);

		expect(await stats(bus, village)).toEqual({
			queued: 0,
			dropped: 0,
			processed: 0,
		});
	});

	it("answers for a widget that never pushed anything", async () => {
		const bus = await busOf();

		expect(await drain(bus, village)).toEqual([]);
		expect(await stats(bus, village)).toEqual({
			queued: 0,
			dropped: 0,
			processed: 0,
		});
	});

	it("does not count a command before the caller applies it", async () => {
		const bus = await busOf();
		await push(bus, village, commands(3));

		expect(await drain(bus, village)).toHaveLength(3);
		expect((await stats(bus, village)).processed).toBe(0);

		await commit(bus, village, 2);

		expect((await stats(bus, village)).processed).toBe(2);

		await commit(bus, village, 0);

		expect((await stats(bus, village)).processed).toBe(2);
	});

	it("returns a shared empty list when the queue is empty", async () => {
		const bus = await busOf();
		await push(bus, village, commands(1));
		await drain(bus, village);

		const first = await drain(bus, village);
		const second = await drain(bus, village);

		expect(first).toBe(second);
	});

	it("rejects an invalid configuration", async () => {
		await expect(
			Effect.runPromise(createCommandBus(config({ maxQueueLength: 0 }))),
		).rejects.toThrow(/maxQueueLength/);
		await expect(
			Effect.runPromise(createCommandBus(config({ maxCommandsPerFrame: -1 }))),
		).rejects.toThrow(/maxCommandsPerFrame/);
		await expect(
			Effect.runPromise(createCommandBus(config({ maxCommandsPerFrame: 1.5 }))),
		).rejects.toThrow(/maxCommandsPerFrame/);
		await expect(
			Effect.runPromise(createCommandBus(config({ maxDrainMs: -1 }))),
		).rejects.toThrow(/maxDrainMs/);
		await expect(
			Effect.runPromise(createCommandBus(config({ maxDrainMs: Number.NaN }))),
		).rejects.toThrow(/maxDrainMs/);
	});

	it("accepts a zero drain budget", async () => {
		const bus = await busOf({ maxDrainMs: 0 });
		await push(bus, village, commands(1));

		expect(await drain(bus, village)).toHaveLength(1);
	});

	it("rejects committing a non-integer count", async () => {
		const bus = await busOf();

		await expect(Effect.runPromise(bus.commit(village, -1))).rejects.toThrow(
			/applied/,
		);
		await expect(Effect.runPromise(bus.commit(village, 1.5))).rejects.toThrow(
			/applied/,
		);
	});

	it("keeps a single queue when pushes run concurrently", async () => {
		const bus = await busOf();

		await Effect.runPromise(
			Effect.all(
				[
					bus.push(village, commands(2, "left")),
					bus.push(village, commands(2, "right")),
				],
				{ concurrency: "unbounded" },
			),
		);

		expect((await stats(bus, village)).queued).toBe(4);
		expect(await drain(bus, village)).toHaveLength(4);
	});
});

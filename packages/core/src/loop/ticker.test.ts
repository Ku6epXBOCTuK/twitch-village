import type { NodeId, WidgetId } from "@tv/protocol";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { createAssetRegistry } from "../assets/asset-registry";
import { createEffectRegistry } from "../effects/effect-registry";
import { Statuses } from "../live";
import { type CommandBus, createCommandBus } from "../queue/command-bus";
import { createStatusStore, type StatusStore } from "../status";
import { createFakeAssetBackend } from "../testing/fake-asset-backend";
import { createFakeEffectCompiler } from "../testing/fake-effect-compiler";
import { createFakeRenderTarget } from "../testing/fake-render-target";
import {
	MAX_COMMANDS_PER_FRAME,
	MAX_DRAIN_MS,
	MAX_QUEUE_LENGTH,
} from "../widget/widget-host";
import type { WidgetFrame } from "./ticker";
import { runFrame } from "./ticker";

function createNode(nodeId: string) {
	return {
		_tag: "CreateNode" as const,
		nodeId: nodeId as NodeId,
		kind: "container" as const,
	};
}

function setTransform(nodeId: string) {
	return { _tag: "SetTransform" as const, nodeId: nodeId as NodeId, x: 1 };
}

interface Harness {
	readonly store: ReturnType<typeof createStatusStore>;
	readonly widget: (
		widgetId: string,
		options?: {
			readonly maxCommandsPerFrame?: number;
			readonly maxDrainMs?: number;
			readonly now?: () => number;
		},
	) => {
		readonly frame: WidgetFrame;
		readonly target: ReturnType<typeof createFakeRenderTarget>;
		readonly bus: CommandBus;
		readonly alive: () => number;
	};
	readonly run: (frames: readonly WidgetFrame[]) => Promise<void>;
	readonly runWith: (
		store: StatusStore,
		frames: readonly WidgetFrame[],
	) => Promise<void>;
}

function setup(): Harness {
	const store = createStatusStore({ now: () => 0 });

	const widget = (
		widgetId: string,
		options?: {
			readonly maxCommandsPerFrame?: number;
			readonly maxDrainMs?: number;
			readonly now?: () => number;
		},
	) => {
		const id = widgetId as WidgetId;
		const target = createFakeRenderTarget({ widgetId: id });
		const backend = createFakeAssetBackend();
		const textures = createAssetRegistry({ widgetId: id, backend });
		const effects = createEffectRegistry({
			widgetId: id,
			compiler: createFakeEffectCompiler(),
		});
		const bus = createCommandBus({
			maxQueueLength: MAX_QUEUE_LENGTH,
			maxCommandsPerFrame:
				options?.maxCommandsPerFrame ?? MAX_COMMANDS_PER_FRAME,
			maxDrainMs: options?.maxDrainMs ?? MAX_DRAIN_MS,
			...(options?.now === undefined ? {} : { now: options.now }),
		});
		let aliveCount = 0;

		store.register(id);

		return {
			frame: {
				widgetId: id,
				bus,
				context: { widgetId: id, target, textures, effects },
				ensureAlive: () => {
					aliveCount += 1;
				},
			},
			target,
			bus,
			alive: () => aliveCount,
		};
	};

	const runWith = (target: StatusStore, frames: readonly WidgetFrame[]) =>
		Effect.runPromise(
			runFrame({ frames: () => frames }).pipe(
				Effect.provide(Layer.succeed(Statuses, target)),
			),
		);

	const run = (frames: readonly WidgetFrame[]) => runWith(store, frames);

	return { store, widget, run, runWith };
}

describe("runFrame", () => {
	it("applies queued commands and empties the queue", async () => {
		const harness = setup();
		const village = harness.widget("village");
		village.bus.push("village" as WidgetId, [createNode("n1")]);

		await harness.run([village.frame]);

		expect(village.target.has("n1" as NodeId)).toBe(true);
		expect(village.bus.stats("village" as WidgetId).queued).toBe(0);
		expect(village.bus.stats("village" as WidgetId).processed).toBe(1);
	});

	it("records a failed command and still applies the next widget", async () => {
		const harness = setup();
		const broken = harness.widget("broken");
		const healthy = harness.widget("healthy");
		broken.bus.push("broken" as WidgetId, [setTransform("ghost")]);
		healthy.bus.push("healthy" as WidgetId, [createNode("n1")]);

		await harness.run([broken.frame, healthy.frame]);

		const status = harness.store.get("broken" as WidgetId);
		expect(status?.counters.UnknownNode).toBe(1);
		expect(healthy.target.has("n1" as NodeId)).toBe(true);
	});

	it("counts skipped commands when a batch exceeds the error budget", async () => {
		const harness = setup();
		const village = harness.widget("village");
		const commands = Array.from({ length: 20 }, () => setTransform("ghost"));
		village.bus.push("village" as WidgetId, [
			{ _tag: "Batch" as const, commands },
		]);

		await harness.run([village.frame]);

		expect(harness.store.get("village" as WidgetId)?.counters.skipped).toBe(4);
	});

	it("checks the watchdog of a widget with an empty queue", async () => {
		const harness = setup();
		const village = harness.widget("village");

		await harness.run([village.frame]);

		expect(village.alive()).toBe(1);
		expect(village.target.calls).toHaveLength(0);
	});

	it("does nothing when there are no widgets", async () => {
		const harness = setup();

		await expect(harness.run([])).resolves.toBeUndefined();
	});

	it("keeps the frame going when a render target throws", async () => {
		const harness = setup();
		const throwing = harness.widget("throwing");
		const healthy = harness.widget("healthy");
		throwing.target.createNode = () => {
			throw new Error("pixi exploded");
		};
		throwing.bus.push("throwing" as WidgetId, [createNode("n1")]);
		healthy.bus.push("healthy" as WidgetId, [createNode("n1")]);

		await expect(
			harness.run([throwing.frame, healthy.frame]),
		).resolves.toBeUndefined();

		const error = harness.store.get("throwing" as WidgetId)?.lastError;
		expect(error?.tag).toBe("RenderFailed");
		expect(healthy.target.has("n1" as NodeId)).toBe(true);
	});

	it("commits the drained entries even when a batch skips the rest", async () => {
		const harness = setup();
		const village = harness.widget("village");
		const commands = Array.from({ length: 20 }, () => setTransform("ghost"));
		village.bus.push("village" as WidgetId, [
			{ _tag: "Batch" as const, commands },
		]);

		await harness.run([village.frame]);

		const stats = village.bus.stats("village" as WidgetId);
		expect(stats.queued).toBe(0);
		expect(stats.processed).toBe(1);
		expect(harness.store.get("village" as WidgetId)?.counters.skipped).toBe(4);
	});

	it("counts skipped commands from every batch as a delta", async () => {
		const harness = setup();
		const village = harness.widget("village");
		const commands = Array.from({ length: 20 }, () => setTransform("ghost"));
		village.bus.push("village" as WidgetId, [
			{ _tag: "Batch" as const, commands },
			{ _tag: "Batch" as const, commands },
		]);

		await harness.run([village.frame]);

		expect(harness.store.get("village" as WidgetId)?.counters.skipped).toBe(8);
	});

	it("does not touch the skipped counter when nothing is skipped", async () => {
		const harness = setup();
		const skippedCalls: number[] = [];
		const spy: StatusStore = {
			...harness.store,
			count: (widgetId, name, by) => {
				if (name === "skipped") skippedCalls.push(by ?? 1);
				harness.store.count(widgetId, name, by);
			},
		};
		const village = harness.widget("village");
		village.bus.push("village" as WidgetId, [createNode("n1")]);

		await harness.runWith(spy, [village.frame]);

		expect(skippedCalls).toEqual([]);
	});

	it("leaves the queue untouched when the widget has no status record", async () => {
		const harness = setup();
		const village = harness.widget("village");
		village.bus.push("village" as WidgetId, [createNode("n1")]);
		harness.store.remove("village" as WidgetId);

		await expect(harness.run([village.frame])).resolves.toBeUndefined();

		expect(village.bus.stats("village" as WidgetId).queued).toBe(1);
		expect(village.target.calls).toHaveLength(0);
	});

	it("leaves the rest of the queue for the next frame when the per-frame limit is hit", async () => {
		const harness = setup();
		const village = harness.widget("village", { maxCommandsPerFrame: 2 });
		village.bus.push("village" as WidgetId, [
			createNode("n1"),
			createNode("n2"),
			createNode("n3"),
		]);

		await harness.run([village.frame]);
		expect(village.target.calls).toHaveLength(2);

		await harness.run([village.frame]);
		expect(village.target.calls).toHaveLength(3);
	});

	it("leaves the rest of the queue for the next frame when the drain budget is spent", async () => {
		const harness = setup();
		let time = 0;
		const village = harness.widget("village", {
			maxDrainMs: 4,
			now: () => {
				time += 5;
				return time;
			},
		});
		village.bus.push("village" as WidgetId, [
			createNode("n1"),
			createNode("n2"),
			createNode("n3"),
		]);

		await harness.run([village.frame]);
		expect(village.target.calls).toHaveLength(1);

		await harness.run([village.frame]);
		expect(village.target.calls).toHaveLength(2);
	});

	it("applies commands in the order they were pushed", async () => {
		const harness = setup();
		const village = harness.widget("village");
		village.bus.push("village" as WidgetId, [
			createNode("n1"),
			setTransform("n1"),
		]);

		await harness.run([village.frame]);

		expect(village.target.calls.map((call) => call.method)).toEqual([
			"createNode",
			"setTransform",
		]);
	});

	it("does not notify status listeners during the frame", async () => {
		const harness = setup();
		const village = harness.widget("village");
		const seen: string[] = [];
		harness.store.subscribe((status) => {
			seen.push(status.widgetId);
		});
		village.bus.push("village" as WidgetId, [setTransform("ghost")]);

		await harness.run([village.frame]);
		expect(seen).toEqual([]);

		harness.store.flush("village" as WidgetId);
		expect(seen).toHaveLength(1);
	});
});

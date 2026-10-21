import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
	AssetNotFound,
	EffectCompileFailed,
	EffectNotFound,
	InvalidCommand,
	InvalidEffectParam,
	ProtocolMismatch,
	QueueOverflow,
	RenderFailed,
	UnknownNode,
	WidgetCrashed,
	WidgetTimeout,
} from "./errors";
import type { AssetId, EffectId, NodeId, WidgetId } from "./ids";

const widgetId = "village" as WidgetId;
const nodeId = "avatar:42" as NodeId;
const assetId = "avatar_01" as AssetId;
const effectId = "glow_pulse" as EffectId;

describe("protocol errors", () => {
	it("every error carries its own tag", () => {
		const errors = [
			new InvalidCommand({ widgetId, message: "unknown field", nodeId }),
			new UnknownNode({ widgetId, message: "node not found", nodeId }),
			new AssetNotFound({ widgetId, message: "asset missing", assetId }),
			new EffectNotFound({ widgetId, message: "effect missing", effectId }),
			new EffectCompileFailed({
				widgetId,
				message: "shader failed",
				effectId,
			}),
			new InvalidEffectParam({
				widgetId,
				message: "param out of range",
				effectId,
				param: "intensity",
			}),
			new RenderFailed({ widgetId, message: "pixi threw", nodeId }),
			new QueueOverflow({ widgetId, message: "queue overflow" }),
			new WidgetTimeout({ widgetId, message: "no heartbeat" }),
			new WidgetCrashed({ widgetId, message: "worker error" }),
			new ProtocolMismatch({
				widgetId,
				message: "version mismatch",
				expectedVersion: 1,
				actualVersion: 2,
			}),
		];

		expect(errors.map((error) => error._tag)).toEqual([
			"InvalidCommand",
			"UnknownNode",
			"AssetNotFound",
			"EffectNotFound",
			"EffectCompileFailed",
			"InvalidEffectParam",
			"RenderFailed",
			"QueueOverflow",
			"WidgetTimeout",
			"WidgetCrashed",
			"ProtocolMismatch",
		]);
	});

	it("every error keeps widgetId and message", () => {
		const error = new UnknownNode({
			widgetId,
			message: "node not found",
			nodeId,
		});

		expect(error.widgetId).toBe(widgetId);
		expect(error.message).toBe("node not found");
	});

	it("UnknownNode keeps nodeId", () => {
		const error = new UnknownNode({
			widgetId,
			message: "node not found",
			nodeId,
		});

		expect(error.nodeId).toBe(nodeId);
	});

	it("InvalidCommand keeps nodeId", () => {
		const error = new InvalidCommand({
			widgetId,
			message: "unknown field",
			nodeId,
		});

		expect(error.nodeId).toBe(nodeId);
	});

	it("AssetNotFound keeps assetId", () => {
		const error = new AssetNotFound({
			widgetId,
			message: "asset missing",
			assetId,
		});

		expect(error.assetId).toBe(assetId);
	});

	it("EffectNotFound keeps effectId", () => {
		const error = new EffectNotFound({
			widgetId,
			message: "effect missing",
			effectId,
		});

		expect(error.effectId).toBe(effectId);
	});

	it("EffectCompileFailed keeps effectId", () => {
		const error = new EffectCompileFailed({
			widgetId,
			message: "shader failed",
			effectId,
		});

		expect(error.effectId).toBe(effectId);
	});

	it("InvalidEffectParam keeps effectId and param", () => {
		const error = new InvalidEffectParam({
			widgetId,
			message: "param out of range",
			effectId,
			param: "intensity",
		});

		expect(error.effectId).toBe(effectId);
		expect(error.param).toBe("intensity");
	});

	it("RenderFailed keeps nodeId", () => {
		const error = new RenderFailed({
			widgetId,
			message: "pixi threw",
			nodeId,
		});

		expect(error.nodeId).toBe(nodeId);
	});

	it("ProtocolMismatch keeps expectedVersion and actualVersion", () => {
		const error = new ProtocolMismatch({
			widgetId,
			message: "version mismatch",
			expectedVersion: 1,
			actualVersion: 2,
		});

		expect(error.expectedVersion).toBe(1);
		expect(error.actualVersion).toBe(2);
	});

	it("fails the effect with the error instance", async () => {
		const program = Effect.gen(function* () {
			return yield* new UnknownNode({
				widgetId,
				message: "node not found",
				nodeId,
			});
		});

		const exit = await Effect.runPromiseExit(program);

		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("catchTag recovers by tag", async () => {
		const program = Effect.gen(function* () {
			return yield* new UnknownNode({
				widgetId,
				message: "node not found",
				nodeId,
			});
		});

		const recovered = program.pipe(
			Effect.catchTag("UnknownNode", (error) => Effect.succeed(error.nodeId)),
		);

		expect(await Effect.runPromise(recovered)).toBe(nodeId);
	});

	it("catchTags recovers several tags at once", async () => {
		const recovered = Effect.fail<AssetNotFound | UnknownNode>(
			new AssetNotFound({
				widgetId,
				message: "asset missing",
				assetId,
			}),
		).pipe(
			Effect.catchTags({
				UnknownNode: () => Effect.succeed("unknown-node"),
				AssetNotFound: (error) => Effect.succeed(error.assetId),
			}),
		);

		expect(await Effect.runPromise(recovered)).toBe(assetId);
	});

	it("an unmatched tag stays a failure", async () => {
		const recovered = Effect.fail<UnknownNode | WidgetTimeout>(
			new WidgetTimeout({ widgetId, message: "no heartbeat" }),
		).pipe(Effect.catchTag("UnknownNode", () => Effect.succeed("recovered")));

		const exit = await Effect.runPromiseExit(recovered);

		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("errors are failures, not defects", async () => {
		const program = Effect.gen(function* () {
			return yield* new QueueOverflow({ widgetId, message: "queue overflow" });
		});

		const exit = await Effect.runPromiseExit(program);

		expect(Exit.isFailure(exit)).toBe(true);
	});
});

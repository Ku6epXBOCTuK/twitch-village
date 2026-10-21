import { Match } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { describe, expect, it } from "vitest";
import { RenderCommandSchema } from "./commands";
import type { RenderCommand } from "./commands";

declare const structuredClone: <T>(value: T) => T;

const formatIssue = SchemaIssue.makeFormatterDefault();

const nodeId = "avatar:42";

const tagOf = (input: unknown): string => {
	if (typeof input === "object" && input !== null && "_tag" in input) {
		return String(input._tag);
	}

	return typeof input;
};

const decodeResult = (input: unknown) => {
	return Schema.decodeUnknownResult(RenderCommandSchema)(input, {
		onExcessProperty: "error",
	});
};

const decode = (input: unknown): RenderCommand => {
	const result = decodeResult(input);

	if (result._tag === "Failure") {
		throw new Error(
			`${tagOf(input)} was rejected:\n${formatIssue(result.failure.issue)}`,
		);
	}

	return result.success;
};

const expectInvalid = (input: unknown): void => {
	const result = decodeResult(input);

	if (result._tag === "Success") {
		throw new Error(
			`${tagOf(input)} was accepted, but should be rejected: ${JSON.stringify(result.success)}`,
		);
	}
};

const validCommands: ReadonlyArray<unknown> = [
	{ _tag: "CreateNode", nodeId, kind: "sprite" },
	{ _tag: "SetParent", nodeId, parentId: "root", order: 0 },
	{ _tag: "SetParent", nodeId, parentId: null, order: 3 },
	{ _tag: "SetTransform", nodeId },
	{
		_tag: "SetTransform",
		nodeId,
		x: 10,
		y: -5,
		scaleX: 2,
		scaleY: 0.5,
		rotation: 1.5,
		alpha: 0.5,
		visible: false,
	},
	{ _tag: "SetSprite", nodeId, assetId: "avatar_01" },
	{
		_tag: "SetAnimation",
		nodeId,
		assetIds: ["avatar_01", "avatar_02"],
		fps: 8,
		loop: true,
	},
	{
		_tag: "SetText",
		nodeId,
		text: "привет",
		style: { fontSize: 12, fill: "#ffffff", align: "center" },
	},
	{ _tag: "AddFilter", nodeId, effectId: "glow_pulse" },
	{
		_tag: "SetFilterParam",
		nodeId,
		effectId: "glow_pulse",
		param: "intensity",
		value: 0.8,
	},
	{ _tag: "RemoveFilter", nodeId, effectId: "glow_pulse" },
	{ _tag: "RemoveNode", nodeId },
	{ _tag: "Batch", commands: [{ _tag: "RemoveNode", nodeId }] },
	{ _tag: "Ready", widgetId: "village", protocolVersion: 1 },
	{ _tag: "Heartbeat", tick: 12 },
];

const describeCommand = (command: RenderCommand): string => {
	return Match.valueTags(command, {
		CreateNode: (c) => c._tag,
		SetParent: (c) => c._tag,
		SetTransform: (c) => c._tag,
		SetSprite: (c) => c._tag,
		SetAnimation: (c) => c._tag,
		SetText: (c) => c._tag,
		AddFilter: (c) => c._tag,
		SetFilterParam: (c) => c._tag,
		RemoveFilter: (c) => c._tag,
		RemoveNode: (c) => c._tag,
		Batch: (c) => c._tag,
		Ready: (c) => c._tag,
		Heartbeat: (c) => c._tag,
	});
};

describe("RenderCommandSchema", () => {
	it("accepts every valid command", () => {
		for (const [index, command] of validCommands.entries()) {
			expect(() => decode(command), `valid command #${index}`).not.toThrow();
		}
	});

	it("decodes to plain objects", () => {
		const command = decode({ _tag: "RemoveNode", nodeId });

		expect(Object.getPrototypeOf(command)).toBe(Object.prototype);
		expect(command).toEqual({ _tag: "RemoveNode", nodeId });
	});

	it("keeps values intact after decoding", () => {
		expect(decode(validCommands[3])).toEqual({
			_tag: "SetTransform",
			nodeId,
		});
		expect(decode(validCommands[6])).toEqual({
			_tag: "SetAnimation",
			nodeId,
			assetIds: ["avatar_01", "avatar_02"],
			fps: 8,
			loop: true,
		});
	});

	it("roundtrips through structuredClone", () => {
		for (const command of validCommands) {
			expect(() => decode(structuredClone(command))).not.toThrow();
		}
	});

	it("matches every variant exhaustively", () => {
		expect(describeCommand(decode(validCommands[0]))).toBe("CreateNode");
		expect(describeCommand(decode(validCommands[12]))).toBe("Batch");
		expect(describeCommand(decode(validCommands[14]))).toBe("Heartbeat");
	});

	it("rejects an unknown tag", () => {
		expectInvalid({ _tag: "Teleport", nodeId });
	});

	it("rejects a missing nodeId", () => {
		expectInvalid({ _tag: "RemoveNode" });
	});

	it("rejects a malformed nodeId", () => {
		expectInvalid({ _tag: "RemoveNode", nodeId: "a b" });
		expectInvalid({ _tag: "RemoveNode", nodeId: "a".repeat(129) });
	});

	it("rejects an unknown node kind", () => {
		expectInvalid({ _tag: "CreateNode", nodeId, kind: "mesh" });
	});

	it("rejects extra properties", () => {
		expectInvalid({ _tag: "RemoveNode", nodeId, extra: true });
	});

	it("rejects alpha outside 0..1", () => {
		expectInvalid({ _tag: "SetTransform", nodeId, alpha: 1.1 });
		expectInvalid({ _tag: "SetTransform", nodeId, alpha: -0.1 });
	});

	it("rejects fps outside 1..60", () => {
		const base = { _tag: "SetAnimation", nodeId, assetIds: [], loop: true };

		expectInvalid({ ...base, fps: 0 });
		expectInvalid({ ...base, fps: 61 });
		expectInvalid({ ...base, fps: 7.5 });
	});

	it("rejects a batch larger than 2048 commands", () => {
		const commands = Array.from({ length: 2049 }, () => ({
			_tag: "RemoveNode",
			nodeId,
		}));

		expectInvalid({ _tag: "Batch", commands });
	});

	it("accepts a batch with exactly 2048 commands", () => {
		const commands = Array.from({ length: 2048 }, () => ({
			_tag: "RemoveNode",
			nodeId,
		}));

		expect(() => decode({ _tag: "Batch", commands })).not.toThrow();
	});

	it("rejects a nested batch", () => {
		expectInvalid({
			_tag: "Batch",
			commands: [{ _tag: "Batch", commands: [] }],
		});
	});
});

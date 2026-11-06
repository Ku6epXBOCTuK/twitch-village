import { describe, expect, it } from "vitest";
import type { LeafCommand } from "./commands";
import type { AssetId, NodeId } from "./ids";

declare const structuredClone: <T>(value: T) => T;
declare const TextEncoder: new () => {
	encode(input: string): Uint8Array;
};

const VIEWERS = 200;
const BATCH_BUDGET_BYTES = 256 * 1024;

const isPlainObject = (value: object): boolean => {
	const prototype = Object.getPrototypeOf(value);

	return prototype === Object.prototype || prototype === null;
};

const assertPlain = (value: unknown, path: string): void => {
	if (value === null) {
		return;
	}

	switch (typeof value) {
		case "string":
		case "number":
		case "boolean":
			return;
		case "undefined":
			throw new Error(`${path} is undefined`);
		case "function":
			throw new Error(`${path} is a function`);
		case "symbol":
			throw new Error(`${path} is a symbol`);
		case "bigint":
			throw new Error(`${path} is a bigint`);
	}

	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertPlain(item, `${path}[${index}]`);
		}

		return;
	}

	if (!isPlainObject(value)) {
		throw new Error(`${path} is a class instance`);
	}

	for (const [key, item] of Object.entries(value)) {
		assertPlain(item, `${path}.${key}`);
	}
};

const createSpawnBatch = () => {
	const commands: LeafCommand[] = [];

	for (let index = 0; index < VIEWERS; index += 1) {
		const nodeId = (suffix: string) => `viewer:${index}:${suffix}` as NodeId;
		const skin = (index % 20) + 1;
		const frames = Array.from(
			{ length: 8 },
			(_, frame) => `ships/${skin}/${frame}` as AssetId,
		);

		commands.push(
			{ _tag: "CreateNode", nodeId: nodeId("container"), kind: "container" },
			{ _tag: "CreateNode", nodeId: nodeId("sprite"), kind: "sprite" },
			{ _tag: "CreateNode", nodeId: nodeId("label"), kind: "text" },
			{
				_tag: "SetParent",
				nodeId: nodeId("sprite"),
				parentId: nodeId("container"),
				order: 0,
			},
			{
				_tag: "SetParent",
				nodeId: nodeId("label"),
				parentId: nodeId("container"),
				order: 1,
			},
			{
				_tag: "SetTransform",
				nodeId: nodeId("container"),
				x: index * 3.5,
				y: 720 - (index % 10) * 40,
				alpha: 1,
			},
			{
				_tag: "SetSprite",
				nodeId: nodeId("sprite"),
				assetId: `ships/${skin}/0` as AssetId,
			},
			{
				_tag: "SetAnimation",
				nodeId: nodeId("sprite"),
				assetIds: frames,
				fps: 15,
				loop: true,
			},
			{
				_tag: "SetText",
				nodeId: nodeId("label"),
				text: `viewer-${index}`,
				style: { fontSize: 14, fill: "#ffffff", align: "center" },
			},
			{ _tag: "SetTint", nodeId: nodeId("sprite"), tint: "#ffffff" },
		);
	}

	return { _tag: "Batch", commands };
};

describe("Batch budget", () => {
	it("keeps a spawn batch for 200 viewers within 256 KiB and clone-safe", () => {
		const batch = createSpawnBatch();

		expect(batch.commands).toHaveLength(VIEWERS * 10);
		assertPlain(batch, "batch");

		const serialized = JSON.stringify(batch);
		const bytes = new TextEncoder().encode(serialized).byteLength;

		expect(bytes).toBeLessThanOrEqual(BATCH_BUDGET_BYTES);
		expect(structuredClone(batch)).toEqual(batch);
	});
});

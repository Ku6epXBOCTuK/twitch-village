import { describe, expect, it } from "vitest";
import { decodeWidgetToCore } from "./decode";
import { PROTOCOL_VERSION } from "./version";

declare const structuredClone: <T>(value: T) => T;

const envelope = (message: unknown): unknown => ({
	protocolVersion: PROTOCOL_VERSION,
	message,
});

const decode = (input: unknown) => {
	const result = decodeWidgetToCore(input);

	if (result._tag === "Failure") {
		throw new Error("expected the envelope to be accepted");
	}

	return result.success;
};

const expectInvalid = (input: unknown): void => {
	const result = decodeWidgetToCore(input);

	if (result._tag === "Success") {
		throw new Error(
			`expected the envelope to be rejected: ${JSON.stringify(result.success)}`,
		);
	}
};

describe("decodeWidgetToCore", () => {
	it("decodes an envelope with a render command", () => {
		const decoded = decode(
			envelope({ _tag: "CreateNode", nodeId: "avatar:42", kind: "sprite" }),
		);

		expect(decoded).toEqual({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "CreateNode", nodeId: "avatar:42", kind: "sprite" },
		});
		expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
	});

	it("decodes an envelope with a service message", () => {
		expect(decode(envelope({ _tag: "Heartbeat", tick: 7 }))).toEqual({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Heartbeat", tick: 7 },
		});
	});

	it("returns a failure instead of throwing", () => {
		expect(() => decodeWidgetToCore({ _tag: "NoSuchMessage" })).not.toThrow();
		expect(decodeWidgetToCore({ _tag: "NoSuchMessage" })._tag).toBe("Failure");
	});

	it("rejects an unknown message tag", () => {
		expectInvalid(envelope({ _tag: "Teleport", nodeId: "avatar:42" }));
	});

	it("rejects extra properties", () => {
		expectInvalid({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Heartbeat", tick: 7, extra: true },
		});
		expectInvalid({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "Heartbeat", tick: 7 },
			extra: true,
		});
	});

	it("rejects a malformed protocolVersion", () => {
		expectInvalid({ message: { _tag: "Heartbeat", tick: 7 } });
		expectInvalid({
			protocolVersion: "1",
			message: { _tag: "Heartbeat", tick: 7 },
		});
		expectInvalid({
			protocolVersion: 1.5,
			message: { _tag: "Heartbeat", tick: 7 },
		});
	});

	it("decodes a structured-cloned envelope", () => {
		const cloned = structuredClone(
			envelope({ _tag: "SetTransform", nodeId: "avatar:42", alpha: 0.5 }),
		);

		expect(decode(cloned)).toEqual({
			protocolVersion: PROTOCOL_VERSION,
			message: { _tag: "SetTransform", nodeId: "avatar:42", alpha: 0.5 },
		});
	});
});

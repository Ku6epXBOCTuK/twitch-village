import { describe, expect, it } from "vitest";
import { PROTOCOL_MAJOR, PROTOCOL_VERSION, isCompatible } from "./version";

describe("protocol version", () => {
	it("version and major are positive integers", () => {
		expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
		expect(Number.isInteger(PROTOCOL_MAJOR)).toBe(true);
		expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
		expect(PROTOCOL_MAJOR).toBeGreaterThanOrEqual(1);
	});

	it("keeps major in sync with the protocol version", () => {
		expect(PROTOCOL_VERSION).toBe(PROTOCOL_MAJOR);
	});

	it("accepts the current major", () => {
		expect(isCompatible(PROTOCOL_MAJOR)).toBe(true);
	});

	it("rejects the next major", () => {
		expect(isCompatible(PROTOCOL_MAJOR + 1)).toBe(false);
	});

	it("rejects zero, negatives and NaN", () => {
		expect(isCompatible(0)).toBe(false);
		expect(isCompatible(-1)).toBe(false);
		expect(isCompatible(Number.NaN)).toBe(false);
	});

	it("is stable for repeated calls", () => {
		expect(isCompatible(PROTOCOL_MAJOR)).toBe(true);
		expect(isCompatible(PROTOCOL_MAJOR)).toBe(true);
	});
});

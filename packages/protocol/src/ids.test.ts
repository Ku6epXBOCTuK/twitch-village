import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { AssetId, EffectId, NodeId, ViewerId, WidgetId } from "./ids";

const decode = (schema: Schema.Decoder<unknown>) => {
	return (input: unknown) => Schema.decodeUnknownSync(schema)(input);
};

const decodeNode = decode(NodeId);

describe("identifiers", () => {
	it("accepts a valid value for every brand", () => {
		expect(decode(WidgetId)("village")).toBe("village");
		expect(decode(NodeId)("avatar:42")).toBe("avatar:42");
		expect(decode(AssetId)("avatar_01")).toBe("avatar_01");
		expect(decode(EffectId)("sparkle-2")).toBe("sparkle-2");
		expect(decode(ViewerId)("123456")).toBe("123456");
	});

	it("returns the same string, without trimming", () => {
		expect(decodeNode("abc")).toBe("abc");
		expect(() => decodeNode(" abc")).toThrow();
		expect(() => decodeNode("abc ")).toThrow();
	});

	it("rejects an empty string", () => {
		expect(() => decodeNode("")).toThrow();
	});

	it("accepts 128 characters and rejects 129", () => {
		expect(decodeNode("a".repeat(128))).toHaveLength(128);
		expect(() => decodeNode("a".repeat(129))).toThrow();
	});

	it("rejects characters outside the allowed set", () => {
		for (const bad of ["a b", "a/b", "a.b", "a$b", "имя", "a\nb"]) {
			expect(() => decodeNode(bad)).toThrow();
		}
	});

	it("rejects non-string values", () => {
		for (const bad of [42, null, undefined, {}, []]) {
			expect(() => decodeNode(bad)).toThrow();
		}
	});

	it("rejects the same values for every brand", () => {
		for (const schema of [WidgetId, NodeId, AssetId, EffectId, ViewerId]) {
			expect(() => decode(schema)("a b")).toThrow();
			expect(() => decode(schema)("")).toThrow();
		}
	});
});

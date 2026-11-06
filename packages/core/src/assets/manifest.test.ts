import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { AssetManifestSchema } from "./manifest";

const decode = Schema.decodeUnknownSync(AssetManifestSchema);

describe("AssetManifestSchema", () => {
	it("accepts the metadata that assetpack adds to an entry", () => {
		const manifest = decode({
			bundles: [
				{
					name: "default",
					assets: [
						{
							alias: ["cook/east/0"],
							src: ["cook/east/0.png"],
							data: { tags: {} },
						},
					],
				},
			],
		});

		expect(manifest.bundles[0]?.assets[0]?.alias).toEqual(["cook/east/0"]);
	});

	it("rejects an alias with a file extension", () => {
		expect(() =>
			decode({
				bundles: [
					{
						name: "default",
						assets: [{ alias: ["cook/east/0.png"], src: "cook/east/0.png" }],
					},
				],
			}),
		).toThrow();
	});
});

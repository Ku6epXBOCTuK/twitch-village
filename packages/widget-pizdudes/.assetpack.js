import { pixiManifest } from "@assetpack/core/manifest";

export default {
	entry: "./assets",
	output: "./dist-assets",
	cache: false,
	pipes: [
		pixiManifest({
			output: "manifest.json",
			trimExtensions: true,
			createShortcuts: false,
		}),
	],
};

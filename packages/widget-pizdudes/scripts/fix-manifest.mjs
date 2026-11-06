import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "dist-assets", "manifest.json");
const assetIdPattern = /^[A-Za-z0-9:_/-]+$/;

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

for (const bundle of manifest.bundles) {
	for (const asset of bundle.assets) {
		const aliases = Array.isArray(asset.alias) ? asset.alias : [asset.alias];
		const valid = aliases.filter((alias) => assetIdPattern.test(alias));
		if (valid.length === 0) {
			throw new Error(
				`Asset ${String(asset.src)} has no alias that matches AssetId`,
			);
		}
		asset.alias = valid;
	}
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

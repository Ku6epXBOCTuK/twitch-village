import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "dist-assets", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const aliasPattern = /^[A-Za-z0-9:_/-]+$/;

for (const bundle of manifest.bundles) {
	bundle.name = "shooting-words";
	for (const asset of bundle.assets) {
		const aliases = Array.isArray(asset.alias) ? asset.alias : [asset.alias];
		const kept = aliases.filter((alias) => aliasPattern.test(alias));
		if (kept.length === 0) {
			throw new Error(`no valid alias left for ${String(asset.src)}`);
		}
		asset.alias = kept;
	}
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

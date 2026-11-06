import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, "public");
const workspace = join(root, "..", "..");
const packages = ["widget-pizdudes", "widget-shooting-words"];

await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

const bundles = [];
for (const name of packages) {
	const dist = join(workspace, "packages", name, "dist-assets");
	const manifest = JSON.parse(
		await readFile(join(dist, "manifest.json"), "utf8"),
	);
	bundles.push(...manifest.bundles);
	await cp(dist, publicDir, {
		recursive: true,
		filter: (source) => basename(source) !== "manifest.json",
	});
}

await writeFile(
	join(publicDir, "manifest.json"),
	`${JSON.stringify({ bundles }, null, 2)}\n`,
);

import type { AssetId, BundleId } from "@tv/protocol";
import { Assets as PixiAssets, type Texture } from "pixi.js";
import type { AssetBackend } from "./asset-registry";
import type { AssetManifest } from "./manifest";

export interface PixiAssetBackendOptions {
	readonly baseUrl?: string;
}

function joinUrl(baseUrl: string, src: string): string {
	const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	return `${base}${src.replace(/^\//, "")}`;
}

export function createPixiAssetBackend(
	options: PixiAssetBackendOptions = {},
): AssetBackend {
	const baseUrl = options.baseUrl ?? "/";
	let manifest: AssetManifest | undefined;
	const textures = new Map<AssetId, Texture>();
	const bundleSources = new Map<BundleId, string[]>();
	const bundleAliases = new Map<BundleId, AssetId[]>();

	return {
		async init(nextManifest: AssetManifest): Promise<void> {
			manifest = nextManifest;
		},
		async loadBundle(bundleId: BundleId): Promise<void> {
			if (manifest === undefined) {
				throw new Error("Asset backend is not initialized");
			}
			if (bundleAliases.has(bundleId)) return;
			const bundle = manifest.bundles.find((entry) => entry.name === bundleId);
			if (bundle === undefined) {
				throw new Error(`Asset bundle ${bundleId} is not in the manifest`);
			}
			const sources: string[] = [];
			const aliases: AssetId[] = [];
			for (const entry of bundle.assets) {
				const entrySources = Array.isArray(entry.src) ? entry.src : [entry.src];
				const entryAliases = Array.isArray(entry.alias)
					? entry.alias
					: [entry.alias];
				let texture: Texture | undefined;
				for (const src of entrySources) {
					const url = joinUrl(baseUrl, src);
					sources.push(url);
					texture ??= await PixiAssets.load<Texture>(url);
				}
				if (texture === undefined) continue;
				for (const alias of entryAliases) {
					textures.set(alias, texture);
					aliases.push(alias);
				}
			}
			bundleSources.set(bundleId, sources);
			bundleAliases.set(bundleId, aliases);
		},
		async unloadBundle(bundleId: BundleId): Promise<void> {
			const aliases = bundleAliases.get(bundleId);
			const sources = bundleSources.get(bundleId);
			if (aliases === undefined || sources === undefined) return;
			for (const alias of aliases) textures.delete(alias);
			bundleAliases.delete(bundleId);
			bundleSources.delete(bundleId);
			await Promise.all(sources.map((src) => PixiAssets.unload(src)));
		},
		get(assetId: AssetId): Texture | undefined {
			return textures.get(assetId);
		},
	};
}

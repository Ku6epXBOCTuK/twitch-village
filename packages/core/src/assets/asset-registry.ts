import {
	AssetNotFound,
	BundleLoadFailed,
	type AssetId,
	type WidgetId,
} from "@tv/protocol";
import type { Texture } from "pixi.js";
import type { AssetManifest } from "./manifest";

export interface AssetBackend {
	init(manifest: AssetManifest): Promise<void>;
	loadBundle(bundleId: string): Promise<void>;
	unloadBundle(bundleId: string): Promise<void>;
	get(assetId: AssetId): Texture | undefined;
}

export interface AssetRegistryOptions {
	readonly widgetId: WidgetId;
	readonly backend: AssetBackend;
}

export interface AssetRegistry {
	// NOTE: the manifest is the only source of the asset-to-bundle map, so
	// init runs once and a repeat call is a no-op.
	init(manifest: AssetManifest): Promise<void>;
	// NOTE: loading is idempotent, and a rejected load leaves the bundle
	// unloaded, so a retry starts from a clean flag.
	loadBundle(bundleId: string): Promise<void>;
	unloadBundle(bundleId: string): Promise<void>;
	isLoaded(bundleId: string): boolean;
	// NOTE: resolution goes through the backend on every call; the registry
	// keeps no texture map of its own.
	getTexture(assetId: AssetId): Texture | AssetNotFound;
}

export function createAssetRegistry(
	options: AssetRegistryOptions,
): AssetRegistry {
	const backend = options.backend;
	let initPromise: Promise<void> | undefined;
	let initialized = false;
	const aliasToBundleMap = new Map<AssetId, string>();
	const bundleLoaded = new Set<string>();

	function assetNotFound(assetId: AssetId, message: string): AssetNotFound {
		return new AssetNotFound({
			widgetId: options.widgetId,
			message,
			assetId,
		});
	}

	return {
		init: async (manifest: AssetManifest) => {
			if (initPromise === undefined) {
				initPromise = (async () => {
					try {
						await backend.init(manifest);
					} catch (e) {
						initPromise = undefined;
						throw e;
					}
					for (const bundle of manifest.bundles) {
						for (const asset of bundle.assets) {
							if (typeof asset.alias === "string") {
								aliasToBundleMap.set(asset.alias, bundle.name);
							} else {
								for (const alias of asset.alias) {
									aliasToBundleMap.set(alias, bundle.name);
								}
							}
						}
					}
					initialized = true;
				})();
			}
			await initPromise;
		},
		loadBundle: async (bundleId: string) => {
			if (!bundleLoaded.has(bundleId)) {
				try {
					await backend.loadBundle(bundleId);
				} catch (error) {
					throw new BundleLoadFailed({
						widgetId: options.widgetId,
						bundleId,
						message: `Bundle ${bundleId} failed to load: ${error instanceof Error ? error.message : String(error)}`,
					});
				}
				bundleLoaded.add(bundleId);
			}
		},
		unloadBundle: async (bundleId: string) => {
			if (bundleLoaded.has(bundleId)) {
				await backend.unloadBundle(bundleId);
				bundleLoaded.delete(bundleId);
			}
		},
		isLoaded: (bundleId: string) => bundleLoaded.has(bundleId),
		getTexture: (assetId: AssetId): Texture | AssetNotFound => {
			if (!initialized) throw new Error("AssetRegistry is not initialized");
			const bundleId = aliasToBundleMap.get(assetId);
			if (bundleId === undefined)
				return assetNotFound(
					assetId,
					`Bundle for asset ${assetId} is not found`,
				);
			if (!bundleLoaded.has(bundleId))
				return assetNotFound(
					assetId,
					`Bundle for asset ${assetId} is not loaded`,
				);
			const texture = backend.get(assetId);
			if (texture === undefined)
				return assetNotFound(assetId, `Asset ${assetId} is not found`);
			return texture;
		},
	};
}

import {
	AssetNotFound,
	BundleLoadFailed,
	BundleUnloadFailed,
	type AssetId,
	type WidgetId,
} from "@tv/protocol";
import { Effect } from "effect";
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
	init(manifest: AssetManifest): Effect.Effect<void>;
	// NOTE: loading is idempotent and a rejected load leaves the bundle
	// unloaded, so a retry starts from a clean flag.
	loadBundle(bundleId: string): Effect.Effect<void, BundleLoadFailed>;
	unloadBundle(
		bundleId: string,
	): Effect.Effect<void, BundleLoadFailed | BundleUnloadFailed>;
	isLoaded(bundleId: string): boolean;
	// NOTE: resolution goes through the backend on every call; the registry
	// keeps no texture map of its own.
	getTexture(assetId: AssetId): Effect.Effect<Texture, AssetNotFound>;
}

function describeCause(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function createAssetRegistry(
	options: AssetRegistryOptions,
): AssetRegistry {
	const backend = options.backend;
	let initPromise: Promise<void> | undefined;
	let initialized = false;
	const aliasToBundleMap = new Map<AssetId, string>();
	const bundleLoaded = new Set<string>();
	const inFlight = new Map<string, Promise<void>>();

	function assetNotFound(assetId: AssetId, message: string): AssetNotFound {
		return new AssetNotFound({
			widgetId: options.widgetId,
			message,
			assetId,
		});
	}

	function loadFailed(bundleId: string, cause: unknown): BundleLoadFailed {
		return new BundleLoadFailed({
			widgetId: options.widgetId,
			bundleId,
			message: `Bundle ${bundleId} failed to load: ${describeCause(cause)}`,
		});
	}

	function unloadFailed(bundleId: string, cause: unknown): BundleUnloadFailed {
		return new BundleUnloadFailed({
			widgetId: options.widgetId,
			bundleId,
			message: `Bundle ${bundleId} failed to unload: ${describeCause(cause)}`,
		});
	}

	function startInit(manifest: AssetManifest): Promise<void> {
		const promise = (async () => {
			await backend.init(manifest);
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
		initPromise = promise;
		return promise;
	}

	function startLoad(bundleId: string): Promise<void> {
		const promise = backend.loadBundle(bundleId).then(
			() => {
				bundleLoaded.add(bundleId);
			},
			(cause: unknown) => {
				throw loadFailed(bundleId, cause);
			},
		);
		inFlight.set(bundleId, promise);
		void promise
			.catch(() => undefined)
			.then(() => {
				if (inFlight.get(bundleId) === promise) inFlight.delete(bundleId);
			});
		return promise;
	}

	function awaitLoad(
		bundleId: string,
		promise: Promise<void>,
	): Effect.Effect<void, BundleLoadFailed> {
		return Effect.tryPromise({
			try: () => promise,
			catch: (cause) =>
				cause instanceof BundleLoadFailed ? cause : loadFailed(bundleId, cause),
		});
	}

	return {
		init: (manifest: AssetManifest) =>
			Effect.suspend(() => {
				const promise = initPromise ?? startInit(manifest);
				return Effect.promise(() => promise);
			}),
		loadBundle: (bundleId: string) =>
			Effect.suspend(() => {
				if (bundleLoaded.has(bundleId)) return Effect.void;
				const promise = inFlight.get(bundleId) ?? startLoad(bundleId);
				return awaitLoad(bundleId, promise);
			}),
		unloadBundle: (bundleId: string) =>
			Effect.suspend(() => {
				const pending = inFlight.get(bundleId);
				return Effect.gen(function* () {
					if (pending !== undefined) {
						yield* awaitLoad(bundleId, pending);
					}
					if (!bundleLoaded.has(bundleId)) return;
					yield* Effect.tryPromise({
						try: () => backend.unloadBundle(bundleId),
						catch: (cause) => unloadFailed(bundleId, cause),
					});
					bundleLoaded.delete(bundleId);
				});
			}),
		isLoaded: (bundleId: string) => bundleLoaded.has(bundleId),
		getTexture: (assetId: AssetId) =>
			Effect.suspend(() => {
				if (!initialized) {
					return Effect.die(new Error("AssetRegistry is not initialized"));
				}
				const bundleId = aliasToBundleMap.get(assetId);
				if (bundleId === undefined) {
					return Effect.fail(
						assetNotFound(assetId, `Bundle for asset ${assetId} is not found`),
					);
				}
				if (!bundleLoaded.has(bundleId)) {
					return Effect.fail(
						assetNotFound(assetId, `Bundle for asset ${assetId} is not loaded`),
					);
				}
				const texture = backend.get(assetId);
				if (texture === undefined) {
					return Effect.fail(
						assetNotFound(assetId, `Asset ${assetId} is not found`),
					);
				}
				return Effect.succeed(texture);
			}),
	};
}

import {
	type AssetId,
	AssetNotFound,
	BundleLoadFailed,
	BundleLoadTimeout,
	BundleUnloadFailed,
	type WidgetId,
} from "@tv/protocol";
import {
	Deferred,
	type Duration,
	Effect,
	Exit,
	Match,
	Schedule,
	SynchronizedRef,
} from "effect";
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
	readonly maxAttempts?: number;
	readonly retryDelay?: Duration.Input;
	readonly timeoutMs?: number;
}

export interface AssetRegistry {
	// NOTE: the manifest is the only source of the asset-to-bundle map, so
	// init runs once and a repeat call is a no-op.
	init(manifest: AssetManifest): Effect.Effect<void>;
	// NOTE: loading is idempotent and a rejected load leaves the bundle
	// unloaded, so a retry starts from a clean flag.
	loadBundle(bundleId: string): Effect.Effect<void, BundleLoadError>;
	unloadBundle(
		bundleId: string,
	): Effect.Effect<void, BundleLoadError | BundleUnloadFailed>;
	isLoaded(bundleId: string): boolean;
	// NOTE: resolution goes through the backend on every call; the registry
	// keeps no texture map of its own.
	getTexture(assetId: AssetId): Effect.Effect<Texture, AssetNotFound>;
}

function describeCause(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

type BundleLoadError = BundleLoadFailed | BundleLoadTimeout;

type BundleEntry =
	| {
			readonly _tag: "loading";
			readonly deferred: Deferred.Deferred<void, BundleLoadError>;
	  }
	| { readonly _tag: "loaded" };

type LoadDecision =
	| { readonly _tag: "ready" }
	| {
			readonly _tag: "wait";
			readonly deferred: Deferred.Deferred<void, BundleLoadError>;
	  }
	| {
			readonly _tag: "start";
			readonly deferred: Deferred.Deferred<void, BundleLoadError>;
	  };

type LoadUpdate = readonly [LoadDecision, Map<string, BundleEntry>];

export function createAssetRegistry(
	options: AssetRegistryOptions,
): AssetRegistry {
	const backend = options.backend;
	const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
	const retryDelay = options.retryDelay ?? 0;
	const retrySchedule = Schedule.recurs(maxAttempts - 1).pipe(
		Schedule.addDelay(() => Effect.succeed(retryDelay)),
	);
	let initPromise: Promise<void> | undefined;
	let initialized = false;
	const aliasToBundleMap = new Map<AssetId, string>();
	const loading = SynchronizedRef.makeUnsafe(new Map<string, BundleEntry>());

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

	function loadTimeout(bundleId: string): BundleLoadTimeout {
		const timeoutMs = options.timeoutMs ?? 0;
		return new BundleLoadTimeout({
			widgetId: options.widgetId,
			bundleId,
			timeoutMs,
			message: `Bundle ${bundleId} load timed out after ${timeoutMs}ms`,
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

	function settleLoad(
		bundleId: string,
		deferred: Deferred.Deferred<void, BundleLoadError>,
		exit: Exit.Exit<void, BundleLoadError>,
	): Effect.Effect<void> {
		return Effect.gen(function* () {
			yield* SynchronizedRef.modify(loading, (state) => {
				const nextState = new Map(state);
				if (Exit.isSuccess(exit)) {
					nextState.set(bundleId, { _tag: "loaded" });
				} else {
					nextState.delete(bundleId);
				}
				return [undefined, nextState];
			});
			yield* Deferred.done(deferred, exit);
		});
	}

	function runLoad(
		bundleId: string,
		deferred: Deferred.Deferred<void, BundleLoadError>,
	): Effect.Effect<void, BundleLoadError> {
		const attempt = Effect.tryPromise({
			try: () => backend.loadBundle(bundleId),
			catch: (cause) => loadFailed(bundleId, cause),
		});
		const retried = Effect.retry(attempt, { schedule: retrySchedule });
		const bounded =
			options.timeoutMs === undefined
				? retried
				: retried.pipe(
						Effect.timeoutOrElse({
							duration: options.timeoutMs,
							orElse: () => Effect.fail(loadTimeout(bundleId)),
						}),
					);

		return bounded.pipe(
			Effect.onExit((exit) => settleLoad(bundleId, deferred, exit)),
		);
	}

	return {
		init: (manifest: AssetManifest) =>
			Effect.suspend(() => {
				const promise = initPromise ?? startInit(manifest);
				return Effect.promise(() => promise);
			}),
		loadBundle: (bundleId: string) =>
			Effect.gen(function* () {
				const decision = yield* SynchronizedRef.modifyEffect(
					loading,
					(state) => {
						const entry = state.get(bundleId);
						if (entry === undefined) {
							return Deferred.make<void, BundleLoadError>().pipe(
								Effect.map((deferred): LoadUpdate => {
									const nextState = new Map(state).set(bundleId, {
										_tag: "loading",
										deferred,
									});
									const start: LoadDecision = {
										_tag: "start",
										deferred,
									};
									return [start, nextState];
								}),
							);
						}
						const result: LoadDecision = Match.valueTags(entry, {
							loaded: () => {
								const ready: LoadDecision = { _tag: "ready" };
								return ready;
							},
							loading: (loadingEntry) => {
								const wait: LoadDecision = {
									_tag: "wait",
									deferred: loadingEntry.deferred,
								};
								return wait;
							},
						});
						return Effect.succeed([result, state]);
					},
				);
				return yield* Match.valueTags(decision, {
					ready: () => Effect.void,
					wait: (waiting) => Deferred.await(waiting.deferred),
					start: (started) => runLoad(bundleId, started.deferred),
				});
			}),
		unloadBundle: (bundleId: string) =>
			Effect.gen(function* () {
				const entry = SynchronizedRef.getUnsafe(loading).get(bundleId);
				if (entry === undefined) return;
				if (entry._tag === "loading") {
					yield* Deferred.await(entry.deferred);
				}
				const loaded = SynchronizedRef.getUnsafe(loading).get(bundleId);
				if (loaded === undefined || loaded._tag !== "loaded") return;
				yield* Effect.tryPromise({
					try: () => backend.unloadBundle(bundleId),
					catch: (cause) => unloadFailed(bundleId, cause),
				});
				yield* SynchronizedRef.modify(loading, (state) => {
					const nextState = new Map(state);
					nextState.delete(bundleId);
					return [undefined, nextState];
				});
			}),
		isLoaded: (bundleId: string) =>
			SynchronizedRef.getUnsafe(loading).get(bundleId)?._tag === "loaded",
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
				const entry = SynchronizedRef.getUnsafe(loading).get(bundleId);
				if (entry === undefined || entry._tag !== "loaded") {
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

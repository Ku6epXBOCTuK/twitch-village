import { Effect } from "effect";
import {
	type AssetRegistry,
	type AssetRegistryOptions,
	createAssetRegistry,
} from "./asset-registry";
import type { AssetManifest } from "./manifest";

export function createManifestAssetRegistry(
	options: AssetRegistryOptions,
	manifest: AssetManifest,
): AssetRegistry {
	const registry = createAssetRegistry(options);

	return {
		...registry,
		loadBundle: (bundleId: string) =>
			registry
				.init(manifest)
				.pipe(Effect.flatMap(() => registry.loadBundle(bundleId))),
		unloadBundle: (bundleId: string) =>
			registry
				.init(manifest)
				.pipe(Effect.flatMap(() => registry.unloadBundle(bundleId))),
	};
}

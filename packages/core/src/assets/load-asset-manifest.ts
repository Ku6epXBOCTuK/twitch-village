import { Schema } from "effect";
import { type AssetManifest, AssetManifestSchema } from "./manifest";

export async function loadAssetManifest(
	url: URL | string,
): Promise<AssetManifest> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Asset manifest ${String(url)} failed with ${response.status}`,
		);
	}
	const data: unknown = await response.json();
	return Schema.decodeUnknownSync(AssetManifestSchema)(data);
}

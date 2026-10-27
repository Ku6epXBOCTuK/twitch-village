import type { AssetId } from "@tv/protocol";
import type { Texture } from "pixi.js";
import type { AssetBackend } from "../assets/asset-registry";
import type { AssetManifest } from "../assets/manifest";

export interface FakeAssetCall {
	readonly method: string;
	readonly args: readonly unknown[];
}

export interface FakeAssetBackend extends AssetBackend {
	readonly calls: readonly FakeAssetCall[];
	readonly textures: Map<AssetId, Texture>;
	readonly failures: Map<string, unknown>;
	initFailure: unknown;
	holdInit(): () => void;
}

export function createFakeAssetBackend(): FakeAssetBackend {
	const calls: FakeAssetCall[] = [];
	const textures = new Map<AssetId, Texture>();
	const failures = new Map<string, unknown>();
	let pendingInit: Promise<void> | undefined;
	let initFailure: unknown;

	const backend: FakeAssetBackend = {
		calls,
		textures,
		failures,
		get initFailure(): unknown {
			return initFailure;
		},
		set initFailure(value: unknown) {
			initFailure = value;
		},
		holdInit(): () => void {
			const box: { release: (() => void) | undefined } = { release: undefined };
			pendingInit = new Promise<void>((resolve) => {
				box.release = resolve;
			});
			return () => {
				pendingInit = undefined;
				box.release?.();
			};
		},
		async init(manifest: AssetManifest): Promise<void> {
			calls.push({ method: "init", args: [manifest] });
			const gate = pendingInit;
			if (gate !== undefined) {
				await gate;
			}
			if (initFailure !== undefined) {
				throw initFailure;
			}
		},
		async loadBundle(bundleId: string): Promise<void> {
			calls.push({ method: "loadBundle", args: [bundleId] });
			const failure = failures.get(bundleId);
			if (failure !== undefined) {
				throw failure;
			}
		},
		async unloadBundle(bundleId: string): Promise<void> {
			calls.push({ method: "unloadBundle", args: [bundleId] });
		},
		get(assetId: AssetId): Texture | undefined {
			calls.push({ method: "get", args: [assetId] });
			return textures.get(assetId);
		},
	};

	return backend;
}

export const stubTexture = (): Texture => ({ label: "stub" }) as Texture;

export const callsOf = (
	backend: FakeAssetBackend,
	method: string,
): readonly (readonly unknown[])[] =>
	backend.calls
		.filter((call) => call.method === method)
		.map((call) => call.args);

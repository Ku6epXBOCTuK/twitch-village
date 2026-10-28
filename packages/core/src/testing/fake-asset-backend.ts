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
	readonly unloadFailures: Map<string, unknown>;
	initFailure: unknown;
	holdInit(): () => void;
	holdLoad(bundleId: string): () => void;
}

export function createFakeAssetBackend(): FakeAssetBackend {
	const calls: FakeAssetCall[] = [];
	const textures = new Map<AssetId, Texture>();
	const failures = new Map<string, unknown>();
	const unloadFailures = new Map<string, unknown>();
	const loadGates = new Map<string, Promise<void>>();
	let pendingInit: Promise<void> | undefined;
	let initFailure: unknown;

	const backend: FakeAssetBackend = {
		calls,
		textures,
		failures,
		unloadFailures,
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
		holdLoad(bundleId: string): () => void {
			const box: { release: (() => void) | undefined } = { release: undefined };
			const gate = new Promise<void>((resolve) => {
				box.release = resolve;
			});
			loadGates.set(bundleId, gate);
			return () => {
				loadGates.delete(bundleId);
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
			const gate = loadGates.get(bundleId);
			if (gate !== undefined) {
				await gate;
			}
			const failure = failures.get(bundleId);
			if (failure !== undefined) {
				throw failure;
			}
		},
		async unloadBundle(bundleId: string): Promise<void> {
			calls.push({ method: "unloadBundle", args: [bundleId] });
			const failure = unloadFailures.get(bundleId);
			if (failure !== undefined) {
				throw failure;
			}
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

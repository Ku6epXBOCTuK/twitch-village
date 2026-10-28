import type { AssetId, WidgetId } from "@tv/protocol";
import { AssetNotFound } from "@tv/protocol";
import { describe, expect, it } from "vitest";
import {
	callsOf,
	createFakeAssetBackend,
	stubTexture,
	type FakeAssetBackend,
} from "../testing/fake-asset-backend";
import {
	createAssetRegistry,
	type AssetRegistry,
	type AssetRegistryOptions,
} from "./asset-registry";
import type { AssetManifest } from "./manifest";

const village = "village" as WidgetId;

const asAssetId = (value: string): AssetId => value as AssetId;

const avatar = asAssetId("avatar/cat/0");

const manifest: AssetManifest = {
	bundles: [
		{
			name: "village",
			assets: [
				{ alias: avatar, src: "avatar/cat-0.png" },
				{
					alias: [asAssetId("avatar/cat/1"), asAssetId("avatar/cat/2")],
					src: "avatar/cat-1.png",
				},
			],
		},
		{
			name: "alerts",
			assets: [{ alias: asAssetId("bell"), src: "bell.png" }],
		},
	],
};

const setup = (): {
	registry: AssetRegistry;
	backend: FakeAssetBackend;
	options: AssetRegistryOptions;
} => {
	const backend = createFakeAssetBackend();
	const options: AssetRegistryOptions = { widgetId: village, backend };
	return { registry: createAssetRegistry(options), backend, options };
};

describe("AssetRegistry", () => {
	it("forwards the manifest to the backend once", async () => {
		const { registry, backend } = setup();

		await registry.init(manifest);
		await registry.init(manifest);

		expect(callsOf(backend, "init")).toEqual([[manifest]]);
	});

	it("calls the backend init once for two parallel inits", async () => {
		const { registry, backend } = setup();
		const release = backend.holdInit();

		const first = registry.init(manifest);
		const second = registry.init(manifest);
		await Promise.resolve();

		expect(callsOf(backend, "init")).toEqual([[manifest]]);

		release();
		await Promise.all([first, second]);

		expect(callsOf(backend, "init")).toEqual([[manifest]]);
	});

	it("can retry after a failed init", async () => {
		const { registry, backend } = setup();
		const failure = new Error("manifest is broken");
		backend.initFailure = failure;

		await expect(registry.init(manifest)).rejects.toThrow(failure);

		backend.initFailure = undefined;
		await registry.init(manifest);

		expect(callsOf(backend, "init")).toEqual([[manifest], [manifest]]);
	});

	it("rejects a texture lookup before init", () => {
		const { registry } = setup();

		expect(() => registry.getTexture(avatar)).toThrow(/not initialized/);
	});

	it("rejects a texture lookup while init is still running", async () => {
		const { registry, backend } = setup();
		const release = backend.holdInit();

		const init = registry.init(manifest);
		await Promise.resolve();

		expect(() => registry.getTexture(avatar)).toThrow(/not initialized/);

		release();
		await init;
	});

	it("marks a bundle as loaded", async () => {
		const { registry, backend } = setup();
		await registry.init(manifest);

		await registry.loadBundle("village");

		expect(registry.isLoaded("village")).toBe(true);
		expect(callsOf(backend, "loadBundle")).toEqual([["village"]]);
	});

	it("loads the same bundle only once", async () => {
		const { registry, backend } = setup();

		await registry.loadBundle("village");
		await registry.loadBundle("village");

		expect(callsOf(backend, "loadBundle")).toEqual([["village"]]);
	});

	it("reports a backend load failure as BundleLoadFailed", async () => {
		const { registry, backend } = setup();
		backend.failures.set("village", new Error("network is down"));

		await expect(registry.loadBundle("village")).rejects.toMatchObject({
			_tag: "BundleLoadFailed",
			bundleId: "village",
			message: expect.stringContaining("network is down"),
		});
		expect(registry.isLoaded("village")).toBe(false);

		backend.failures.delete("village");
		await registry.loadBundle("village");

		expect(registry.isLoaded("village")).toBe(true);
	});

	it("unloads a bundle", async () => {
		const { registry, backend } = setup();
		await registry.loadBundle("village");

		await registry.unloadBundle("village");

		expect(registry.isLoaded("village")).toBe(false);
		expect(callsOf(backend, "unloadBundle")).toEqual([["village"]]);
	});

	it("does not call the backend for a bundle that was never loaded", async () => {
		const { registry, backend } = setup();

		await registry.unloadBundle("village");

		expect(callsOf(backend, "unloadBundle")).toEqual([]);
	});

	it("returns the texture of a loaded bundle", async () => {
		const { registry, backend } = setup();
		const texture = stubTexture();
		backend.textures.set(avatar, texture);
		await registry.init(manifest);
		await registry.loadBundle("village");

		expect(registry.getTexture(avatar)).toBe(texture);
	});

	it("resolves every alias of a multi-alias entry", async () => {
		const { registry, backend } = setup();
		const second = asAssetId("avatar/cat/2");
		backend.textures.set(second, stubTexture());
		await registry.init(manifest);
		await registry.loadBundle("village");

		expect(registry.getTexture(second)).toBeDefined();
	});

	it("rejects an asset of a bundle that is not loaded", async () => {
		const { registry, backend } = setup();
		backend.textures.set(avatar, stubTexture());
		await registry.init(manifest);

		expect(registry.getTexture(avatar)).toBeInstanceOf(AssetNotFound);
	});

	it("rejects an asset after its bundle was unloaded", async () => {
		const { registry, backend } = setup();
		backend.textures.set(avatar, stubTexture());
		await registry.init(manifest);
		await registry.loadBundle("village");
		await registry.unloadBundle("village");

		expect(registry.getTexture(avatar)).toBeInstanceOf(AssetNotFound);
	});

	it("reports the widget and the asset of a miss", async () => {
		const { registry } = setup();
		await registry.init(manifest);

		expect(registry.getTexture(avatar)).toMatchObject({
			_tag: "AssetNotFound",
			widgetId: village,
			assetId: avatar,
		});
	});

	it("rejects an asset missing from the manifest", async () => {
		const { registry, backend } = setup();
		const unknown = asAssetId("avatar/dog/0");
		backend.textures.set(unknown, stubTexture());
		await registry.init(manifest);

		expect(registry.getTexture(unknown)).toBeInstanceOf(AssetNotFound);
	});

	it("rejects an asset that the backend does not know", async () => {
		const { registry } = setup();
		await registry.init(manifest);
		await registry.loadBundle("village");

		expect(registry.getTexture(avatar)).toBeInstanceOf(AssetNotFound);
	});
});

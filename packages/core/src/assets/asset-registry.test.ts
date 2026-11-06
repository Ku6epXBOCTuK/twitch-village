import type { AssetId, WidgetId } from "@tv/protocol";
import { AssetNotFound, BundleLoadTimeout } from "@tv/protocol";
import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
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

const setup = (
	overrides: Partial<AssetRegistryOptions> = {},
): {
	registry: AssetRegistry;
	backend: FakeAssetBackend;
	options: AssetRegistryOptions;
} => {
	const backend = createFakeAssetBackend();
	const options: AssetRegistryOptions = {
		widgetId: village,
		backend,
		...overrides,
	};
	return { registry: createAssetRegistry(options), backend, options };
};

const failureOf = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
	Effect.runPromise(Effect.flip(effect));

const defectOf = async (
	effect: Effect.Effect<unknown, unknown>,
): Promise<unknown> => {
	const exit = await Effect.runPromiseExit(effect);

	if (Exit.isSuccess(exit)) throw new Error("expected the effect to fail");

	return Cause.squash(exit.cause);
};

describe("AssetRegistry", () => {
	it("forwards the manifest to the backend once", async () => {
		const { registry, backend } = setup();

		await Effect.runPromise(registry.init(manifest));
		await Effect.runPromise(registry.init(manifest));

		expect(callsOf(backend, "init")).toEqual([[manifest]]);
	});

	it("calls the backend init once for two parallel inits", async () => {
		const { registry, backend } = setup();
		const release = backend.holdInit();

		const first = Effect.runPromise(registry.init(manifest));
		const second = Effect.runPromise(registry.init(manifest));
		await Promise.resolve();

		expect(callsOf(backend, "init")).toEqual([[manifest]]);

		release();
		await Promise.all([first, second]);

		expect(callsOf(backend, "init")).toEqual([[manifest]]);
	});

	it("does not retry after a failed init", async () => {
		const { registry, backend } = setup();
		const failure = new Error("manifest is broken");
		backend.initFailure = failure;

		expect(await defectOf(registry.init(manifest))).toBe(failure);

		backend.initFailure = undefined;

		expect(await defectOf(registry.init(manifest))).toBe(failure);
		expect(callsOf(backend, "init")).toEqual([[manifest]]);
	});

	it("dies on a texture lookup before init", async () => {
		const { registry } = setup();

		expect(await defectOf(registry.getTexture(avatar))).toMatchObject({
			message: expect.stringContaining("not initialized"),
		});
	});

	it("dies on a texture lookup while init is still running", async () => {
		const { registry, backend } = setup();
		const release = backend.holdInit();

		const init = Effect.runPromise(registry.init(manifest));
		await Promise.resolve();

		expect(await defectOf(registry.getTexture(avatar))).toMatchObject({
			message: expect.stringContaining("not initialized"),
		});

		release();
		await init;
	});

	it("marks a bundle as loaded", async () => {
		const { registry, backend } = setup();
		await Effect.runPromise(registry.init(manifest));

		await Effect.runPromise(registry.loadBundle("village"));

		expect(registry.isLoaded("village")).toBe(true);
		expect(callsOf(backend, "loadBundle")).toEqual([["village"]]);
	});

	it("loads the same bundle only once", async () => {
		const { registry, backend } = setup();

		await Effect.runPromise(registry.loadBundle("village"));
		await Effect.runPromise(registry.loadBundle("village"));

		expect(callsOf(backend, "loadBundle")).toEqual([["village"]]);
	});

	it("shares one backend load between parallel calls", async () => {
		const { registry, backend } = setup();
		const release = backend.holdLoad("village");

		const first = Effect.runPromise(registry.loadBundle("village"));
		const second = Effect.runPromise(registry.loadBundle("village"));
		await Promise.resolve();

		release();
		await Promise.all([first, second]);

		expect(callsOf(backend, "loadBundle")).toEqual([["village"]]);
		expect(registry.isLoaded("village")).toBe(true);
	});

	it("reports a backend load failure as BundleLoadFailed", async () => {
		const { registry, backend } = setup();
		backend.failures.set("village", new Error("network is down"));

		expect(await failureOf(registry.loadBundle("village"))).toMatchObject({
			_tag: "BundleLoadFailed",
			bundleId: "village",
			message: expect.stringContaining("network is down"),
		});
		expect(registry.isLoaded("village")).toBe(false);
	});

	it("retries a load after a failure", async () => {
		const { registry, backend } = setup();
		backend.failures.set("village", new Error("network is down"));
		await failureOf(registry.loadBundle("village"));

		backend.failures.delete("village");
		await Effect.runPromise(registry.loadBundle("village"));

		expect(registry.isLoaded("village")).toBe(true);
	});

	it("retries a failed load within the same call", async () => {
		const { registry, backend } = setup({ maxAttempts: 3, retryDelay: 0 });
		backend.failLoad("village", new Error("network is down"), 2);

		await Effect.runPromise(registry.loadBundle("village"));

		expect(registry.isLoaded("village")).toBe(true);
		expect(callsOf(backend, "loadBundle")).toHaveLength(3);
	});

	it("gives up after the last allowed attempt", async () => {
		const { registry, backend } = setup({ maxAttempts: 2, retryDelay: 0 });
		backend.failures.set("village", new Error("network is down"));

		expect(await failureOf(registry.loadBundle("village"))).toMatchObject({
			_tag: "BundleLoadFailed",
			bundleId: "village",
		});
		expect(callsOf(backend, "loadBundle")).toHaveLength(2);
		expect(registry.isLoaded("village")).toBe(false);
	});

	it("waits the retry delay between attempts", async () => {
		const { registry, backend } = setup({
			maxAttempts: 2,
			retryDelay: "1 second",
		});
		backend.failLoad("village", new Error("network is down"));

		await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(registry.loadBundle("village"));
				yield* TestClock.adjust("1 second");
				return yield* Fiber.join(fiber);
			}).pipe(Effect.provide(TestClock.layer())),
		);

		expect(registry.isLoaded("village")).toBe(true);
		expect(callsOf(backend, "loadBundle")).toHaveLength(2);
	});

	it("fails with BundleLoadTimeout when an attempt runs out of time", async () => {
		const { registry, backend } = setup({ timeoutMs: 5000 });
		const release = backend.holdLoad("village");

		const failure = await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(
					Effect.flip(registry.loadBundle("village")),
				);
				yield* TestClock.adjust("5 seconds");
				return yield* Fiber.join(fiber);
			}).pipe(Effect.provide(TestClock.layer())),
		);

		release();

		expect(failure).toBeInstanceOf(BundleLoadTimeout);
		expect(failure).toMatchObject({
			_tag: "BundleLoadTimeout",
			widgetId: village,
			bundleId: "village",
			timeoutMs: 5000,
		});
		expect(registry.isLoaded("village")).toBe(false);
	});

	it("unloads a bundle", async () => {
		const { registry, backend } = setup();
		await Effect.runPromise(registry.loadBundle("village"));

		await Effect.runPromise(registry.unloadBundle("village"));

		expect(registry.isLoaded("village")).toBe(false);
		expect(callsOf(backend, "unloadBundle")).toEqual([["village"]]);
	});

	it("does not call the backend for a bundle that was never loaded", async () => {
		const { registry, backend } = setup();

		await Effect.runPromise(registry.unloadBundle("village"));

		expect(callsOf(backend, "unloadBundle")).toEqual([]);
	});

	it("waits for an in-flight load before unloading", async () => {
		const { registry, backend } = setup();
		const release = backend.holdLoad("village");

		const load = Effect.runPromise(registry.loadBundle("village"));
		await Promise.resolve();
		const unload = Effect.runPromise(registry.unloadBundle("village"));
		await Promise.resolve();

		expect(callsOf(backend, "unloadBundle")).toEqual([]);

		release();
		await load;
		await unload;

		expect(registry.isLoaded("village")).toBe(false);
		expect(backend.calls.map((call) => call.method)).toEqual([
			"loadBundle",
			"unloadBundle",
		]);
	});

	it("reports a backend unload failure and keeps the bundle loaded", async () => {
		const { registry, backend } = setup();
		await Effect.runPromise(registry.loadBundle("village"));
		backend.unloadFailures.set("village", new Error("disk is gone"));

		expect(await failureOf(registry.unloadBundle("village"))).toMatchObject({
			_tag: "BundleUnloadFailed",
			bundleId: "village",
			message: expect.stringContaining("disk is gone"),
		});
		expect(registry.isLoaded("village")).toBe(true);
	});

	it("returns the texture of a loaded bundle", async () => {
		const { registry, backend } = setup();
		const texture = stubTexture();
		backend.textures.set(avatar, texture);
		await Effect.runPromise(registry.init(manifest));
		await Effect.runPromise(registry.loadBundle("village"));

		expect(await Effect.runPromise(registry.getTexture(avatar))).toBe(texture);
	});

	it("resolves every alias of a multi-alias entry", async () => {
		const { registry, backend } = setup();
		const second = asAssetId("avatar/cat/2");
		backend.textures.set(second, stubTexture());
		await Effect.runPromise(registry.init(manifest));
		await Effect.runPromise(registry.loadBundle("village"));

		expect(await Effect.runPromise(registry.getTexture(second))).toBeDefined();
	});

	it("rejects an asset of a bundle that is not loaded", async () => {
		const { registry, backend } = setup();
		backend.textures.set(avatar, stubTexture());
		await Effect.runPromise(registry.init(manifest));

		expect(await failureOf(registry.getTexture(avatar))).toBeInstanceOf(
			AssetNotFound,
		);
	});

	it("rejects an asset after its bundle was unloaded", async () => {
		const { registry, backend } = setup();
		backend.textures.set(avatar, stubTexture());
		await Effect.runPromise(registry.init(manifest));
		await Effect.runPromise(registry.loadBundle("village"));
		await Effect.runPromise(registry.unloadBundle("village"));

		expect(await failureOf(registry.getTexture(avatar))).toBeInstanceOf(
			AssetNotFound,
		);
	});

	it("reports the widget and the asset of a miss", async () => {
		const { registry } = setup();
		await Effect.runPromise(registry.init(manifest));

		expect(await failureOf(registry.getTexture(avatar))).toMatchObject({
			_tag: "AssetNotFound",
			widgetId: village,
			assetId: avatar,
		});
	});

	it("rejects an asset missing from the manifest", async () => {
		const { registry, backend } = setup();
		const unknown = asAssetId("avatar/dog/0");
		backend.textures.set(unknown, stubTexture());
		await Effect.runPromise(registry.init(manifest));

		expect(await failureOf(registry.getTexture(unknown))).toBeInstanceOf(
			AssetNotFound,
		);
	});

	it("rejects an asset that the backend does not know", async () => {
		const { registry } = setup();
		await Effect.runPromise(registry.init(manifest));
		await Effect.runPromise(registry.loadBundle("village"));

		expect(await failureOf(registry.getTexture(avatar))).toBeInstanceOf(
			AssetNotFound,
		);
	});
});

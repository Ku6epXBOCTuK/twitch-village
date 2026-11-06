import {
	CoreApp,
	createEffectAdapter,
	createProductionRuntime,
	createSceneManager,
	createStatusStore,
	createTicker,
	loadAssetManifest,
	runFrame,
	statusesLayer,
} from "@tv/core";
import { MockEventSource } from "@tv/event-mock";
import {
	PIZDUDES_ASSET_BUNDLE,
	PIZDUDES_WIDGET_ID,
} from "@tv/widget-pizdudes/constants";
import { Effect } from "effect";
import pizdudesWorkerUrl from "../../../packages/widget-pizdudes/src/worker.ts?worker&url";
import { readOverlayConfig } from "./config";

const root = document.querySelector<HTMLDivElement>("#app");

async function main(): Promise<void> {
	if (root === null) return;

	const config = readOverlayConfig(window.location.search);
	const assetManifest = await loadAssetManifest("/manifest.json");
	const statuses = createStatusStore({});
	const runtime = createProductionRuntime({
		width: window.innerWidth,
		height: window.innerHeight,
		backgroundAlpha: 0,
		assetManifest,
		assetBaseUrl: "/",
		statuses,
	});
	const app = await runtime.runPromise(
		Effect.gen(function* () {
			return yield* CoreApp;
		}),
	);
	root.appendChild(app.canvas);

	const scene = await runtime.runPromise(createSceneManager());
	const adapter = createEffectAdapter({
		runtime,
		program: runFrame(scene).pipe(Effect.provide(statusesLayer(statuses))),
		onError: (cause) => console.error("render frame failed", cause),
	});
	const ticker = createTicker({ app, adapter });
	ticker.start();

	const source = new MockEventSource();
	source.subscribe((event) => scene.dispatch(event));
	const sourceConfig = { seed: config.seed, mode: config.mode };

	for (const widgetId of config.widgets) {
		if (widgetId !== PIZDUDES_WIDGET_ID) {
			console.warn(`unknown widget ${widgetId}`);
			continue;
		}
		await runtime.runPromise(
			scene.activate({
				id: PIZDUDES_WIDGET_ID,
				workerUrl: new URL(pizdudesWorkerUrl, import.meta.url),
				assetBundle: PIZDUDES_ASSET_BUNDLE,
				config: { debug: config.debug },
			}),
		);
	}

	source.start(sourceConfig);

	document.addEventListener("visibilitychange", () => {
		if (document.hidden) {
			scene.pause();
			source.stop();
			return;
		}
		scene.resume();
		source.start(sourceConfig);
	});

	window.addEventListener("beforeunload", () => {
		ticker.stop();
		source.stop();
		adapter.dispose();
		void runtime.dispose();
	});
}

void main().catch((cause: unknown) => {
	const message = cause instanceof Error ? cause.message : String(cause);
	if (root !== null) root.textContent = `overlay failed: ${message}`;
	console.error(cause);
});

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
	type WidgetDescriptor,
} from "@tv/core";
import { MockEventSource } from "@tv/event-mock";
import {
	PIZDUDES_ASSET_BUNDLE,
	PIZDUDES_WIDGET_ID,
} from "@tv/widget-pizdudes/constants";
import {
	SHOOTING_WORDS_ASSET_BUNDLE,
	SHOOTING_WORDS_WIDGET_ID,
} from "@tv/widget-shooting-words/constants";
import { Effect } from "effect";
import pizdudesWorkerUrl from "../../../packages/widget-pizdudes/src/worker.ts?worker&url";
import shootingWordsWorkerUrl from "../../../packages/widget-shooting-words/src/worker.ts?worker&url";
import { readOverlayConfig } from "./config";
import { createDebugPanel, type DebugPanel } from "./debug/panel";

const root = document.querySelector<HTMLDivElement>("#app");

async function main(): Promise<void> {
	if (root === null) return;

	if (!("obsstudio" in window)) {
		document.documentElement.classList.add("tv-preview");
	}

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
	app.renderer.background.alpha = 0;
	app.canvas.style.background = "transparent";
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
	let sourceConfig = { seed: config.seed, mode: config.mode };
	const descriptors = [
		{
			id: PIZDUDES_WIDGET_ID,
			workerUrl: new URL(pizdudesWorkerUrl, import.meta.url),
			assetBundle: PIZDUDES_ASSET_BUNDLE,
			config: { debug: config.debug },
		},
		{
			id: SHOOTING_WORDS_WIDGET_ID,
			workerUrl: new URL(shootingWordsWorkerUrl, import.meta.url),
			assetBundle: SHOOTING_WORDS_ASSET_BUNDLE,
			config: { debug: config.debug },
		},
	];
	const known = new Map(
		descriptors.map((descriptor) => [descriptor.id, descriptor] as const),
	);
	const active: WidgetDescriptor[] = [];
	for (const widgetId of config.widgets) {
		const descriptor = known.get(widgetId);
		if (descriptor === undefined) {
			console.warn(`unknown widget ${widgetId}`);
			continue;
		}
		await runtime.runPromise(scene.activate(descriptor));
		active.push(descriptor);
	}

	source.start(sourceConfig);

	let panel: DebugPanel | undefined;
	if (config.debug) {
		panel = createDebugPanel({
			statuses,
			widgets: config.widgets,
			source,
			seed: config.seed,
			onSeedChange: (seed) => {
				sourceConfig = { ...sourceConfig, seed };
				source.stop();
				source.start(sourceConfig);
			},
			onClear: () => {
				for (const descriptor of active) {
					void runtime
						.runPromise(scene.activate(descriptor, { restart: true }))
						.catch((cause: unknown) => console.error("restart failed", cause));
				}
			},
		});
	}

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
		panel?.dispose();
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

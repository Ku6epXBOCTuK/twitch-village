import type { MockMode } from "@tv/event-mock";
import type { WidgetId } from "@tv/protocol";

export interface OverlayConfig {
	readonly widgets: readonly WidgetId[];
	readonly debug: boolean;
	readonly seed: number;
	readonly mode: MockMode;
}

const DEFAULT_WIDGET = "pizdudes";

export function readOverlayConfig(search: string): OverlayConfig {
	const params = new URLSearchParams(search);
	const widgets = (params.get("widgets") ?? DEFAULT_WIDGET)
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.map((value) => value as WidgetId);
	const seed = Number.parseInt(params.get("seed") ?? "42", 10);
	return {
		widgets: widgets.length > 0 ? widgets : [DEFAULT_WIDGET as WidgetId],
		debug: params.get("debug") === "1",
		seed: Number.isFinite(seed) ? seed : 42,
		mode: params.get("mode") === "manual" ? "manual" : "auto",
	};
}

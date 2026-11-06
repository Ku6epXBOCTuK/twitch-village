import type { ViewerEvent, ViewerId } from "@tv/protocol";
import { mulberry32, type Random } from "./prng";

export type MockMode = "manual" | "auto";

export interface MockEventConfig {
	readonly seed?: number;
	readonly mode?: MockMode;
	readonly minIntervalMs?: number;
	readonly maxIntervalMs?: number;
}

export interface ViewerEventSource {
	subscribe(handler: (event: ViewerEvent) => void): () => void;
	start(config?: MockEventConfig): void;
	stop(): void;
	emit(event: ViewerEvent): void;
}

interface MockViewer {
	readonly id: ViewerId;
	readonly displayName: string;
	readonly color: string;
}

const DEFAULT_SEED = 42;
const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEFAULT_MAX_INTERVAL_MS = 3000;

const NAMES = [
	"Mira",
	"Kai",
	"Nox",
	"Lumen",
	"Vesper",
	"Orin",
	"Sable",
	"Yuki",
] as const;

const COLORS = [
	"#f87171",
	"#fb923c",
	"#facc15",
	"#4ade80",
	"#22d3ee",
	"#60a5fa",
	"#a78bfa",
	"#f472b6",
] as const;

const MESSAGES = [
	"hello village",
	"what a stream",
	"nice",
	"!dance",
	"!pet",
	"good luck",
] as const;

const GIFT_KINDS = ["bits", "sub", "giftSub"] as const;

const pick = <T>(random: Random, items: readonly [T, ...T[]]): T => {
	const index = Math.floor(random() * items.length);
	return items[index] ?? items[0];
};

const randomInt = (random: Random, min: number, max: number): number =>
	min + Math.floor(random() * (max - min + 1));

export class MockEventSource implements ViewerEventSource {
	private readonly handlers = new Set<(event: ViewerEvent) => void>();
	private readonly viewers = new Map<ViewerId, MockViewer>();
	private random: Random = mulberry32(DEFAULT_SEED);
	private seed = DEFAULT_SEED;
	private mode: MockMode = "auto";
	private minIntervalMs = DEFAULT_MIN_INTERVAL_MS;
	private maxIntervalMs = DEFAULT_MAX_INTERVAL_MS;
	private viewerSerial = 0;
	private running = false;
	private timer: ReturnType<typeof setTimeout> | undefined;

	subscribe(handler: (event: ViewerEvent) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	start(config: MockEventConfig = {}): void {
		this.stop();
		this.seed = config.seed ?? DEFAULT_SEED;
		this.mode = config.mode ?? "auto";
		this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
		this.maxIntervalMs = config.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
		if (this.maxIntervalMs < this.minIntervalMs) {
			this.maxIntervalMs = this.minIntervalMs;
		}
		this.random = mulberry32(this.seed);
		this.viewers.clear();
		this.viewerSerial = 0;
		this.running = true;
		if (this.mode === "auto") {
			this.scheduleNext();
		}
	}

	stop(): void {
		this.running = false;
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	emit(event: ViewerEvent): void {
		if (!this.running) return;
		this.apply(event);
		this.notify(event);
	}

	private scheduleNext(): void {
		if (!this.running || this.mode !== "auto") return;
		const delay = randomInt(
			this.random,
			this.minIntervalMs,
			this.maxIntervalMs,
		);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (!this.running) return;
			this.emit(this.generate());
			this.scheduleNext();
		}, delay);
	}

	private generate(): ViewerEvent {
		const viewers = [...this.viewers.values()];
		const first = viewers[0];

		if (first === undefined) {
			return this.joined();
		}

		const roll = this.random();
		if (roll < 0.4) {
			return this.joined();
		}

		const viewer =
			viewers[randomInt(this.random, 0, viewers.length - 1)] ?? first;

		if (roll < 0.75) {
			const text = pick(this.random, MESSAGES);
			return {
				_tag: "ViewerMessage",
				viewerId: viewer.id,
				text,
				isCommand: text.startsWith("!"),
			};
		}

		if (roll < 0.95) {
			return {
				_tag: "ViewerGift",
				viewerId: viewer.id,
				amount: randomInt(this.random, 1, 500),
				kind: pick(this.random, GIFT_KINDS),
			};
		}

		return { _tag: "ViewerLeft", viewerId: viewer.id };
	}

	private joined(): ViewerEvent {
		this.viewerSerial += 1;
		const viewerId = `viewer-${this.viewerSerial}` as ViewerId;
		return {
			_tag: "ViewerJoined",
			viewerId,
			displayName: pick(this.random, NAMES),
			color: pick(this.random, COLORS),
		};
	}

	private apply(event: ViewerEvent): void {
		switch (event._tag) {
			case "ViewerJoined":
				this.viewers.set(event.viewerId, {
					id: event.viewerId,
					displayName: event.displayName,
					color: event.color ?? "#60a5fa",
				});
				break;
			case "ViewerLeft":
				this.viewers.delete(event.viewerId);
				break;
			case "ViewerMessage":
			case "ViewerGift":
				break;
		}
	}

	private notify(event: ViewerEvent): void {
		for (const handler of [...this.handlers]) {
			handler(event);
		}
	}
}

import type { ViewerEventSource } from "@tv/event-mock";
import type { StatusStore, WidgetStatus } from "@tv/core";
import type { ViewerId, WidgetId } from "@tv/protocol";
import "./panel.css";

export interface DebugPanelOptions {
	readonly statuses: StatusStore;
	readonly widgets: readonly WidgetId[];
	readonly source: ViewerEventSource;
	readonly seed: number;
	readonly onSeedChange: (seed: number) => void;
	readonly onClear: () => void;
}

export interface DebugPanel {
	dispose(): void;
}

interface DebugViewer {
	readonly id: ViewerId;
	readonly login: string;
	readonly name: string;
	readonly color: string;
}

const COLORS = ["#60a5fa", "#f472b6", "#facc15", "#34d399", "#fb923c"];

const stateLabel = (status: WidgetStatus): string => {
	const counters = status.counters;
	const parts = [
		`hb ${counters.heartbeat}`,
		`drop ${counters.dropped}`,
		`skip ${counters.skipped}`,
	];
	if (status.lastError !== null) parts.push(status.lastError.tag);
	return parts.join(" · ");
};

export function createDebugPanel(options: DebugPanelOptions): DebugPanel {
	let serial = 0;
	let seed = options.seed;
	const viewers: DebugViewer[] = [];

	const host = document.createElement("aside");
	host.className = "tv-debug";
	host.innerHTML = `
		<header class="tv-debug__header">
			<strong>twitch-village</strong>
			<button type="button" data-action="toggle" aria-label="Свернуть панель">−</button>
		</header>
		<div class="tv-debug__body">
			<section>
				<h2>Виджеты</h2>
				<div class="tv-debug__widgets" data-role="widgets"></div>
			</section>
			<section>
				<h2>События</h2>
				<div class="tv-debug__row">
					<button type="button" data-action="spawn">Вход</button>
					<button type="button" data-action="message">Сообщение</button>
					<button type="button" data-action="gift">Подарок</button>
					<button type="button" data-action="leave">Выход</button>
				</div>
				<div class="tv-debug__row">
					<label>seed <input type="number" data-role="seed" value="${seed}" /></label>
					<button type="button" data-action="clear">Очистить</button>
				</div>
			</section>
		</div>
	`;

	const widgetsRoot = host.querySelector<HTMLElement>('[data-role="widgets"]');
	const seedInput = host.querySelector<HTMLInputElement>('[data-role="seed"]');
	const toggle = host.querySelector<HTMLButtonElement>(
		'[data-action="toggle"]',
	);

	const nextViewer = (): DebugViewer => {
		serial += 1;
		const viewer: DebugViewer = {
			id: `debug-${serial}` as ViewerId,
			login: `debug_${serial}`,
			name: `Зритель ${serial}`,
			color: COLORS[(serial - 1) % COLORS.length] ?? "#60a5fa",
		};
		viewers.push(viewer);
		return viewer;
	};

	const lastViewer = (): DebugViewer =>
		viewers[viewers.length - 1] ?? nextViewer();

	const spawn = (): void => {
		const viewer = nextViewer();
		options.source.emit({
			_tag: "ViewerJoined",
			viewerId: viewer.id,
			displayName: viewer.name,
			color: viewer.color,
		});
	};

	const message = (): void => {
		const viewer = lastViewer();
		options.source.emit({
			_tag: "ViewerMessage",
			viewerId: viewer.id,
			login: viewer.login,
			text: `сообщение ${serial}`,
			isCommand: false,
			isMod: false,
		});
	};

	const gift = (): void => {
		const viewer = lastViewer();
		options.source.emit({
			_tag: "ViewerGift",
			viewerId: viewer.id,
			amount: 100,
			kind: "bits",
		});
	};

	const leave = (): void => {
		const viewer = viewers.pop();
		if (viewer === undefined) return;
		options.source.emit({ _tag: "ViewerLeft", viewerId: viewer.id });
	};

	const render = (): void => {
		if (widgetsRoot === null) return;
		widgetsRoot.replaceChildren();
		for (const widgetId of options.widgets) {
			const status = options.statuses.get(widgetId);
			if (status === undefined) continue;
			const card = document.createElement("article");
			card.className = `tv-debug__card tv-debug__card--${status.state}`;
			const title = document.createElement("strong");
			title.textContent = `${widgetId} · ${status.state}`;
			const details = document.createElement("span");
			details.textContent = stateLabel(status);
			card.append(title, details);
			if (status.lastError !== null) {
				const error = document.createElement("span");
				error.className = "tv-debug__error";
				error.textContent = status.lastError.message;
				card.append(error);
			}
			widgetsRoot.append(card);
		}
		if (widgetsRoot.childElementCount === 0) {
			const empty = document.createElement("span");
			empty.textContent = "нет активных виджетов";
			widgetsRoot.append(empty);
		}
	};

	const onClick = (event: Event): void => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const action = target.dataset.action;
		switch (action) {
			case "toggle":
				host.classList.toggle("tv-debug--collapsed");
				if (toggle !== null) {
					toggle.textContent = host.classList.contains("tv-debug--collapsed")
						? "+"
						: "−";
				}
				break;
			case "spawn":
				spawn();
				break;
			case "message":
				message();
				break;
			case "gift":
				gift();
				break;
			case "leave":
				leave();
				break;
			case "clear":
				viewers.length = 0;
				options.onClear();
				break;
		}
	};

	const onSeed = (): void => {
		if (seedInput === null) return;
		const next = Number.parseInt(seedInput.value, 10);
		if (!Number.isFinite(next)) return;
		seed = next;
		options.onSeedChange(seed);
	};

	host.addEventListener("click", onClick);
	seedInput?.addEventListener("change", onSeed);
	const unsubscribe = options.statuses.subscribe(render);
	document.body.append(host);
	render();

	return {
		dispose: () => {
			unsubscribe();
			host.removeEventListener("click", onClick);
			seedInput?.removeEventListener("change", onSeed);
			host.remove();
		},
	};
}

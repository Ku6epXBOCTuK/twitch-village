import {
	type CoreToWidget,
	type LeafCommand,
	type NodeId,
	PROTOCOL_VERSION,
	type Transport,
	type ViewerId,
	type WidgetEvent,
	type WidgetToCore,
} from "@tv/protocol";
import {
	SHIP_SCALE,
	WORD_FONT_SIZE,
	WORD_TTL_MS,
	addShip,
	createWorld,
	getShip,
	removeShip,
	resizeWorld,
	shoot,
	stepWorld,
	type Ship,
	type Word,
	type World,
} from "./world";
import { shipCellSize, shipFrames } from "./assets";

const MAX_BATCH = 2048;

const sceneId = "sw-scene" as NodeId;
const shipNode = (id: number): NodeId => `sw-ship-${id}` as NodeId;
const shipSpriteNode = (id: number): NodeId => `sw-ship-${id}-sprite` as NodeId;
const shipLabelNode = (id: number): NodeId => `sw-ship-${id}-label` as NodeId;
const shipLabelPlateNode = (id: number): NodeId =>
	`sw-ship-${id}-label-plate` as NodeId;
const shipHpBgNode = (id: number): NodeId => `sw-ship-${id}-hp-bg` as NodeId;
const shipHpNode = (id: number): NodeId => `sw-ship-${id}-hp` as NodeId;
const wordNode = (id: number): NodeId => `sw-word-${id}` as NodeId;
const wordPlateNode = (id: number): NodeId => `sw-word-${id}-plate` as NodeId;
const wordTextNode = (id: number): NodeId => `sw-word-${id}-text` as NodeId;
const wordBarBgNode = (id: number): NodeId => `sw-word-${id}-bar-bg` as NodeId;
const wordBarNode = (id: number): NodeId => `sw-word-${id}-bar` as NodeId;
const bulletNode = (id: number): NodeId => `sw-bullet-${id}` as NodeId;
const shotNode = (id: number): NodeId => `sw-shot-${id}` as NodeId;

export interface ShootingWordsOptions {
	readonly tickMs?: number;
	readonly heartbeatMs?: number;
	readonly seed?: number;
}

export interface ShootingWordsWidget {
	handle(message: WidgetEvent): void;
	tick(dtMs: number): void;
	dispose(): void;
	readonly world: World | null;
}

const shipWidth = (ship: Ship): number =>
	shipCellSize(ship.skin).width * SHIP_SCALE;
const shipHeight = (ship: Ship): number =>
	shipCellSize(ship.skin).height * SHIP_SCALE;

const wordWidth = (text: string): number => Math.max(60, text.length * 16);

const createScene = (): LeafCommand[] => [
	{ _tag: "CreateNode", nodeId: sceneId, kind: "container" },
];

const createShipCommands = (ship: Ship, order: number): LeafCommand[] => {
	const cell = shipCellSize(ship.skin);
	const labelWidth = Math.max(64, ship.name.length * 7 + 16);
	const barWidth = Math.max(24, shipWidth(ship));
	const hpWidth = Math.max(1, (ship.hp / ship.maxHp) * barWidth);
	return [
		{ _tag: "CreateNode", nodeId: shipNode(ship.id), kind: "container" },
		{ _tag: "SetParent", nodeId: shipNode(ship.id), parentId: sceneId, order },
		{ _tag: "SetTransform", nodeId: shipNode(ship.id), x: ship.x, y: ship.y },
		{ _tag: "CreateNode", nodeId: shipSpriteNode(ship.id), kind: "sprite" },
		{
			_tag: "SetParent",
			nodeId: shipSpriteNode(ship.id),
			parentId: shipNode(ship.id),
			order: 0,
		},
		{
			_tag: "SetAnimation",
			nodeId: shipSpriteNode(ship.id),
			assetIds: shipFrames(ship.skin),
			fps: 8,
			loop: true,
		},
		{
			_tag: "SetTransform",
			nodeId: shipSpriteNode(ship.id),
			x: (-cell.width * SHIP_SCALE) / 2,
			y: (-cell.height * SHIP_SCALE) / 2,
			scaleX: SHIP_SCALE,
			scaleY: SHIP_SCALE,
		},
		{
			_tag: "CreateNode",
			nodeId: shipLabelPlateNode(ship.id),
			kind: "rect",
		},
		{
			_tag: "SetParent",
			nodeId: shipLabelPlateNode(ship.id),
			parentId: shipNode(ship.id),
			order: 1,
		},
		{
			_tag: "SetTransform",
			nodeId: shipLabelPlateNode(ship.id),
			x: -labelWidth / 2,
			y: -shipHeight(ship) / 2 - 26,
		},
		{
			_tag: "SetRectStyle",
			nodeId: shipLabelPlateNode(ship.id),
			width: labelWidth,
			height: 20,
			radius: 6,
			fill: "#111827",
			alpha: 0.8,
		},
		{ _tag: "CreateNode", nodeId: shipLabelNode(ship.id), kind: "text" },
		{
			_tag: "SetParent",
			nodeId: shipLabelNode(ship.id),
			parentId: shipNode(ship.id),
			order: 2,
		},
		{
			_tag: "SetTransform",
			nodeId: shipLabelNode(ship.id),
			x: -labelWidth / 2 + 4,
			y: -shipHeight(ship) / 2 - 23,
		},
		{
			_tag: "SetText",
			nodeId: shipLabelNode(ship.id),
			text: ship.name,
			style: { fontSize: 12, fill: "#e5e7eb", align: "left" },
		},
		{ _tag: "CreateNode", nodeId: shipHpBgNode(ship.id), kind: "rect" },
		{
			_tag: "SetParent",
			nodeId: shipHpBgNode(ship.id),
			parentId: shipNode(ship.id),
			order: 3,
		},
		{
			_tag: "SetTransform",
			nodeId: shipHpBgNode(ship.id),
			x: -barWidth / 2,
			y: shipHeight(ship) / 2 + 6,
		},
		{
			_tag: "SetRectStyle",
			nodeId: shipHpBgNode(ship.id),
			width: barWidth,
			height: 5,
			radius: 2,
			fill: "#1f2937",
		},
		{ _tag: "CreateNode", nodeId: shipHpNode(ship.id), kind: "rect" },
		{
			_tag: "SetParent",
			nodeId: shipHpNode(ship.id),
			parentId: shipNode(ship.id),
			order: 4,
		},
		{
			_tag: "SetTransform",
			nodeId: shipHpNode(ship.id),
			x: -barWidth / 2,
			y: shipHeight(ship) / 2 + 6,
		},
		{
			_tag: "SetRectStyle",
			nodeId: shipHpNode(ship.id),
			width: hpWidth,
			height: 5,
			radius: 2,
			fill: "#22c55e",
		},
	];
};

const createWordCommands = (word: Word, order: number): LeafCommand[] => {
	const width = wordWidth(word.text);
	const height = 38;
	const barWidth = width - 12;
	return [
		{ _tag: "CreateNode", nodeId: wordNode(word.id), kind: "container" },
		{
			_tag: "SetParent",
			nodeId: wordNode(word.id),
			parentId: sceneId,
			order: 100 + order,
		},
		{
			_tag: "SetTransform",
			nodeId: wordNode(word.id),
			x: word.x,
			y: word.y,
			scaleX: word.scale,
			scaleY: word.scale,
		},
		{ _tag: "CreateNode", nodeId: wordPlateNode(word.id), kind: "rect" },
		{
			_tag: "SetParent",
			nodeId: wordPlateNode(word.id),
			parentId: wordNode(word.id),
			order: 0,
		},
		{
			_tag: "SetTransform",
			nodeId: wordPlateNode(word.id),
			x: -width / 2,
			y: -height / 2,
		},
		{
			_tag: "SetRectStyle",
			nodeId: wordPlateNode(word.id),
			width,
			height,
			radius: 8,
			fill: "#111827",
			alpha: 0.85,
		},
		{ _tag: "CreateNode", nodeId: wordTextNode(word.id), kind: "text" },
		{
			_tag: "SetParent",
			nodeId: wordTextNode(word.id),
			parentId: wordNode(word.id),
			order: 1,
		},
		{
			_tag: "SetTransform",
			nodeId: wordTextNode(word.id),
			x: -width / 2 + 6,
			y: -WORD_FONT_SIZE / 2 - 2,
		},
		{
			_tag: "SetText",
			nodeId: wordTextNode(word.id),
			text: word.text,
			style: { fontSize: WORD_FONT_SIZE, fill: "#ffffff", align: "center" },
		},
		{ _tag: "CreateNode", nodeId: wordBarBgNode(word.id), kind: "rect" },
		{
			_tag: "SetParent",
			nodeId: wordBarBgNode(word.id),
			parentId: wordNode(word.id),
			order: 2,
		},
		{
			_tag: "SetTransform",
			nodeId: wordBarBgNode(word.id),
			x: -barWidth / 2,
			y: height / 2 - 5,
		},
		{
			_tag: "SetRectStyle",
			nodeId: wordBarBgNode(word.id),
			width: barWidth,
			height: 3,
			radius: 2,
			fill: "#374151",
		},
		{ _tag: "CreateNode", nodeId: wordBarNode(word.id), kind: "rect" },
		{
			_tag: "SetParent",
			nodeId: wordBarNode(word.id),
			parentId: wordNode(word.id),
			order: 3,
		},
		{
			_tag: "SetTransform",
			nodeId: wordBarNode(word.id),
			x: -barWidth / 2,
			y: height / 2 - 5,
		},
		{
			_tag: "SetRectStyle",
			nodeId: wordBarNode(word.id),
			width: barWidth,
			height: 3,
			radius: 2,
			fill: "#22c55e",
		},
	];
};

const createBulletCommands = (
	bulletId: number,
	x: number,
	y: number,
): LeafCommand[] => [
	{ _tag: "CreateNode", nodeId: bulletNode(bulletId), kind: "rect" },
	{
		_tag: "SetParent",
		nodeId: bulletNode(bulletId),
		parentId: sceneId,
		order: 200,
	},
	{ _tag: "SetTransform", nodeId: bulletNode(bulletId), x, y },
	{
		_tag: "SetRectStyle",
		nodeId: bulletNode(bulletId),
		width: 8,
		height: 8,
		radius: 4,
		fill: "#fde047",
	},
];

const createShotCommands = (
	shotId: number,
	x: number,
	y: number,
): LeafCommand[] => [
	{ _tag: "CreateNode", nodeId: shotNode(shotId), kind: "rect" },
	{
		_tag: "SetParent",
		nodeId: shotNode(shotId),
		parentId: sceneId,
		order: 200,
	},
	{ _tag: "SetTransform", nodeId: shotNode(shotId), x, y },
	{
		_tag: "SetRectStyle",
		nodeId: shotNode(shotId),
		width: 9,
		height: 9,
		radius: 4,
		fill: "#ef4444",
	},
];

export function createShootingWordsWidget(
	transport: Transport<WidgetToCore, CoreToWidget>,
	options: ShootingWordsOptions = {},
): ShootingWordsWidget {
	const tickMs = options.tickMs ?? 33;
	const heartbeatMs = options.heartbeatMs ?? 500;
	const seed = options.seed ?? 42;
	let world: World | null = null;
	let initialized = false;
	let paused = false;
	let disposed = false;
	let heartbeat = 0;
	let tickTimer: ReturnType<typeof setInterval> | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	const armedWords = new Set<number>();
	const barBuckets = new Map<number, number>();
	const unsubscribe = transport.subscribe((envelope) => {
		if (envelope.protocolVersion !== PROTOCOL_VERSION) return;
		handle(envelope.message);
	});

	const send = (message: WidgetToCore["message"]): void => {
		if (disposed) return;
		transport.send({ protocolVersion: PROTOCOL_VERSION, message });
	};

	const sendCommands = (commands: readonly LeafCommand[]): void => {
		for (let index = 0; index < commands.length; index += MAX_BATCH) {
			send({
				_tag: "Batch",
				commands: commands.slice(index, index + MAX_BATCH),
			});
		}
	};

	const stopTimers = (): void => {
		if (tickTimer !== undefined) {
			clearInterval(tickTimer);
			tickTimer = undefined;
		}
		if (heartbeatTimer !== undefined) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}
	};

	const startTimers = (): void => {
		stopTimers();
		if (tickMs > 0) {
			tickTimer = setInterval(() => {
				tick(tickMs);
			}, tickMs);
		}
		if (heartbeatMs > 0) {
			heartbeatTimer = setInterval(() => {
				heartbeat += 1;
				send({ _tag: "Heartbeat", tick: heartbeat });
			}, heartbeatMs);
		}
	};

	const sceneCommands = (): LeafCommand[] => {
		if (world === null) return [];
		const commands = createScene();
		for (const ship of world.ships.values()) {
			commands.push(...createShipCommands(ship, ship.id));
		}
		return commands;
	};

	const createWord = (wordId: number): void => {
		if (world === null) return;
		const word = world.words.get(wordId);
		if (word === undefined) return;
		barBuckets.set(wordId, Math.floor(word.age / 500));
		sendCommands(createWordCommands(word, wordId));
	};

	const removeWord = (wordId: number): void => {
		armedWords.delete(wordId);
		barBuckets.delete(wordId);
		sendCommands([{ _tag: "RemoveNode", nodeId: wordNode(wordId) }]);
	};

	const removeShipNode = (shipId: number): void => {
		sendCommands([{ _tag: "RemoveNode", nodeId: shipNode(shipId) }]);
	};

	const updateShip = (ship: Ship): void => {
		sendCommands([
			{ _tag: "SetTransform", nodeId: shipNode(ship.id), x: ship.x, y: ship.y },
		]);
	};

	const updateHp = (ship: Ship): void => {
		const barWidth = Math.max(24, shipWidth(ship));
		sendCommands([
			{
				_tag: "SetRectStyle",
				nodeId: shipHpNode(ship.id),
				width: Math.max(1, (ship.hp / ship.maxHp) * barWidth),
				height: 5,
				radius: 2,
				fill: ship.hp <= 3 ? "#ef4444" : "#22c55e",
			},
		]);
	};

	const ensureShip = (
		viewerId: ViewerId,
		name: string,
		login: string,
	): Ship | undefined => {
		if (world === null) return undefined;
		const existing = getShip(world, viewerId);
		if (existing !== undefined) return existing;
		const ship = addShip(world, viewerId, name, login);
		sendCommands(createShipCommands(ship, ship.id));
		return ship;
	};

	const updateWord = (wordId: number): void => {
		if (world === null) return;
		const word = world.words.get(wordId);
		if (word === undefined) return;
		sendCommands([
			{
				_tag: "SetTransform",
				nodeId: wordNode(wordId),
				x: word.x,
				y: word.y,
				scaleX: word.scale,
				scaleY: word.scale,
			},
		]);
		if (word.armed && !armedWords.has(wordId)) {
			armedWords.add(wordId);
			sendCommands([
				{ _tag: "SetTint", nodeId: wordTextNode(wordId), tint: "#ef4444" },
			]);
		}
	};

	const updateBars = (): void => {
		if (world === null) return;
		for (const word of world.words.values()) {
			if (!word.landed || word.dead) continue;
			const bucket = Math.floor(word.age / 500);
			if (barBuckets.get(word.id) === bucket) continue;
			barBuckets.set(word.id, bucket);
			const ratio = Math.max(0, 1 - word.age / (WORD_TTL_MS + 1000));
			const width = Math.max(1, (wordWidth(word.text) - 12) * ratio);
			sendCommands([
				{
					_tag: "SetRectStyle",
					nodeId: wordBarNode(word.id),
					width,
					height: 3,
					radius: 2,
					fill: ratio > 0.5 ? "#22c55e" : ratio > 0.2 ? "#eab308" : "#ef4444",
				},
			]);
		}
	};

	function tick(dtMs: number): void {
		if (!initialized || paused || disposed || world === null) return;
		const result = stepWorld(world, dtMs);
		for (const word of result.spawnedWords) createWord(word.id);
		for (const ship of result.movedShips) updateShip(ship);
		for (const word of result.changedWords) updateWord(word.id);
		for (const bullet of result.spawnedBullets) {
			sendCommands(createBulletCommands(bullet.id, bullet.x, bullet.y));
		}
		for (const bullet of result.movedBullets) {
			sendCommands([
				{
					_tag: "SetTransform",
					nodeId: bulletNode(bullet.id),
					x: bullet.x,
					y: bullet.y,
				},
			]);
		}
		for (const shot of result.spawnedShots) {
			sendCommands(createShotCommands(shot.id, shot.x, shot.y));
		}
		for (const shot of result.movedShots) {
			sendCommands([
				{
					_tag: "SetTransform",
					nodeId: shotNode(shot.id),
					x: shot.x,
					y: shot.y,
				},
			]);
		}
		for (const id of result.removedWords) removeWord(id);
		for (const id of result.removedBullets) {
			sendCommands([{ _tag: "RemoveNode", nodeId: bulletNode(id) }]);
		}
		for (const id of result.removedShots) {
			sendCommands([{ _tag: "RemoveNode", nodeId: shotNode(id) }]);
		}
		for (const ship of result.damagedShips) updateHp(ship);
		for (const ship of result.killedShips) removeShipNode(ship.id);
		updateBars();
	}

	const handleViewerEvent = (
		event: WidgetEvent & { _tag: "ViewerEvent" },
	): void => {
		if (world === null) return;
		switch (event.event._tag) {
			case "ViewerJoined":
				ensureShip(
					event.event.viewerId,
					event.event.displayName,
					event.event.viewerId,
				);
				break;
			case "ViewerMessage": {
				const ship = ensureShip(
					event.event.viewerId,
					event.event.viewerId,
					event.event.login,
				);
				if (ship === undefined) break;
				const bullets = shoot(world, event.event.viewerId, event.event.text);
				for (const bullet of bullets) {
					sendCommands(createBulletCommands(bullet.id, bullet.x, bullet.y));
				}
				break;
			}
			case "ViewerGift":
				ensureShip(
					event.event.viewerId,
					event.event.viewerId,
					event.event.viewerId as string,
				);
				break;
			case "ViewerLeft": {
				const ship = getShip(world, event.event.viewerId);
				if (ship !== undefined) {
					removeShip(world, event.event.viewerId);
					removeShipNode(ship.id);
				}
				break;
			}
		}
	};

	function handle(message: WidgetEvent): void {
		if (disposed) return;
		switch (message._tag) {
			case "Init":
				world = createWorld(message.viewport.w, message.viewport.h, seed);
				initialized = true;
				paused = false;
				send({
					_tag: "Ready",
					widgetId: message.widgetId,
					protocolVersion: PROTOCOL_VERSION,
				});
				sendCommands(sceneCommands());
				startTimers();
				break;
			case "ViewerEvent":
				handleViewerEvent(message);
				break;
			case "Viewport":
				if (world === null) break;
				resizeWorld(world, message.w, message.h);
				for (const ship of world.ships.values()) updateShip(ship);
				break;
			case "Pause":
				paused = true;
				break;
			case "Resume":
				paused = false;
				break;
			case "Dispose":
				dispose();
				break;
		}
	}

	function dispose(): void {
		if (disposed) return;
		stopTimers();
		if (initialized) {
			sendCommands([{ _tag: "RemoveNode", nodeId: sceneId }]);
		}
		disposed = true;
		unsubscribe();
		transport.dispose();
	}

	return {
		handle,
		tick,
		dispose,
		get world() {
			return world;
		},
	};
}

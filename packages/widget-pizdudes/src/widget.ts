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
	COOK_FPS,
	cookFrame,
	cookFrames,
	FLOOR_ASSET,
	stationAsset,
} from "./assets";
import {
	COOK_CELL,
	COOK_HALF_SIZE,
	FLOOR_SOURCE_SIZE,
	type StationLayout,
} from "./field";
import {
	applyViewerEvent,
	type Cook,
	createWorld,
	resizeWorld,
	stepWorld,
	type World,
} from "./world";

const SCENE_NODE = "scene" as NodeId;
const FLOOR_NODE = "floor" as NodeId;
const MAX_BATCH = 2048;
const DEFAULT_TICK_MS = 33;
const DEFAULT_HEARTBEAT_MS = 500;
const COOK_ORDER = 20;

export interface PizdudesWidgetOptions {
	readonly tickMs?: number;
	readonly heartbeatMs?: number;
	readonly seed?: number;
}

export interface PizdudesWidget {
	handle(message: WidgetEvent): void;
	tick(dtMs: number): void;
	dispose(): void;
	readonly world: World | null;
}

const cookNode = (id: ViewerId): NodeId => `cook:${id}` as NodeId;
const cookSpriteNode = (id: ViewerId): NodeId => `cook:${id}:sprite` as NodeId;
const cookBadgeNode = (id: ViewerId): NodeId => `cook:${id}:badge` as NodeId;
const cookBadgeTextNode = (id: ViewerId): NodeId =>
	`cook:${id}:badge-text` as NodeId;
const stationNode = (index: number): NodeId => `station:${index}` as NodeId;

const badgeWidth = (cook: Cook): number =>
	Math.max(72, Math.min(220, cook.name.length * 7 + 16));

const animationCommand = (cook: Cook): LeafCommand => {
	const frame = cook.moving
		? cookFrames(cook.direction)
		: [cookFrame(cook.direction, 0)];
	return {
		_tag: "SetAnimation",
		nodeId: cookSpriteNode(cook.id),
		assetIds: frame,
		fps: cook.moving ? COOK_FPS : 0.1,
		loop: cook.moving,
	};
};

const cookCommands = (cook: Cook): LeafCommand[] => {
	const width = badgeWidth(cook);
	return [
		{ _tag: "CreateNode", nodeId: cookNode(cook.id), kind: "container" },
		{ _tag: "CreateNode", nodeId: cookSpriteNode(cook.id), kind: "sprite" },
		{
			_tag: "SetParent",
			nodeId: cookSpriteNode(cook.id),
			parentId: cookNode(cook.id),
			order: 0,
		},
		{
			_tag: "SetSprite",
			nodeId: cookSpriteNode(cook.id),
			assetId: cookFrame("south", 0),
		},
		{
			_tag: "SetTransform",
			nodeId: cookSpriteNode(cook.id),
			x: -COOK_CELL / 2,
			y: -COOK_CELL / 2,
		},
		animationCommand(cook),
		{ _tag: "CreateNode", nodeId: cookBadgeNode(cook.id), kind: "rect" },
		{
			_tag: "SetParent",
			nodeId: cookBadgeNode(cook.id),
			parentId: cookNode(cook.id),
			order: 1,
		},
		{
			_tag: "SetRectStyle",
			nodeId: cookBadgeNode(cook.id),
			width,
			height: 18,
			radius: 9,
			fill: "#0f172a",
			alpha: 0.72,
		},
		{
			_tag: "SetTransform",
			nodeId: cookBadgeNode(cook.id),
			x: -width / 2,
			y: -COOK_HALF_SIZE - 24,
		},
		{ _tag: "CreateNode", nodeId: cookBadgeTextNode(cook.id), kind: "text" },
		{
			_tag: "SetParent",
			nodeId: cookBadgeTextNode(cook.id),
			parentId: cookNode(cook.id),
			order: 2,
		},
		{
			_tag: "SetText",
			nodeId: cookBadgeTextNode(cook.id),
			text: cook.name,
			style: { fontSize: 12, fill: cook.color, align: "center" },
		},
		{
			_tag: "SetTransform",
			nodeId: cookBadgeTextNode(cook.id),
			x: -width / 2 + 8,
			y: -COOK_HALF_SIZE - 23,
		},
	];
};

const stationCommands = (stations: readonly StationLayout[]): LeafCommand[] => {
	const commands: LeafCommand[] = [];
	stations.forEach((station, index) => {
		const node = stationNode(index);
		commands.push(
			{ _tag: "CreateNode", nodeId: node, kind: "sprite" },
			{
				_tag: "SetParent",
				nodeId: node,
				parentId: SCENE_NODE,
				order: index + 1,
			},
			{ _tag: "SetSprite", nodeId: node, assetId: stationAsset(station.name) },
			{
				_tag: "SetTransform",
				nodeId: node,
				x: station.center.x - 64,
				y: station.center.y - 64,
			},
		);
	});
	return commands;
};

const initialScene = (
	width: number,
	height: number,
	stations: readonly StationLayout[],
): LeafCommand[] => [
	{ _tag: "CreateNode", nodeId: SCENE_NODE, kind: "container" },
	{ _tag: "CreateNode", nodeId: FLOOR_NODE, kind: "sprite" },
	{ _tag: "SetParent", nodeId: FLOOR_NODE, parentId: SCENE_NODE, order: 0 },
	{ _tag: "SetSprite", nodeId: FLOOR_NODE, assetId: FLOOR_ASSET },
	{ _tag: "SetTint", nodeId: FLOOR_NODE, tint: "#6a6e78" },
	{
		_tag: "SetTransform",
		nodeId: FLOOR_NODE,
		x: 0,
		y: 0,
		scaleX: width / FLOOR_SOURCE_SIZE,
		scaleY: height / FLOOR_SOURCE_SIZE,
	},
	...stationCommands(stations),
];

const viewportCommands = (world: World): LeafCommand[] => [
	{
		_tag: "SetTransform",
		nodeId: FLOOR_NODE,
		scaleX: world.width / FLOOR_SOURCE_SIZE,
		scaleY: world.height / FLOOR_SOURCE_SIZE,
	},
	...world.stations.flatMap((station, index) => [
		{
			_tag: "SetTransform",
			nodeId: stationNode(index),
			x: station.center.x - 64,
			y: station.center.y - 64,
		} satisfies LeafCommand,
	]),
];

export function createPizdudesWidget(
	transport: Transport<WidgetToCore, CoreToWidget>,
	options: PizdudesWidgetOptions = {},
): PizdudesWidget {
	const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
	const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
	const seed = options.seed ?? 42;

	let world: World | null = null;
	let initialized = false;
	let paused = false;
	let disposed = false;
	let heartbeatTick = 0;
	let tickTimer: ReturnType<typeof setInterval> | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let seq = 0;

	const send = (message: WidgetToCore["message"]): void => {
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
		if (tickTimer !== undefined) clearInterval(tickTimer);
		if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
		tickTimer = undefined;
		heartbeatTimer = undefined;
	};

	const startTimers = (): void => {
		stopTimers();
		if (tickMs > 0) {
			tickTimer = setInterval(() => tick(tickMs), tickMs);
		}
		if (heartbeatMs > 0) {
			heartbeatTimer = setInterval(() => {
				heartbeatTick += 1;
				send({ _tag: "Heartbeat", tick: heartbeatTick });
			}, heartbeatMs);
		}
	};

	const tick = (dtMs: number): void => {
		if (!initialized || paused || disposed || world === null) return;
		const changes = stepWorld(world, dtMs);
		const commands: LeafCommand[] = [];
		for (const change of changes) {
			const { cook } = change;
			if (change.moved) {
				commands.push({
					_tag: "SetTransform",
					nodeId: cookNode(cook.id),
					x: cook.x,
					y: cook.y,
				});
			}
			if (change.animationChanged) {
				commands.push(animationCommand(cook));
			}
		}
		if (commands.length > 0) sendCommands(commands);
	};

	const handle = (message: WidgetEvent): void => {
		if (disposed) return;
		switch (message._tag) {
			case "Init": {
				if (initialized) return;
				world = createWorld(message.viewport.w, message.viewport.h, seed);
				initialized = true;
				paused = false;
				send({
					_tag: "Ready",
					widgetId: message.widgetId,
					protocolVersion: PROTOCOL_VERSION,
				});
				sendCommands(initialScene(world.width, world.height, world.stations));
				startTimers();
				return;
			}
			case "ViewerEvent": {
				if (!initialized || world === null) return;
				const before = world.cooks.has(message.event.viewerId);
				const cook = applyViewerEvent(world, message.event);
				if (cook === undefined && before) {
					sendCommands([
						{ _tag: "RemoveNode", nodeId: cookNode(message.event.viewerId) },
					]);
					return;
				}
				if (cook !== undefined && !before) {
					seq += 1;
					sendCommands([
						...cookCommands(cook),
						{
							_tag: "SetParent",
							nodeId: cookNode(cook.id),
							parentId: SCENE_NODE,
							order: COOK_ORDER + seq,
						},
						{
							_tag: "SetTransform",
							nodeId: cookNode(cook.id),
							x: cook.x,
							y: cook.y,
						},
					]);
				}
				return;
			}
			case "Viewport": {
				if (!initialized || world === null) return;
				resizeWorld(world, message.w, message.h);
				sendCommands(viewportCommands(world));
				return;
			}
			case "Pause":
				paused = true;
				return;
			case "Resume":
				paused = false;
				return;
			case "Dispose":
				dispose();
				return;
		}
	};

	const unsubscribe = transport.subscribe((envelope) => {
		if (envelope.protocolVersion !== PROTOCOL_VERSION) return;
		handle(envelope.message);
	});

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		stopTimers();
		if (initialized) {
			sendCommands([{ _tag: "RemoveNode", nodeId: SCENE_NODE }]);
		}
		unsubscribe();
		transport.dispose();
	};

	return {
		handle,
		tick,
		dispose,
		get world() {
			return world;
		},
	};
}

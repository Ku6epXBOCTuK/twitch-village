import type { ViewerEvent, ViewerId } from "@tv/protocol";
import { COOK_DIRECTIONS, type CookDirection } from "./assets";
import {
	AGENT_SPEED,
	ARRIVE_DISTANCE,
	IDLE_MAX_MS,
	IDLE_MIN_MS,
	layoutStations,
	type Point,
	SPAWN_AREA,
	type StationLayout,
	WANDER_AREA,
	WANDER_SPEED,
} from "./field";
import { mulberry32, type Random, randomBetween } from "./random";

export interface Cook {
	readonly id: ViewerId;
	name: string;
	color: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	direction: CookDirection;
	moving: boolean;
	speed: number;
	target: Point | null;
	idleMs: number;
}

export interface World {
	width: number;
	height: number;
	stations: StationLayout[];
	cooks: Map<ViewerId, Cook>;
	nextStation: number;
	random: Random;
}

export interface CookChange {
	readonly cook: Cook;
	readonly moved: boolean;
	readonly animationChanged: boolean;
}

export function createWorld(width: number, height: number, seed = 42): World {
	return {
		width,
		height,
		stations: layoutStations(width, height),
		cooks: new Map(),
		nextStation: 0,
		random: mulberry32(seed),
	};
}

export function resizeWorld(world: World, width: number, height: number): void {
	world.width = width;
	world.height = height;
	world.stations = layoutStations(width, height);
}

function spawnPoint(world: World): Point {
	return {
		x: randomBetween(
			world.random,
			world.width * SPAWN_AREA.xMin,
			world.width * SPAWN_AREA.xMax,
		),
		y: randomBetween(
			world.random,
			world.height * SPAWN_AREA.yMin,
			world.height * SPAWN_AREA.yMax,
		),
	};
}

function wanderPoint(world: World): Point {
	return {
		x: randomBetween(
			world.random,
			world.width * WANDER_AREA.xMin,
			world.width * WANDER_AREA.xMax,
		),
		y: randomBetween(
			world.random,
			world.height * WANDER_AREA.yMin,
			world.height * WANDER_AREA.yMax,
		),
	};
}

function targetPoint(world: World, cook: Cook): Point {
	if (world.stations.length === 0 || world.random() < 0.35) {
		cook.speed = WANDER_SPEED;
		return wanderPoint(world);
	}
	const station =
		world.stations[world.nextStation % world.stations.length] ??
		world.stations[0];
	world.nextStation += 1;
	cook.speed = AGENT_SPEED;
	return station?.approach ?? wanderPoint(world);
}

export function addCook(
	world: World,
	id: ViewerId,
	name: string,
	color: string,
): Cook {
	const existing = world.cooks.get(id);
	if (existing !== undefined) {
		existing.name = name;
		existing.color = color;
		return existing;
	}
	const point = spawnPoint(world);
	const cook: Cook = {
		id,
		name,
		color,
		x: point.x,
		y: point.y,
		vx: 0,
		vy: 0,
		direction: "south",
		moving: false,
		speed: AGENT_SPEED,
		target: null,
		idleMs: 0,
	};
	cook.target = targetPoint(world, cook);
	world.cooks.set(id, cook);
	return cook;
}

export function removeCook(world: World, id: ViewerId): boolean {
	return world.cooks.delete(id);
}

export function applyViewerEvent(
	world: World,
	event: ViewerEvent,
): Cook | undefined {
	switch (event._tag) {
		case "ViewerJoined":
			return addCook(
				world,
				event.viewerId,
				event.displayName,
				event.color ?? "#60a5fa",
			);
		case "ViewerMessage":
		case "ViewerGift": {
			const cook = world.cooks.get(event.viewerId);
			if (cook === undefined) {
				return addCook(world, event.viewerId, event.viewerId, "#60a5fa");
			}
			cook.target = targetPoint(world, cook);
			cook.idleMs = 0;
			return cook;
		}
		case "ViewerLeft":
			removeCook(world, event.viewerId);
			return undefined;
	}
}

export function directionFromVelocity(vx: number, vy: number): CookDirection {
	const index = Math.round(Math.atan2(vy, vx) / (Math.PI / 4));
	const normalized =
		((index % COOK_DIRECTIONS.length) + COOK_DIRECTIONS.length) %
		COOK_DIRECTIONS.length;
	return COOK_DIRECTIONS[normalized] ?? "south";
}

export function stepWorld(world: World, dtMs: number): CookChange[] {
	const dt = Math.max(0, dtMs) / 1000;
	const changes: CookChange[] = [];

	for (const cook of world.cooks.values()) {
		let moved = false;
		let animationChanged = false;

		if (cook.target !== null) {
			const dx = cook.target.x - cook.x;
			const dy = cook.target.y - cook.y;
			const distance = Math.hypot(dx, dy);
			if (distance <= ARRIVE_DISTANCE) {
				cook.x = cook.target.x;
				cook.y = cook.target.y;
				cook.target = null;
				cook.idleMs = randomBetween(world.random, IDLE_MIN_MS, IDLE_MAX_MS);
				if (cook.moving) {
					cook.moving = false;
					cook.vx = 0;
					cook.vy = 0;
					animationChanged = true;
				}
				moved = true;
			} else {
				const step = Math.min(cook.speed * dt, distance);
				cook.vx = (dx / distance) * cook.speed;
				cook.vy = (dy / distance) * cook.speed;
				cook.x += (dx / distance) * step;
				cook.y += (dy / distance) * step;
				const direction = directionFromVelocity(dx, dy);
				if (!cook.moving || direction !== cook.direction) {
					animationChanged = true;
				}
				cook.direction = direction;
				cook.moving = true;
				moved = true;
			}
		} else {
			cook.idleMs -= Math.max(0, dtMs);
			if (cook.idleMs <= 0) {
				cook.target = targetPoint(world, cook);
			}
		}

		if (moved || animationChanged) {
			changes.push({ cook, moved, animationChanged });
		}
	}

	return changes;
}

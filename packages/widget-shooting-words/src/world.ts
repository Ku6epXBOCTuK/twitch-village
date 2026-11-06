import type { ViewerId } from "@tv/protocol";

export const SHIP_WIDTH = 24;
export const SHIP_HEIGHT = 32;
export const SHIP_SCALE = 2;
export const SHIP_GROUND_MARGIN = 40;
export const SHIP_BASE_HP = 10;
export const WORD_TTL_MS = 30_000;
export const ARMED_FUSE_MS = 1000;
export const WORD_MAX = 30;
export const BULLET_SPEED = 700;
export const BULLET_HIT_DISTANCE = 30;
export const ENEMY_SHOT_SPEED = 400;
export const ENEMY_SHOT_HIT_DISTANCE = 20;
export const ENEMY_SHOT_DAMAGE_CHANCE = 0.5;
export const ENEMY_SPAWN_MIN_MS = 2000;
export const ENEMY_SPAWN_MAX_MS = 4000;
export const Z_FAR = 1200;
export const Z_NEAR = 200;
export const WORD_PADDING = 24;
export const WORD_FONT_SIZE = 28;

export interface Point {
	readonly x: number;
	readonly y: number;
}

export interface Ship {
	readonly id: number;
	readonly viewerId: ViewerId;
	name: string;
	login: string;
	skin: number;
	x: number;
	y: number;
	direction: 1 | -1;
	speed: number;
	walkTimer: number;
	hp: number;
	maxHp: number;
	xp: number;
	dead: boolean;
}

export interface Word {
	readonly id: number;
	readonly text: string;
	x: number;
	y: number;
	fromX: number;
	fromY: number;
	targetX: number;
	targetY: number;
	z: number;
	scale: number;
	landed: boolean;
	age: number;
	armed: boolean;
	dead: boolean;
}

export interface Bullet {
	readonly id: number;
	readonly shooterId: number;
	readonly targetWordId: number;
	x: number;
	y: number;
}

export interface EnemyShot {
	readonly id: number;
	readonly targetShipId: number;
	readonly damage: number;
	x: number;
	y: number;
}

export interface World {
	width: number;
	height: number;
	random: () => number;
	ships: Map<number, Ship>;
	words: Map<number, Word>;
	bullets: Map<number, Bullet>;
	shots: Map<number, EnemyShot>;
	nextShipId: number;
	nextWordId: number;
	nextBulletId: number;
	nextShotId: number;
	nextWordAt: number;
}

export interface StepResult {
	spawnedWords: Word[];
	movedShips: Ship[];
	changedWords: Word[];
	spawnedBullets: Bullet[];
	movedBullets: Bullet[];
	spawnedShots: EnemyShot[];
	movedShots: EnemyShot[];
	removedWords: number[];
	removedBullets: number[];
	removedShots: number[];
	damagedShips: Ship[];
	killedShips: Ship[];
}

const emptyStep = (): StepResult => ({
	spawnedWords: [],
	movedShips: [],
	changedWords: [],
	spawnedBullets: [],
	movedBullets: [],
	spawnedShots: [],
	movedShots: [],
	removedWords: [],
	removedBullets: [],
	removedShots: [],
	damagedShips: [],
	killedShips: [],
});

export function createWorld(width: number, height: number, seed = 42): World {
	let state = seed >>> 0;
	const random = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
	return {
		width,
		height,
		random,
		ships: new Map(),
		words: new Map(),
		bullets: new Map(),
		shots: new Map(),
		nextShipId: 1,
		nextWordId: 1,
		nextBulletId: 1,
		nextShotId: 1,
		nextWordAt: 1000,
	};
}

export function resizeWorld(world: World, width: number, height: number): void {
	world.width = width;
	world.height = height;
	for (const ship of world.ships.values()) {
		ship.x = clampX(world, ship.x);
		ship.y = groundY(world);
	}
}

const clampX = (world: World, x: number): number => {
	const half = SHIP_WIDTH / 2;
	return Math.min(
		Math.max(x, half + 8),
		Math.max(half + 8, world.width - half - 8),
	);
};

const groundY = (world: World): number =>
	world.height - SHIP_GROUND_MARGIN - SHIP_HEIGHT;

const randomBetween = (world: World, min: number, max: number): number =>
	min + world.random() * (max - min);

const randomInt = (world: World, min: number, max: number): number =>
	min + Math.floor(world.random() * (max - min + 1));

const pick = <T>(world: World, items: readonly T[]): T | undefined =>
	items[Math.floor(world.random() * items.length)];

const WORD_POOL = [
	"apple",
	"banana",
	"cherry",
	"delta",
	"ember",
	"falcon",
	"globe",
	"harbor",
	"island",
	"jungle",
	"kite",
	"lemon",
	"meteor",
	"nectar",
	"ocean",
	"pixel",
	"quartz",
	"rocket",
	"silver",
	"tiger",
	"umbra",
	"violet",
	"willow",
	"xenon",
	"yonder",
	"zephyr",
] as const;

export function addShip(
	world: World,
	viewerId: ViewerId,
	name: string,
	login: string,
): Ship {
	const ship: Ship = {
		id: world.nextShipId,
		viewerId,
		name,
		login,
		skin: randomInt(world, 1, 20),
		x: randomBetween(world, 48, Math.max(48, world.width - 48)),
		y: groundY(world),
		direction: world.random() < 0.5 ? -1 : 1,
		speed: randomBetween(world, 20, 70),
		walkTimer: randomBetween(world, 0, 4000),
		hp: SHIP_BASE_HP,
		maxHp: SHIP_BASE_HP,
		xp: 0,
		dead: false,
	};
	world.nextShipId += 1;
	world.ships.set(ship.id, ship);
	return ship;
}

const findShip = (world: World, viewerId: ViewerId): Ship | undefined => {
	for (const ship of world.ships.values()) {
		if (ship.viewerId === viewerId) return ship;
	}
	return undefined;
};

export function getShip(world: World, viewerId: ViewerId): Ship | undefined {
	return findShip(world, viewerId);
}

export function removeShip(world: World, viewerId: ViewerId): Ship | undefined {
	const ship = findShip(world, viewerId);
	if (ship === undefined) return undefined;
	world.ships.delete(ship.id);
	return ship;
}

function spawnWord(world: World): Word {
	const text = pick(world, WORD_POOL) ?? "word";
	const targetX = randomBetween(
		world,
		WORD_PADDING,
		Math.max(WORD_PADDING, world.width - WORD_PADDING),
	);
	const targetY = randomBetween(world, 80, Math.max(80, world.height - 150));
	const word: Word = {
		id: world.nextWordId,
		text,
		x: world.width / 2,
		y: world.height / 2,
		fromX: world.width / 2,
		fromY: world.height / 2,
		targetX,
		targetY,
		z: Z_FAR,
		scale: 0.2,
		landed: false,
		age: 0,
		armed: false,
		dead: false,
	};
	world.nextWordId += 1;
	world.words.set(word.id, word);
	return word;
}

export function shoot(
	world: World,
	viewerId: ViewerId,
	text: string,
): Bullet[] {
	const ship = findShip(world, viewerId);
	if (ship === undefined || ship.dead) return [];
	const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const target = words[0];
	if (target === undefined) return [];
	const created: Bullet[] = [];
	for (const word of world.words.values()) {
		if (word.dead || word.text !== target) continue;
		const bullet: Bullet = {
			id: world.nextBulletId,
			shooterId: ship.id,
			targetWordId: word.id,
			x: ship.x,
			y: ship.y - SHIP_HEIGHT / 2,
		};
		world.nextBulletId += 1;
		world.bullets.set(bullet.id, bullet);
		created.push(bullet);
	}
	return created;
}

const moveToward = (
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	step: number,
): { x: number; y: number; distance: number } => {
	const dx = toX - fromX;
	const dy = toY - fromY;
	const distance = Math.hypot(dx, dy);
	if (distance === 0) return { x: toX, y: toY, distance: 0 };
	const move = Math.min(step, distance);
	return {
		x: fromX + (dx / distance) * move,
		y: fromY + (dy / distance) * move,
		distance,
	};
};

const damageShip = (
	world: World,
	ship: Ship,
	damage: number,
	result: StepResult,
): void => {
	if (damage <= 0 || ship.dead) return;
	ship.hp = Math.max(0, ship.hp - damage);
	result.damagedShips.push(ship);
	if (ship.hp === 0) {
		ship.dead = true;
		result.killedShips.push(ship);
	}
};

export function stepWorld(world: World, dtMs: number): StepResult {
	const result = emptyStep();
	const dt = Math.max(0, dtMs);
	const seconds = dt / 1000;

	if (world.width > 0 && world.height > 0) {
		world.nextWordAt -= dt;
		if (world.nextWordAt <= 0 && world.words.size < WORD_MAX) {
			result.spawnedWords.push(spawnWord(world));
			world.nextWordAt = randomBetween(
				world,
				ENEMY_SPAWN_MIN_MS,
				ENEMY_SPAWN_MAX_MS,
			);
		}
	}

	for (const ship of world.ships.values()) {
		if (ship.dead) continue;
		ship.walkTimer -= dt;
		if (ship.walkTimer <= 0) {
			ship.direction = world.random() < 0.5 ? -1 : 1;
			ship.speed = randomBetween(world, 20, 70);
			ship.walkTimer = randomBetween(world, 1000, 4000);
		}
		const nextX = clampX(world, ship.x + ship.direction * ship.speed * seconds);
		if (nextX !== ship.x) {
			ship.x = nextX;
			result.movedShips.push(ship);
		}
		if (nextX <= SHIP_WIDTH / 2 + 8) ship.direction = 1;
		if (nextX >= world.width - SHIP_WIDTH / 2 - 8) ship.direction = -1;
		ship.y = groundY(world);
	}

	for (const word of world.words.values()) {
		if (word.dead) continue;
		if (!word.landed) {
			word.z -= randomBetween(world, 500, 900) * seconds;
			const progress = Math.min(1, Math.max(0, 1 - word.z / Z_FAR));
			word.x = word.fromX + (word.targetX - word.fromX) * progress;
			word.y = word.fromY + (word.targetY - word.fromY) * progress;
			word.scale = Z_NEAR / Math.max(Z_NEAR, word.z);
			result.changedWords.push(word);
			if (word.z <= Z_NEAR) {
				word.landed = true;
				word.x = word.targetX;
				word.y = word.targetY;
				word.scale = 1;
				word.age = 0;
				result.changedWords.push(word);
			}
			continue;
		}
		word.age += dt;
		if (word.age >= WORD_TTL_MS + ARMED_FUSE_MS) {
			word.dead = true;
			result.removedWords.push(word.id);
			const targets = [...world.ships.values()].filter((ship) => !ship.dead);
			const target = pick(world, targets);
			if (target !== undefined) {
				const damage = world.random() < ENEMY_SHOT_DAMAGE_CHANCE ? 1 : 0;
				const shot: EnemyShot = {
					id: world.nextShotId,
					targetShipId: target.id,
					damage,
					x: word.x,
					y: word.y,
				};
				world.nextShotId += 1;
				world.shots.set(shot.id, shot);
				result.spawnedShots.push(shot);
			}
			continue;
		}
		const armed = word.age >= WORD_TTL_MS;
		if (armed !== word.armed) {
			word.armed = armed;
			result.changedWords.push(word);
		}
	}

	for (const bullet of world.bullets.values()) {
		const word = world.words.get(bullet.targetWordId);
		if (word === undefined || word.dead) {
			world.bullets.delete(bullet.id);
			result.removedBullets.push(bullet.id);
			continue;
		}
		const step = BULLET_SPEED * seconds;
		const next = moveToward(bullet.x, bullet.y, word.x, word.y, step);
		bullet.x = next.x;
		bullet.y = next.y;
		result.movedBullets.push(bullet);
		if (next.distance <= Math.max(step, BULLET_HIT_DISTANCE)) {
			word.dead = true;
			world.words.delete(word.id);
			world.bullets.delete(bullet.id);
			result.removedWords.push(word.id);
			result.removedBullets.push(bullet.id);
			const shooter = world.ships.get(bullet.shooterId);
			if (shooter !== undefined) shooter.xp += 1;
		}
	}

	for (const shot of world.shots.values()) {
		const ship = world.ships.get(shot.targetShipId);
		if (ship === undefined || ship.dead) {
			world.shots.delete(shot.id);
			result.removedShots.push(shot.id);
			continue;
		}
		const step = ENEMY_SHOT_SPEED * seconds;
		const next = moveToward(shot.x, shot.y, ship.x, ship.y, step);
		shot.x = next.x;
		shot.y = next.y;
		result.movedShots.push(shot);
		if (next.distance <= Math.max(step, ENEMY_SHOT_HIT_DISTANCE)) {
			damageShip(world, ship, shot.damage, result);
			world.shots.delete(shot.id);
			result.removedShots.push(shot.id);
		}
	}

	return result;
}

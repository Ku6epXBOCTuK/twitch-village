import type { StationName } from "./assets";

export const CELL_SIZE = 128;
export const AGENT_SPEED = 120;
export const ARRIVE_DISTANCE = 10;
export const STATION_HALF_SIZE = 54;
export const COOK_HALF_SIZE = 32;
export const WANDER_SPEED = 85;
export const IDLE_MIN_MS = 1500;
export const IDLE_MAX_MS = 4000;
export const FLOOR_SOURCE_SIZE = 1200;
export const COOK_CELL = 84;

export const SPAWN_AREA = { xMin: 0.22, xMax: 0.48, yMin: 0.41, yMax: 0.61 };
export const WANDER_AREA = { xMin: 0.05, xMax: 0.8, yMin: 0.26, yMax: 0.74 };

export interface Point {
	readonly x: number;
	readonly y: number;
}

type Side = "top" | "bottom" | "left" | "right";

const PLACEMENTS: ReadonlyArray<{
	readonly name: StationName;
	readonly cell: string;
	readonly side: Side;
}> = [
	{ name: "bun-shelf", cell: "e3", side: "bottom" },
	{ name: "produce-shelf", cell: "f3", side: "bottom" },
	{ name: "dairy-shelf", cell: "g3", side: "bottom" },
	{ name: "pantry-shelf", cell: "h3", side: "bottom" },
	{ name: "fridge", cell: "i3", side: "bottom" },
	{ name: "cutting-board", cell: "h8", side: "top" },
	{ name: "grill", cell: "c4", side: "right" },
	{ name: "dough-mixer", cell: "k4", side: "left" },
	{ name: "pizza-oven", cell: "k5", side: "left" },
	{ name: "stove-pot", cell: "c5", side: "right" },
	{ name: "trash-can", cell: "i8", side: "top" },
	{ name: "serving-counter", cell: "g8", side: "top" },
	{ name: "cash-register", cell: "e8", side: "top" },
];

export interface GridMetrics {
	readonly columns: number;
	readonly rows: number;
	readonly offsetX: number;
	readonly offsetY: number;
}

export interface StationLayout {
	readonly name: StationName;
	readonly center: Point;
	readonly approach: Point;
}

export function gridMetrics(width: number, height: number): GridMetrics {
	const columns = Math.max(1, Math.floor(width / CELL_SIZE));
	const rows = Math.max(1, Math.floor(height / CELL_SIZE));
	return {
		columns,
		rows,
		offsetX: (width - columns * CELL_SIZE) / 2,
		offsetY: (height - rows * CELL_SIZE) / 2,
	};
}

export function cellCenter(cell: string, grid: GridMetrics): Point {
	const column = (cell.charCodeAt(0) - 97) % grid.columns;
	const row = (Number.parseInt(cell.slice(1), 10) - 1) % grid.rows;
	return {
		x: grid.offsetX + (column + 0.5) * CELL_SIZE,
		y: grid.offsetY + (row + 0.5) * CELL_SIZE,
	};
}

function approachPoint(center: Point, side: Side): Point {
	const distance = STATION_HALF_SIZE + COOK_HALF_SIZE;
	switch (side) {
		case "top":
			return { x: center.x, y: center.y - distance };
		case "bottom":
			return { x: center.x, y: center.y + distance };
		case "left":
			return { x: center.x - distance, y: center.y };
		case "right":
			return { x: center.x + distance, y: center.y };
	}
}

export function layoutStations(width: number, height: number): StationLayout[] {
	const grid = gridMetrics(width, height);
	return PLACEMENTS.map((placement) => {
		const center = cellCenter(placement.cell, grid);
		return {
			name: placement.name,
			center,
			approach: approachPoint(center, placement.side),
		};
	});
}

export function clampToArea(
	point: Point,
	width: number,
	height: number,
): Point {
	return {
		x: Math.min(Math.max(point.x, 0), width),
		y: Math.min(Math.max(point.y, 0), height),
	};
}

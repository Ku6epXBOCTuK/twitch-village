import type { AssetId } from "@tv/protocol";
import { PIZDUDES_ASSET_BUNDLE } from "./constants";

export const ASSET_BUNDLE = PIZDUDES_ASSET_BUNDLE;

export const COOK_DIRECTIONS = [
	"east",
	"south-east",
	"south",
	"south-west",
	"west",
	"north-west",
	"north",
	"north-east",
] as const;

export type CookDirection = (typeof COOK_DIRECTIONS)[number];

export const COOK_FRAME_COUNT = 8;
export const COOK_FPS = 15;

export const STATION_NAMES = [
	"bun-shelf",
	"produce-shelf",
	"dairy-shelf",
	"pantry-shelf",
	"fridge",
	"cutting-board",
	"grill",
	"dough-mixer",
	"pizza-oven",
	"stove-pot",
	"serving-counter",
	"cash-register",
	"trash-can",
] as const;

export type StationName = (typeof STATION_NAMES)[number];

export const cookFrame = (direction: CookDirection, frame: number): AssetId =>
	`cook/${direction}/${frame}` as AssetId;

export const cookFrames = (direction: CookDirection): AssetId[] =>
	Array.from({ length: COOK_FRAME_COUNT }, (_, frame) =>
		cookFrame(direction, frame),
	);

export const stationAsset = (station: StationName): AssetId =>
	`stations/${station}` as AssetId;

export const FLOOR_ASSET = "floor" as AssetId;

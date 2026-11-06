import type { AssetId } from "@tv/protocol";
import { SHOOTING_WORDS_ASSET_BUNDLE } from "./constants";

export const ASSET_BUNDLE = SHOOTING_WORDS_ASSET_BUNDLE;

export interface ShipSheet {
	readonly cols: number;
	readonly rows: number;
	readonly frames: readonly number[];
}

export const SHIP_SHEETS: readonly ShipSheet[] = [
	{
		cols: 6,
		rows: 3,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17],
	},
	{ cols: 6, rows: 3, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15] },
	{ cols: 5, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
	{
		cols: 7,
		rows: 3,
		frames: [
			0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
		],
	},
	{ cols: 5, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
	{ cols: 5, rows: 1, frames: [0, 1, 2, 3, 4] },
	{
		cols: 5,
		rows: 3,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
	},
	{ cols: 6, rows: 1, frames: [0, 1, 2, 3, 4, 5] },
	{ cols: 5, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
	{ cols: 4, rows: 1, frames: [0, 1, 2, 3] },
	{ cols: 7, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
	{ cols: 4, rows: 3, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
	{ cols: 8, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
	{ cols: 4, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7] },
	{ cols: 6, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
	{ cols: 4, rows: 3, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
	{ cols: 6, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
	{ cols: 4, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7] },
	{ cols: 4, rows: 2, frames: [0, 1, 2, 3, 4, 5, 6, 7] },
	{ cols: 5, rows: 3, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
];

export const SHIP_SIZES: readonly {
	readonly width: number;
	readonly height: number;
}[] = [
	{ width: 150, height: 81 },
	{ width: 210, height: 108 },
	{ width: 135, height: 54 },
	{ width: 203, height: 69 },
	{ width: 175, height: 76 },
	{ width: 205, height: 22 },
	{ width: 235, height: 108 },
	{ width: 198, height: 30 },
	{ width: 175, height: 62 },
	{ width: 164, height: 29 },
	{ width: 259, height: 56 },
	{ width: 108, height: 81 },
	{ width: 296, height: 82 },
	{ width: 212, height: 64 },
	{ width: 234, height: 52 },
	{ width: 116, height: 84 },
	{ width: 210, height: 50 },
	{ width: 132, height: 60 },
	{ width: 172, height: 56 },
	{ width: 225, height: 132 },
];

export const shipCellSize = (
	skin: number,
): { readonly width: number; readonly height: number } => {
	const index = Math.max(0, Math.min(SHIP_SHEETS.length - 1, skin - 1));
	const sheet = SHIP_SHEETS[index];
	const size = SHIP_SIZES[index];
	if (sheet === undefined || size === undefined)
		return { width: 24, height: 32 };
	return {
		width: size.width / sheet.cols,
		height: size.height / sheet.rows,
	};
};

export const shipFrameAsset = (skin: number, frame: number): AssetId =>
	`ships/${skin}/${frame}` as AssetId;

export const shipFrames = (skin: number): AssetId[] => {
	const sheet =
		SHIP_SHEETS[Math.max(0, Math.min(SHIP_SHEETS.length - 1, skin - 1))];
	if (sheet === undefined) return [];
	return sheet.frames.map((frame) => shipFrameAsset(skin, frame));
};

export const shipIdleAsset = (skin: number): AssetId =>
	shipFrames(skin)[0] ?? shipFrameAsset(1, 0);

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "assets-src", "ships");
const target = join(root, "assets", "shooting-words", "ships");

const SHEETS = [
	{
		file: "tinyShip1.png",
		cols: 6,
		rows: 3,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 17],
	},
	{
		file: "tinyShip2.png",
		cols: 6,
		rows: 3,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15],
	},
	{
		file: "tinyShip3.png",
		cols: 5,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	},
	{
		file: "tinyShip4.png",
		cols: 7,
		rows: 3,
		frames: [
			0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
		],
	},
	{
		file: "tinyShip5.png",
		cols: 5,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	},
	{ file: "tinyShip6.png", cols: 5, rows: 1, frames: [0, 1, 2, 3, 4] },
	{
		file: "tinyShip7.png",
		cols: 5,
		rows: 3,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
	},
	{ file: "tinyShip8.png", cols: 6, rows: 1, frames: [0, 1, 2, 3, 4, 5] },
	{
		file: "tinyShip9.png",
		cols: 5,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8],
	},
	{ file: "tinyShip10.png", cols: 4, rows: 1, frames: [0, 1, 2, 3] },
	{
		file: "tinyShip11.png",
		cols: 7,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
	},
	{
		file: "tinyShip12.png",
		cols: 4,
		rows: 3,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
	},
	{
		file: "tinyShip13.png",
		cols: 8,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
	},
	{
		file: "tinyShip14.png",
		cols: 4,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7],
	},
	{
		file: "tinyShip15.png",
		cols: 6,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
	},
	{
		file: "tinyShip16.png",
		cols: 4,
		rows: 3,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
	},
	{
		file: "tinyShip17.png",
		cols: 6,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
	},
	{
		file: "tinyShip18.png",
		cols: 4,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7],
	},
	{
		file: "tinyShip19.png",
		cols: 4,
		rows: 2,
		frames: [0, 1, 2, 3, 4, 5, 6, 7],
	},
	{
		file: "tinyShip20.png",
		cols: 5,
		rows: 3,
		frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
	},
];

await rm(join(root, "assets"), { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const [index, sheet] of SHEETS.entries()) {
	const skin = index + 1;
	const input = join(source, sheet.file);
	const meta = await sharp(input).metadata();
	const width = meta.width ?? 0;
	const height = meta.height ?? 0;
	const cellWidth = Math.floor(width / sheet.cols);
	const cellHeight = Math.floor(height / sheet.rows);
	const skinDir = join(target, String(skin));
	await mkdir(skinDir, { recursive: true });

	for (const frame of sheet.frames) {
		const left = (frame % sheet.cols) * cellWidth;
		const top = Math.floor(frame / sheet.cols) * cellHeight;
		await sharp(input)
			.extract({ left, top, width: cellWidth, height: cellHeight })
			.png()
			.toFile(join(skinDir, `${frame}.png`));
	}
}

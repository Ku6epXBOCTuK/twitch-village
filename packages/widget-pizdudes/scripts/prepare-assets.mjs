import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "..", "assets-src");
const target = join(root, "..", "assets", "pizdudes{m}");

const CELL = 84;
const FRAMES = 8;
const ROWS = {
	south: 1,
	"south-east": 2,
	east: 3,
	"north-east": 4,
	north: 5,
	"north-west": 6,
	west: 7,
	"south-west": 8,
};

const STATIONS = {
	"bun-shelf": "bun-shelf.png",
	"produce-shelf": "veggie-shelf.png",
	"dairy-shelf": "cheese-shelf.png",
	"pantry-shelf": "sauce-dispenser.png",
	fridge: "fridge.png",
	"cutting-board": "cutting-board.png",
	grill: "patty-grill.png",
	"dough-mixer": "dough-mixer.png",
	"pizza-oven": "pizza-oven.png",
	"stove-pot": "stove-pot.png",
	"serving-counter": "serving-counter.png",
	"cash-register": "cash-register.png",
	"trash-can": "trash-can.png",
};

await rm(join(root, "..", "assets"), { recursive: true, force: true });

for (const [direction, row] of Object.entries(ROWS)) {
	const folder = join(target, "cook", direction);
	await mkdir(folder, { recursive: true });
	for (let frame = 0; frame < FRAMES; frame += 1) {
		await sharp(join(source, "cook.png"))
			.extract({
				left: frame * CELL,
				top: row * CELL,
				width: CELL,
				height: CELL,
			})
			.png()
			.toFile(join(folder, `${frame}.png`));
	}
}

await mkdir(join(target, "stations"), { recursive: true });
await copyFile(join(source, "floor.jpg"), join(target, "floor.jpg"));
for (const [station, file] of Object.entries(STATIONS)) {
	await copyFile(
		join(source, "stations", file),
		join(target, "stations", `${station}.png`),
	);
}

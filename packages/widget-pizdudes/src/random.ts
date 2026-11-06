export type Random = () => number;

export function mulberry32(seed: number): Random {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

export function randomBetween(
	random: Random,
	min: number,
	max: number,
): number {
	return min + random() * (max - min);
}

export function pick<T>(random: Random, items: readonly T[]): T {
	const value = items[Math.floor(random() * items.length)];
	if (value === undefined) throw new Error("cannot pick from an empty list");
	return value;
}

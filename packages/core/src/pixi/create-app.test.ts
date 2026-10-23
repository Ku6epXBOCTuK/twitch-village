import { describe, expect, it } from "vitest";
import { buildPixiOptions } from "./create-app";

describe("buildPixiOptions", () => {
	it("passes the requested size and the default render options", () => {
		const options = buildPixiOptions({ width: 1920, height: 1080 });

		expect(options).toMatchObject({
			width: 1920,
			height: 1080,
			background: 0x000000,
			backgroundAlpha: 0,
			autoDensity: true,
			antialias: true,
		});
	});

	it("respects an explicit background alpha", () => {
		const options = buildPixiOptions({
			width: 800,
			height: 600,
			backgroundAlpha: 1,
		});

		expect(options.backgroundAlpha).toBe(1);
	});

	it("falls back to resolution 1 and no resize target outside the browser", () => {
		const options = buildPixiOptions({ width: 800, height: 600 });

		expect(options.resolution).toBe(1);
		expect(options).not.toHaveProperty("resizeTo");
	});
});

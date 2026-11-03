import type { ViewerId } from "@tv/protocol";
import { describe, expect, it } from "vitest";
import {
	AVATAR_COUNT,
	AVATAR_SIZE,
	BOTTOM_BAND,
	CELEBRATE_GIFT_MS,
	CELEBRATE_MESSAGE_MS,
	IDLE_TIMEOUT_MS,
	LEAVE_FADE_MS,
	NAME_HEIGHT,
	type SpawnOptions,
	VIEWER_COLORS,
	type Viewer,
} from "./types";
import {
	createViewer,
	markCelebrating,
	markLeaving,
	shouldLeave,
	shouldRemove,
	viewerNodeIds,
} from "./viewer";

const bounds = { width: 1280, height: 720 };

const joined = (patch: { color?: string } = {}) => ({
	_tag: "ViewerJoined" as const,
	viewerId: "42" as ViewerId,
	displayName: "Ku6epXBOCTuK",
	...patch,
});

const optionsOf = (rng = () => 0.5, now = 1000): SpawnOptions => ({
	bounds,
	now,
	rng,
});

const spawn = (
	rng: () => number = () => 0.5,
	now = 1000,
	color?: string,
): Viewer =>
	createViewer(
		joined(color === undefined ? {} : { color }),
		optionsOf(rng, now),
	);

describe("viewer spawn", () => {
	it("puts the viewer near the bottom edge and inside the safe area", () => {
		const viewer = spawn();
		const half = AVATAR_SIZE / 2;

		expect(viewer.x).toBeGreaterThanOrEqual(half);
		expect(viewer.x).toBeLessThanOrEqual(bounds.width - half);
		expect(viewer.y).toBeGreaterThanOrEqual(bounds.height - BOTTOM_BAND);
		expect(viewer.y).toBeLessThanOrEqual(bounds.height - NAME_HEIGHT - half);
	});

	it("keeps the viewer inside the safe area at both edges of the random range", () => {
		const half = AVATAR_SIZE / 2;
		const left = spawn(() => 0);
		const right = spawn(() => 0.999999);

		expect(left.x).toBeGreaterThanOrEqual(half);
		expect(right.x).toBeLessThanOrEqual(bounds.width - half);
	});

	it("keeps the viewer on screen when the viewport is smaller than the safe area", () => {
		const tiny = { width: 20, height: 40 };
		const spawnIn = (rng: () => number): Viewer =>
			createViewer(joined(), { bounds: tiny, now: 1000, rng });

		for (const rng of [() => 0, () => 0.5, () => 0.999999]) {
			const viewer = spawnIn(rng);

			expect(viewer.x).toBeGreaterThanOrEqual(0);
			expect(viewer.x).toBeLessThanOrEqual(tiny.width);
			expect(viewer.y).toBeGreaterThanOrEqual(0);
			expect(viewer.y).toBeLessThanOrEqual(tiny.height);
		}
	});

	it("starts idle, unseen since the spawn moment", () => {
		const viewer = spawn(() => 0.5, 5000);

		expect(viewer.state).toBe("idle");
		expect(viewer.celebrateUntil).toBe(0);
		expect(viewer.lastSeenAt).toBe(5000);
	});

	it("keeps the color the event carries", () => {
		const viewer = spawn(() => 0.5, 1000, "#123abc");

		expect(viewer.color).toBe("#123abc");
	});

	it("falls back to the palette when the event has no color", () => {
		const viewer = spawn();

		expect(VIEWER_COLORS).toContain(viewer.color);
	});

	it("picks an avatar that the asset bundle has", () => {
		const viewer = spawn(() => 0.5);

		expect(viewer.avatarIndex).toBeGreaterThanOrEqual(0);
		expect(viewer.avatarIndex).toBeLessThan(AVATAR_COUNT);
	});

	it("gives the viewer the three node ids of its own tree", () => {
		const viewer = spawn();
		const ids = viewerNodeIds("42");

		expect(viewer.nodeIds).toEqual(ids);
		expect(ids.root).toBe("avatar-42");
		expect(ids.sprite).toBe("avatar-42-sprite");
		expect(ids.name).toBe("avatar-42-name");
	});

	it("keeps the node ids apart for two viewers", () => {
		expect(viewerNodeIds("42").root).not.toBe(viewerNodeIds("43").root);
	});
});

describe("celebration", () => {
	const viewerWith = (): Viewer => spawn(() => 0.5, 1000);

	it("celebrates for the given duration", () => {
		const viewer = viewerWith();

		markCelebrating(viewer, CELEBRATE_MESSAGE_MS, 2000);

		expect(viewer.state).toBe("celebrate");
		expect(viewer.celebrateUntil).toBe(2000 + CELEBRATE_MESSAGE_MS);
		expect(viewer.lastSeenAt).toBe(2000);
	});

	it("keeps the longer deadline when a gift lands during a message celebration", () => {
		const viewer = viewerWith();

		markCelebrating(viewer, CELEBRATE_MESSAGE_MS, 2000);
		markCelebrating(viewer, CELEBRATE_GIFT_MS, 2400);

		expect(viewer.celebrateUntil).toBe(2400 + CELEBRATE_GIFT_MS);
	});

	it("does not cut a gift celebration short by a later message", () => {
		const viewer = viewerWith();

		markCelebrating(viewer, CELEBRATE_GIFT_MS, 2000);
		const deadline = viewer.celebrateUntil;
		markCelebrating(viewer, CELEBRATE_MESSAGE_MS, 2100);

		expect(viewer.celebrateUntil).toBe(deadline);
	});
});

describe("leaving", () => {
	it("fades out in place without moving the viewer", () => {
		const viewer = spawn(() => 0.5, 1000);

		markLeaving(viewer, 3000);

		expect(viewer.state).toBe("leaving");
		expect(viewer.leavingUntil).toBe(3000 + LEAVE_FADE_MS);
		expect(viewer.x).toBe(spawn(() => 0.5, 1000).x);
	});

	it("asks for a leave only after the silence timeout", () => {
		const viewer = spawn(() => 0.5, 1000);

		expect(shouldLeave(viewer, 1000 + IDLE_TIMEOUT_MS - 1)).toBe(false);
		expect(shouldLeave(viewer, 1000 + IDLE_TIMEOUT_MS)).toBe(true);
	});

	it("gives a silent viewer a new deadline on every event", () => {
		const viewer = spawn(() => 0.5, 1000);

		markCelebrating(viewer, CELEBRATE_MESSAGE_MS, 5000);

		expect(shouldLeave(viewer, 5000 + IDLE_TIMEOUT_MS - 1)).toBe(false);
	});

	it("does not ask twice for a viewer that is already leaving", () => {
		const viewer = spawn(() => 0.5, 1000);

		markLeaving(viewer, 3000);

		expect(shouldLeave(viewer, 3000 + IDLE_TIMEOUT_MS)).toBe(false);
	});

	it("removes the viewer only after the fade", () => {
		const viewer = spawn(() => 0.5, 1000);

		markLeaving(viewer, 3000);

		expect(shouldRemove(viewer, 3000 + LEAVE_FADE_MS - 1)).toBe(false);
		expect(shouldRemove(viewer, 3000 + LEAVE_FADE_MS)).toBe(true);
	});

	it("does not remove a viewer that is not leaving", () => {
		const viewer = spawn(() => 0.5, 1000);

		expect(shouldRemove(viewer, 1_000_000)).toBe(false);
	});

	it("keeps the fade deadline when the leave is requested twice", () => {
		const viewer = spawn(() => 0.5, 1000);

		markLeaving(viewer, 3000);
		markLeaving(viewer, 3500);

		expect(viewer.leavingUntil).toBe(3000 + LEAVE_FADE_MS);
	});

	it("drops the celebration when the leave starts", () => {
		const viewer = spawn(() => 0.5, 1000);

		markCelebrating(viewer, CELEBRATE_GIFT_MS, 2000);
		markLeaving(viewer, 3000);

		expect(viewer.celebrateUntil).toBe(0);
	});
});

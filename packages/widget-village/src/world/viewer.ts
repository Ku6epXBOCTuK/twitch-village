import type { ViewerEvent } from "@tv/protocol";
import {
	AVATAR_COUNT,
	AVATAR_SIZE,
	BOTTOM_BAND,
	IDLE_TIMEOUT_MS,
	LEAVE_FADE_MS,
	NAME_HEIGHT,
	type SpawnOptions,
	VIEWER_COLORS,
	type Viewer,
	type ViewerNodeIds,
} from "./types";

export type ViewerJoinedEvent = Extract<
	ViewerEvent,
	{ readonly _tag: "ViewerJoined" }
>;

export function viewerNodeIds(id: string): ViewerNodeIds {
	return {
		root: `avatar-${id}` as ViewerNodeIds["root"],
		sprite: `avatar-${id}-sprite` as ViewerNodeIds["sprite"],
		name: `avatar-${id}-name` as ViewerNodeIds["name"],
	};
}

function rngIndex(rng: () => number, maxIndex: number): number {
	return Math.min(maxIndex - 1, Math.floor(rng() * maxIndex));
}

export function createViewer(
	event: ViewerJoinedEvent,
	options: SpawnOptions,
): Viewer {
	const id = event.viewerId;
	const color =
		event.color ??
		VIEWER_COLORS[rngIndex(options.rng, VIEWER_COLORS.length)] ??
		VIEWER_COLORS[0];
	const nodeIds = viewerNodeIds(id);
	const avatarIndex = rngIndex(options.rng, AVATAR_COUNT);
	const x = Math.min(
		Math.max(
			0,
			options.rng() * (options.bounds.width - AVATAR_SIZE) + AVATAR_SIZE / 2,
		),
		options.bounds.width,
	);

	const minY = options.bounds.height - BOTTOM_BAND;
	const maxY = options.bounds.height - NAME_HEIGHT - AVATAR_SIZE / 2;

	const y = Math.min(
		Math.max(0, (maxY - minY) * options.rng() + minY),
		options.bounds.height,
	);
	return {
		id,
		displayName: event.displayName,
		color,
		avatarIndex,
		nodeIds,
		x,
		y,
		vx: 0,
		vy: 0,
		state: "idle",
		celebrateUntil: 0,
		lastSeenAt: options.now,
		leavingUntil: 0,
	};
}

export function markCelebrating(
	viewer: Viewer,
	durationMs: number,
	now: number,
): void {
	const celebrateUntil = now + durationMs;
	viewer.celebrateUntil = Math.max(celebrateUntil, viewer.celebrateUntil);
	viewer.state = "celebrate";
	viewer.lastSeenAt = now;
}

export function markLeaving(viewer: Viewer, now: number): void {
	if (viewer.state === "leaving") return;
	viewer.state = "leaving";
	viewer.leavingUntil = now + LEAVE_FADE_MS;
	viewer.celebrateUntil = 0;
}

export function shouldLeave(viewer: Viewer, now: number): boolean {
	if (viewer.state === "leaving") return false;
	if (now - viewer.lastSeenAt >= IDLE_TIMEOUT_MS) return true;
	return false;
}

export function shouldRemove(viewer: Viewer, now: number): boolean {
	if (viewer.state !== "leaving") return false;
	if (now - viewer.leavingUntil >= 0) return true;
	return false;
}

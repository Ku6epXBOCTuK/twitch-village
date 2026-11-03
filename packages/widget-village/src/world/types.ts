import type { NodeId, ViewerId } from "@tv/protocol";

export const MAX_VIEWERS = 200;
export const IDLE_TIMEOUT_MS = 120_000;
export const CELEBRATE_MESSAGE_MS = 1_500;
export const CELEBRATE_GIFT_MS = 4_000;
export const LEAVE_FADE_MS = 500;
export const AVATAR_COUNT = 4;
export const AVATAR_SIZE = 32;
export const NAME_HEIGHT = 14;
export const BOTTOM_BAND = 48;

export const VIEWER_COLORS = [
	"#f25f5c",
	"#f7a072",
	"#ffd166",
	"#a8d06a",
	"#5bc0eb",
	"#8f8ff2",
	"#c77dff",
	"#ff9ecb",
] as const;

export type ViewerState = "idle" | "walk" | "celebrate" | "leaving";

export interface ViewerNodeIds {
	readonly root: NodeId;
	readonly sprite: NodeId;
	readonly name: NodeId;
}

export interface Viewer {
	readonly id: ViewerId;
	readonly displayName: string;
	readonly color: string;
	readonly avatarIndex: number;
	readonly nodeIds: ViewerNodeIds;
	x: number;
	y: number;
	vx: number;
	vy: number;
	state: ViewerState;
	celebrateUntil: number;
	lastSeenAt: number;
	leavingUntil: number;
}

export interface WorldBounds {
	readonly width: number;
	readonly height: number;
}

export interface SpawnOptions {
	readonly bounds: WorldBounds;
	readonly now: number;
	readonly rng: () => number;
}

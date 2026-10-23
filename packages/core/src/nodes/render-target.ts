import type { NodeId, WidgetId } from "@tv/protocol";
import type { Container, Filter, Texture } from "pixi.js";

export interface RenderHandle {
	readonly nodeId: NodeId;
	readonly kind: string;
}
export interface NodeTransform {
	readonly x?: number;
	readonly y?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly rotation?: number;
	readonly alpha?: number;
	readonly visible?: boolean;
}

export interface TextStyleOptions {
	readonly fontSize: number;
	readonly fill: string;
	readonly align: "left" | "center" | "right";
}

export interface AnimationState {
	readonly fps: number;
	readonly loop: boolean;
	readonly frameCount: number;
}

export interface FilterParamState {
	readonly effectId: string;
	readonly param: string;
	readonly value: number;
}

export interface NodeSnapshot {
	nodeId: NodeId;
	kind: string;
	parentId: NodeId | undefined;
	order: number;
	transform: NodeTransform;
	content: "none" | "sprite" | "animated" | "text";
	text: string | undefined;
	textStyle: TextStyleOptions | undefined;
	animation: AnimationState | undefined;
	filterIds: readonly string[];
	filterParams: readonly FilterParamState[];
}

export interface RenderSnapshot {
	readonly nodes: readonly NodeSnapshot[];
}

export interface RenderTarget {
	readonly widgetId: WidgetId;
	readonly root: Container;
	createNode(nodeId: NodeId, kind: string): RenderHandle;
	removeNode(nodeId: NodeId): void;
	setParent(nodeId: NodeId, parentId: NodeId, order: number): void;
	setTransform(nodeId: NodeId, transform: NodeTransform): void;
	setSprite(nodeId: NodeId, texture: Texture): void;
	setAnimation(
		nodeId: NodeId,
		textures: Texture[],
		fps: number,
		loop: boolean,
	): void;
	setText(nodeId: NodeId, text: string, style: TextStyleOptions): void;
	addFilter(nodeId: NodeId, effectId: string, filter: Filter): void;
	removeFilter(nodeId: NodeId, effectId: string): void;
	setFilterParam(
		nodeId: NodeId,
		effectId: string,
		param: string,
		value: number,
	): void;
	snapshot(): RenderSnapshot;
}

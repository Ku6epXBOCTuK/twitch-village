import type { EffectId, NodeId, NodeKind, WidgetId } from "@tv/protocol";
import type { Container, Filter, Texture } from "pixi.js";

export interface RenderHandle {
	readonly nodeId: NodeId;
	readonly kind: NodeKind;
}

export interface NodeTransform {
	readonly x?: number | undefined;
	readonly y?: number | undefined;
	readonly scaleX?: number | undefined;
	readonly scaleY?: number | undefined;
	readonly rotation?: number | undefined;
	readonly alpha?: number | undefined;
	readonly visible?: boolean | undefined;
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
	readonly effectId: EffectId;
	readonly param: string;
	readonly value: number;
}

export interface NodeSnapshot {
	nodeId: NodeId;
	kind: NodeKind;
	parentId: NodeId | undefined;
	order: number;
	transform: NodeTransform;
	content: "none" | "sprite" | "animated" | "text";
	text: string | undefined;
	textStyle: TextStyleOptions | undefined;
	animation: AnimationState | undefined;
	filterIds: readonly EffectId[];
	filterParams: readonly FilterParamState[];
}

export interface RenderSnapshot {
	readonly nodes: readonly NodeSnapshot[];
}

export interface RenderTarget {
	readonly widgetId: WidgetId;
	readonly root: Container;
	createNode(nodeId: NodeId, kind: NodeKind): RenderHandle;
	has(nodeId: NodeId): boolean;
	removeNode(nodeId: NodeId): readonly NodeId[];
	setParent(nodeId: NodeId, parentId: NodeId | null, order: number): void;
	setTransform(nodeId: NodeId, transform: NodeTransform): void;
	setSprite(nodeId: NodeId, texture: Texture): void;
	setAnimation(
		nodeId: NodeId,
		textures: Texture[],
		fps: number,
		loop: boolean,
	): void;
	setText(nodeId: NodeId, text: string, style: TextStyleOptions): void;
	addFilter(nodeId: NodeId, effectId: EffectId, filter: Filter): void;
	removeFilter(nodeId: NodeId, effectId: EffectId): void;
	setFilterParam(
		nodeId: NodeId,
		effectId: EffectId,
		param: string,
		value: number,
	): void;
	snapshot(): RenderSnapshot;
}

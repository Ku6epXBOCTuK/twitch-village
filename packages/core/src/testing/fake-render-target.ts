import type { NodeId, WidgetId } from "@tv/protocol";
import type { Container, Filter, Texture } from "pixi.js";
import type {
	RenderHandle,
	RenderSnapshot,
	RenderTarget,
} from "../nodes/render-target";
import { createRenderState, type RenderState } from "../nodes/render-state";

export interface FakeRenderTargetOptions {
	readonly widgetId: WidgetId;
}

export interface FakeRenderCall {
	readonly method: string;
	readonly args: readonly unknown[];
}

export interface FakeRenderTarget extends RenderTarget {
	readonly calls: readonly FakeRenderCall[];
}

export function createFakeRenderTarget(
	options: FakeRenderTargetOptions,
): FakeRenderTarget {
	const state: RenderState = createRenderState(options.widgetId);
	const calls: FakeRenderCall[] = [];

	const record = (method: string, args: readonly unknown[]): void => {
		calls.push({ method, args });
	};

	const target: FakeRenderTarget = {
		widgetId: options.widgetId,
		root: {} as Container,
		calls,
		createNode(nodeId: NodeId, kind: string): RenderHandle {
			record("createNode", [nodeId, kind]);
			state.createNode(nodeId, kind);
			return { nodeId, kind };
		},
		removeNode(nodeId: NodeId): void {
			record("removeNode", [nodeId]);
			state.removeNode(nodeId);
		},
		setParent(nodeId: NodeId, parentId: NodeId, order: number): void {
			record("setParent", [nodeId, parentId, order]);
			state.setParent(nodeId, parentId, order);
		},
		setTransform(nodeId, transform): void {
			record("setTransform", [nodeId, transform]);
			state.setTransform(nodeId, transform);
		},
		setSprite(nodeId: NodeId, texture: Texture): void {
			record("setSprite", [nodeId, texture]);
			state.setSprite(nodeId);
		},
		setAnimation(nodeId, textures, fps, loop): void {
			record("setAnimation", [nodeId, textures, fps, loop]);
			state.setAnimation(nodeId, fps, loop, textures.length);
		},
		setText(nodeId, text, style): void {
			record("setText", [nodeId, text, style]);
			state.setText(nodeId, text, style);
		},
		addFilter(nodeId: NodeId, effectId: string, filter: Filter): void {
			record("addFilter", [nodeId, effectId, filter]);
			state.addFilter(nodeId, effectId);
		},
		removeFilter(nodeId: NodeId, effectId: string): void {
			record("removeFilter", [nodeId, effectId]);
			state.removeFilter(nodeId, effectId);
		},
		setFilterParam(nodeId, effectId, param, value): void {
			record("setFilterParam", [nodeId, effectId, param, value]);
			state.setFilterParam(nodeId, effectId, param, value);
		},
		snapshot(): RenderSnapshot {
			return state.snapshot();
		},
	};

	return target;
}

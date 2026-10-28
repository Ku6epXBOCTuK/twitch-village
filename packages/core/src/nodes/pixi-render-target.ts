import {
	InvalidCommand,
	type EffectId,
	type NodeId,
	type WidgetId,
} from "@tv/protocol";
import type { Filter, Texture } from "pixi.js";
import { AnimatedSprite, Container, Sprite, Text } from "pixi.js";
import { createRenderState } from "./render-state";
import type {
	RenderSnapshot,
	RenderTarget,
	TextStyleOptions,
} from "./render-target";

export interface PixiRenderTargetOptions {
	readonly widgetId: WidgetId;
}

export function createPixiRenderTarget(
	options: PixiRenderTargetOptions,
): RenderTarget {
	const state = createRenderState(options.widgetId);
	const root = new Container();
	const views = new Map<NodeId, Container>();
	const contents = new Map<NodeId, Container>();
	const filters = new Map<NodeId, Map<EffectId, Filter>>();

	const requireView = (nodeId: NodeId): Container => {
		const view = views.get(nodeId);
		if (!view) {
			throw new Error(`Missing view for node: ${nodeId}`);
		}
		return view;
	};

	const setContent = (nodeId: NodeId, next: Container): void => {
		const previous = contents.get(nodeId);
		if (previous) {
			previous.removeFromParent();
			previous.destroy({ children: true });
		}
		requireView(nodeId).addChild(next);
		contents.set(nodeId, next);
	};

	const applyFilters = (nodeId: NodeId): void => {
		const list = [...(filters.get(nodeId)?.values() ?? [])];
		requireView(nodeId).filters = list.length > 0 ? list : [];
	};

	return {
		widgetId: options.widgetId,
		root,
		createNode(nodeId, kind) {
			state.createNode(nodeId, kind);
			const view = new Container();
			root.addChild(view);
			views.set(nodeId, view);
			return { nodeId, kind };
		},
		has(nodeId) {
			return state.has(nodeId);
		},
		removeNode(nodeId) {
			const removed = state.removeNode(nodeId);
			const view = views.get(nodeId);
			view?.removeFromParent();
			view?.destroy({ children: true });
			for (const snapshot of removed) {
				views.delete(snapshot.nodeId);
				contents.delete(snapshot.nodeId);
				filters.delete(snapshot.nodeId);
			}
			return removed.map((snapshot) => snapshot.nodeId);
		},
		setParent(nodeId, parentId, order) {
			if (nodeId === parentId) {
				throw new InvalidCommand({
					widgetId: options.widgetId,
					message: "Cannot set a node as its own parent",
					nodeId,
				});
			}
			state.setParent(nodeId, parentId, order);

			if (parentId === null) {
				const index = Math.max(0, Math.min(order, root.children.length));
				root.addChildAt(requireView(nodeId), index);
			} else {
				const parentView = requireView(parentId);
				const index = Math.max(0, Math.min(order, parentView.children.length));
				parentView.addChildAt(requireView(nodeId), index);
			}
		},
		setTransform(nodeId, transform) {
			state.setTransform(nodeId, transform);
			const view = requireView(nodeId);
			if (transform.x !== undefined) view.x = transform.x;
			if (transform.y !== undefined) view.y = transform.y;
			if (transform.scaleX !== undefined) view.scale.x = transform.scaleX;
			if (transform.scaleY !== undefined) view.scale.y = transform.scaleY;
			if (transform.rotation !== undefined) view.rotation = transform.rotation;
			if (transform.alpha !== undefined) view.alpha = transform.alpha;
			if (transform.visible !== undefined) view.visible = transform.visible;
		},
		setSprite(nodeId, texture: Texture) {
			state.setSprite(nodeId);
			const sprite = new Sprite();
			sprite.texture = texture;
			setContent(nodeId, sprite);
		},
		setAnimation(nodeId, textures, fps, loop) {
			state.setAnimation(nodeId, fps, loop, textures.length);
			if (textures.length === 0) {
				contents.get(nodeId)?.destroy({ children: true });
				contents.delete(nodeId);
				return;
			}
			const animation = new AnimatedSprite(textures);
			animation.animationSpeed = fps / 60;
			animation.loop = loop;
			animation.play();
			setContent(nodeId, animation);
		},
		setText(nodeId, text, style: TextStyleOptions) {
			state.setText(nodeId, text, style);
			// NOTE: Pixi Text measures glyphs through a DOM canvas, absent in Node
			if (typeof document === "undefined") {
				return;
			}
			setContent(
				nodeId,
				new Text({
					text,
					style: {
						fontSize: style.fontSize,
						fill: style.fill,
						align: style.align,
					},
				}),
			);
		},
		addFilter(nodeId, effectId, filter: Filter) {
			state.addFilter(nodeId, effectId);
			const nodeFilters = filters.get(nodeId) ?? new Map<EffectId, Filter>();
			nodeFilters.set(effectId, filter);
			filters.set(nodeId, nodeFilters);
			applyFilters(nodeId);
		},
		removeFilter(nodeId, effectId) {
			state.removeFilter(nodeId, effectId);
			filters.get(nodeId)?.delete(effectId);
			applyFilters(nodeId);
		},
		setFilterParam(nodeId, effectId, param, value) {
			state.setFilterParam(nodeId, effectId, param, value);
			const uniforms = (
				filters.get(nodeId)?.get(effectId) as
					{ uniforms?: Record<string, unknown> } | undefined
			)?.uniforms;
			if (uniforms) {
				uniforms[param] = value;
			}
		},
		snapshot(): RenderSnapshot {
			return state.snapshot();
		},
	};
}

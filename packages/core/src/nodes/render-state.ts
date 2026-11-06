import type {
	EffectId,
	FilterParamValue,
	NodeId,
	NodeKind,
	WidgetId,
} from "@tv/protocol";
import { InvalidCommand, UnknownNode } from "@tv/protocol";
import type {
	AnimationState,
	FilterParamState,
	NodeSnapshot,
	NodeTransform,
	RectStyleState,
	RenderSnapshot,
	TextStyleOptions,
} from "./render-target";

interface NodeState {
	nodeId: NodeId;
	kind: NodeKind;
	parentId: NodeId | undefined;
	order: number;
	transform: NodeTransform;
	tint: string | null;
	content: NodeSnapshot["content"];
	text: string | undefined;
	textStyle: TextStyleOptions | undefined;
	rect: RectStyleState | undefined;
	animation: AnimationState | undefined;
	filterIds: EffectId[];
	filterParams: FilterParamState[];
}

export interface RenderState {
	readonly widgetId: WidgetId;
	createNode(nodeId: NodeId, kind: NodeKind): void;
	has(nodeId: NodeId): boolean;
	removeNode(nodeId: NodeId): readonly NodeId[];
	setParent(nodeId: NodeId, parentId: NodeId | null, order: number): void;
	setTransform(nodeId: NodeId, transform: NodeTransform): void;
	setTint(nodeId: NodeId, tint: string | null): void;
	getTint(nodeId: NodeId): string | null;
	setSprite(nodeId: NodeId): void;
	setAnimation(
		nodeId: NodeId,
		fps: number,
		loop: boolean,
		frameCount: number,
	): void;
	setText(nodeId: NodeId, text: string, style: TextStyleOptions): void;
	setRectStyle(nodeId: NodeId, style: RectStyleState): void;
	addFilter(nodeId: NodeId, effectId: EffectId): void;
	removeFilter(nodeId: NodeId, effectId: EffectId): void;
	setFilterParam(
		nodeId: NodeId,
		effectId: EffectId,
		param: string,
		value: FilterParamValue,
	): void;
	snapshot(): RenderSnapshot;
}

export function createRenderState(widgetId: WidgetId): RenderState {
	const nodes = new Map<NodeId, NodeState>();
	const children = new Map<NodeId | undefined, Set<NodeId>>();

	const indexChild = (nodeId: NodeId, parentId: NodeId | undefined): void => {
		let set = children.get(parentId);
		if (set === undefined) {
			set = new Set();
			children.set(parentId, set);
		}
		set.add(nodeId);
	};

	const unindexChild = (nodeId: NodeId, parentId: NodeId | undefined): void => {
		children.get(parentId)?.delete(nodeId);
	};

	const requireNode = (nodeId: NodeId): NodeState => {
		const node = nodes.get(nodeId);
		if (!node) {
			throw new UnknownNode({
				widgetId,
				message: `Unknown node: ${nodeId}`,
				nodeId,
			});
		}
		return node;
	};

	const collectSubtree = (nodeId: NodeId): readonly NodeId[] => {
		const subtree: NodeId[] = [];
		const stack: NodeId[] = [nodeId];
		while (stack.length > 0) {
			const current = stack.pop();
			if (current === undefined) break;
			subtree.push(current);
			const nested = children.get(current);
			if (nested === undefined) continue;
			for (const child of nested) {
				stack.push(child);
			}
		}
		return subtree;
	};

	const toSnapshot = (node: NodeState): NodeSnapshot => ({
		nodeId: node.nodeId,
		kind: node.kind,
		parentId: node.parentId,
		order: node.order,
		transform: { ...node.transform },
		tint: node.tint,
		content: node.content,
		text: node.text,
		textStyle: node.textStyle === undefined ? undefined : { ...node.textStyle },
		rect: node.rect === undefined ? undefined : { ...node.rect },
		animation: node.animation === undefined ? undefined : { ...node.animation },
		filterIds: [...node.filterIds],
		filterParams: node.filterParams.map((param) => ({ ...param })),
	});

	return {
		widgetId,
		createNode(nodeId, kind) {
			if (nodes.has(nodeId)) {
				throw new InvalidCommand({
					widgetId,
					message: `Node already exists: ${nodeId}`,
					nodeId,
				});
			}
			nodes.set(nodeId, {
				nodeId,
				kind,
				parentId: undefined,
				order: 0,
				transform: {},
				tint: null,
				content: "none",
				text: undefined,
				textStyle: undefined,
				rect: undefined,
				animation: undefined,
				filterIds: [],
				filterParams: [],
			});
			indexChild(nodeId, undefined);
		},
		has(nodeId) {
			return nodes.has(nodeId);
		},
		removeNode(nodeId) {
			requireNode(nodeId);
			const removed = collectSubtree(nodeId);
			for (const removedId of removed) {
				const node = nodes.get(removedId);
				if (node === undefined) continue;
				unindexChild(removedId, node.parentId);
				children.delete(removedId);
				nodes.delete(removedId);
			}
			return removed;
		},
		setParent(nodeId, parentId, order) {
			if (parentId !== null) {
				if (parentId === nodeId) {
					throw new InvalidCommand({
						widgetId,
						message: `Cannot set parent to self: ${nodeId}`,
						nodeId,
					});
				}
				if (collectSubtree(nodeId).includes(parentId)) {
					throw new InvalidCommand({
						widgetId,
						message: `Cannot move a node under its own descendant: ${nodeId}`,
						nodeId,
					});
				}
				const node = requireNode(nodeId);
				requireNode(parentId);
				unindexChild(nodeId, node.parentId);
				node.parentId = parentId;
				node.order = order;
				indexChild(nodeId, parentId);
			} else {
				const node = requireNode(nodeId);
				unindexChild(nodeId, node.parentId);
				node.parentId = undefined;
				node.order = order;
				indexChild(nodeId, undefined);
			}
		},
		setTransform(nodeId, transform) {
			const node = requireNode(nodeId);
			node.transform = { ...node.transform, ...transform };
		},
		setTint(nodeId, tint) {
			requireNode(nodeId).tint = tint;
		},
		getTint(nodeId) {
			return requireNode(nodeId).tint;
		},
		setSprite(nodeId) {
			requireNode(nodeId).content = "sprite";
		},
		setAnimation(nodeId, fps, loop, frameCount) {
			const node = requireNode(nodeId);
			node.content = "animated";
			node.animation = { fps, loop, frameCount };
		},
		setText(nodeId, text, style) {
			const node = requireNode(nodeId);
			node.content = "text";
			node.text = text;
			node.textStyle = { ...style };
		},
		setRectStyle(nodeId, style) {
			const node = requireNode(nodeId);
			node.content = "rect";
			node.rect = { ...style };
		},
		addFilter(nodeId, effectId) {
			const node = requireNode(nodeId);
			if (!node.filterIds.includes(effectId)) {
				node.filterIds.push(effectId);
			}
		},
		removeFilter(nodeId, effectId) {
			const node = requireNode(nodeId);
			node.filterIds = node.filterIds.filter((id) => id !== effectId);
			node.filterParams = node.filterParams.filter(
				(param) => param.effectId !== effectId,
			);
		},
		setFilterParam(nodeId, effectId, param, value) {
			const node = requireNode(nodeId);
			const existing = node.filterParams.find(
				(item) => item.effectId === effectId && item.param === param,
			);
			if (existing) {
				node.filterParams = node.filterParams.map((item) =>
					item === existing ? { ...item, value } : item,
				);
				return;
			}
			node.filterParams.push({ effectId, param, value });
		},
		snapshot() {
			return { nodes: [...nodes.values()].map(toSnapshot) };
		},
	};
}

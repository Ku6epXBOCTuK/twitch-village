import type { NodeId, WidgetId } from "@tv/protocol";
import { InvalidCommand, UnknownNode } from "@tv/protocol";
import type {
	AnimationState,
	FilterParamState,
	NodeSnapshot,
	NodeTransform,
	RenderSnapshot,
	TextStyleOptions,
} from "./render-target";

interface NodeState {
	nodeId: NodeId;
	kind: string;
	parentId: NodeId | undefined;
	order: number;
	transform: NodeTransform;
	content: NodeSnapshot["content"];
	text: string | undefined;
	textStyle: TextStyleOptions | undefined;
	animation: AnimationState | undefined;
	filterIds: string[];
	filterParams: FilterParamState[];
}

export interface RenderState {
	readonly widgetId: WidgetId;
	createNode(nodeId: NodeId, kind: string): void;
	removeNode(nodeId: NodeId): readonly NodeSnapshot[];
	setParent(nodeId: NodeId, parentId: NodeId | null, order: number): void;
	setTransform(nodeId: NodeId, transform: NodeTransform): void;
	setSprite(nodeId: NodeId): void;
	setAnimation(
		nodeId: NodeId,
		fps: number,
		loop: boolean,
		frameCount: number,
	): void;
	setText(nodeId: NodeId, text: string, style: TextStyleOptions): void;
	addFilter(nodeId: NodeId, effectId: string): void;
	removeFilter(nodeId: NodeId, effectId: string): void;
	setFilterParam(
		nodeId: NodeId,
		effectId: string,
		param: string,
		value: number,
	): void;
	snapshot(): RenderSnapshot;
}

export function createRenderState(widgetId: WidgetId): RenderState {
	const nodes = new Map<NodeId, NodeState>();

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
		const subtree: NodeId[] = [nodeId];
		for (const node of nodes.values()) {
			if (node.parentId === nodeId) {
				subtree.push(...collectSubtree(node.nodeId));
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
		content: node.content,
		text: node.text,
		textStyle: node.textStyle === undefined ? undefined : { ...node.textStyle },
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
				content: "none",
				text: undefined,
				textStyle: undefined,
				animation: undefined,
				filterIds: [],
				filterParams: [],
			});
		},
		removeNode(nodeId) {
			requireNode(nodeId);
			const removed = collectSubtree(nodeId).map((id) =>
				toSnapshot(requireNode(id)),
			);
			for (const snapshot of removed) {
				nodes.delete(snapshot.nodeId);
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
						message: `Cannot set parent to self: ${nodeId}`,
						nodeId,
					});
				}
				const node = requireNode(nodeId);
				requireNode(parentId);
				node.parentId = parentId;
				node.order = order;
			} else {
				const node = requireNode(nodeId);
				node.parentId = undefined;
				node.order = order;
			}
		},
		setTransform(nodeId, transform) {
			const node = requireNode(nodeId);
			node.transform = { ...node.transform, ...transform };
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

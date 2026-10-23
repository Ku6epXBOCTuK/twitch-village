import {
	InvalidCommand,
	UnknownNode,
	type NodeId,
	type WidgetId,
} from "@tv/protocol";
import type {
	RenderHandle,
	RenderSnapshot,
	RenderTarget,
} from "./render-target";

export interface NodeRegistryOptions {
	readonly widgetId: WidgetId;
	readonly target: RenderTarget;
}

export interface NodeRegistry {
	create(nodeId: NodeId, kind: string): RenderHandle;
	get(nodeId: NodeId): RenderHandle;
	has(nodeId: NodeId): boolean;
	remove(nodeId: NodeId): void;
	removeAll(): void;
	list(): readonly RenderHandle[];
}

function collectChildrenMap(snapshot: RenderSnapshot): Map<NodeId, NodeId[]> {
	const map = new Map<NodeId, NodeId[]>();
	for (const node of snapshot.nodes) {
		if (node.parentId !== undefined) {
			if (!map.has(node.parentId)) {
				map.set(node.parentId, []);
			}
			map.get(node.parentId)?.push(node.nodeId);
		}
	}
	return map;
}

function collectSubTree(
	nodeId: NodeId,
	childrenMap: Map<NodeId, NodeId[]>,
	visited: Set<NodeId> = new Set(),
): NodeId[] {
	if (visited.has(nodeId)) return [];
	visited.add(nodeId);

	const nodes: NodeId[] = [];
	const childrenNodes = childrenMap.get(nodeId);
	if (childrenNodes !== undefined) {
		for (const childNodeId of childrenNodes) {
			nodes.push(...collectSubTree(childNodeId, childrenMap, visited));
		}
	}

	nodes.push(nodeId);

	return nodes;
}

function collectRoots(snapshot: RenderSnapshot): NodeId[] {
	const roots: NodeId[] = [];

	for (const node of snapshot.nodes) {
		if (node.parentId === undefined) {
			roots.push(node.nodeId);
		}
	}

	return roots;
}

export function createNodeRegistry(options: NodeRegistryOptions): NodeRegistry {
	const nodes = new Map<NodeId, RenderHandle>();
	const { widgetId, target } = options;

	function unknownNode(nodeId: NodeId): UnknownNode {
		return new UnknownNode({
			widgetId,
			message: `node with id ${nodeId} does not exist`,
			nodeId,
		});
	}

	function deleteSubtree(nodeId: NodeId, childrenMap: Map<NodeId, NodeId[]>) {
		if (!nodes.has(nodeId)) {
			throw unknownNode(nodeId);
		}

		const nodesForRemove = collectSubTree(nodeId, childrenMap);
		for (const nodeId of nodesForRemove) {
			target.removeNode(nodeId);
			nodes.delete(nodeId);
		}
	}

	const registry: NodeRegistry = {
		create: (nodeId: NodeId, kind: string): RenderHandle => {
			if (nodes.has(nodeId)) {
				throw new InvalidCommand({
					widgetId,
					message: `node with id ${nodeId} already exists`,
					nodeId,
				});
			}
			const handle = target.createNode(nodeId, kind);
			nodes.set(nodeId, handle);
			return handle;
		},
		get: (nodeId: NodeId): RenderHandle => {
			const handle = nodes.get(nodeId);
			if (handle === undefined) {
				throw unknownNode(nodeId);
			}
			return handle;
		},
		has: (nodeId: NodeId): boolean => {
			return nodes.has(nodeId);
		},
		remove: (nodeId: NodeId) => {
			deleteSubtree(nodeId, collectChildrenMap(target.snapshot()));
		},
		removeAll: () => {
			// NOTE: can optimize by collect roots and childrenMap in one pass
			const snapshot = target.snapshot();
			const roots = collectRoots(snapshot);
			const childrenMap = collectChildrenMap(snapshot);

			for (const nodeId of roots) {
				deleteSubtree(nodeId, childrenMap);
			}

			nodes.clear();
		},
		list: (): readonly RenderHandle[] => {
			return Array.from(nodes.values());
		},
	};
	return registry;
}

import type { VectraProject } from '../types';


// Protected IDs that cannot be deleted
export const PROTECTED_IDS = ['root', 'page-1'];

/**
 * Get all descendant IDs of a node (recursive)
 */
export const getAllDescendants = (elements: VectraProject, nodeId: string): string[] => {
    const node = elements[nodeId];
    if (!node || !node.children) return [];

    let descendants: string[] = [];
    node.children.forEach(childId => {
        descendants.push(childId);
        descendants = [...descendants, ...getAllDescendants(elements, childId)];
    });
    return descendants;
};

/**
 * Delete a node and all its children recursively
 * Prevents orphaned nodes in the project state
 */
export const deleteNodeRecursive = (elements: VectraProject, nodeIdToDelete: string): VectraProject => {
    // Safety Guard: Never delete protected nodes
    if (PROTECTED_IDS.includes(nodeIdToDelete)) {
        console.warn(`⚠️ Cannot delete protected node: ${nodeIdToDelete}`);
        return elements;
    }

    const newElements = { ...elements };
    const nodeToDelete = newElements[nodeIdToDelete];

    if (!nodeToDelete) {
        console.warn(`⚠️ Node not found: ${nodeIdToDelete}`);
        return elements;
    }

    // 1. Find Parent and remove reference
    const parentId = Object.keys(newElements).find(key =>
        newElements[key].children?.includes(nodeIdToDelete)
    );

    if (parentId && newElements[parentId]) {
        newElements[parentId] = {
            ...newElements[parentId],
            children: newElements[parentId].children?.filter(id => id !== nodeIdToDelete) || []
        };
    }

    // 2. Identify all nodes to remove (node + descendants)
    const idsToRemove = [nodeIdToDelete, ...getAllDescendants(newElements, nodeIdToDelete)];

    console.log(`🗑️ Deleting ${idsToRemove.length} nodes:`, idsToRemove);

    // 3. Delete them all
    idsToRemove.forEach(id => {
        delete newElements[id];
    });

    return newElements;
};

/**
 * Check if a node can be safely deleted
 */
export const canDeleteNode = (nodeId: string): boolean => {
    return !PROTECTED_IDS.includes(nodeId);
};

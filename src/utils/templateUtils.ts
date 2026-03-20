/**
 * --- TEMPLATE UTILS ---------------------------------------------------------
 * Deep-clones a template subtree from the element tree, assigning fresh
 * collision-resistant IDs to every node in the clone. Used when duplicating
 * elements, instantiating drag-dropped templates, and grouping selections.
 */
import type { VectraProject, VectraNode } from '../types';

export const instantiateTemplate = (
    templateRootId: string,
    templateNodes: VectraProject
): { newNodes: VectraProject; rootId: string } => {

    const idMap: Record<string, string> = {};
    const newNodes: VectraProject = {};

    // 1. First Pass: Generate new IDs for every node in the template
    const getAllDescendants = (nodeId: string): string[] => {
        const node = templateNodes[nodeId];
        if (!node) return [];
        let descendants = [nodeId];
        node.children?.forEach(child => {
            descendants = [...descendants, ...getAllDescendants(child)];
        });
        return descendants;
    };

    const nodesToClone = getAllDescendants(templateRootId);

    nodesToClone.forEach(oldId => {
        // crypto.randomUUID() — guaranteed unique per RFC 4122. Date.now()+random had ~60M collision space and the same ms timestamp for all nodes in a 30+ node bulk instantiation on a loaded CPU
        const newId = `el-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        idMap[oldId] = newId;
    });

    // 2. Second Pass: Clone the data and update references
    nodesToClone.forEach(oldId => {
        const newId = idMap[oldId];
        const oldNode = templateNodes[oldId];

        // Deep copy the node
        const newNode: VectraNode = JSON.parse(JSON.stringify(oldNode));

        // Update Metadata
        newNode.id = newId;

        // Update Children references (point to new IDs)
        if (newNode.children) {
            newNode.children = newNode.children.map(childId => idMap[childId]).filter(Boolean);
        }

        newNodes[newId] = newNode;
    });

    return { newNodes, rootId: idMap[templateRootId] };
};

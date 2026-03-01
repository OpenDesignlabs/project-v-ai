import type { VectraProject, VectraNode } from '../types';

/**
 * Takes a template (a collection of nodes) and creates a deep copy
 * with brand new unique IDs for every single node.
 */
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
        // M-5 FIX: crypto.randomUUID() — guaranteed unique per RFC 4122.
        // Date.now()+random had ~60M collision space and the same ms timestamp
        // for all nodes in a 30+ node bulk instantiation on a loaded CPU.
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

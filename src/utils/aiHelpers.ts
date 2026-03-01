import type { VectraProject, VectraNode } from '../types';

// --- 1. JSON REPAIR ---
// Fixes truncated or malformed JSON from the AI by auto-closing missing braces
export const repairJSON = (jsonStr: string): string => {
    let repaired = jsonStr.trim();

    // ── Stage 1: Detect truncation inside the "code" string ──────────────────
    // The AI most commonly runs out of tokens while writing JSX inside the
    // "code" value. We find that block, check if the string is still open,
    // and inject a safe JSX/function closer before sealing the JSON string.
    const codeKeyIdx = repaired.lastIndexOf('"code"');
    if (codeKeyIdx !== -1) {
        // Find the opening quote of the code value: "code": "<here>
        const afterKey = repaired.indexOf('"', repaired.indexOf(':', codeKeyIdx) + 1);
        if (afterKey !== -1) {
            // Walk from the opening quote, respecting escape sequences, to see if it closed
            let inStr = true; // we START inside the string
            let escaped = false;
            let closedAt = -1;
            for (let i = afterKey + 1; i < repaired.length; i++) {
                const ch = repaired[i];
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === '"') { inStr = false; closedAt = i; break; }
            }
            if (inStr || closedAt === -1) {
                // String was never closed — AI was cut off mid-component.
                // Append a safe JSX+function closer, then seal the JSON string.
                console.log('🔧 repairJSON: AI truncated inside "code" string — injecting closure');
                repaired += '</div>}';   // close any open JSX + the function body
                repaired += '"';         // close the JSON string value
            }
        }
    }

    // ── Stage 2: Walk string respecting escapes, count structural brackets ────
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < repaired.length; i++) {
        const ch = repaired[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') openBraces++;
        else if (ch === '}') openBraces--;
        else if (ch === '[') openBrackets++;
        else if (ch === ']') openBrackets--;
    }

    // ── Stage 3: Close arrays before objects (correct nesting order) ─────────
    if (openBrackets > 0) {
        console.log(`🔧 repairJSON: Adding ${openBrackets} closing bracket(s)`);
        repaired += ']'.repeat(openBrackets);
    }
    if (openBraces > 0) {
        console.log(`🔧 repairJSON: Adding ${openBraces} closing brace(s)`);
        repaired += '}'.repeat(openBraces);
    }

    return repaired;
};



// --- 2. ID SANITIZATION ---
// Renames all IDs in an AI-generated element map to be globally unique,
// preventing collisions with existing project nodes (e.g. "root_1", "container_1").
export const sanitizeAIElements = (
    elements: Record<string, VectraNode>,
    rootId: string
): { sanitizedElements: Record<string, VectraNode>; newRootId: string } => {
    const idMap: Record<string, string> = {};
    const incomingIds = Object.keys(elements);

    // Build a mapping: old ID → new unique ID
    incomingIds.forEach(oldId => {
        // NH-3 FIX: crypto.randomUUID() — same collision-free standard applied in M-5/templateUtils.
        // Date.now() + Math.random() produced identical IDs for all nodes in a single AI pass
        // (same millisecond, tiny random suffix space). Orphaned subtrees + corrupt parentMap resulted.
        idMap[oldId] = `ai_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    });

    // Reconstruct the element map with remapped IDs and children
    const sanitizedElements: Record<string, VectraNode> = {};
    incomingIds.forEach(oldId => {
        const el = elements[oldId];
        const newId = idMap[oldId];
        const newChildren = (el.children || []).map(
            (childId: string) => idMap[childId] || childId
        );

        sanitizedElements[newId] = { ...el, id: newId, children: newChildren };
    });

    const newRootId = idMap[rootId] || rootId;
    console.log('🔧 ID Sanitization:', {
        originalRoot: rootId,
        newRoot: newRootId,
        totalElements: Object.keys(sanitizedElements).length,
    });

    return { sanitizedElements, newRootId };
};

// --- 3. MERGE STRATEGY ---
// Integrates sanitized AI-generated content into the current project state.
// isFullPage=true  → REPLACE the page's children with the new root
// isFullPage=false → APPEND the new root to the page's existing children
export const mergeAIContent = (
    currentProject: VectraProject,
    pageRootId: string,
    aiElements: Record<string, VectraNode>,
    aiRootId: string,
    isFullPage: boolean
): VectraProject => {

    // Step 1 – sanitize incoming IDs
    const { sanitizedElements, newRootId } = sanitizeAIElements(aiElements, aiRootId);

    // Step 2 – merge flat maps
    const mergedProject: VectraProject = { ...currentProject, ...sanitizedElements };
    const pageRoot = mergedProject[pageRootId];

    if (!pageRoot) {
        console.error('❌ mergeAIContent: Page root not found:', pageRootId);
        return currentProject;
    }

    // Step 3 – attach new root to the page
    if (isFullPage) {
        console.log('🔄 REPLACE mode: Clearing existing page content');
        mergedProject[pageRootId] = { ...pageRoot, children: [newRootId] };
    } else {
        console.log('➕ APPEND mode: Adding to existing content');
        mergedProject[pageRootId] = {
            ...pageRoot,
            children: [...(pageRoot.children || []), newRootId],
        };
    }

    return mergedProject;
};

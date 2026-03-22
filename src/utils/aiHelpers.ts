import type { VectraProject, VectraNode, AiSourceMeta } from '../types';

// --- 1. JSON REPAIR ---
// Fixes truncated or malformed JSON from the AI by auto-closing missing braces
export const repairJSON = (jsonStr: string): string => {
    let repaired = jsonStr.trim();

    // ── Stage 0: Single-quote normalisation ──────────────────────────────────── Some models (especially smaller ones) output JSON with single-quoted keys or values. Standard JSON.parse rejects them
    repaired = repaired.replace(/([{[,:\s])\s*'([^']*)'/g, (_, boundary, inner) => {
        return `${boundary}"${inner.replace(/"/g, '\\"')}"`;
    });

    // ── Stage 1: Trailing-comma stripping ────────────────────────────────────
    // AI models frequently emit trailing commas before } or ]
    // which are illegal in JSON. Apply iteratively (handles nested cases like
    // [ 1, 2, { "a": 3, }, ] — one pass removes inner trailing comma, second
    // removes outer, third sees no change and stops).
    //
    //   { "a": 1, }  →  { "a": 1 }
    //   [1, 2, 3,]   →  [1, 2, 3]
    //   { "a": { "b": 2, }, }  →  { "a": { "b": 2 } }
    let prev = '';
    while (prev !== repaired) {
        prev = repaired;
        repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
    }

    // ── Stage 2: Detect truncation inside the "code" string ──────────────────
    // (Was Stage 1 — unchanged, renumbered for SPRINT-B-FIX-30 insertion above)
    // The AI most commonly runs out of tokens while writing JSX inside the
    // "code" value. We find that block, check if the string is still open,
    // and inject a safe JSX/function closer before sealing the JSON string.
    const codeKeyIdx = repaired.lastIndexOf('"code"');
    if (codeKeyIdx !== -1) {
        const afterKey = repaired.indexOf('"', repaired.indexOf(':', codeKeyIdx) + 1);
        if (afterKey !== -1) {
            let inStr = true;
            let escaped = false;
            let closedAt = -1;
            for (let i = afterKey + 1; i < repaired.length; i++) {
                const ch = repaired[i];
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === '"') { inStr = false; closedAt = i; break; }
            }
            if (inStr || closedAt === -1) {
                console.log('🔧 repairJSON: AI truncated inside "code" string — injecting closure');
                repaired += '</div>}';
                repaired += '"';
            }
        }
    }

    // ── Stage 3: Walk string counting structural brackets ────────────────────
    // (Was Stage 2 — unchanged, renumbered)
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

    // ── Stage 4: Close arrays before objects (correct nesting order) ────────
    // (Was Stage 3 — unchanged, renumbered)
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



// --- 2. ID SANITIZATION --- Renames all IDs in an AI-generated element map to be globally unique, preventing collisions with existing project nodes (e.g. "root_1", "container_1")
export const sanitizeAIElements = (
    elements: Record<string, VectraNode>,
    rootId: string,
    // AI-SOURCE-1: optional metadata stamped onto generated sections.
    // When present, every custom_code node in the incoming elements map
    // receives an aiSource field at creation time. Container/wrapper nodes
    // (type !== 'custom_code') intentionally never receive aiSource.
    aiMeta?: Pick<AiSourceMeta, 'prompt' | 'model'>
): { sanitizedElements: Record<string, VectraNode>; newRootId: string } => {
    const idMap: Record<string, string> = {};
    const incomingIds = Object.keys(elements);

    // Build a mapping: old ID → new unique ID
    incomingIds.forEach(oldId => {
        // crypto.randomUUID() — same collision-free standard applied in M-5/templateUtils.
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

        // AI-SOURCE-1: stamp provenance on code-bearing section nodes only.
        // Container wrappers (PageWrapper, Wrapper) are structural — no aiSource.
        const shouldStamp = el.type === 'custom_code' && !!el.code && !!aiMeta;

        sanitizedElements[newId] = {
            ...el,
            id: newId,
            children: newChildren,
            ...(shouldStamp ? {
                aiSource: {
                    prompt: aiMeta!.prompt,
                    sectionName: el.name ?? 'Section',
                    model: aiMeta!.model,
                    generatedAt: Date.now(),
                } satisfies AiSourceMeta
            } : {}),
        };
    });

    const newRootId = idMap[rootId] || rootId;
    console.log('🔧 ID Sanitization:', {
        originalRoot: rootId,
        newRoot: newRootId,
        totalElements: Object.keys(sanitizedElements).length,
        aiStamped: Object.values(sanitizedElements).filter(n => n.aiSource).length,
    });

    return { sanitizedElements, newRootId };
};

// --- 3. MERGE STRATEGY --- Integrates sanitized AI-generated content into the current project state. isFullPage=true  → REPLACE the page's children with the new root
export const mergeAIContent = (
    currentProject: VectraProject,
    pageRootId: string,
    aiElements: Record<string, VectraNode>,
    aiRootId: string,
    isFullPage: boolean,
    // AI-SOURCE-1: thread through to sanitizeAIElements for provenance stamping.
    aiMeta?: Pick<AiSourceMeta, 'prompt' | 'model'>
): VectraProject => {

    // Step 1 – sanitize incoming IDs (+ stamp aiSource when aiMeta provided)
    const { sanitizedElements, newRootId } = sanitizeAIElements(aiElements, aiRootId, aiMeta);

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

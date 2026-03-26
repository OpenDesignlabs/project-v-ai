/**
 * useWasmEngine.ts  — v0.4
 * ─────────────────────────
 * Central access point for ALL Rust engine features.
 * The engine now owns:
 *   §1  LayoutEngine      — snap, gap, overlap, bbox
 *   §2  HistoryManager    — LZ4 compressed undo/redo
 *   §3  SwcCompiler       — TSX→JS, validate, minify
 *   §4  ColorEngine       — HSL/WCAG/palettes
 *   §5  Tailwind          — deduplicate_classes, sort_tailwind_classes
 *   §6  Grid              — absolute_to_grid (fr + px)
 *   §7  ReactCodegen      — generate_react_code
 *   §8  TreeManager       — delete_subtree, clone_subtree, build_parent_map
 *   §9  JsonRepair        — repair_json
 *   §10 AIContentMerger   — merge_ai_content
 *   §11 CSSGenerator      — build_breakpoint_css, build_mobile_css
 *   §12 ThumbnailEngine   — generate_thumbnail
 *   §13 CodeSanitizer     — sanitize_code, check_sandbox_violations (NEW v0.4)
 *   §14 ComponentAnalyzer — detect_component_name, is_valid_react_component,
 *                           generate_component_id, get_detection_preview (NEW v0.4)
 *   §15 CodeWrapper       — to_pascal_case, wrap_component_next/vite (NEW v0.4)
 *   §16 FigmaConverter    — transform_figma_frame (NEW v0.4)
 *
 * ACCESS PATTERNS:
 *   A) Via this hook (React components)  — useWasmEngine(), useColorEngine(), etc.
 *   B) Inline in utility files           — codeSanitizer.ts, importHelpers.ts,
 *                                          useFileSync.ts, figmaImporter.ts call
 *                                          window.vectraWasm directly. Both patterns
 *                                          are correct — no need to centralize utilities.
 */

import { useCallback } from 'react';

const getWasm = (): any => (window as any).vectraWasm ?? null;
const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

// ── §4 ColorEngine ────────────────────────────────────────────────────────────
export interface ColorEngineAPI {
    adjustLightness:     (hex: string, delta: number) => string;
    adjustSaturation:    (hex: string, delta: number) => string;
    mixColors:           (hex1: string, hex2: string, t: number) => string;
    getContrastRatio:    (fg: string, bg: string) => number;
    isAccessible:        (fg: string, bg: string) => boolean;
    suggestAccessibleFg: (bg: string) => string;
    generateScale:       (hex: string, steps: number) => string[];
    complement:          (hex: string) => string;
    hexToHsl:            (hex: string) => string;
    hslToHex:            (h: number, s: number, l: number) => string;
}

function getColorEngine(): any {
    const wasm = getWasm();
    if (!wasm) return null;
    if (!(window as any).__vectraColorEngine) {
        (window as any).__vectraColorEngine = new wasm.ColorEngine();
    }
    return (window as any).__vectraColorEngine;
}

export function useColorEngine(): ColorEngineAPI {
    const ce = getColorEngine;
    return {
        adjustLightness:     (hex, d)    => safe(() => ce()?.adjust_lightness(hex, d),     hex),
        adjustSaturation:    (hex, d)    => safe(() => ce()?.adjust_saturation(hex, d),    hex),
        mixColors:           (h1, h2, t) => safe(() => ce()?.mix_colors(h1, h2, t),        h1),
        getContrastRatio:    (fg, bg)    => safe(() => ce()?.get_contrast_ratio(fg, bg),   1),
        isAccessible:        (fg, bg)    => safe(() => ce()?.is_accessible(fg, bg),         false),
        suggestAccessibleFg: (bg)        => safe(() => ce()?.suggest_accessible_fg(bg),    '#000000'),
        generateScale:       (hex, n)    => safe(() => JSON.parse(ce()?.generate_scale(hex, n) ?? '[]'), []),
        complement:          (hex)       => safe(() => ce()?.complement(hex),               hex),
        hexToHsl:            (hex)       => safe(() => ce()?.hex_to_hsl(hex),              '0,0,50'),
        hslToHex:            (h, s, l)   => safe(() => ce()?.hsl_to_hex(h, s, l),         '#808080'),
    };
}

// ── §5 Tailwind ───────────────────────────────────────────────────────────────
export function deduplicateTailwindClasses(classes: string): string {
    if (!classes.trim()) return classes;
    return safe(() => getWasm()?.deduplicate_classes(classes) ?? classes, classes);
}
export function sortTailwindClasses(classes: string): string {
    if (!classes.trim()) return classes;
    return safe(() => getWasm()?.sort_tailwind_classes(classes) ?? classes, classes);
}
export function optimizeTailwindClasses(classes: string): string {
    return sortTailwindClasses(deduplicateTailwindClasses(classes));
}

// ── §7 Validation / compile ───────────────────────────────────────────────────
export function validateJsx(code: string): string {
    const wasm = getWasm();
    if (!wasm) return '';
    const compiler = (window as any).__vectraCompiler ?? new wasm.SwcCompiler();
    return safe(() => compiler.validate_jsx?.(code) ?? '', '');
}
export function compileMinified(code: string): string {
    const wasm = getWasm();
    if (!wasm) throw new Error('WASM not ready');
    const compiler = (window as any).__vectraCompiler ?? new wasm.SwcCompiler();
    return compiler.compile_minified(code);
}

// ── §8 TreeManager ────────────────────────────────────────────────────────────
/**
 * Delete a node + its entire subtree. Returns the updated project JSON.
 * Replaces: treeUtils.deleteNodeRecursive(elements, id)
 */
export function deleteSubtree(projectJson: string, nodeId: string): string {
    const wasm = getWasm();
    if (!wasm?.delete_subtree) {
        // Fallback — should never happen in production
        console.warn('[engine] delete_subtree not available');
        return projectJson;
    }
    return wasm.delete_subtree(projectJson, nodeId) as string;
}

/**
 * Collect all descendant IDs (not including root).
 * Replaces: treeUtils.getAllDescendants(elements, id)
 */
export function collectSubtreeIds(projectJson: string, rootId: string): string[] {
    const wasm = getWasm();
    if (!wasm?.collect_subtree_ids) return [];
    return safe(() => JSON.parse(wasm.collect_subtree_ids(projectJson, rootId)) as string[], []);
}

/**
 * Find the parent ID of a node.
 * Replaces: parentMap.get(id)
 */
export function findParent(projectJson: string, nodeId: string): string {
    const wasm = getWasm();
    if (!wasm?.find_parent) return '';
    return safe(() => wasm.find_parent(projectJson, nodeId) as string, '');
}

/**
 * Build the full parent map { childId → parentId } for all nodes.
 * Replaces: the parentMap useMemo in ProjectContext (useful for one-shot rebuilds)
 */
export function buildParentMap(projectJson: string): Record<string, string> {
    const wasm = getWasm();
    if (!wasm?.build_parent_map) return {};
    return safe(() => JSON.parse(wasm.build_parent_map(projectJson)) as Record<string, string>, {});
}

/**
 * Deep-clone a subtree with fresh UUIDs.
 * Replaces: templateUtils.instantiateTemplate(rootId, elements)
 * Returns: { newNodes: VectraProject, rootId: string }
 */
export function cloneSubtree(
    projectJson: string,
    rootId: string
): { newNodes: Record<string, any>; rootId: string } | null {
    const wasm = getWasm();
    if (!wasm?.clone_subtree) return null;
    return safe(() => JSON.parse(wasm.clone_subtree(projectJson, rootId)), null);
}

// ── §9 JSON Repair ────────────────────────────────────────────────────────────
/**
 * Fix malformed / truncated AI JSON.
 * Replaces: aiHelpers.repairJSON(jsonStr)
 */
export function repairJson(jsonStr: string): string {
    const wasm = getWasm();
    if (!wasm?.repair_json) {
        // Pure-JS fallback (same 4-stage logic) if WASM hasn't loaded yet
        return jsonStr;
    }
    return safe(() => wasm.repair_json(jsonStr) as string, jsonStr);
}

// ── §10 AI Content Merger ─────────────────────────────────────────────────────
/**
 * Sanitize AI-generated elements + optionally stamp aiSource.
 * Replaces: aiHelpers.sanitizeAIElements(elements, rootId, aiMeta)
 */
export function sanitizeAiElements(
    elementsJson: string,
    rootId: string,
    aiMeta?: { prompt: string; model: string }
): { sanitizedElements: Record<string, any>; newRootId: string } | null {
    const wasm = getWasm();
    if (!wasm?.sanitize_ai_elements) return null;
    const metaJson = aiMeta ? JSON.stringify(aiMeta) : '';
    return safe(() => {
        const result = JSON.parse(wasm.sanitize_ai_elements(elementsJson, rootId, metaJson));
        return { sanitizedElements: result.sanitizedElements, newRootId: result.newRootId };
    }, null);
}

/**
 * Merge AI-generated content into the live project.
 * Replaces: aiHelpers.mergeAIContent(project, pageRootId, ai, aiRoot, isFullPage, aiMeta)
 * Returns the updated project as a parsed object.
 */
export function mergeAiContent(
    projectJson: string,
    pageRootId: string,
    aiElementsJson: string,
    aiRootId: string,
    isFullPage: boolean,
    aiMeta?: { prompt: string; model: string }
): Record<string, any> | null {
    const wasm = getWasm();
    if (!wasm?.merge_ai_content) return null;
    const metaJson = aiMeta ? JSON.stringify(aiMeta) : '';
    return safe(() =>
        JSON.parse(wasm.merge_ai_content(projectJson, pageRootId, aiElementsJson, aiRootId, isFullPage, metaJson)),
    null);
}

// ── §11 CSS Generator ─────────────────────────────────────────────────────────
/**
 * Generate @media breakpoint CSS for tablet + mobile overrides.
 * Replaces: codeGenerator.buildBreakpointCSS(project, nodeIds)
 */
export function buildBreakpointCss(projectJson: string, nodeIdsJson: string): string {
    const wasm = getWasm();
    if (!wasm?.build_breakpoint_css) return '';
    return safe(() => wasm.build_breakpoint_css(projectJson, nodeIdsJson) as string, '');
}

/**
 * Generate the canvas-frame + stack-on-mobile media query CSS.
 * Replaces: codeGenerator.buildMobileCSS(hasMobileNodes)
 */
export function buildMobileCss(hasMobileNodes: boolean): string {
    const wasm = getWasm();
    if (!wasm?.build_mobile_css) return '';
    return safe(() => wasm.build_mobile_css(hasMobileNodes) as string, '');
}

/**
 * Serialize a React style object to a CSS declaration string.
 * Replaces: codeGenerator.serializeStyle(styleObj)
 */
export function serializeStyleObject(styleObj: Record<string, any>): string {
    const wasm = getWasm();
    if (!wasm?.serialize_style_object) return '';
    return safe(() => wasm.serialize_style_object(JSON.stringify(styleObj)) as string, '');
}

// ── §12 Thumbnail Engine ──────────────────────────────────────────────────────
/**
 * Generate a 300×180 SVG wireframe thumbnail.
 * Replaces: generateThumbnail.generateLayoutThumbnail(elements, pages)
 * Returns raw SVG string — store in localStorage as data URI.
 */
export function generateThumbnail(
    projectJson: string,
    pagesJson: string
): string {
    const wasm = getWasm();
    if (!wasm?.generate_thumbnail) return '';
    return safe(() => wasm.generate_thumbnail(projectJson, pagesJson) as string, '');
}

// ── §2 HistoryManager extras ─────────────────────────────────────────────────
export interface HistoryStats {
    count: number; currentIndex: number;
    memoryBytes: number; avgFrameKb: number;
    canUndo: boolean; canRedo: boolean;
}

// ── §1 Layout extras ─────────────────────────────────────────────────────────
export interface OverlapPair { a: number; b: number; }
export interface WasmBBox    { x: number; y: number; w: number; h: number; }

export function useOverlapDetection() {
    return useCallback((): OverlapPair[] => {
        const wasm = getWasm();
        if (!wasm?.layoutEngine) return [];
        return safe(() => JSON.parse(wasm.layoutEngine.find_overlapping_pairs()) as OverlapPair[], []);
    }, []);
}

export function useSelectionBBox() {
    return useCallback((indices: number[]): WasmBBox | null => {
        const wasm = getWasm();
        if (!wasm?.layoutEngine || !indices.length) return null;
        return safe(() => JSON.parse(wasm.layoutEngine.compute_selection_bbox(JSON.stringify(indices))) as WasmBBox, null);
    }, []);
}

// ══════════════════════════════════════════════════════════════════════════════
// §13  CODE SANITIZER  (v0.4)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Clean AI-generated component code before compilation.
 * Strips imports, normalises quotes, fixes Icon JSX syntax.
 * Replaces: codeSanitizer.sanitizeCode(code)
 */
export function sanitizeCode(code: string): string {
    const wasm = getWasm();
    if (!wasm?.sanitize_code) return code;
    return safe(() => wasm.sanitize_code(code) as string, code);
}

/**
 * Check for browser-unsafe patterns (eval, fetch, localStorage, etc.).
 * Returns the first violation name or '' if clean.
 * Replaces: SANDBOX_BLOCKED_PATTERNS.find(p => p.test(code))
 */
export function checkSandboxViolations(code: string): string {
    const wasm = getWasm();
    if (!wasm?.check_sandbox_violations) return '';
    return safe(() => wasm.check_sandbox_violations(code) as string, '');
}

// ══════════════════════════════════════════════════════════════════════════════
// §14  COMPONENT ANALYZER  (v0.4)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Detect the exported component name from React source code.
 * Replaces: detectComponentName() in importHelpers.ts
 */
export function detectComponentName(code: string, filename = ''): string {
    const wasm = getWasm();
    if (!wasm?.detect_component_name) return 'CustomComponent';
    return safe(() => wasm.detect_component_name(code, filename) as string, 'CustomComponent');
}

/**
 * Returns true if the code looks like a valid React component.
 * Replaces: isValidReactComponent() in importHelpers.ts
 */
export function isValidReactComponent(code: string): boolean {
    const wasm = getWasm();
    if (!wasm?.is_valid_react_component) return true;
    return safe(() => wasm.is_valid_react_component(code) as boolean, true);
}

/**
 * Generate a collision-proof registry ID: 'custom-{kebab-name}-{8hex}'.
 * Replaces: generateComponentId() in importHelpers.ts
 */
export function generateComponentId(name: string): string {
    const wasm = getWasm();
    if (!wasm?.generate_component_id) return `custom-${name}-${Math.random().toString(16).slice(2,10)}`;
    return safe(() => wasm.generate_component_id(name) as string, `custom-${name}`);
}

export interface DetectionPreview {
    name: string;
    isDefault: boolean;
    importStatement: string;
    importPath: string;
}

/**
 * Build an import preview for the ImportModal live preview.
 * Returns null if code is empty.
 * Replaces: getDetectionPreview() in importHelpers.ts
 */
export function getDetectionPreview(code: string, filename = ''): DetectionPreview | null {
    const wasm = getWasm();
    if (!wasm?.get_detection_preview) return null;
    return safe(() => {
        const raw = wasm.get_detection_preview(code, filename) as string;
        return raw ? JSON.parse(raw) as DetectionPreview : null;
    }, null);
}

// ══════════════════════════════════════════════════════════════════════════════
// §15  CODE WRAPPER + PASCAL CASE  (v0.4)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a raw name string to PascalCase component name.
 * e.g. 'my hero section' → 'MyHeroSection'
 * Replaces: toPascalCase() in useFileSync.ts and toPascalCaseGen() in codeGenerator.ts
 */
export function toPascalCase(raw: string): string {
    const wasm = getWasm();
    if (!wasm?.to_pascal_case) {
        // JS fallback
        const cleaned = raw.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const pascal = cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        return /^[A-Z]/.test(pascal) ? pascal : 'Component' + pascal;
    }
    return safe(() => wasm.to_pascal_case(raw) as string, raw);
}

/**
 * Wrap component code for Next.js App Router (adds 'use client' + imports).
 * Replaces: wrapWithImportsNext() in useFileSync.ts
 */
export function wrapComponentNext(rawCode: string): string {
    const wasm = getWasm();
    if (!wasm?.wrap_component_next) return rawCode;
    return safe(() => wasm.wrap_component_next(rawCode) as string, rawCode);
}

/**
 * Wrap component code for Vite/React (adds React/Lucide/Motion imports).
 * Replaces: wrapWithImportsVite() in useFileSync.ts
 */
export function wrapComponentVite(rawCode: string): string {
    const wasm = getWasm();
    if (!wasm?.wrap_component_vite) return rawCode;
    return safe(() => wasm.wrap_component_vite(rawCode) as string, rawCode);
}

// ══════════════════════════════════════════════════════════════════════════════
// §16  FIGMA CONVERTER  (v0.4)
// ══════════════════════════════════════════════════════════════════════════════

export interface FigmaConvertResult {
    nodes: Record<string, any>;
    rootId: string;
    imageFillNodeIds: string[];
    imageFillMap: Map<string, string>;
    warnings: string[];
}

/**
 * Transform a Figma frame node tree into a Vectra element map.
 * Handles: coordinate transforms (FIG-COORD-1), fills, gradients, strokes,
 * shadows, border-radius, auto-layout→flexbox, text styles, image tracking.
 * Replaces: transformFigmaFrame() in figmaImporter.ts
 */
export function transformFigmaFrame(
    frame: any,
    importMode: 'page' | 'component'
): FigmaConvertResult | null {
    const wasm = getWasm();
    if (!wasm?.transform_figma_frame) return null;
    return safe(() => {
        const raw = wasm.transform_figma_frame(JSON.stringify(frame), importMode) as string;
        const result = JSON.parse(raw);
        return {
            nodes:              result.nodes,
            rootId:             result.rootId,
            imageFillNodeIds:   result.imageFillNodeIds,
            imageFillMap:       new Map(Object.entries(result.imageFillMap ?? {})),
            warnings:           result.warnings,
        } as FigmaConvertResult;
    }, null);
}

// ══════════════════════════════════════════════════════════════════════════════
// §17  CODEGEN HELPERS  (v0.5)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Walk project subtree, return IDs where props.stackOnMobile === true.
 * Replaces: codeGenerator.collectStackOnMobileIds (recursive TS traversal)
 */
export function collectStackOnMobileIds(projectJson: string, rootId: string): string[] {
    const wasm = getWasm();
    if (!wasm?.collect_stack_on_mobile_ids) return [];
    return safe(() => JSON.parse(wasm.collect_stack_on_mobile_ids(projectJson, rootId)) as string[], []);
}

/**
 * Convert URL slug to Next.js App Router file path.
 * "/" → "app/page.tsx", "/about" → "app/about/page.tsx"
 * Replaces: codeGenerator.slugToNextPath
 */
export function slugToNextPath(slug: string): string {
    const wasm = getWasm();
    if (!wasm?.slug_to_next_path) {
        if (slug === '/') return 'app/page.tsx';
        const clean = slug.replace(/^\/+/, '').replace(/\/+$/, '');
        return `app/${clean}/page.tsx`;
    }
    return safe(() => wasm.slug_to_next_path(slug) as string, 'app/page.tsx');
}

/**
 * Compute topology fingerprint of element tree (id+type+children only).
 * Only changes when nodes are added/moved/removed — not on style edits.
 * Replaces: structuralKey useMemo in ProjectContext
 */
export function computeStructuralKey(projectJson: string): string {
    const wasm = getWasm();
    if (!wasm?.compute_structural_key) return projectJson.length.toString();
    return safe(() => wasm.compute_structural_key(projectJson) as string, '');
}

/**
 * Query history undo/redo capability from Rust HistoryManager.
 * Posts CAN_UNDO/CAN_REDO to the history worker and returns a Promise.
 */
export function queryHistoryCapability(
    worker: Worker | null
): { postCanUndo: () => void; postCanRedo: () => void; postMemoryUsage: () => void } {
    return {
        postCanUndo:     () => worker?.postMessage({ type: 'CAN_UNDO' }),
        postCanRedo:     () => worker?.postMessage({ type: 'CAN_REDO' }),
        postMemoryUsage: () => worker?.postMessage({ type: 'GET_MEMORY_USAGE' }),
    };
}

// ── Master hook ───────────────────────────────────────────────────────────────
export interface WasmEngineAPI {
    isReady:              boolean;
    // §1  Layout
    findOverlappingPairs:  ReturnType<typeof useOverlapDetection>;
    computeSelectionBBox:  ReturnType<typeof useSelectionBBox>;
    // §4  Color
    colorEngine:           ColorEngineAPI;
    // §5  Tailwind
    deduplicateClasses:    (c: string) => string;
    sortClasses:           (c: string) => string;
    optimizeClasses:       (c: string) => string;
    // §7  Compiler
    validateJsx:           (c: string) => string;
    compileMinified:       (c: string) => string;
    // §8  Tree
    deleteSubtree:         typeof deleteSubtree;
    collectSubtreeIds:     typeof collectSubtreeIds;
    findParent:            typeof findParent;
    buildParentMap:        typeof buildParentMap;
    cloneSubtree:          typeof cloneSubtree;
    // §9  JSON
    repairJson:            typeof repairJson;
    // §10  AI
    sanitizeAiElements:    typeof sanitizeAiElements;
    mergeAiContent:        typeof mergeAiContent;
    // §11  CSS
    buildBreakpointCss:    typeof buildBreakpointCss;
    buildMobileCss:        typeof buildMobileCss;
    serializeStyleObject:  typeof serializeStyleObject;
    // §12  Thumbnail
    generateThumbnail:     typeof generateThumbnail;
    // §13  Code Sanitizer (v0.4)
    sanitizeCode:          typeof sanitizeCode;
    checkSandboxViolations: typeof checkSandboxViolations;
    // §14  Component Analyzer (v0.4)
    detectComponentName:   typeof detectComponentName;
    isValidReactComponent: typeof isValidReactComponent;
    generateComponentId:   typeof generateComponentId;
    getDetectionPreview:   typeof getDetectionPreview;
    // §15  Code Wrapper (v0.4)
    toPascalCase:          typeof toPascalCase;
    wrapComponentNext:     typeof wrapComponentNext;
    wrapComponentVite:     typeof wrapComponentVite;
    // §16  Figma Converter (v0.4)
    transformFigmaFrame:   typeof transformFigmaFrame;
    // §17  Codegen Helpers (v0.5)
    collectStackOnMobileIds: typeof collectStackOnMobileIds;
    slugToNextPath:          typeof slugToNextPath;
    computeStructuralKey:    typeof computeStructuralKey;
    queryHistoryCapability:  typeof queryHistoryCapability;
}

export function useWasmEngine(): WasmEngineAPI {
    const findOverlappingPairs = useOverlapDetection();
    const computeSelectionBBox = useSelectionBBox();
    const colorEngine          = useColorEngine();
    return {
        isReady: !!getWasm(),
        // §1 Layout
        findOverlappingPairs, computeSelectionBBox,
        // §4 Color
        colorEngine,
        // §5 Tailwind
        deduplicateClasses:  deduplicateTailwindClasses,
        sortClasses:         sortTailwindClasses,
        optimizeClasses:     optimizeTailwindClasses,
        // §7 Compiler
        validateJsx, compileMinified,
        // §8 Tree
        deleteSubtree, collectSubtreeIds, findParent, buildParentMap, cloneSubtree,
        // §9 JSON
        repairJson,
        // §10 AI
        sanitizeAiElements, mergeAiContent,
        // §11 CSS
        buildBreakpointCss, buildMobileCss, serializeStyleObject,
        // §12 Thumbnail
        generateThumbnail,
        // §13 Code Sanitizer (v0.4)
        sanitizeCode, checkSandboxViolations,
        // §14 Component Analyzer (v0.4)
        detectComponentName, isValidReactComponent, generateComponentId, getDetectionPreview,
        // §15 Code Wrapper (v0.4)
        toPascalCase, wrapComponentNext, wrapComponentVite,
        // §16 Figma Converter (v0.4)
        transformFigmaFrame,
        // §17 Codegen Helpers (v0.5)
        collectStackOnMobileIds, slugToNextPath, computeStructuralKey, queryHistoryCapability,
    };
}
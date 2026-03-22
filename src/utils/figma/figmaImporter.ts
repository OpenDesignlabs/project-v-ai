/**
 * --- FIGMA IMPORTER ---------------------------------------------------------
 * Converts a Figma node tree (from the Figma REST API) into Vectra canvas
 * elements. Traverses FRAME, COMPONENT, TEXT, and RECTANGLE nodes and
 * maps Figma layout properties (size, fill, typography) to Vectra props.
 */

import type { VectraNode, VectraProject } from '../../types';

// ─── FIGMA API TYPES ──────────────────────────────────────────────────────────
// Subset of Figma v1 REST API — only fields Vectra actually reads.
// Full spec: https://www.figma.com/developers/api#node-types

export interface FigmaColor {
    r: number; // 0–1
    g: number; // 0–1
    b: number; // 0–1
    a: number; // 0–1
}

export interface FigmaBoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface FigmaGradientStop {
    position: number; // 0–1 offset along the gradient
    color: FigmaColor;
}

export interface FigmaPaint {
    type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'IMAGE' | string;
    color?: FigmaColor;
    opacity?: number;
    imageRef?: string;   // present when type === 'IMAGE'
    visible?: boolean;
    /** Present for GRADIENT_LINEAR / GRADIENT_RADIAL paints */
    gradientStops?: FigmaGradientStop[];
}

export interface FigmaTypeStyle {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
    textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
    letterSpacing?: number;
    lineHeightPx?: number;
    italic?: boolean;
    textDecoration?: 'NONE' | 'STRIKETHROUGH' | 'UNDERLINE';
}

export interface FigmaEffect {
    type: 'INNER_SHADOW' | 'DROP_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
    visible?: boolean;
    radius?: number;
    color?: FigmaColor;
    offset?: { x: number; y: number };
}

export interface FigmaNode {
    id: string;
    name: string;
    type: string;
    visible?: boolean;
    opacity?: number;
    children?: FigmaNode[];
    // Geometry
    absoluteBoundingBox?: FigmaBoundingBox;
    // Appearance
    fills?: FigmaPaint[];
    strokes?: FigmaPaint[];
    strokeWeight?: number;
    cornerRadius?: number;
    rectangleCornerRadii?: [number, number, number, number];
    // Auto-layout
    layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
    primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
    counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
    itemSpacing?: number;
    paddingLeft?: number;
    paddingRight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    clipsContent?: boolean;
    // Text
    characters?: string;
    style?: FigmaTypeStyle;
    // Effects
    effects?: FigmaEffect[];
}

export interface FigmaCanvasNode {
    id: string;
    name: string;
    type: 'CANVAS';
    children: FigmaNode[];
    backgroundColor?: FigmaColor;
}

export interface FigmaDocument {
    id: string;
    name: string;
    type: 'DOCUMENT';
    children: FigmaCanvasNode[];
}

export interface FigmaFileResponse {
    name: string;
    lastModified: string;
    version: string;
    document: FigmaDocument;
    components: Record<string, { name: string; description?: string }>;
}

export interface FigmaImageResponse {
    err: string | null;
    images: Record<string, string | null>; // figmaNodeId → CDN URL
}

// ─── PUBLIC RESULT TYPES ──────────────────────────────────────────────────────

export interface FigmaFrameInfo {
    id: string;
    name: string;
    bounds: FigmaBoundingBox;
    canvasName: string;
    isComponent: boolean;
}

export interface FigmaTransformResult {
    nodes: VectraProject;
    rootId: string;
    /** Figma node IDs that had IMAGE fills — need second API call for URLs */
    imageFillNodeIds: string[];
    /** vectraNodeId → figmaNodeId for post-import image URL patching */
    imageFillMap: Map<string, string>;
    warnings: string[];
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MAX_FIGMA_DEPTH = 8;

const RENDERABLE_TYPES = new Set([
    'FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET',
    'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE', 'VECTOR',
    'TEXT', 'BOOLEAN_OPERATION',
]);

const SKIP_FIGMA_TYPES = new Set([
    'DOCUMENT', 'CANVAS', 'SLICE', 'CONNECTOR',
]);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** FIG-SAFE-4: IDs always from crypto.randomUUID — never Figma node IDs */
const genId = (prefix: string): string =>
    `fig-${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

/**
 * figmaColorToCSS
 * Converts Figma 0–1 RGBA float → CSS rgba() / rgb() string.
 * Rounds to avoid sub-pixel float noise in CSS output.
 */
export const figmaColorToCSS = (color: FigmaColor, opacityOverride?: number): string => {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const a = opacityOverride !== undefined
        ? parseFloat(opacityOverride.toFixed(3))
        : parseFloat((color.a).toFixed(3));
    if (a >= 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Returns a CSS gradient string from a GRADIENT_LINEAR or GRADIENT_RADIAL Figma paint. */
const extractGradientFill = (paint: FigmaPaint): string | undefined => {
    if (!paint.gradientStops || paint.gradientStops.length === 0) return undefined;
    const stops = paint.gradientStops
        .map(s => `${figmaColorToCSS(s.color)} ${Math.round(s.position * 100)}%`)
        .join(', ');
    if (paint.type === 'GRADIENT_LINEAR') return `linear-gradient(135deg, ${stops})`;
    if (paint.type === 'GRADIENT_RADIAL') return `radial-gradient(circle, ${stops})`;
    return undefined;
};

/** Returns the first visible SOLID fill as a CSS color, or undefined. */
const extractFigmaFill = (
    fills: FigmaPaint[] | undefined,
    nodeOpacity = 1,
): string | undefined => {
    if (!fills || fills.length === 0) return undefined;
    const solid = fills.find(f => f.type === 'SOLID' && f.visible !== false && f.color);
    if (solid?.color) {
        const eff = (solid.opacity ?? 1) * nodeOpacity;
        return figmaColorToCSS(solid.color, eff < 1 ? eff : undefined);
    }
    // Fall back to gradient if no solid fill
    const gradient = fills.find(f =>
        (f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') &&
        f.visible !== false && f.gradientStops?.length
    );
    if (gradient) return extractGradientFill(gradient);
    return undefined;
};

/** Returns CSS border shorthand from Figma strokes, or undefined. */
const extractFigmaStroke = (
    strokes: FigmaPaint[] | undefined,
    strokeWeight: number | undefined,
): string | undefined => {
    if (!strokes || !strokeWeight || strokes.length === 0) return undefined;
    const solid = strokes.find(s => s.type === 'SOLID' && s.visible !== false && s.color);
    if (solid?.color) return `${strokeWeight}px solid ${figmaColorToCSS(solid.color)}`;
    return undefined;
};

/** Converts Figma DROP_SHADOW effects → CSS box-shadow string. */
const extractBoxShadow = (effects: FigmaEffect[] | undefined): string | undefined => {
    if (!effects || effects.length === 0) return undefined;
    const shadows = effects.filter(e => e.type === 'DROP_SHADOW' && e.visible !== false && e.color);
    if (shadows.length === 0) return undefined;
    return shadows.map(e => {
        const x = e.offset?.x ?? 0;
        const y = e.offset?.y ?? 0;
        return `${x}px ${y}px ${e.radius ?? 0}px ${e.color ? figmaColorToCSS(e.color) : 'rgba(0,0,0,0.25)'}`;
    }).join(', ');
};

/** Converts Figma corner radius (uniform or per-corner) → CSS string. */
const extractBorderRadius = (node: FigmaNode): string | undefined => {
    if (node.rectangleCornerRadii) {
        const [tl, tr, br, bl] = node.rectangleCornerRadii;
        if (tl === tr && tr === br && br === bl) return tl > 0 ? `${tl}px` : undefined;
        return `${tl}px ${tr}px ${br}px ${bl}px`;
    }
    if (node.cornerRadius && node.cornerRadius > 0) return `${node.cornerRadius}px`;
    return undefined;
};

/** Maps Figma TextStyle → React.CSSProperties subset. */
const extractTextStyles = (style: FigmaTypeStyle): React.CSSProperties => {
    const css: React.CSSProperties = {};
    if (style.fontFamily) css.fontFamily = style.fontFamily;
    if (style.fontSize) css.fontSize = `${style.fontSize}px`;
    if (style.fontWeight) css.fontWeight = style.fontWeight;
    if (style.italic) css.fontStyle = 'italic';
    if (style.letterSpacing) css.letterSpacing = `${style.letterSpacing}px`;
    if (style.lineHeightPx) css.lineHeight = `${style.lineHeightPx}px`;
    switch (style.textAlignHorizontal) {
        case 'CENTER': css.textAlign = 'center'; break;
        case 'RIGHT': css.textAlign = 'right'; break;
        case 'JUSTIFIED': css.textAlign = 'justify'; break;
        default: css.textAlign = 'left';
    }
    switch (style.textDecoration) {
        case 'UNDERLINE': css.textDecoration = 'underline'; break;
        case 'STRIKETHROUGH': css.textDecoration = 'line-through'; break;
    }
    return css;
};

// ─── TRANSFORM CONTEXT ────────────────────────────────────────────────────────

interface TransformCtx {
    nodeMap: VectraProject;
    imageFillNodeIds: string[];
    imageFillMap: Map<string, string>;
    warnings: string[];
}

// ─── CORE RECURSIVE TRANSFORMER ───────────────────────────────────────────────

/**
 * figmaNodeToVectraNode
 * ──────────────────────
 * Recursively converts one FigmaNode and its descendants into VectraNodes.
 * All produced nodes are written into ctx.nodeMap.
 *
 * FIG-COORD-1 IMPLEMENTATION:
 *   parentBox = absoluteBoundingBox of the parent frame.
 *   left = node.abs.x - parentBox.x  (coordinates relative to parent).
 *   Top-level call passes the FRAME's own box so the root gets left:0, top:0.
 */
const figmaNodeToVectraNode = (
    node: FigmaNode,
    parentBox: FigmaBoundingBox,
    depth: number,
    ctx: TransformCtx,
): string | null => {
    // Skip invisible nodes
    if (node.visible === false) return null;
    // Skip non-renderable types
    if (SKIP_FIGMA_TYPES.has(node.type)) return null;
    if (!RENDERABLE_TYPES.has(node.type)) {
        ctx.warnings.push(`Skipped unsupported type: ${node.type} ("${node.name}")`);
        return null;
    }

    // depth collapse
    if (depth > MAX_FIGMA_DEPTH) {
        const text = node.characters?.trim();
        if (text) {
            const id = genId('txt');
            ctx.nodeMap[id] = {
                id, type: 'text',
                name: `${node.name} (collapsed)`,
                content: text.slice(0, 500),
                children: [],
                props: { style: { position: 'relative', width: '100%' } },
            };
            return id;
        }
        return null;
    }

    // ── Geometry (FIG-COORD-1) ────────────────────────────────────────────────
    const box = node.absoluteBoundingBox;
    const left = box ? Math.round(box.x - parentBox.x) : 0;
    const top = box ? Math.round(box.y - parentBox.y) : 0;
    const width = box ? Math.round(box.width) : 100;
    const height = box ? Math.round(box.height) : 40;

    // ── Determine VectraNode type ─────────────────────────────────────────────
    let nodeType: string;
    let nodeContent: string | undefined;

    if (node.type === 'TEXT') {
        nodeType = (node.style?.fontSize ?? 0) >= 20 ? 'heading' : 'text';
        nodeContent = node.characters ?? '';
    } else if (node.type === 'LINE' || node.type === 'VECTOR') {
        nodeType = 'container';
        ctx.warnings.push(`Vector/Line "${node.name}" → empty container (SVG not supported in MVP).`);
    } else {
        nodeType = 'container';
    }

    // ── Build style ───────────────────────────────────────────────────────────
    const style: React.CSSProperties = {
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
    };

    if (node.opacity !== undefined && node.opacity < 1) style.opacity = node.opacity;
    if (node.type === 'ELLIPSE') style.borderRadius = '50%';

    const bgFill = extractFigmaFill(node.fills, node.opacity);
    if (bgFill) {
        // Gradient values must go into `background`, not `backgroundColor`
        if (bgFill.startsWith('linear-gradient') || bgFill.startsWith('radial-gradient')) {
            (style as any).background = bgFill;
        } else {
            style.backgroundColor = bgFill;
        }
    }

    const border = extractFigmaStroke(node.strokes, node.strokeWeight);
    if (border) style.border = border;

    const radius = extractBorderRadius(node);
    if (radius && node.type !== 'ELLIPSE') style.borderRadius = radius;

    const shadow = extractBoxShadow(node.effects);
    if (shadow) style.boxShadow = shadow;

    if (node.clipsContent) style.overflow = 'hidden';

    // Auto-layout → flexbox
    if (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') {
        style.display = 'flex';
        style.flexDirection = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
        if (node.itemSpacing) style.gap = `${node.itemSpacing}px`;
        if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
            style.padding = `${node.paddingTop ?? 0}px ${node.paddingRight ?? 0}px ${node.paddingBottom ?? 0}px ${node.paddingLeft ?? 0}px`;
        }
        const primary = node.primaryAxisAlignItems;
        const counter = node.counterAxisAlignItems;
        if (node.layoutMode === 'HORIZONTAL') {
            style.justifyContent = primary === 'CENTER' ? 'center' : primary === 'MAX' ? 'flex-end' : primary === 'SPACE_BETWEEN' ? 'space-between' : 'flex-start';
            style.alignItems = counter === 'CENTER' ? 'center' : counter === 'MAX' ? 'flex-end' : 'flex-start';
        } else {
            style.alignItems = primary === 'CENTER' ? 'center' : primary === 'MAX' ? 'flex-end' : 'flex-start';
            style.justifyContent = counter === 'CENTER' ? 'center' : counter === 'MAX' ? 'flex-end' : 'flex-start';
        }
    }

    // Text styles
    if (nodeType === 'text' || nodeType === 'heading') {
        if (node.style) Object.assign(style, extractTextStyles(node.style));
        const textColor = extractFigmaFill(node.fills);
        if (textColor) style.color = textColor;
        delete style.backgroundColor; // text nodes in Figma have no background
    }

    // ── IMAGE fill detection ──────────────────────────────────────────────────
    const hasImageFill = node.fills?.some(f => f.type === 'IMAGE' && f.visible !== false);

    // ── Build VectraNode ──────────────────────────────────────────────────────
    const vectraId = genId(nodeType.slice(0, 3));
    const vectraNode: VectraNode = {
        id: vectraId,
        type: hasImageFill ? 'image' : nodeType,
        name: node.name.slice(0, 60),
        children: [],
        props: { style },
    };

    if (nodeContent !== undefined) vectraNode.content = nodeContent.slice(0, 2000);

    if (hasImageFill) {
        ctx.imageFillNodeIds.push(node.id);
        ctx.imageFillMap.set(vectraId, node.id);
        vectraNode.src = ''; // placeholder until async image URL resolves
    }

    // ── Recurse into children ─────────────────────────────────────────────────
    if (!hasImageFill && nodeType === 'container' && node.children) {
        const childBox = box ?? parentBox; // this node's box becomes parent for children
        const childIds: string[] = [];
        for (const child of node.children) {
            const childId = figmaNodeToVectraNode(child, childBox, depth + 1, ctx);
            if (childId) childIds.push(childId);
        }
        vectraNode.children = childIds;
    }

    // final guard before writing to nodeMap
    if (!vectraNode.id || !vectraNode.type || !vectraNode.name) return null;
    if (!Array.isArray(vectraNode.children)) vectraNode.children = [];
    if (!vectraNode.props?.style || typeof vectraNode.props.style !== 'object') {
        vectraNode.props = { ...vectraNode.props, style: {} };
    }

    ctx.nodeMap[vectraId] = vectraNode;
    return vectraId;
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * extractFileKey
 * ──────────────
 * Extracts the Figma file key from a full URL or returns a raw key unchanged.
 * Supports: /file/{key}/, /design/{key}/, /proto/{key}/, raw key string.
 */
export const extractFileKey = (urlOrKey: string): string | null => {
    const trimmed = urlOrKey.trim();
    if (/^[a-zA-Z0-9]{10,}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
};

/**
 * extractTopLevelFrames
 * ──────────────────────
 * Returns all importable top-level FRAMEs and COMPONENTs from all canvases
 * in the Figma document. Skips invisible frames.
 */
export const extractTopLevelFrames = (doc: FigmaDocument): FigmaFrameInfo[] => {
    const frames: FigmaFrameInfo[] = [];
    for (const canvas of doc.children) {
        if (canvas.type !== 'CANVAS') continue;
        for (const node of canvas.children) {
            if (!['FRAME', 'COMPONENT', 'COMPONENT_SET'].includes(node.type)) continue;
            if (node.visible === false) continue;
            frames.push({
                id: node.id,
                name: node.name,
                bounds: node.absoluteBoundingBox ?? { x: 0, y: 0, width: 1440, height: 900 },
                canvasName: canvas.name,
                isComponent: node.type === 'COMPONENT' || node.type === 'COMPONENT_SET',
            });
        }
    }
    return frames;
};

/**
 * findNodeById
 * ────────────
 * BFS search for a specific FigmaNode within a loaded FigmaFileResponse.
 * Used by FigmaPanel to get the raw node to pass to transformFigmaFrame().
 */
export const findNodeById = (doc: FigmaFileResponse, targetId: string): FigmaNode | null => {
    const queue: FigmaNode[] = [];
    for (const canvas of doc.document.children) {
        for (const child of canvas.children) queue.push(child);
    }
    while (queue.length > 0) {
        const node = queue.shift()!;
        if (node.id === targetId) return node;
        if (node.children) queue.push(...node.children);
    }
    return null;
};

/**
 * transformFigmaFrame
 * ────────────────────
 * Main transformation entry point. Converts a single top-level Figma FRAME
 * into a VectraProject subtree ready for importPage().
 *
 * The root node produced is type 'webpage' for page imports (matches addPage's
 * canvas shape) or 'container' for component imports.
 *
 * @param frame      Top-level Figma FRAME node
 * @param importMode 'page' → root is 'webpage'; 'component' → root is 'container'
 */
export const transformFigmaFrame = (
    frame: FigmaNode,
    importMode: 'page' | 'component',
): FigmaTransformResult => {
    const ctx: TransformCtx = {
        nodeMap: {},
        imageFillNodeIds: [],
        imageFillMap: new Map(),
        warnings: [],
    };

    const box = frame.absoluteBoundingBox ?? { x: 0, y: 0, width: 1440, height: 900 };
    const width = Math.round(box.width);
    const height = Math.round(box.height);

    // Process children — pass the frame's own box so children get coordinates
    // relative to the frame origin (FIG-COORD-1)
    const childIds: string[] = [];
    if (frame.children) {
        for (const child of frame.children) {
            const childId = figmaNodeToVectraNode(child, box, 1, ctx);
            if (childId) childIds.push(childId);
        }
    }

    if (ctx.warnings.length > 0) {
        console.log('[figmaImporter] Warnings:', ctx.warnings);
    }

    const rootId = genId('root');
    const bgFill = extractFigmaFill(frame.fills);

    ctx.nodeMap[rootId] = {
        id: rootId,
        type: importMode === 'page' ? 'webpage' : 'container',
        name: frame.name,
        children: childIds,
        props: {
            layoutMode: 'canvas',
            style: {
                position: 'relative',
                width: `${width}px`,
                minHeight: `${height}px`,
                backgroundColor: bgFill ?? '#ffffff',
            },
        },
    };

    return {
        nodes: ctx.nodeMap,
        rootId,
        imageFillNodeIds: ctx.imageFillNodeIds,
        imageFillMap: ctx.imageFillMap,
        warnings: ctx.warnings,
    };
};

/**
 * applyImageFills
 * ───────────────
 * Post-import step: patches image nodes with resolved CDN URLs from the
 * Figma Images API. Returns a new VectraProject (FIG-SAFE-3: no mutation).
 *
 * @param nodes          VectraProject from transformFigmaFrame
 * @param imageFillMap   vectraNodeId → figmaNodeId
 * @param figmaImageUrls figmaNodeId → CDN URL (from Figma Images API)
 */
export const applyImageFills = (
    nodes: VectraProject,
    imageFillMap: Map<string, string>,
    figmaImageUrls: Record<string, string | null>,
): VectraProject => {
    const patched = { ...nodes };
    for (const [vectraId, figmaId] of imageFillMap.entries()) {
        const url = figmaImageUrls[figmaId];
        if (url && patched[vectraId]) {
            patched[vectraId] = {
                ...patched[vectraId],
                src: url,
                props: {
                    ...patched[vectraId].props,
                    style: { ...patched[vectraId].props.style, objectFit: 'cover' as const },
                },
            };
        }
    }
    return patched;
};
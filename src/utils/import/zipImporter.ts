/**
 * ─── ZIP IMPORTER ─────────────────────────────────────────────────────────────
 * STI-1 — Full Page Import pipeline: ZIP → HTML → VectraNode tree.
 *
 * PERMANENT CONSTRAINTS
 * ─────────────────────
 * STI-SAFE-1 [PERMANENT]: Every produced VectraNode MUST have:
 *   id (string), type (string), name (string), children (array), props.style (object).
 *   sanitizeNode() at the end of htmlNodeToVectraNode() enforces this.
 *
 * STI-SAFE-2 [PERMANENT]: MAX_PARSE_DEPTH = 6.
 *   Nodes beyond depth 6 are collapsed into their nearest ancestor's content.
 *   Prevents runaway recursion on deeply nested Bootstrap/email HTML.
 *
 * STI-SAFE-3 [PERMANENT]: <script>, <noscript>, <style>, <svg>, <iframe> etc.
 *   are ALWAYS skipped. We never import executable code from external HTML.
 *
 * STI-SAFE-4 [PERMANENT]: IDs are crypto.randomUUID()-based.
 *   External HTML element.id values are NEVER used as Vectra node IDs.
 *
 * STI-CSS-1 [PERMANENT]: CSS extraction is a pure return value.
 *   The caller (StitchPanel) is responsible for VFS injection.
 *   This util has zero side effects.
 */

import JSZip from 'jszip';
import type { VectraNode, VectraProject } from '../../types';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MAX_PARSE_DEPTH = 6;

const TAG_TO_NODE_TYPE: Record<string, string> = {
    section: 'container', div: 'container', article: 'container',
    aside: 'container', header: 'container', footer: 'container',
    nav: 'container', main: 'container', figure: 'container',
    ul: 'container', ol: 'container', form: 'container',
    h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'text', h5: 'text', h6: 'text',
    p: 'text', span: 'text', a: 'text', label: 'text', li: 'text',
    button: 'button',
    img: 'image',
    input: 'input', textarea: 'input', select: 'input',
};

const SKIP_TAGS = new Set([
    'script', 'noscript', 'style', 'link', 'meta', 'head',
    'svg', 'canvas', 'iframe', 'object', 'embed',
    'br', 'hr', 'wbr',
]);

// Tailwind utility → CSSProperties: conservative, single-property only
const TAILWIND_REVERSE_MAP: Array<{
    pattern: RegExp;
    property: keyof React.CSSProperties;
    value: (m: RegExpMatchArray) => string;
}> = [
        { pattern: /^text-center$/, property: 'textAlign', value: () => 'center' },
        { pattern: /^text-left$/, property: 'textAlign', value: () => 'left' },
        { pattern: /^text-right$/, property: 'textAlign', value: () => 'right' },
        { pattern: /^text-white$/, property: 'color', value: () => '#ffffff' },
        { pattern: /^text-black$/, property: 'color', value: () => '#000000' },
        { pattern: /^bg-white$/, property: 'backgroundColor', value: () => '#ffffff' },
        { pattern: /^bg-black$/, property: 'backgroundColor', value: () => '#000000' },
        { pattern: /^bg-transparent$/, property: 'backgroundColor', value: () => 'transparent' },
        { pattern: /^flex$/, property: 'display', value: () => 'flex' },
        { pattern: /^hidden$/, property: 'display', value: () => 'none' },
        { pattern: /^w-full$/, property: 'width', value: () => '100%' },
        { pattern: /^h-full$/, property: 'height', value: () => '100%' },
        { pattern: /^items-center$/, property: 'alignItems', value: () => 'center' },
        { pattern: /^justify-center$/, property: 'justifyContent', value: () => 'center' },
        { pattern: /^justify-between$/, property: 'justifyContent', value: () => 'space-between' },
        { pattern: /^flex-col$/, property: 'flexDirection', value: () => 'column' },
        { pattern: /^flex-row$/, property: 'flexDirection', value: () => 'row' },
        { pattern: /^relative$/, property: 'position', value: () => 'relative' },
        { pattern: /^absolute$/, property: 'position', value: () => 'absolute' },
        { pattern: /^font-bold$/, property: 'fontWeight', value: () => 'bold' },
        { pattern: /^font-semibold$/, property: 'fontWeight', value: () => '600' },
        { pattern: /^font-medium$/, property: 'fontWeight', value: () => '500' },
        { pattern: /^overflow-hidden$/, property: 'overflow', value: () => 'hidden' },
        { pattern: /^opacity-0$/, property: 'opacity', value: () => '0' },
        { pattern: /^opacity-50$/, property: 'opacity', value: () => '0.5' },
        { pattern: /^opacity-100$/, property: 'opacity', value: () => '1' },
        // Arbitrary value classes
        { pattern: /^bg-\[#([0-9a-fA-F]{3,8})\]$/, property: 'backgroundColor', value: (m) => `#${m[1]}` },
        { pattern: /^text-\[#([0-9a-fA-F]{3,8})\]$/, property: 'color', value: (m) => `#${m[1]}` },
        { pattern: /^w-\[(\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh))\]$/, property: 'width', value: (m) => m[1] },
        { pattern: /^h-\[(\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh))\]$/, property: 'height', value: (m) => m[1] },
        { pattern: /^p-\[(\d+(?:\.\d+)?(?:px|rem|em))\]$/, property: 'padding', value: (m) => m[1] },
    ];

// ─── PUBLIC RESULT TYPE ───────────────────────────────────────────────────────

export interface ZipImportResult {
    nodes: VectraProject;
    rootId: string;
    pageName: string;
    css: string;
    imageAssets: Array<{ name: string; file: File }>;
    warnings: string[];
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const genId = (prefix: string): string =>
    `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

// Inline style CSS props → React CSSProperties keys
const INLINE_STYLE_PROPS: Array<[string, keyof React.CSSProperties]> = [
    ['color', 'color'],
    ['background-color', 'backgroundColor'],
    ['background', 'background'],
    ['font-size', 'fontSize'],
    ['font-weight', 'fontWeight'],
    ['font-family', 'fontFamily'],
    ['line-height', 'lineHeight'],
    ['letter-spacing', 'letterSpacing'],
    ['text-align', 'textAlign'],
    ['padding', 'padding'],
    ['padding-top', 'paddingTop'],
    ['padding-right', 'paddingRight'],
    ['padding-bottom', 'paddingBottom'],
    ['padding-left', 'paddingLeft'],
    ['margin', 'margin'],
    ['margin-top', 'marginTop'],
    ['margin-right', 'marginRight'],
    ['margin-bottom', 'marginBottom'],
    ['margin-left', 'marginLeft'],
    ['border-radius', 'borderRadius'],
    ['border', 'border'],
    ['border-color', 'borderColor'],
    ['border-width', 'borderWidth'],
    ['display', 'display'],
    ['flex-direction', 'flexDirection'],
    ['align-items', 'alignItems'],
    ['justify-content', 'justifyContent'],
    ['gap', 'gap'],
    ['width', 'width'],
    ['height', 'height'],
    ['max-width', 'maxWidth'],
    ['min-height', 'minHeight'],
    ['opacity', 'opacity'],
    ['position', 'position'],
    ['top', 'top'],
    ['left', 'left'],
    ['right', 'right'],
    ['bottom', 'bottom'],
    ['z-index', 'zIndex'],
    ['overflow', 'overflow'],
    ['box-shadow', 'boxShadow'],
    ['transform', 'transform'],
    ['transition', 'transition'],
    ['object-fit', 'objectFit'],
    ['object-position', 'objectPosition'],
];

const extractInlineStyles = (el: HTMLElement): React.CSSProperties => {
    const result: React.CSSProperties = {};
    for (const [cssProp, reactProp] of INLINE_STYLE_PROPS) {
        const value = el.style.getPropertyValue(cssProp);
        if (value) (result as any)[reactProp] = value;
    }
    return result;
};

const extractTailwindStyles = (className: string): React.CSSProperties => {
    const styles: React.CSSProperties = {};
    for (const cls of className.split(/\s+/).filter(Boolean)) {
        for (const mapping of TAILWIND_REVERSE_MAP) {
            const m = cls.match(mapping.pattern);
            if (m) {
                (styles as any)[mapping.property] = mapping.value(m);
                break;
            }
        }
    }
    return styles;
};

const inferNodeName = (el: HTMLElement, fallbackType: string): string => {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.slice(0, 40);
    const dataName = el.getAttribute('data-name');
    if (dataName) return dataName.slice(0, 40);
    const text = el.textContent?.trim();
    if (text && text.length > 0 && text.length < 40) return text;
    const tag = el.tagName?.toLowerCase() ?? fallbackType;
    return tag.charAt(0).toUpperCase() + tag.slice(1);
};

// ─── CORE RECURSIVE PARSER ────────────────────────────────────────────────────

const htmlNodeToVectraNode = (
    el: HTMLElement,
    nodeMap: VectraProject,
    depth: number,
    warnings: string[],
): string | null => {
    const tag = el.tagName?.toLowerCase() ?? '';

    // STI-SAFE-3: skip non-visual / executable tags
    if (SKIP_TAGS.has(tag)) return null;

    // STI-SAFE-2: depth limit → collapse to text
    if (depth > MAX_PARSE_DEPTH) {
        const text = el.textContent?.trim();
        if (text && text.length > 0) {
            const id = genId('txt');
            nodeMap[id] = {
                id, type: 'text',
                name: `${tag} (collapsed)`,
                content: text.slice(0, 500),
                children: [],
                props: { style: { position: 'relative', width: '100%' } },
            };
            return id;
        }
        return null;
    }

    const nodeType = TAG_TO_NODE_TYPE[tag] ?? 'container';
    const nodeId = genId(nodeType.slice(0, 3));
    const nodeName = inferNodeName(el, nodeType);

    const inlineStyles = extractInlineStyles(el);
    const className = el.getAttribute('class') || '';
    const tailwindStyles = extractTailwindStyles(className);

    const mergedStyle: React.CSSProperties = {
        position: 'relative',
        width: '100%',
        ...tailwindStyles,
        ...inlineStyles,
    };

    const node: VectraNode = {
        id: nodeId,
        type: nodeType,
        name: nodeName,
        children: [],
        props: {
            className: className || undefined,
            style: mergedStyle,
        },
    };

    // ── Type-specific field population ────────────────────────────────────────

    if (nodeType === 'heading' || nodeType === 'text' || nodeType === 'button') {
        const directText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent?.trim())
            .filter(Boolean)
            .join(' ')
            .trim();
        node.content = directText || el.textContent?.trim().slice(0, 1000) || '';
    }

    if (nodeType === 'image') {
        const src = el.getAttribute('src');
        const alt = el.getAttribute('alt');
        if (src) node.src = src;
        if (alt) node.props.alt = alt;
        nodeMap[nodeId] = node;
        return nodeId; // leaf — no children
    }

    if (nodeType === 'input') {
        node.props.placeholder = el.getAttribute('placeholder') || '';
        node.props.inputType = el.getAttribute('type') || 'text';
        nodeMap[nodeId] = node;
        return nodeId; // leaf
    }

    // ── Recurse into children ─────────────────────────────────────────────────
    if (nodeType === 'container') {
        const childIds: string[] = [];
        for (const child of Array.from(el.children) as HTMLElement[]) {
            const childId = htmlNodeToVectraNode(child, nodeMap, depth + 1, warnings);
            if (childId !== null) childIds.push(childId);
        }
        node.children = childIds;

        // Childless container with text → downgrade to text node
        if (childIds.length === 0) {
            const text = el.textContent?.trim();
            if (text && text.length > 0) {
                node.type = 'text';
                node.content = text.slice(0, 1000);
            }
        }
    }

    // ── STI-SAFE-1: Final sanitization ────────────────────────────────────────
    if (!node.id) { warnings.push(`Skipped: missing id (${tag})`); return null; }
    if (!node.type) node.type = 'container';
    if (!node.name) node.name = 'Unnamed';
    if (!Array.isArray(node.children)) node.children = [];
    if (!node.props || typeof node.props !== 'object') node.props = { style: {} };
    if (!node.props.style || typeof node.props.style !== 'object') node.props.style = {};

    nodeMap[nodeId] = node;
    return nodeId;
};

// ─── CSS COLLECTOR ────────────────────────────────────────────────────────────

const collectCSSFromZip = async (zip: JSZip, zipFileName: string): Promise<string> => {
    const chunks: string[] = [
        `/* ─── Imported from: ${zipFileName} via Vectra Stitch Import ─── */`,
        `/* Review before production use. */`,
        '',
    ];

    const cssFiles = Object.values(zip.files).filter(
        f => !f.dir && f.name.endsWith('.css') &&
            !f.name.includes('node_modules') &&
            !f.name.includes('bootstrap.min') &&
            !f.name.includes('font-awesome.min')
    );

    for (const file of cssFiles) {
        let css = await file.async('string');
        css = css.replace(/@import\s+url\([^)]+\)[^;]*;/g, '/* @import stripped by Vectra */');
        css = css.replace(/@import\s+['"][^'"]+['"]\s*;/g, '/* @import stripped */');
        chunks.push(`/* ── ${file.name} ── */`);
        chunks.push(css, '');
    }

    return chunks.join('\n');
};

// ─── IMAGE EXTRACTOR ──────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'];

const extractImageAssetsFromZip = async (zip: JSZip): Promise<Array<{ name: string; file: File }>> => {
    const assets: Array<{ name: string; file: File }> = [];
    const imageFiles = Object.values(zip.files).filter(f => {
        if (f.dir) return false;
        const lower = f.name.toLowerCase();
        return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
    });

    for (const imageFile of imageFiles) {
        try {
            const blob = await imageFile.async('blob');
            const ext = imageFile.name.split('.').pop()?.toLowerCase() ?? 'png';
            const mimeMap: Record<string, string> = {
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
            };
            const fileName = imageFile.name.split('/').pop() ?? imageFile.name;
            assets.push({ name: fileName, file: new File([blob], fileName, { type: mimeMap[ext] ?? 'image/png' }) });
        } catch { /* non-fatal */ }
    }
    return assets;
};

// ─── PAGE NAME ────────────────────────────────────────────────────────────────

const extractPageName = (doc: Document, zipFileName: string): string => {
    const title = doc.querySelector('title')?.textContent?.trim();
    if (title && title.length > 0 && title.length < 80) return title;
    return zipFileName.replace(/\.zip$/i, '').replace(/[-_]/g, ' ').trim() || 'Imported Page';
};

// ─── MAIN PUBLIC FUNCTION ─────────────────────────────────────────────────────

/**
 * parseZipToVectraPage
 * ─────────────────────
 * Single public entry point for STI-1 ZIP import.
 * THROWS on catastrophic failures (corrupt ZIP, no HTML found).
 * Non-fatal issues are returned in result.warnings.
 */
export const parseZipToVectraPage = async (zipFile: File): Promise<ZipImportResult> => {
    const warnings: string[] = [];
    const nodeMap: VectraProject = {};

    // Step 1: Open ZIP
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(zipFile);
    } catch (e) {
        throw new Error(`Could not read ZIP file: ${(e as Error).message}`);
    }

    // Step 2: Find HTML file (priority: index.html → index.htm → first *.html → first *.htm)
    const allFiles = Object.values(zip.files).filter(f => !f.dir);
    const findHtml = (name: string) => allFiles.find(
        f => f.name === name || f.name.endsWith(`/${name}`)
    );
    const htmlFile =
        findHtml('index.html') ||
        findHtml('index.htm') ||
        allFiles.find(f => f.name.endsWith('.html')) ||
        allFiles.find(f => f.name.endsWith('.htm'));

    if (!htmlFile) {
        throw new Error('No HTML file found in ZIP. Please include an index.html file.');
    }

    const htmlString = await htmlFile.async('string');

    // Step 3: Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const pageName = extractPageName(doc, zipFile.name);

    // Step 4: Collect CSS + images
    const css = await collectCSSFromZip(zip, zipFile.name);
    const imageAssets = await extractImageAssetsFromZip(zip);
    if (imageAssets.length > 0) {
        warnings.push(`Found ${imageAssets.length} image(s) — added to your asset library.`);
    }

    // Step 5: Walk body → VectraNodes
    const body = doc.body;
    if (!body) throw new Error('HTML file has no <body> element.');

    const bodyChildren = Array.from(body.children) as HTMLElement[];
    const meaningful = bodyChildren.filter(el => !SKIP_TAGS.has(el.tagName?.toLowerCase()));
    if (meaningful.length === 0) throw new Error('HTML body has no importable elements.');

    const topLevelIds: string[] = [];
    for (const child of meaningful) {
        const id = htmlNodeToVectraNode(child, nodeMap, 1, warnings);
        if (id !== null) topLevelIds.push(id);
    }
    if (topLevelIds.length === 0) throw new Error('No valid nodes could be extracted from the HTML.');

    // Step 6: Build page root (type: 'webpage' — matches addPage's canvas node shape)
    const rootId = genId('canvas');
    nodeMap[rootId] = {
        id: rootId,
        type: 'webpage',
        name: pageName,
        children: topLevelIds,
        props: {
            layoutMode: 'flex',
            style: {
                width: '1440px',
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: '#ffffff',
                position: 'relative',
            },
        },
    };

    // Step 7: Large import warning
    const nodeCount = Object.keys(nodeMap).length;
    if (nodeCount > 200) {
        warnings.push(`Large import: ${nodeCount} nodes. Consider simplifying the source HTML.`);
    }

    return { nodes: nodeMap, rootId, pageName, css, imageAssets, warnings };
};

import type { VectraProject, Page, DataSource, ApiRoute } from '../types';

export interface GeneratedFileMap {
  files: Record<string, string>;
  dependencies: Set<string>;
}

// ── Phase F2: CSS Grid layout descriptor (mirrors Rust GridLayout struct) ─────
// Field names are camelCase because the Rust struct uses #[serde(rename_all = "camelCase")].
export interface GridLayout {
  templateColumns: string;       // e.g. "120px 360px 240px"
  templateRows: string;          // e.g. "80px 640px 60px"
  colWidthsPx: number[];         // raw pixel track widths, parallel to templateColumns
  rowHeightsPx: number[];        // raw pixel track heights, parallel to templateRows
  items: Array<{
    id: string;
    colStart: number;            // 1-based CSS line number (inclusive start)
    colEnd: number;              // 1-based CSS line number (exclusive end)
    rowStart: number;
    rowEnd: number;
  }>;
}

class ImportManager {
  private imports: Map<string, Set<string>> = new Map();
  public dependencies: Set<string> = new Set();

  add(module: string, items: string | string[]) {
    if (!module.startsWith('.') && module !== 'react') this.dependencies.add(module);
    if (!this.imports.has(module)) this.imports.set(module, new Set());
    const set = this.imports.get(module)!;
    if (Array.isArray(items)) items.forEach(i => set.add(i));
    else set.add(items);
  }

  generate(): string {
    let code = `import React from 'react';\n`;
    this.imports.forEach((items, module) => {
      const list = Array.from(items);
      const defaultEntry = list.find(i => i.startsWith('default:'));
      if (defaultEntry) {
        code += `import ${defaultEntry.split(':')[1]} from '${module}';\n`;
      } else if (list.includes('*')) {
        const name = list.find(i => i.startsWith('* as ')) || '*';
        code += `import ${name} from '${module}';\n`;
      } else {
        code += `import { ${list.join(', ')} } from '${module}';\n`;
      }
    });
    return code;
  }
}

const cleanClass = (c: string) => c ? c.replace(/\s+/g, ' ').trim() : '';
const injectBindings = (t: string) => t ? t.replace(/{{([^}]+)}}/g, (_, p) => `{data?.${p.split('.').join('?.')} ?? ''}`) : '';

const serializeStyle = (styleObj: any) => {
  if (!styleObj || Object.keys(styleObj).length === 0) return '';
  const clean: any = {};
  Object.entries(styleObj).forEach(([k, v]) => { if (v !== undefined && v !== '' && k !== 'animationName') clean[k] = v; });
  return Object.keys(clean).length ? `style={${JSON.stringify(clean)}}` : '';
};

const generateMotionProps = (props: any): string[] => {
  const motionAttributes: string[] = [];

  if (props.hoverEffect && props.hoverEffect !== 'none') {
    let hoverObj = '';
    switch (props.hoverEffect) {
      case 'lift': hoverObj = '{ y: -5 }'; break;
      case 'scale': hoverObj = '{ scale: 1.05 }'; break;
      case 'glow': hoverObj = '{ boxShadow: "0 0 15px rgba(59, 130, 246, 0.6)" }'; break;
      case 'border': hoverObj = '{ borderColor: "#3b82f6", borderWidth: "1px", borderStyle: "solid" }'; break;
      case 'opacity': hoverObj = '{ opacity: 0.7 }'; break;
    }
    if (hoverObj) motionAttributes.push(`whileHover={${hoverObj}}`);
    motionAttributes.push(`transition={{ type: "spring", stiffness: 300, damping: 20 }}`);
  }

  if (props.animation && props.animation !== 'none') {
    const dur = props.animationDuration || 0.5;
    const dly = props.animationDelay || 0;

    if (!motionAttributes.some(p => p.startsWith('transition'))) {
      motionAttributes.push(`transition={{ duration: ${dur}, delay: ${dly}, ease: "easeOut" }}`);
    }

    switch (props.animation) {
      case 'fade':
        motionAttributes.push(`initial={{ opacity: 0 }}`);
        motionAttributes.push(`animate={{ opacity: 1 }}`);
        break;
      case 'slide-up':
        motionAttributes.push(`initial={{ opacity: 0, y: 30 }}`);
        motionAttributes.push(`animate={{ opacity: 1, y: 0 }}`);
        break;
      case 'slide-left':
        motionAttributes.push(`initial={{ opacity: 0, x: -30 }}`);
        motionAttributes.push(`animate={{ opacity: 1, x: 0 }}`);
        break;
      case 'scale-in':
        motionAttributes.push(`initial={{ opacity: 0, scale: 0.8 }}`);
        motionAttributes.push(`animate={{ opacity: 1, scale: 1 }}`);
        break;
    }
  }

  return motionAttributes;
};

const generateNodeCode = (nodeId: string, project: VectraProject, imports: ImportManager, depth: number): string => {
  const node = project[nodeId];
  if (!node) return '';
  const indent = '  '.repeat(depth);

  let tagName = 'div';
  let content = '';
  const isComponent = ['hero_geometric', 'feature_hover', 'geometric_shapes'].includes(node.type);

  if (isComponent) {
    const name = node.type.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
    tagName = name;
    imports.add(`../components/marketplace/${name}`, `default:${name}`);
  } else {
    switch (node.type) {
      case 'text': tagName = 'p'; content = injectBindings(node.content || ''); break;
      case 'heading': tagName = 'h1'; content = injectBindings(node.content || ''); break;
      case 'image': tagName = 'img'; break;
      case 'input': tagName = 'input'; break;
      case 'button': tagName = 'button'; content = node.content || 'Click'; break;
      case 'icon':
        tagName = `Lucide.${node.props.iconName || 'HelpCircle'}`;
        imports.add('lucide-react', '* as Lucide');
        break;
    }
  }

  const motionProps = generateMotionProps(node.props);
  const hasMotion = motionProps.length > 0;

  if (hasMotion && !tagName.includes('.') && !isComponent) {
    imports.add('framer-motion', 'motion');
    tagName = `motion.${tagName}`;
  }

  const props: string[] = [];
  // Phase F: append 'vectra-stack-mobile' class for stack-on-mobile export override.
  // This class is targeted by the @media block injected by generateNextPage()
  // and generateProjectCode(). It does not affect canvas rendering — it is
  // only meaningful in the exported HTML/CSS output.
  const baseClass = cleanClass(node.props.className || '');
  const stackClass = node.props.stackOnMobile === true ? 'vectra-stack-mobile' : '';
  const mergedClass = [baseClass, stackClass].filter(Boolean).join(' ');
  if (mergedClass) props.push(`className="${mergedClass}"`);
  const styleStr = serializeStyle(node.props.style);
  if (styleStr) props.push(styleStr);

  if (node.type === 'image') props.push(`src="${node.src || 'https://via.placeholder.com/150'}"`);
  if (node.type === 'input') props.push(`placeholder="${node.props.placeholder || ''}"`);

  if (isComponent) {
    Object.entries(node.props).forEach(([k, v]) => {
      if (['className', 'style', 'children'].includes(k)) return;
      if (typeof v === 'string') props.push(`${k}="${v}"`);
      else if (typeof v === 'number' || typeof v === 'boolean') props.push(`${k}={${v}}`);
    });
  }

  props.push(...motionProps);

  let childrenCode = '';
  if (node.children && !isComponent) {
    childrenCode = node.children.map((cid: string) => generateNodeCode(cid, project, imports, depth + 1)).join('');
  }

  const propsStr = props.length ? ' ' + props.join(' ') : '';
  let code = '';

  if (['img', 'input', 'hr', 'br'].includes(node.type) || (tagName.includes('Lucide') && !hasMotion)) {
    code = `${indent}<${tagName}${propsStr} />\n`;
  } else {
    const safeContent = content ? `\n${indent}  ${content}` : '';
    const safeChildren = childrenCode ? `\n${childrenCode}${indent}` : '';
    if (!safeContent && !safeChildren) {
      code = `${indent}<${tagName}${propsStr} />\n`;
    } else {
      code = `${indent}<${tagName}${propsStr}>${safeContent}${safeChildren}</${tagName}>\n`;
    }
  }

  if (node.props.linkTo) {
    imports.add('react-router-dom', 'Link');
    return `${indent}<Link to="${node.props.linkTo}" className="contents">\n${code}${indent}</Link>\n`;
  }

  return code;
};

export const generateProjectCode = (
  project: VectraProject,
  pages: Page[],
  _dataSources: DataSource[]
): GeneratedFileMap => {
  const files: Record<string, string> = {};
  const allDependencies = new Set<string>();

  allDependencies.add('react');
  allDependencies.add('react-dom');
  allDependencies.add('react-router-dom');
  allDependencies.add('clsx');
  allDependencies.add('tailwind-merge');

  pages.forEach(page => {
    const compName = page.name.replace(/[^a-zA-Z0-9]/g, '');
    const imports = new ImportManager();
    const rootNode = project[page.rootId];

    let rootFrameId = rootNode?.children?.find(cid => project[cid]?.type === 'webpage');
    if (!rootFrameId && rootNode?.children?.length) rootFrameId = rootNode.children[0];

    // ── Phase F: Read canvas dimensions from the frame node ───────────────
    const frameNode = rootFrameId ? project[rootFrameId] : null;
    const frameStyle = frameNode?.props?.style || {};
    const canvasWidth: number = parseFloat(String((frameStyle as any).width || 1440)) || 1440;
    const canvasHeight: number = parseFloat(String((frameStyle as any).height || 900)) || 900;

    // ── Phase F: Collect stack-on-mobile nodes for this page ──────────────
    const mobileNodeIds = rootFrameId
      ? collectStackOnMobileIds(project, rootFrameId)
      : new Set<string>();
    const hasMobileNodes = mobileNodeIds.size > 0;
    const mobileCSSString = buildMobileCSS(hasMobileNodes);
    const mobileCSSLiteral = JSON.stringify(mobileCSSString);

    let jsxContent = '';
    if (rootFrameId) {
      if (project[rootFrameId].children) {
        jsxContent = project[rootFrameId].children!.map((cid: string) => generateNodeCode(cid, project, imports, 4)).join('');
      }
    } else {
      jsxContent = `        <div className="text-center p-10">Empty Page</div>`;
    }

    // ── Phase F: Responsive wrapper replaces the old bare <div> wrapper ───
    const code = `${imports.generate()}

// Vectra responsive styles — auto-generated, do not edit.
const VECTRA_MOBILE_CSS = ${mobileCSSLiteral};

export default function ${compName}() {
  return (
    <div className="w-full min-h-screen bg-white text-slate-900">
      <style dangerouslySetInnerHTML={{ __html: VECTRA_MOBILE_CSS }} />
      <div
        className="vectra-canvas-frame relative"
        style={{ width: '${canvasWidth}px', minHeight: '${canvasHeight}px', margin: '0 auto' }}
      >
${jsxContent}      </div>
    </div>
  );
}`;
    files[`src/pages/${compName}.tsx`] = code;
    imports.dependencies.forEach(d => allDependencies.add(d));
  });

  const routerImports = new ImportManager();
  routerImports.add('react-router-dom', ['BrowserRouter', 'Routes', 'Route']);

  const routeJSX = pages.map(p => {
    const name = p.name.replace(/[^a-zA-Z0-9]/g, '');
    routerImports.add(`./pages/${name}`, `default:${name}`);
    return `<Route path="${p.slug}" element={<${name} />} />`;
  }).join('\n        ');

  files['src/App.tsx'] = `${routerImports.generate()}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        ${routeJSX}
      </Routes>
    </BrowserRouter>
  );
}`;

  return { files, dependencies: allDependencies };
};

export const generateCode = (project: VectraProject, rootId: string): string => {
  return generateNodeCode(rootId, project, new ImportManager(), 0);
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy: ', err);
    return false;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE F — RESPONSIVE CANVAS EXPORT: LAYER 1 + LAYER 2
//
// Layer 1: Responsive Canvas Wrapper
//   Every exported page wraps its canvas frame in overflow-x:auto so the
//   absolute layout is horizontally scrollable on small screens rather than
//   clipping silently. The canvas width is preserved exactly — no transform.
//
// Layer 2: Stack-on-Mobile
//   Nodes with props.stackOnMobile === true receive the 'vectra-stack-mobile'
//   CSS class in the generated JSX. A <style> block injected into the page
//   overrides their position/left/top/width/height at @media (max-width:768px).
//   !important is required and correct here — it is the only way to override
//   React inline styles from a stylesheet rule.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Recursively walks the VectraProject tree from a given root node,
 * collecting the IDs of all nodes where props.stackOnMobile === true.
 */
export const collectStackOnMobileIds = (
  project: VectraProject,
  nodeId: string,
  result: Set<string> = new Set(),
  visited: Set<string> = new Set()
): Set<string> => {
  if (visited.has(nodeId)) return result;
  visited.add(nodeId);

  const node = project[nodeId];
  if (!node) return result;

  if (node.props.stackOnMobile === true) {
    result.add(nodeId);
  }

  if (node.children) {
    for (const childId of node.children) {
      collectStackOnMobileIds(project, childId, result, visited);
    }
  }
  return result;
};

/**
 * Builds the CSS string that is injected as a <style> block into exported pages.
 * Always includes the Layer 1 canvas frame rule.
 * Layer 2 rules are only included when hasMobileNodes is true.
 */
export const buildMobileCSS = (hasMobileNodes: boolean): string => {
  const layer1 = [
    '@media (max-width: 768px) {',
    '  /* Layer 1: Canvas frame scrolls horizontally on small screens */',
    '  .vectra-canvas-frame {',
    '    overflow-x: auto;',
    '    -webkit-overflow-scrolling: touch;',
    '  }',
  ];

  const layer2 = hasMobileNodes
    ? [
      '  /* Layer 2: Stack-on-Mobile — overrides inline absolute positioning */',
      '  .vectra-stack-mobile {',
      '    position: relative !important;',
      '    left: auto !important;',
      '    top: auto !important;',
      '    right: auto !important;',
      '    bottom: auto !important;',
      '    width: 100% !important;',
      '    max-width: 100% !important;',
      '    height: auto !important;',
      '    min-height: 0 !important;',
      '  }',
    ]
    : [];

  return [...layer1, ...layer2, '}'].join('\n');
};


// ─── Direction A: camelCase → kebab-case CSS property converter ──────────────
const camelToKebab = (str: string): string =>
  str.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

/**
 * buildBreakpointCSS
 * ──────────────────
 * Generates @media CSS rules for all nodes that carry breakpoint overrides.
 * Keyed by [data-vid="nodeId"] — the same attribute RenderNode stamps on every
 * DOM element, so selectors are class-collision-free.
 *
 * !important is required to override React's inline style attribute.
 *
 * Example output:
 *   @media (max-width: 1024px) {
 *     [data-vid="el-abc"] { font-size: 14px !important; }
 *   }
 *   @media (max-width: 768px) {
 *     [data-vid="el-abc"] { font-size: 12px !important; }
 *     [data-vid="el-xyz"] { display: none !important; }
 *   }
 */
export const buildBreakpointCSS = (
  project: VectraProject,
  nodeIds: string[]
): string => {
  const tabletRules: string[] = [];
  const mobileRules: string[] = [];

  for (const id of nodeIds) {
    const node = project[id];
    if (!node?.props?.breakpoints) continue;

    const { tablet, mobile } = node.props.breakpoints as {
      tablet?: Record<string, string>;
      mobile?: Record<string, string>;
    };

    if (tablet && Object.keys(tablet).length > 0) {
      const decls = Object.entries(tablet)
        .map(([k, v]) => `    ${camelToKebab(k)}: ${v} !important;`)
        .join('\n');
      tabletRules.push(`  [data-vid="${id}"] {\n${decls}\n  }`);
    }

    if (mobile && Object.keys(mobile).length > 0) {
      const decls = Object.entries(mobile)
        .map(([k, v]) => `    ${camelToKebab(k)}: ${v} !important;`)
        .join('\n');
      mobileRules.push(`  [data-vid="${id}"] {\n${decls}\n  }`);
    }
  }

  const parts: string[] = [];
  if (tabletRules.length > 0)
    parts.push(`@media (max-width: 1024px) {\n${tabletRules.join('\n')}\n}`);
  if (mobileRules.length > 0)
    parts.push(`@media (max-width: 768px) {\n${mobileRules.join('\n')}\n}`);

  return parts.join('\n\n');
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE F2 — CSS GRID LAYER 3 (WASM-POWERED RESPONSIVE GRID EXPORT)
//
// generateGridPage() takes a VectraProject page + a GridLayout produced by
// the Rust absolute_to_grid() WASM function and returns a production-ready
// TypeScript/React page that uses CSS Grid instead of absolute positioning.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * buildFrTemplateStrings
 * ──────────────────────
 * Converts absolute pixel track sizes to CSS fr units.
 *
 * fr_value = track_px / total_px
 *
 * Example: [120, 360, 240] on a 720px canvas →
 *   120/720 = 0.1667fr, 360/720 = 0.5fr, 240/720 = 0.3333fr
 *
 * We round to 4 decimal places to avoid floating-point noise while keeping
 * enough precision that tracks add up to exactly 1fr after browser rounding.
 * Row heights use canvasHeight as the denominator — valid only when the
 * container has an explicit height, which the generator always emits as minHeight.
 */
const buildFrTemplateStrings = (
  colWidthsPx: number[],
  rowHeightsPx: number[],
  canvasWidth: number,
  canvasHeight: number
): { templateColumns: string; templateRows: string } => {
  const totalColPx = colWidthsPx.reduce((a, b) => a + b, 0) || canvasWidth;
  const totalRowPx = rowHeightsPx.reduce((a, b) => a + b, 0) || canvasHeight;
  const templateColumns = colWidthsPx.map(w => `${(w / totalColPx).toFixed(4)}fr`).join(' ');
  const templateRows = rowHeightsPx.map(h => `${(h / totalRowPx).toFixed(4)}fr`).join(' ');
  return { templateColumns, templateRows };
};

/**
 * deepPatchProjectForGrid
 * ───────────────────────
 * Recursively patches every node in the subtree rooted at `rootId` that has
 * a CSS Grid placement entry. Returns a new VectraProject copy — the
 * original project is NEVER mutated.
 *
 * WHAT IT FIXES (A2)
 * ──────────────────
 * The previous implementation patched only the direct canvas child:
 *   patchedProject = { ...project, [childId]: { ...patchedStyle } }
 *
 * generateNodeCode() recurses into grandchildren reading from patchedProject.
 * But grandchildren still had their original absolute style because the
 * shallow clone only replaced the root child entry.
 *
 * This function walks the FULL subtree and patches every node whose id
 * appears in the placementMap. Nodes not in the placementMap are inserted
 * into the patched map unchanged — same object reference, zero allocation.
 *
 * CYCLE SAFETY
 * ────────────
 * A visited Set prevents infinite loops on malformed trees where a
 * child’s children[] includes an ancestor ID. In practice Vectra’s tree
 * is always a DAG, but the guard costs O(N) memory and prevents a hang.
 */
const deepPatchProjectForGrid = (
  project: VectraProject,
  rootId: string,
  placementMap: Map<string, { colStart: number; colEnd: number; rowStart: number; rowEnd: number }>
): VectraProject => {
  // Shallow-clone the whole project so untouched nodes outside this subtree
  // are zero-cost identity references. We only overwrite entries we visit.
  const patched: VectraProject = { ...project };
  const visited = new Set<string>();

  const walk = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);

    const node = project[id];
    if (!node) return;

    const placement = placementMap.get(id);
    if (placement) {
      // Strip absolute-positioning props; inject grid placement.
      // All other style props (bg, border, shadow …) are preserved.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { position: _p, left: _l, top: _t, ...restStyle } = (node.props?.style || {}) as any;
      patched[id] = {
        ...node,
        props: {
          ...node.props,
          style: {
            ...restStyle,
            gridColumn: `${placement.colStart} / ${placement.colEnd}`,
            gridRow: `${placement.rowStart} / ${placement.rowEnd}`,
          },
        },
      };
    } else {
      // No placement — clone reference unchanged (zero allocation).
      patched[id] = node;
    }

    // Recurse into children
    for (const childId of (node.children ?? [])) {
      walk(childId);
    }
  };

  walk(rootId);
  return patched;
};

export const generateGridPage = (
  page: Page,
  project: VectraProject,
  gridLayout: GridLayout,
  framework: 'nextjs' | 'vite' = 'nextjs',
  frUnits: boolean = false
): string => {
  const componentName = page.name.replace(/[^a-zA-Z0-9]/g, '') || 'Page';
  const imports = new ImportManager();

  // Build a lookup map: node id → grid placement
  const placementMap = new Map(
    gridLayout.items.map(item => [item.id, item])
  );

  // Locate the canvas frame children
  const pageRoot = project[page.rootId];
  const canvasFrameId = pageRoot?.children?.find(
    (cid: string) => project[cid]?.type === 'webpage'
  ) || pageRoot?.children?.[0];
  const canvasFrame = canvasFrameId ? project[canvasFrameId] : null;
  const childIds: string[] = canvasFrame?.children || [];

  // ── Canvas wrapper dimensions ────────────────────────────────────────────
  const canvasWidth = parseFloat(String((canvasFrame?.props?.style as any)?.width || 1440)) || 1440;
  const canvasHeight = parseFloat(String((canvasFrame?.props?.style as any)?.height || 900)) || 900;

  // Sprint 1: resolve template strings — px or fr depending on caller's choice.
  // No WASM re-call needed; colWidthsPx/rowHeightsPx carry the raw pixel data.
  const { templateColumns, templateRows } = frUnits
    ? buildFrTemplateStrings(gridLayout.colWidthsPx, gridLayout.rowHeightsPx, canvasWidth, canvasHeight)
    : { templateColumns: gridLayout.templateColumns, templateRows: gridLayout.templateRows };

  const unitLabel = frUnits ? 'fr' : 'px';
  const colCount = gridLayout.colWidthsPx.length;
  const rowCount = gridLayout.rowHeightsPx.length;

  // ── Direction 1 (A2 fix): Deep-patch each canvas child subtree ───────────
  // deepPatchProjectForGrid() walks the FULL subtree so that grandchildren
  // (nested containers, text nodes, images …) are also correctly patched.
  // Previously we only patched the direct canvas child, leaving grandchildren
  // with their original position:absolute style — now fixed.
  const childJsx = childIds.map(childId => {
    if (!project[childId]) return '';

    // Build one coherent patched copy for this subtree.
    // All descendants with placement entries get gridColumn/gridRow.
    // All other descendants are identity-cloned (no allocation).
    const patchedProject = deepPatchProjectForGrid(project, childId, placementMap);

    return generateNodeCode(childId, patchedProject, imports, 3);
  }).join('');

  const importBlock = framework === 'nextjs'
    ? `import type { Metadata } from 'next';\n${imports.generate().replace("import React from 'react';\n", '')}`
    : imports.generate();

  const metadataBlock = framework === 'nextjs'
    ? `\nexport const metadata: Metadata = {\n  title: '${page.name} | Vectra App',\n  description: 'Grid layout — generated by Vectra Convert to Grid',\n};\n`
    : '';

  // Sprint 1: hint comment flips based on current unit mode
  const hintComment = frUnits
    ? `To lock to pixel sizes, switch off fr units:\n *   "${gridLayout.templateColumns}"`
    : `To make this fluid, convert to fr units:\n *   "${buildFrTemplateStrings(gridLayout.colWidthsPx, gridLayout.rowHeightsPx, canvasWidth, canvasHeight).templateColumns}"`;

  return `${importBlock}${metadataBlock}
/**
 * ${componentName} — Responsive CSS Grid Layout
 *
 * Auto-generated by Vectra "Convert to Grid" (Phase F2).
 * Template: ${colCount} column${colCount !== 1 ? 's' : ''} \u00d7 ${rowCount} row${rowCount !== 1 ? 's' : ''} (${unitLabel} units)
 * Source canvas: ${canvasWidth}px \u00d7 ${canvasHeight}px
 *
 * ${hintComment}
 */
export default function ${componentName}() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '${templateColumns}',
        gridTemplateRows: '${templateRows}',
        width: ${canvasWidth},
        minHeight: ${canvasHeight},
        margin: '0 auto',
        position: 'relative',
      }}
    >
${childJsx}    </div>
  );
}
`;
};


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE B — NEXT.JS APP ROUTER CODE GENERATORS
//
// Additive exports. All existing Vite generators above are PRESERVED.
// These functions are imported by useFileSync for Next.js projects,
// and by Header.tsx for the Next.js ZIP export path.
//
// Key files generated:
//   app/[slug]/page.tsx         page-level SERVER component
//   components/Navbar.tsx       CLIENT component (multi-page nav)
//   app/layout.tsx              root layout with theme + Navbar import
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converts a page slug into the correct Next.js App Router file path.
 *   '/'         → 'app/page.tsx'
 *   '/about'    → 'app/about/page.tsx'
 *   '/services/consulting' → 'app/services/consulting/page.tsx'
 */
export const slugToNextPath = (slug: string): string => {
  if (slug === '/') return 'app/page.tsx';
  const clean = slug.replace(/^\/+/, '').replace(/\/+$/, '');
  return `app/${clean}/page.tsx`;
};

/** Converts a page name into a React component function name. */
const toPageComponentName = (pageName: string): string => {
  const pascal = pageName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return `${pascal || 'Home'}Page`;
};

/** PascalCase for component names — mirrors the version in useFileSync. */
const toPascalCaseGen = (raw: string): string => {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return /^[A-Z]/.test(cleaned) ? cleaned : 'Component' + cleaned;
};

/**
 * generateNextPage — generates a single app/[slug]/page.tsx file.
 * Page-level files are SERVER components (no 'use client') that import
 * CLIENT components from @/components/.
 */
export const generateNextPage = (
  page: Page,
  project: VectraProject
): string => {
  const componentName = toPageComponentName(page.name);
  const imports = new ImportManager();
  const importedComponents = new Set<string>();

  const pageRoot = project[page.rootId];

  // Find the canvas frame node (webpage type inside the page root)
  let canvasFrameId: string | undefined;
  if (pageRoot?.children) {
    canvasFrameId = pageRoot.children.find(
      cid => project[cid]?.type === 'webpage'
    );
    if (!canvasFrameId && pageRoot.children.length > 0) {
      canvasFrameId = pageRoot.children[0];
    }
  }

  const canvasFrame = canvasFrameId ? project[canvasFrameId] : null;
  const canvasChildren = canvasFrame?.children || pageRoot?.children || [];

  // Read canvas dimensions from the frame's stored style
  const frameStyle = canvasFrame?.props?.style || {};
  const canvasWidth: number = parseFloat(String((frameStyle as any).width || 1440)) || 1440;
  const canvasHeight: number = parseFloat(String((frameStyle as any).height || 900)) || 900;

  // ── Phase F: Collect stack-on-mobile node IDs in this page ─────────────
  const mobileNodeIds = canvasFrameId
    ? collectStackOnMobileIds(project, canvasFrameId)
    : new Set<string>();
  const hasMobileNodes = mobileNodeIds.size > 0;
  const mobileCSSString = buildMobileCSS(hasMobileNodes);
  const mobileCSSLiteral = JSON.stringify(mobileCSSString);

  // ── Direction A: Collect all descendant node IDs for breakpoint CSS ─────
  // Walk the full subtree once to gather IDs. buildBreakpointCSS filters
  // to only those nodes with props.breakpoints populated — O(N), N < ~200.
  const allPageNodeIds: string[] = [];
  const collectPageIds = (id: string, visited = new Set<string>()) => {
    if (visited.has(id)) return;
    visited.add(id);
    allPageNodeIds.push(id);
    const n = project[id];
    if (n?.children) n.children.forEach((c: string) => collectPageIds(c, visited));
  };
  if (canvasFrameId) collectPageIds(canvasFrameId);

  const breakpointCSSString = buildBreakpointCSS(project, allPageNodeIds);
  const breakpointCSSLiteral = breakpointCSSString.length > 0
    ? JSON.stringify(breakpointCSSString)
    : 'null';
  let jsxParts: string[] = [];

  for (const childId of canvasChildren) {
    const child = project[childId];
    if (!child) continue;

    if (child.type === 'custom_code') {
      const compName = toPascalCaseGen(child.name?.trim() || child.id);

      if (!importedComponents.has(compName)) {
        importedComponents.add(compName);
        imports.add(`@/components/${compName}`, `default:${compName}`);
      }

      const styleStr = child.props?.style
        ? ` style={${JSON.stringify(child.props.style)}}`
        : '';
      const baseClass = cleanClass(child.props?.className || '');
      const stackClass = child.props?.stackOnMobile ? ' vectra-stack-mobile' : '';
      const classAttr = (baseClass + stackClass).trim()
        ? ` className="${(baseClass + stackClass).trim()}"`
        : '';

      jsxParts.push(`        <${compName}${classAttr}${styleStr} />`);
    } else {
      const inlineJsx = generateNodeCode(childId, project, imports, 4);
      if (inlineJsx.trim()) {
        jsxParts.push(inlineJsx.trimEnd());
      }
    }
  }

  const jsxContent = jsxParts.length > 0
    ? jsxParts.join('\n')
    : `        <div className="flex items-center justify-center w-full h-full text-zinc-500 text-sm font-mono">
          Empty page — add components in the Vectra editor.
        </div>`;

  const importBlock = [
    `import type { Metadata } from 'next';`,
    imports.generate().replace("import React from 'react';\n", ''),
  ]
    .filter(Boolean)
    .join('\n');

  // ── Phase F: Direction D — Build SEO metadata block before the template literal
  // Variables are computed in plain JS so there's no backtick nesting conflict.
  const esc = (s: string) => s.replace(/'/g, "\\'");
  const seoTitle = page.seo?.title || `${page.name} | Vectra App`;
  const seoDescription = page.seo?.description || `${page.name} page — built with Vectra Visual Builder`;
  const seoOgTitle = page.seo?.ogTitle || seoTitle;
  const seoOgDesc = page.seo?.ogDescription
    ? `'${esc(page.seo.ogDescription)}'`
    : `'${esc(seoDescription)}'`;
  const seoOgImage = page.seo?.ogImage;
  const seoCanonical = page.seo?.canonical;
  const seoNoIndex = page.seo?.noIndex === true;
  const ogImageLine = seoOgImage ? `\n    images: ['${seoOgImage}'],` : '';
  const canonicalLine = seoCanonical ? `\n  alternates: { canonical: '${seoCanonical}' },` : '';
  const robotsLine = seoNoIndex ? `\n  robots: { index: false, follow: false },` : '';

  const metadataBlock = `export const metadata: Metadata = {
  title: '${esc(seoTitle)}',
  description: '${esc(seoDescription)}',
  openGraph: {
    title: '${esc(seoOgTitle)}',
    description: ${seoOgDesc},${ogImageLine}
  },${canonicalLine}${robotsLine}
};`;

  // ── Phase F: Assemble the responsive page wrapper ──────────────────────
  return `${importBlock}

${metadataBlock}

// Vectra responsive styles — Layer 1 (canvas scroll) + Layer 2 (stack on mobile).
// Auto-generated. Do not edit manually.
const VECTRA_MOBILE_CSS = ${mobileCSSLiteral};
// Direction A: per-node breakpoint overrides keyed by [data-vid] selector.
const VECTRA_BP_CSS = ${breakpointCSSLiteral};

export default function ${componentName}() {
  return (
    <main className="w-full min-h-screen bg-black text-white">
      {/* Vectra responsive styles — Layer 1+2 (canvas scroll + stack-mobile) */}
      <style dangerouslySetInnerHTML={{ __html: VECTRA_MOBILE_CSS }} />
      {/* Direction A: per-node breakpoint overrides */}
      {VECTRA_BP_CSS && <style dangerouslySetInnerHTML={{ __html: VECTRA_BP_CSS }} />}

      {/*
        Canvas frame — ${canvasWidth}px wide, matching the Vectra editor exactly.
        On screens wider than ${canvasWidth}px: centered via margin auto.
        On screens narrower than ${canvasWidth}px: horizontally scrollable (Layer 1).
        Elements with stackOnMobile enabled reflow to full-width blocks (Layer 2).
      */}
      <div
        className="vectra-canvas-frame relative"
        style={{ width: ${canvasWidth}, minHeight: ${canvasHeight}, margin: '0 auto' }}
      >
${jsxContent}
      </div>
    </main>
  );
}
`;
};

/**
 * generateNextNavbar — responsive Navbar with Next.js <Link>.
 * 'use client' component (uses useState for mobile toggle).
 * Only generated when project has 2+ pages.
 *
 * C-1 FIX (fourth pass): The previous template literal had three classes of JSX
 * syntax errors that caused `next build` to fail for every multi-page export:
 *   A) `aria - label` — binary subtraction expression, not a JSX attribute.
 *      JSX hyphenated attrs must be written as a continuous string: aria-label="…"
 *   B) `< button`, `< div`, `< span` — space after `<` is an invalid open-tag.
 *      Same class of bug fixed for `< Navbar />` in generateRootLayout (pass 3).
 *   C) `key= { item.href }`, `href = { item.href }` — spaces inside/around {}
 *      JSX expression slots. SWC strict-mode rejects them.
 */
export const generateNextNavbar = (pages: Page[]): string => {
  const navItems = pages
    .map(p => `  { label: '${p.name}', href: '${p.slug}' }`)
    .join(',\n');

  return `'use client';

import React, { useState } from 'react';
import Link from 'next/link';

const NAV_ITEMS = [
${navItems},
];

export default function Navbar({ className }: { className?: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav
      className={\`fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/10\${className ? \` \${className}\` : ''}\`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-white font-bold text-xl tracking-tight">
            Vectra<span className="text-blue-400">.</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-zinc-400 hover:text-white transition-colors text-sm font-medium"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 text-zinc-400 hover:text-white transition-colors"
            aria-label="Toggle menu"
          >
            <div className="w-5 h-0.5 bg-current mb-1 transition-all" />
            <div className="w-5 h-0.5 bg-current mb-1 transition-all" />
            <div className="w-5 h-0.5 bg-current transition-all" />
          </button>
        </div>
      </div>
      {isOpen && (
        <div className="md:hidden border-t border-white/10 bg-black/95">
          <div className="px-4 py-4 flex flex-col gap-3">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className="text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
`;
};

/**
 * generateRootLayout — app/layout.tsx content.
 * Server component (no 'use client'). Imports Navbar only if 2+ pages.
 *
 * C-2 FIX (fourth pass):
 *   - cssVars was `\nstyle = {{` → leading newline + space-around-= breaks SWC JSX.
 *   - lang= "en" had a space before the string value.
 *   - `${navbarImport} import` had a stray space before `import`.
 *   - `{ children }` was at 2-space indent instead of 8.
 */
export const generateRootLayout = (
  pages: Page[],
  theme?: { primary?: string; secondary?: string; accent?: string; font?: string }
): string => {
  const hasMultiplePages = pages.length > 1;
  const navbarImport = hasMultiplePages
    ? `import Navbar from '@/components/Navbar';\n`
    : '';
  const navbarJsx = hasMultiplePages ? '\n        <Navbar />' : '';

  // C-2 FIX: cssVarsAttr is a single-line attribute starting with a space (not \n).
  // `style = {{…}}` (space around =) is rejected by SWC; `style={{…}}` is correct.
  // Inline-style on <body> is valid React — CSS custom properties are supported.
  const cssVarsAttr = theme
    ? ` style={{ '--primary': '${theme.primary || '#3b82f6'}', '--secondary': '${theme.secondary || '#8b5cf6'}', '--accent': '${theme.accent || '#ec4899'}' } as React.CSSProperties}`
    : '';

  return `import type { Metadata } from 'next';
import type React from 'react';
${navbarImport}import './globals.css';
/* import './tokens.css'; // Uncomment to use design tokens from ZIP export */

export const metadata: Metadata = {
  title: 'Vectra App',
  description: 'Built with Vectra Visual Builder',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className="bg-black text-white antialiased"${cssVarsAttr}
      >${navbarJsx}
        {children}
      </body>
    </html>
  );
}
`;
};

/**
 * deduplicatePageSlugs
 * ────────────────────
 * Guards against slug collisions in the page list before generating
 * Next.js App Router file paths.
 *
 * WHY THIS IS NEEDED (A3)
 * ────────────────────────
 * Every new project starts with page-home at slug '/'. If the user adds
 * a second page and leaves its slug as '/', generateNextProjectCode() would
 * call slugToNextPath('/') twice, writing 'app/page.tsx' twice. The second
 * write silently overwrites the first — the first page's content is lost in
 * the ZIP with no warning.
 *
 * ALGORITHM
 * ──────────
 * 1. Walk the pages array in order (home page at index 0 is always safe).
 * 2. Maintain a Set of slugs already assigned.
 * 3. If a slug collides, append a numeric suffix and increment until the
 *    slug is unique: '/about' → '/about-2' → '/about-3' etc.
 * 4. Return a new Page[] with safe slugs. The original array is not mutated.
 *
 * A console.warn is emitted per collision so developers can see and fix the
 * source data in the Vectra pages panel.
 *
 * @param pages   Original page list — not mutated
 * @returns       New page list with all slugs guaranteed unique
 */
export const deduplicatePageSlugs = (pages: Page[]): Page[] => {
  const seen = new Set<string>();
  return pages.map(page => {
    let slug = page.slug || '/';

    if (!seen.has(slug)) {
      seen.add(slug);
      return page;
    }

    // C-3 FIX: `${slug} -${counter} ` had a literal space before the hyphen and a
    // trailing space — slugToNextPath would produce `app/about -2 /page.tsx`.
    // VFS creates directories with spaces; Next.js routing can never resolve them.
    let counter = 2;
    let candidate = `${slug}-${counter}`;
    while (seen.has(candidate)) {
      counter++;
      candidate = `${slug}-${counter}`;
    }

    console.warn(
      `[Vectra] Slug collision detected: page "${page.name}" has slug "${slug}" ` +
      `which is already used.Auto - renamed to "${candidate}" in export.` +
      `Fix this in the Pages panel to avoid surprises.`
    );

    seen.add(candidate);
    return { ...page, slug: candidate };
  });
};

/**
 * generateNextProjectCode — full GeneratedFileMap for a Next.js project.
 * Next.js equivalent of the existing generateProjectCode() (Vite).
 */
export const generateNextProjectCode = (
  project: VectraProject,
  pages: Page[],
  _dataSources: DataSource[] = []
): GeneratedFileMap => {
  const files: Record<string, string> = {};
  const allDependencies = new Set<string>([
    'next', 'react', 'react-dom',
    'lucide-react', 'framer-motion',
    'clsx', 'tailwind-merge',
  ]);

  // Item 1: Deduplicate slugs before generating paths.
  // Prevents silent file overwrites in the ZIP when two pages share a slug.
  const safePages = deduplicatePageSlugs(pages);

  safePages.forEach(page => {
    const filePath = slugToNextPath(page.slug);
    files[filePath] = generateNextPage(page, project);
  });

  files['app/layout.tsx'] = generateRootLayout(safePages);

  if (safePages.length > 1) {
    files['components/Navbar.tsx'] = generateNextNavbar(safePages);
  }

  return { files, dependencies: allDependencies };
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE D — API ROUTE FILE GENERATOR
//
// Produces the content of a Next.js App Router route handler file.
// Output path in VFS: app/api/[path]/route.ts
//
// Next.js App Router Route Handler contract:
//   • File must be named exactly `route.ts`
//   • Lives at: app/api/[path]/route.ts
//   • Exports named functions matching HTTP method names: GET, POST, PUT, etc.
//   • Each function receives a Request (or NextRequest)
//   • Returns a Response (native Web API) or NextResponse
//   • Server-only — no 'use client' directive allowed
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converts an ApiRoute path into the correct VFS file path.
 *   'users'        → 'app/api/users/route.ts'
 *   'users/[id]'   → 'app/api/users/[id]/route.ts'
 *   'auth/login'   → 'app/api/auth/login/route.ts'
 */
export const apiRouteToVfsPath = (path: string): string => {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '').trim() || 'unnamed';
  return `app / api / ${clean}/route.ts`;
};

/**
 * generateApiRouteFile — full content of a Next.js App Router route handler.
 *
 * Two modes:
 *   1. If route.handlerCode is non-empty → use it verbatim (user-authored).
 *   2. If empty → scaffold from route.methods with typed handlers.
 */
export const generateApiRouteFile = (route: ApiRoute): string => {
  // User-authored code — use verbatim with defensive import injection
  if (route.handlerCode && route.handlerCode.trim().length > 0) {
    const hasImport = route.handlerCode.includes('next/server');
    const importLine = hasImport
      ? ''
      : `import { NextRequest, NextResponse } from 'next/server';\n`;
    const pathComment = `// Next.js Route Handler — /api/${route.path}\n// Generated by Vectra Visual Builder\n\n`;
    return `${pathComment}${importLine}${route.handlerCode}`;
  }

  // Scaffold from methods
  const handlerBlocks = route.methods.map(method => {
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
    const statusCode = method === 'POST' ? 201 : 200;
    const bodyBlock = hasBody
      ? `\n  let body: Record<string, unknown> = {};\n  try {\n    body = await request.json();\n  } catch {\n    return NextResponse.json(\n      { success: false, message: 'Invalid JSON body' },\n      { status: 400 }\n    );\n  }`
      : '';

    return `/**\n * ${method} /api/${route.path}\n * ${route.name}\n */\nexport async function ${method}(request: NextRequest) {${bodyBlock}\n  try {\n    // TODO: Implement your ${method} logic here\n    return NextResponse.json(\n      {\n        success: true,\n        message: '${method} ${route.path} OK',\n        data: null,\n        timestamp: new Date().toISOString(),\n      },\n      { status: ${statusCode} }\n    );\n  } catch (error) {\n    console.error('[${route.path}] ${method} error:', error);\n    return NextResponse.json(\n      {\n        success: false,\n        message: error instanceof Error ? error.message : 'Internal Server Error',\n      },\n      { status: 500 }\n    );\n  }\n}`;
  });

  return `// Next.js Route Handler — /api/${route.path}\n// Generated by Vectra Visual Builder\n// Route: ${route.name}\n// Docs: https://nextjs.org/docs/app/building-your-application/routing/route-handlers\n\nimport { NextRequest, NextResponse } from 'next/server';\n\n${handlerBlocks.join('\n\n')}\n`;
};

import type { LucideIcon } from 'lucide-react';

export type ActionType =
    | { type: 'NAVIGATE'; payload: string }
    | { type: 'OPEN_MODAL'; payload: string }
    | { type: 'SCROLL_TO'; payload: string }
    | { type: 'TOGGLE_VISIBILITY'; payload: string }
    // New Interaction Builder Types
    | { action: 'link'; value: string }
    | { action: 'scroll'; value: string }
    | { action: 'navigate'; value: string };

export interface GlobalStyles {
    colors: Record<string, string>;
    fonts: Record<string, string>;
}

export interface Asset {
    id: string;
    type: 'image';
    url: string;
    name: string;
}

export interface VectraNode {
    id: string;
    type: string;
    name: string;
    content?: string;
    children?: string[];
    src?: string;
    locked?: boolean;
    hidden?: boolean;
    events?: { onClick?: ActionType; };
    // --- LIVE COMPILER: Stores raw React code for AI-generated custom components ---
    code?: string;
    /**
     * CIS-1 — Component import identity.
     * Present on nodes that represent real React components (marketplace, npm,
     * user-registered). Absent on nodes that map to native HTML elements.
     * Drives import statement generation in all export paths.
     * Never present on: div, p, h1, img, input, button, icon, canvas, webpage.
     */
    importMeta?: ComponentImportMeta;
    props: {
        className?: string;
        style?: React.CSSProperties;
        /**
         * Direction A — Responsive Breakpoint Editing
         * Per-node style overrides applied at specific viewport widths.
         * Overrides are ADDITIVE — they merge over base `style` at the breakpoint.
         * mobile:  max-width: 768px  | tablet: max-width: 1024px
         */
        breakpoints?: BreakpointMap;
        layoutMode?: 'canvas' | 'flex' | 'grid';
        stackOnMobile?: boolean;
        placeholder?: string;
        iconName?: string;
        iconSize?: number;
        iconClassName?: string;
        id?: string;
        [key: string]: any;
    };
}


export type VectraProject = Record<string, VectraNode>;

/**
 * Direction A — BreakpointMap
 * additive style overrides keyed by viewport.
 * desktop (>1024px) → base props.style  (no override needed)
 * tablet  (≤1024px) → props.breakpoints.tablet merges over base
 * mobile  (≤768px)  → props.breakpoints.mobile merges over base
 *
 * WHY NOT TAILWIND CLASSES
 * Tailwind responsive prefixes (md:, sm:) require compile-time class knowledge.
 * Since Vectra generates arbitrary pixel values, inline style overrides compiled
 * to @media CSS rules (via buildBreakpointCSS) are the correct approach.
 */
export interface BreakpointMap {
    /** Applied at max-width: 768px (mobile phones) */
    mobile?: Partial<React.CSSProperties>;
    /** Applied at max-width: 1024px (tablets) */
    tablet?: Partial<React.CSSProperties>;
}

/**
 * CIS-1 — Component Identity System
 * ─────────────────────────────────
 * Carries the import identity for any registered component that is NOT a
 * raw HTML element (div, p, h1, etc.). Set on VectraNode at creation time
 * by copying it from ComponentConfig.importMeta.
 *
 * This is the single source of truth that drives:
 *   1. codeGenerator.ts — correct import statement in exported JSX
 *   2. GitHub publish    — correct import in pushed repo files
 *   3. @vectra/loader    — bidirectional component registration
 *
 * ABSENT  = the node is a native HTML element (p, div, h1, img, etc.)
 * PRESENT = the node is a real React component from a package or local path
 */
export interface ComponentImportMeta {
    /**
     * npm package name or project-relative path.
     * npm package:    '@acme/ui'  | 'framer-motion' | 'recharts'
     * relative path:  './components/Button' | '../shared/Card'
     * Vectra internal: '../components/marketplace/HeroGeometric'
     */
    packageName: string;

    /**
     * The exported identifier, used verbatim as the JSX tag name.
     * Default export: the local binding name  →  'HeroGeometric'
     * Named export:   the exact export name   →  'Button' | 'LineChart'
     *
     * This value IS the JSX tag: <HeroGeometric /> <Button /> <LineChart />
     */
    exportName: string;

    /**
     * true  → default import:  import HeroGeometric from '../components/marketplace/HeroGeometric'
     * false → named import:    import { Button } from '@acme/ui'
     * @default false
     */
    isDefault?: boolean;

    /**
     * Semver version range — written into package.json dependencies when
     * packageName is an npm package (not a relative path starting with '.').
     * Example: '^2.0.0' | '~1.5.3'
     * Omit for relative paths or when version pinning is not required.
     */
    version?: string;
}

/**
 * Direction D — PageSEO
 * Per-page metadata fields — maps directly to Next.js Metadata API.
 * All fields optional — generateNextPage() uses page.name as fallback.
 */
export interface PageSEO {
    /** <title> tag — falls back to "${page.name} | Vectra App" */
    title?: string;
    /** <meta name="description"> */
    description?: string;
    /** og:title — falls back to title, then page.name */
    ogTitle?: string;
    /** og:description — falls back to description */
    ogDescription?: string;
    /** og:image — absolute URL required for social sharing */
    ogImage?: string;
    /** <link rel="canonical"> — full URL including domain */
    canonical?: string;
    /** robots noindex — hides page from search engines when true */
    noIndex?: boolean;
}

// Page definition for Multi-Page Architecture
export interface Page {
    id: string;
    name: string;
    slug: string;       // URL path (e.g., '/', '/about', '/contact')
    rootId: string;     // Pointer to the page's root element in VectraProject
    seo?: PageSEO;      // Direction D — per-page SEO metadata
    /** FIG-FUTURE-1: hidden pages are staging areas (e.g. component-mode Figma imports).
     *  Not shown in the Pages panel. Set when name starts with '__figma_comp__'. */
    hidden?: boolean;
}

/**
 * Lightweight project metadata — stored in the project index (not the element tree).
 * Kept small so the Dashboard renders the full list from a single IDB read.
 */
export interface ProjectMeta {
    /** UUID generated once at project creation. Never changes. */
    id: string;
    /** Human-readable project name. User-editable from the Dashboard. */
    name: string;
    /** Framework chosen at project creation. */
    framework: Framework;
    /** Unix timestamp (ms) — set once at creation. */
    createdAt: number;
    /** Unix timestamp (ms) — updated every autosave tick. */
    lastEditedAt: number;
    /** Number of pages in the project — updated on autosave. Quick display info. */
    pageCount: number;
}

export interface Guide {
    orientation: 'horizontal' | 'vertical';
    pos: number;
    start: number;
    end: number;
    label?: string;
    type: 'align' | 'gap';
}

// Component Categories for Insert Drawer
export type ComponentCategory = 'basic' | 'layout' | 'forms' | 'media' | 'sections';

export interface ComponentConfig {
    icon: LucideIcon;
    label: string;
    category: ComponentCategory;
    defaultProps: any;
    defaultContent?: string;
    src?: string;
    /**
     * CIS-1 — If set, nodes created from this config are real React components.
     * Copied onto VectraNode.importMeta at drop/instantiation time.
     * Drives correct import statements across all export paths.
     */
    importMeta?: ComponentImportMeta;
    /**
     * Phase A — Component-First Canvas
     * ──────────────────────────────────
     * Optional reference to the actual React component constructor.
     * When present, RenderNode renders this component directly on the canvas
     * instead of the styled-div fallback path.
     *
     * WHEN TO SET:
     *   registerComponent('my_button', { component: MyButton, importMeta: {...} })
     *   → canvas renders <MyButton /> exactly as it appears in the real codebase.
     *
     * WHEN TO OMIT:
     *   Native HTML elements (text, container, div, p, h1...) — no real component.
     *   Marketplace items in COMPONENT_TYPES — their lazy refs live in RenderNode.
     *
     * ABSENT  → falls through to hardcoded chain or styled-div rendering
     * PRESENT → RenderNode renders <component {...props} /> inside Suspense
     */
    component?: React.ComponentType<any>;
    /**
     * Phase B — @vectra/loader source code field.
     * ─────────────────────────────────────────────
     * Present when a component was registered via the loader bridge.
     * Contains the raw JSX/TSX source (no import statements) — the same
     * format LiveComponent expects.
     *
     * RenderNode Phase B routing: fires when element.importMeta is set AND
     * element.code is absent AND this field is present on the registry entry.
     *
     * PHASE-B-3 [PERMANENT]: MUST NOT be set for marketplace items in constants.ts.
     * The code field is exclusively for @vectra/loader registered components.
     *
     * ABSENT  = Phase A path (runtime component ref) or native HTML element
     * PRESENT = Phase B path (loader-registered, compile-on-demand)
     */
    code?: string;
}

export interface DragData {
    type: 'NEW' | 'TEMPLATE' | 'ASSET' | 'ASSET_IMAGE' | 'ICON' | 'DATA_BINDING';
    payload: string;
    meta?: any;
    dropIndex?: number;
    dropParentId?: string;
}

export interface InteractionState {
    type: 'MOVE' | 'RESIZE';
    itemId: string;
    startX?: number;
    startY?: number;
    startRect?: { left: number; top: number; width: number; height: number };
    handle?: string;
}

export type EditorTool = 'select' | 'hand' | 'type';
export type DeviceType = 'desktop' | 'tablet' | 'mobile';

// View Mode: Visual (Design) vs Skeleton (Layout)
export type ViewMode = 'visual' | 'skeleton';

// DB-1: Extended DataSource — mirrors ProjectContext's authoritative copy.
export type DataSourceKind = 'rest' | 'supabase' | 'planetscale';

export interface DataSource {
    id: string;
    name: string;
    kind?: DataSourceKind;
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    supabaseAnonKey?: string;
    supabaseTable?: string;
    psHost?: string;
    psUsername?: string;
    psPassword?: string;
    psDatabase?: string;
    envVarMap?: Record<string, string>;
    data: any;
    status?: 'idle' | 'connecting' | 'connected' | 'error';
    errorMessage?: string;
    lastFetchedAt?: string;
}

export interface EditorContextType {
    elements: VectraProject;
    setElements: React.Dispatch<React.SetStateAction<VectraProject>>;
    selectedId: string | null;
    setSelectedId: (id: string | null) => void;
    hoveredId: string | null;
    setHoveredId: (id: string | null) => void;
    activePageId: string;
    setActivePageId: (id: string) => void;
    previewMode: boolean;
    setPreviewMode: (mode: boolean) => void;
    viewMode: ViewMode;
    setViewMode: (mode: ViewMode) => void;
    device: DeviceType;
    setDevice: (device: DeviceType) => void;
    activeTool: EditorTool;
    setActiveTool: (tool: EditorTool) => void;
    zoom: number;
    setZoom: React.Dispatch<React.SetStateAction<number>>;
    pan: { x: number; y: number };
    setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
    isPanning: boolean;
    setIsPanning: (isPanning: boolean) => void;
    dragData: DragData | null;
    setDragData: (data: DragData | null) => void;
    interaction: InteractionState | null;
    setInteraction: React.Dispatch<React.SetStateAction<InteractionState | null>>;
    handleInteractionMove: (e: PointerEvent) => void;
    guides: Guide[];
    assets: Asset[];
    addAsset: (file: File) => void;
    globalStyles: GlobalStyles;
    setGlobalStyles: React.Dispatch<React.SetStateAction<GlobalStyles>>;
    addPage: (name: string, slug?: string) => void;
    deletePage: (id: string) => void;
    updateProject: (newElements: VectraProject) => void;
    deleteElement: (id: string) => void;
    history: { undo: () => void; redo: () => void };
    runAction: (action: ActionType) => void;
    isInsertDrawerOpen: boolean;
    toggleInsertDrawer: () => void;
    activePanel: string | null;
    setActivePanel: (panel: string | null) => void;
    togglePanel: (panel: string | null) => void;
    componentRegistry: Record<string, ComponentConfig>;
    registerComponent: (id: string, config: ComponentConfig) => void;
    instantiateTemplate: (rootId: string, nodes: VectraProject) => { newNodes: VectraProject; rootId: string };
    recentComponents: string[];
    addRecentComponent: (id: string) => void;
    currentView: 'dashboard' | 'editor';
    setCurrentView: (view: 'dashboard' | 'editor') => void;
    createNewProject: (templateId: string) => void;
    exitProject: () => void;
    theme: any;
    updateTheme: (updates: any) => void;
    dataSources: DataSource[];
    addDataSource: (ds: DataSource) => void;
    removeDataSource: (id: string) => void;
    updateDataSource: (id: string, patch: Partial<Omit<DataSource, 'id'>>) => void;
    switchPage: (pageId: string) => void;
    /** STI-PAGE-1: Atomic import — merges nodes, registers page, navigates to it. */
    importPage: (name: string, slug: string, nodes: VectraProject, rootId: string) => void;
    pages: any[];
    realPageId: string;
    isMagicBarOpen: boolean;
    setMagicBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

// ─── PHASE A: Framework type ──────────────────────────────────────────────────
// Stored in project metadata (ProjectContext) to determine VFS template,
// code generator, and export format. Default: 'nextjs'.
export type Framework = 'nextjs' | 'vite';

// ─── PHASE D FOUNDATION: API Route type ──────────────────────────────────────
// Represents a single backend API route in the project.
// Will be stored in ProjectContext as apiRoutes: ApiRoute[].
// useFileSync Phase D will write these to app/api/[path]/route.ts.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRoute {
    /** Unique identifier (nanoid) */
    id: string;
    /** Display name shown in the Backend panel, e.g. "Get Users" */
    name: string;
    /**
     * URL path relative to /api/, e.g. "users" → /api/users
     * Supports dynamic segments: "users/[id]" → /api/users/[id]
     */
    path: string;
    /** HTTP methods this route handles */
    methods: HttpMethod[];
    /**
     * Raw TypeScript handler code authored in the inline editor.
     * Written verbatim into app/api/[path]/route.ts.
     */
    handlerCode: string;
    /** ISO timestamp of last edit — used for dirty-check in useFileSync Phase D */
    updatedAt: string;
}


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

export interface DataSource {
    id: string;
    name: string;
    url: string;
    method: 'GET' | 'POST';
    data: any; // The sample JSON response schema
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
    addPage: (name: string) => void;
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


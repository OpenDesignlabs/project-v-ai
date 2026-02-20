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

// Page definition for Multi-Page Architecture
export interface Page {
    id: string;
    name: string;
    slug: string;       // URL path (e.g., '/', '/about', '/contact')
    rootId: string;     // Pointer to the page's root element in VectraProject
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

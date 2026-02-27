/**
 * ─── UI CONTEXT ───────────────────────────────────────────────────────────────
 * Owns only ephemeral, per-session UI state that changes frequently:
 * selections, hovers, active tool, zoom, pan, drag, panels, preview mode.
 *
 * Keeping this separate from ProjectContext means that hovering over an element
 * or switching a sidebar panel does NOT re-render the entire canvas or any
 * component that only cares about document data.
 *
 * This is the "View State" in a loose MVC split with ProjectContext.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { DragData, InteractionState, Guide, Asset, GlobalStyles, EditorTool, DeviceType, ActionType } from '../types';

/** Per-page viewport snapshot — saved when switching away from a page. */
interface PageViewport {
    selectedId: string | null;
    pan: { x: number; y: number };
    zoom: number;
}

export type SidebarPanel = 'add' | 'layers' | 'pages' | 'assets' | 'settings' | 'files' | 'npm' | 'icons' | 'theme' | 'data' | 'marketplace' | 'backend' | null;
export type AppView = 'dashboard' | 'editor';
export type ViewMode = 'visual' | 'skeleton';

interface UIContextType {
    // ── Selection ─────────────────────────────────────────────────────────────
    selectedId: string | null;
    setSelectedId: (id: string | null) => void;
    hoveredId: string | null;
    setHoveredId: (id: string | null) => void;

    // ── Tool & viewport ───────────────────────────────────────────────────────
    activeTool: EditorTool;
    setActiveTool: (tool: EditorTool) => void;
    zoom: number;
    setZoom: React.Dispatch<React.SetStateAction<number>>;
    pan: { x: number; y: number };
    setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
    isPanning: boolean;
    setIsPanning: (v: boolean) => void;

    // ── Drag & interaction ────────────────────────────────────────────────────
    dragData: DragData | null;
    setDragData: (data: DragData | null) => void;
    interaction: InteractionState | null;
    setInteraction: React.Dispatch<React.SetStateAction<InteractionState | null>>;
    guides: Guide[];
    setGuides: React.Dispatch<React.SetStateAction<Guide[]>>;

    // ── Preview / device ──────────────────────────────────────────────────────
    previewMode: boolean;
    setPreviewMode: (v: boolean) => void;
    device: DeviceType;
    setDevice: (d: DeviceType) => void;
    viewMode: ViewMode;
    setViewMode: (m: ViewMode) => void;

    // ── Panels ────────────────────────────────────────────────────────────────
    activePanel: SidebarPanel;
    setActivePanel: React.Dispatch<React.SetStateAction<SidebarPanel>>;
    togglePanel: (panel: SidebarPanel) => void;
    isInsertDrawerOpen: boolean;
    toggleInsertDrawer: () => void;

    // ── Magic bar ─────────────────────────────────────────────────────────────
    isMagicBarOpen: boolean;
    setMagicBarOpen: React.Dispatch<React.SetStateAction<boolean>>;

    // ── Assets & styles ───────────────────────────────────────────────────────
    assets: Asset[];
    addAsset: (file: File) => void;
    globalStyles: GlobalStyles;
    setGlobalStyles: React.Dispatch<React.SetStateAction<GlobalStyles>>;

    // ── App view (dashboard vs editor) ────────────────────────────────────────
    currentView: AppView;
    setCurrentView: (v: AppView) => void;

    /**
     * savePageViewport: snapshot current selectedId/pan/zoom under pageId.
     * Call BEFORE switching activePageId so the departing page's state is captured.
     */
    savePageViewport: (pageId: string) => void;

    /**
     * restorePageViewport: apply the cached viewport for pageId.
     * If no cache entry exists (page never visited), resets to clean slate:
     *   selectedId = null, pan = {x:0, y:0}, zoom = 1
     */
    restorePageViewport: (pageId: string) => void;

    // ── Action runner (links, scroll) ─────────────────────────────────────────
    runAction: (action: ActionType) => void;

    // ── Component registry / recents ─────────────────────────────────────────
    componentRegistry: Record<string, any>;
    registerComponent: (id: string, config: any) => void;
    recentComponents: string[];
    addRecentComponent: (id: string) => void;
}

// ─── CONTEXT ─────────────────────────────────────────────────────────────────

const UIContext = createContext<UIContextType | null>(null);

// ─── PROVIDER ────────────────────────────────────────────────────────────────

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [activeTool, setActiveTool] = useState<EditorTool>('select');
    const [zoom, setZoom] = useState(0.5);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [dragData, setDragData] = useState<DragData | null>(null);
    const [interaction, setInteraction] = useState<InteractionState | null>(null);
    const [guides, setGuides] = useState<Guide[]>([]);
    const [previewMode, setPreviewMode] = useState(false);
    const [device, setDeviceState] = useState<DeviceType>('desktop');
    const [viewMode, setViewMode] = useState<ViewMode>('visual');
    const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
    const [isInsertDrawerOpen, setIsInsertDrawerOpen] = useState(false);
    const [isMagicBarOpen, setMagicBarOpen] = useState(false);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [globalStyles, setGlobalStyles] = useState<GlobalStyles>({ colors: { primary: '#3b82f6', secondary: '#10b981', accent: '#f59e0b', dark: '#1e293b' }, fonts: {} });
    const [componentRegistry, setComponentRegistry] = useState<Record<string, any>>({});
    const [recentComponents, setRecentComponents] = useState<string[]>([]);

    // ── Per-page viewport cache (Direction 3 — Item 0 perf fix) ──────────────────
    //
    // THE PROBLEM THIS FIXES:
    // savePageViewport previously closed over selectedId, pan, and zoom directly.
    // Those values change at 60fps during pan/zoom gestures. useCallback([selectedId,
    // pan, zoom]) recreated savePageViewport on every frame. Canvas.tsx's useEffect
    // depended on it, so the event listener tore down and re-attached 60 times/sec.
    // window.removeEventListener + addEventListener at 60fps is not free.
    //
    // THE FIX:
    // viewportStateRef is a ref that mirrors the three values synchronously.
    // A single useEffect (dep: [selectedId, pan, zoom]) writes to the ref on
    // every change — this is the ONLY thing that depends on those values.
    // savePageViewport reads from the ref with dep array []. It is created ONCE,
    // never recreated, and Canvas.tsx's useEffect dep array is also [].
    // The event listener attaches exactly once on mount and detaches on unmount.
    const pageViewportCache = useRef<Map<string, PageViewport>>(new Map());

    // Stable ref — always holds the latest selectedId/pan/zoom without causing
    // savePageViewport to be recreated when those values change.
    const viewportStateRef = useRef<PageViewport>({
        selectedId: null,
        pan: { x: 0, y: 0 },
        zoom: 0.5,
    });

    // Keep the ref in sync. This effect runs whenever the viewport state changes,
    // but it does NOT cause any callbacks that depend on it to be recreated.
    useEffect(() => {
        viewportStateRef.current = { selectedId, pan, zoom };
    }, [selectedId, pan, zoom]);

    // Stable identity — [] dep array. Reads from viewportStateRef, never from
    // the closed-over state variables. Zero listener churn during 60fps pan.
    const savePageViewport = useCallback((pageId: string) => {
        pageViewportCache.current.set(pageId, { ...viewportStateRef.current });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Stable identity — setter functions from useState are guaranteed stable
    // by React, so this is safe with [].
    const restorePageViewport = useCallback((pageId: string) => {
        const cached = pageViewportCache.current.get(pageId);
        if (cached) {
            setSelectedId(cached.selectedId);
            setPan(cached.pan);
            setZoom(cached.zoom);
        } else {
            setSelectedId(null);
            setPan({ x: 0, y: 0 });
            setZoom(1);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // App view — persisted to localStorage
    const [currentView, setCurrentViewState] = useState<AppView>(() =>
        (localStorage.getItem('vectra_view') as AppView) || 'dashboard'
    );
    const setCurrentView = useCallback((v: AppView) => {
        setCurrentViewState(v);
        localStorage.setItem('vectra_view', v);
    }, []);

    // Listen for project exit event dispatched by ProjectContext
    useEffect(() => {
        const handler = () => setCurrentView('dashboard');
        window.addEventListener('vectra:exit-project', handler);
        return () => window.removeEventListener('vectra:exit-project', handler);
    }, [setCurrentView]);

    // Listen for project open event dispatched by Dashboard
    useEffect(() => {
        const handler = () => setCurrentView('editor');
        window.addEventListener('vectra:open-project', handler);
        return () => window.removeEventListener('vectra:open-project', handler);
    }, [setCurrentView]);

    // Clear guides when interaction ends
    useEffect(() => { if (!interaction) setGuides([]); }, [interaction]);

    // Magic bar keyboard shortcut (Cmd+K / Ctrl+K)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setMagicBarOpen(p => !p); }
            if (e.key === 'Escape' && isMagicBarOpen) setMagicBarOpen(false);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isMagicBarOpen]);

    const setDevice = (d: DeviceType) => {
        setDeviceState(d);
        setZoom(d === 'mobile' ? 1 : 0.8);
    };

    const addAsset = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => setAssets(prev => [...prev, { id: `asset-${Date.now()}`, type: 'image', url: e.target?.result as string, name: file.name }]);
        reader.readAsDataURL(file);
    };

    const runAction = (act: ActionType) => {
        if ('action' in act) {
            if (act.action === 'link' && act.value) {
                try {
                    const url = new URL(act.value, window.location.href);
                    if (url.protocol === 'http:' || url.protocol === 'https:') window.open(act.value, '_blank', 'noopener,noreferrer');
                    else console.warn('[Security] Blocked non-http URL:', url.protocol);
                } catch { console.warn('[Security] Blocked invalid URL:', act.value); }
            } else if (act.action === 'scroll' && act.value) {
                document.getElementById(act.value)?.scrollIntoView({ behavior: 'smooth' });
            }
        }
    };

    return (
        <UIContext.Provider value={{
            selectedId, setSelectedId, hoveredId, setHoveredId,
            activeTool, setActiveTool, zoom, setZoom, pan, setPan,
            isPanning, setIsPanning, dragData, setDragData,
            interaction, setInteraction, guides, setGuides,
            previewMode, setPreviewMode, device, setDevice,
            viewMode, setViewMode, activePanel, setActivePanel,
            togglePanel: (p) => setActivePanel(cur => cur === p ? null : p),
            isInsertDrawerOpen, toggleInsertDrawer: () => setIsInsertDrawerOpen(p => !p),
            isMagicBarOpen, setMagicBarOpen,
            assets, addAsset, globalStyles, setGlobalStyles,
            currentView, setCurrentView, runAction,
            componentRegistry,
            registerComponent: (id, cfg) => setComponentRegistry(p => ({ ...p, [id]: cfg })),
            recentComponents,
            addRecentComponent: (id) => setRecentComponents(p => [id, ...p.filter(i => i !== id)].slice(0, 8)),
            savePageViewport,
            restorePageViewport,
        }}>
            {children}
        </UIContext.Provider>
    );
};

// ─── HOOK ─────────────────────────────────────────────────────────────────────

export const useUI = (): UIContextType => {
    const ctx = useContext(UIContext);
    if (!ctx) throw new Error('useUI must be used within UIProvider');
    return ctx;
};

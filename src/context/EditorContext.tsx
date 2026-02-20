import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { VectraProject, DragData, InteractionState, Guide, Asset, GlobalStyles, EditorTool, DeviceType, ActionType, ViewMode, ComponentConfig, Page } from '../types';
import { INITIAL_DATA, COMPONENT_TYPES, STORAGE_KEY } from '../data/constants';
import { instantiateTemplate as instantiateTemplateTS } from '../utils/templateUtils';
import { generateWithAI } from '../services/aiAgent';

import { mergeAIContent } from '../utils/aiHelpers';
import { deleteNodeRecursive, canDeleteNode } from '../utils/treeUtils';



// --- GLOBAL WASM REFERENCE ---
// Must be outside component to be accessible by event handlers
let wasmModule: any = null;

export type SidebarPanel = 'add' | 'layers' | 'pages' | 'assets' | 'settings' | 'files' | 'npm' | 'icons' | 'theme' | 'data' | 'marketplace' | null;
export type AppView = 'dashboard' | 'editor';

export interface GlobalTheme {
    primary: string;
    secondary: string;
    accent: string;
    radius: '0px' | '0.25rem' | '0.5rem' | '0.75rem' | '1rem';
    font: string;
}

export interface DataSource {
    id: string;
    name: string;
    url: string;
    method: 'GET' | 'POST';
    data: any;
}

interface ExtendedEditorContextType {
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
    pages: Page[];
    switchPage: (pageId: string) => void;
    realPageId: string;
    updateProject: (newElements: VectraProject) => void;
    deleteElement: (id: string) => void;
    history: { undo: () => void; redo: () => void };
    runAction: (action: ActionType) => void;
    isInsertDrawerOpen: boolean;
    toggleInsertDrawer: () => void;
    activePanel: SidebarPanel;
    setActivePanel: React.Dispatch<React.SetStateAction<SidebarPanel>>;
    togglePanel: (panel: SidebarPanel) => void;
    componentRegistry: Record<string, ComponentConfig>;
    registerComponent: (id: string, config: ComponentConfig) => void;
    instantiateTemplate: (rootId: string, nodes: VectraProject) => { newNodes: VectraProject; rootId: string };
    recentComponents: string[];
    addRecentComponent: (id: string) => void;
    currentView: AppView;
    setCurrentView: (view: AppView) => void;
    createNewProject: (templateId: string) => void;
    exitProject: () => void;
    theme: GlobalTheme;
    updateTheme: (updates: Partial<GlobalTheme>) => void;
    dataSources: DataSource[];
    addDataSource: (ds: DataSource) => void;
    removeDataSource: (id: string) => void;
    isMagicBarOpen: boolean;
    setMagicBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
    runAI: (prompt: string) => Promise<string | undefined>;
}


const EditorContext = createContext<ExtendedEditorContextType | undefined>(undefined);

export const EditorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // --- STATE INITIALIZATION ---
    const [elements, setElements] = useState<VectraProject>(() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || INITIAL_DATA; }
        catch { return INITIAL_DATA; }
    });

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [activePageId, setActivePageId] = useState('page-home');
    const [previewMode, setPreviewMode] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('visual');
    const [activeTool, setActiveTool] = useState<EditorTool>('select');
    const [device, setDeviceState] = useState<DeviceType>('desktop');
    const [dragData, setDragData] = useState<DragData | null>(null);
    const [interaction, setInteraction] = useState<InteractionState | null>(null);
    const [zoom, setZoom] = useState(0.5);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [isMagicBarOpen, setMagicBarOpen] = useState(false);

    // History
    const historyManagerRef = useRef<any>(null);
    const [historyStack, setHistoryStack] = useState<VectraProject[]>([INITIAL_DATA]);
    const [historyIndex, setHistoryIndex] = useState(0);

    const [guides, setGuides] = useState<Guide[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [pages, setPages] = useState<Page[]>([{ id: 'page-home', name: 'Home', slug: '/', rootId: 'page-home' }]);
    const [globalStyles, setGlobalStyles] = useState<GlobalStyles>({ colors: { primary: '#3b82f6', secondary: '#10b981', accent: '#f59e0b', dark: '#1e293b' }, fonts: {} });
    const [isInsertDrawerOpen, setIsInsertDrawerOpen] = useState(false);
    const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
    const [componentRegistry, setComponentRegistry] = useState<Record<string, ComponentConfig>>(COMPONENT_TYPES);
    const [recentComponents, setRecentComponents] = useState<string[]>([]);

    // VIEW STATE (Critical for Launching Editor from Dashboard)
    const [currentView, setCurrentView] = useState<AppView>(() => {
        return (localStorage.getItem('vectra_view') as AppView) || 'dashboard';
    });

    useEffect(() => {
        localStorage.setItem('vectra_view', currentView);
    }, [currentView]);

    const [theme, setTheme] = useState<GlobalTheme>({ primary: '#3b82f6', secondary: '#64748b', accent: '#f59e0b', radius: '0.5rem', font: 'Inter' });
    const [dataSources, setDataSources] = useState<DataSource[]>([
        { id: 'ds-1', name: 'JSONPlaceholder', url: 'https://jsonplaceholder.typicode.com/users', method: 'GET', data: { name: 'Demo User' } }
    ]);

    const addDataSource = (ds: DataSource) => setDataSources(p => [...p, ds]);
    const removeDataSource = (id: string) => setDataSources(p => p.filter(d => d.id !== id));

    // --- ACTIONS (RESTORED FROM BACKUP) ---
    const createNewProject = useCallback((templateId: string) => {
        console.log(`[Vectra] Initializing project with template: ${templateId}...`);

        // 1. Hard Reset State
        setElements(INITIAL_DATA);
        setHistoryStack([INITIAL_DATA]);
        setHistoryIndex(0);
        setPages([{ id: 'page-home', name: 'Home', slug: '/', rootId: 'page-home' }]);
        setActivePageId('page-home');
        setSelectedId(null);
        setZoom(0.5);
        setPan({ x: 0, y: 0 });

        // 2. Clear Storage
        localStorage.removeItem(STORAGE_KEY);

        // 3. Switch View
        setCurrentView('editor');
    }, []);

    const exitProject = useCallback(() => {
        if (confirm("Exit to dashboard? Unsaved changes will be kept in local history.")) {
            setCurrentView('dashboard');
        }
    }, []);

    // --- WASM INIT ---
    useEffect(() => {
        const initWasm = async () => {
            try {
                const wasm = await import('../../vectra-engine/pkg/vectra_engine.js');
                await wasm.default();
                wasmModule = wasm;

                // Safe Init for History
                const safeState = JSON.stringify(INITIAL_DATA);
                historyManagerRef.current = new wasm.HistoryManager(safeState);

                console.log("Vectra Engine (Rust): Ready");
            } catch (e) {
                console.warn("Vectra Engine (Rust): Init failed.", e);
            }
        };
        initWasm();
    }, []);

    // --- STORAGE SYNC ---
    useEffect(() => {
        const timer = setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(elements)), 1000);
        return () => clearTimeout(timer);
    }, [elements]);

    // --- UPDATES & HISTORY ---
    const updateProject = useCallback((newElements: VectraProject) => {
        setElements(newElements);

        if (historyManagerRef.current) {
            try {
                const stateStr = JSON.stringify(newElements);
                if (stateStr.length > 1024 * 1024) throw new Error("Size limit reached");
                historyManagerRef.current.push_state(newElements);
            } catch (e) {
                setHistoryStack(p => [...p.slice(0, historyIndex + 1), newElements].slice(-50));
                setHistoryIndex(p => Math.min(p + 1, 49));
            }
        } else {
            setHistoryStack(p => [...p.slice(0, historyIndex + 1), newElements].slice(-50));
            setHistoryIndex(p => Math.min(p + 1, 49));
        }
    }, [historyIndex]);

    const undo = useCallback(() => {
        if (historyManagerRef.current && historyManagerRef.current.can_undo()) {
            const prevStateStr = historyManagerRef.current.undo();
            if (prevStateStr) setElements(JSON.parse(prevStateStr));
        } else if (historyIndex > 0) {
            setHistoryIndex(p => p - 1);
            setElements(historyStack[historyIndex - 1]);
        }
    }, [historyIndex, historyStack]);

    const redo = useCallback(() => {
        if (historyManagerRef.current && historyManagerRef.current.can_redo()) {
            const nextStateStr = historyManagerRef.current.redo();
            if (nextStateStr) setElements(JSON.parse(nextStateStr));
        } else if (historyIndex < historyStack.length - 1) {
            setHistoryIndex(p => p + 1);
            setElements(historyStack[historyIndex + 1]);
        }
    }, [historyIndex, historyStack]);

    // --- INTERACTION ENGINE ---
    const handleInteractionMove = useCallback((e: PointerEvent) => {
        if (!interaction) return;
        const { type, itemId, startX, startY, startRect, handle } = interaction;

        const currentStartX = startX || 0;
        const currentStartY = startY || 0;
        const deltaX = (e.clientX - currentStartX) / zoom;
        const deltaY = (e.clientY - currentStartY) / zoom;
        const THRESHOLD = 5;

        let newRect = startRect ? { ...startRect } : { left: 0, top: 0, width: 0, height: 0 };
        let newGuides: Guide[] = [];

        if (type === 'MOVE') {
            const parentId = Object.keys(elements).find(k => elements[k].children?.includes(itemId));
            const parent = parentId ? elements[parentId] : null;
            const siblings = parentId ? elements[parentId].children || [] : [];

            const candidates = siblings
                .filter(id => id !== itemId)
                .map(id => {
                    const el = elements[id];
                    return {
                        id: id,
                        x: parseFloat(String(el.props.style?.left || 0)),
                        y: parseFloat(String(el.props.style?.top || 0)),
                        w: parseFloat(String(el.props.style?.width || 0)),
                        h: parseFloat(String(el.props.style?.height || 0)),
                    };
                });

            if (parent && (parent.type === 'canvas' || parent.type === 'webpage')) {
                candidates.push({
                    id: 'parent',
                    x: 0, y: 0,
                    w: parseFloat(String(parent.props.style?.width || 0)),
                    h: parseFloat(String(parent.props.style?.height || 0))
                });
            }

            const targetRect = {
                id: itemId,
                x: startRect?.left || 0,
                y: startRect?.top || 0,
                w: startRect?.width || 0,
                h: startRect?.height || 0
            };

            if (wasmModule && wasmModule.calculate_snapping) {
                try {
                    const result = wasmModule.calculate_snapping(targetRect, candidates, deltaX, deltaY, THRESHOLD);
                    newRect.left = result.x;
                    newRect.top = result.y;
                    newGuides = result.guides;
                } catch {
                    newRect.left = targetRect.x + deltaX;
                    newRect.top = targetRect.y + deltaY;
                }
            } else {
                newRect.left = targetRect.x + deltaX;
                newRect.top = targetRect.y + deltaY;
            }

        } else if (type === 'RESIZE' && handle && startRect) {
            if (handle.includes('e')) newRect.width = Math.max(20, startRect.width + deltaX);
            if (handle.includes('w')) { newRect.width = Math.max(20, startRect.width - deltaX); newRect.left = startRect.left + deltaX; }
            if (handle.includes('s')) newRect.height = Math.max(20, startRect.height + deltaY);
            if (handle.includes('n')) { newRect.height = Math.max(20, startRect.height - deltaY); newRect.top = startRect.top + deltaY; }
        }

        setGuides(newGuides);

        setElements(prev => {
            const currentElement = prev[itemId];
            if (!currentElement) return prev;
            return {
                ...prev,
                [itemId]: {
                    ...currentElement,
                    props: {
                        ...currentElement.props,
                        style: {
                            ...currentElement.props.style,
                            left: `${newRect.left}px`,
                            top: `${newRect.top}px`,
                            width: `${newRect.width}px`,
                            height: `${newRect.height}px`,
                        }
                    }
                }
            };
        });
    }, [interaction, zoom, elements]);

    useEffect(() => { if (!interaction) setGuides([]); }, [interaction]);

    // --- CRUD OPS ---
    // RECURSIVE DELETE (Prevents Orphaned Nodes)
    const deleteElement = useCallback((id: string) => {
        if (!canDeleteNode(id)) {
            console.warn(`⚠️ Cannot delete protected node: ${id}`);
            return;
        }

        // Use functional update for concurrency safety
        setElements(prev => deleteNodeRecursive(prev, id));

        // Clear selection if deleted node was selected
        if (selectedId === id) {
            setSelectedId(null);
        }
    }, [selectedId]);


    const addPage = (name: string, slug?: string) => {
        const pageId = `page-${Date.now()}`;
        const canvasId = `canvas-${Date.now()}`;
        const pageSlug = slug || `/${name.toLowerCase().replace(/\s+/g, '-')}`;
        const newElements = { ...elements };

        newElements[pageId] = {
            id: pageId, type: 'page', name: name, children: [canvasId],
            props: { className: 'w-full h-full relative', style: { width: '100%', height: '100%' } }
        };
        newElements[canvasId] = {
            id: canvasId, type: 'webpage', name: name, children: [],
            props: { layoutMode: 'canvas', style: { width: '100%', minHeight: '100vh', backgroundColor: '#ffffff' } }
        };
        if (newElements['application-root']) {
            newElements['application-root'].children = [...(newElements['application-root'].children || []), pageId];
        }

        setPages(prev => [...prev, { id: pageId, name, slug: pageSlug, rootId: pageId }]);
        updateProject(newElements);
        setActivePageId(pageId);
    };

    const deletePage = (id: string) => {
        if (pages.length <= 1 || id === 'page-home') return;
        const newElements = { ...elements };
        if (newElements['application-root']) {
            newElements['application-root'].children = newElements['application-root'].children?.filter(cid => cid !== id);
        }
        delete newElements[id];
        setPages(prev => prev.filter(p => p.id !== id));
        updateProject(newElements);
        if (activePageId === id) setActivePageId(pages[0].id);
    };

    const setDevice = (newDevice: DeviceType) => {
        setDeviceState(newDevice);
        // Optimization: Zoom adjust
        if (newDevice === 'mobile') setZoom(1); else setZoom(0.8);
    };

    const runAction = (act: ActionType) => {
        if ('action' in act) {
            if (act.action === 'link' && act.value) {
                // SECURITY: Validate protocol to block javascript: and data: URLs
                // noopener prevents tabnabbing (new tab cannot access window.opener)
                // noreferrer prevents leaking the referrer header
                try {
                    const url = new URL(act.value, window.location.href);
                    if (url.protocol === 'http:' || url.protocol === 'https:') {
                        window.open(act.value, '_blank', 'noopener,noreferrer');
                    } else {
                        console.warn('[Security] Blocked navigation to non-http URL:', url.protocol);
                    }
                } catch {
                    console.warn('[Security] Blocked navigation to invalid URL:', act.value);
                }
            }
            else if (act.action === 'scroll' && act.value) {
                document.getElementById(act.value)?.scrollIntoView({ behavior: 'smooth' });
            }
        }
    };


    // --- KEYBOARD SHORTCUT FOR MAGIC BAR (Cmd+K / Ctrl+K) ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Toggle MagicBar with Cmd+K or Ctrl+K
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setMagicBarOpen(prev => !prev);
            }
            // Close MagicBar on Escape
            if (e.key === 'Escape' && isMagicBarOpen) {
                setMagicBarOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMagicBarOpen]);

    // --- OTHER HELPERS ---
    const addAsset = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => setAssets(prev => [...prev, { id: `asset-${Date.now()}`, type: 'image', url: e.target?.result as string, name: file.name }]);
        reader.readAsDataURL(file);
    };

    // --- AI EXECUTION LOGIC (CONCURRENCY-SAFE) ---
    const runAI = async (prompt: string): Promise<string | undefined> => {
        try {
            console.log("🎨 AI Agent processing:", prompt);

            // STEP 1: Read current state for AI context (snapshot is OK here)
            const result = await generateWithAI(prompt, elements);

            if (result.action === 'error') {
                console.warn("❌ AI Error:", result.message);
                return result.message;
            }

            if (result.action === 'create' && result.elements && result.rootId) {
                console.log("✨ Creating new elements...");
                console.log("📦 AI generated root:", result.rootId);

                // Find current page
                const currentPage = pages.find(p => p.id === activePageId);
                if (!currentPage) {
                    console.error("❌ No active page found");
                    return "No active page";
                }

                // Detect if full page or section
                const isFullPage = prompt.toLowerCase().includes('page') ||
                    prompt.toLowerCase().includes('website') ||
                    prompt.toLowerCase().includes('portfolio') ||
                    prompt.toLowerCase().includes('landing');

                // STEP 2: CRITICAL - Use functional update to merge into LATEST state
                // This ensures concurrent edits during AI generation are not lost
                setElements(currentElements => {
                    return mergeAIContent(
                        currentElements,  // Use LATEST state, not snapshot
                        currentPage.rootId,
                        result.elements!,
                        result.rootId!,
                        isFullPage
                    );
                });

                console.log("✅ Canvas updated with", Object.keys(result.elements).length, "new elements");
                return result.message;
            }

            if (result.action === 'update' && result.elements) {
                console.log("🔄 Updating existing elements...");

                // STEP 2: Use functional update for updates too
                setElements(currentElements => ({
                    ...currentElements,
                    ...result.elements
                }));

                console.log("✅ Updated", Object.keys(result.elements).length, "elements");
                return result.message;
            }

        } catch (e) {
            console.error("❌ AI Error:", e);
            return "Something went wrong.";
        }
    };

    const togglePanel = (p: SidebarPanel) => setActivePanel(curr => curr === p ? null : p);

    return (
        <EditorContext.Provider value={{
            elements, setElements, selectedId, setSelectedId, hoveredId, setHoveredId,
            activePageId, setActivePageId, previewMode, setPreviewMode, activeTool, setActiveTool,
            device, setDevice, dragData, setDragData, zoom, setZoom, pan, setPan, isPanning, setIsPanning,
            interaction, setInteraction, handleInteractionMove, guides, assets, addAsset,
            globalStyles, setGlobalStyles, addPage, deletePage, pages, switchPage: (id) => { setActivePageId(id); setSelectedId(null); },
            realPageId: activePageId, updateProject, deleteElement, history: { undo, redo }, runAction,
            isInsertDrawerOpen, toggleInsertDrawer: () => setIsInsertDrawerOpen(p => !p), activePanel, setActivePanel, togglePanel,
            componentRegistry, registerComponent: (id, cfg) => setComponentRegistry(p => ({ ...p, [id]: cfg })),
            instantiateTemplate: instantiateTemplateTS, recentComponents, addRecentComponent: (id) => setRecentComponents(p => [id, ...p.filter(i => i !== id)].slice(0, 8)),
            currentView, setCurrentView, createNewProject, exitProject,
            theme, updateTheme: (u) => setTheme(p => ({ ...p, ...u })),
            dataSources, addDataSource, removeDataSource, isMagicBarOpen, setMagicBarOpen, viewMode, setViewMode, runAI,

        }}>
            {children}
        </EditorContext.Provider>
    );
};

export const useEditor = () => {
    const context = useContext(EditorContext);
    if (!context) throw new Error("useEditor must be used within EditorProvider");
    return context;
};

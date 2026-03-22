/** Stores all project document data: element tree, pages, history, autosave, and Wasm engines.
 * Components re-render only when project data changes (not on hover or panel switches). */
import React, {
    createContext, useContext, useState, useEffect,
    useCallback, useRef, useMemo, type ReactNode,
} from 'react';
import type { VectraProject, VectraNode, Page, ApiRoute, HttpMethod, Framework, ProjectMeta, SnapResult } from '../types/index.js';
import { INITIAL_DATA, STORAGE_KEY } from '../data/constants';
export const FRAMEWORK_KEY = 'vectra_framework';
import { mergeAIContent } from '../utils/aiHelpers';
import { deleteNodeRecursive, canDeleteNode } from '../utils/treeUtils';
import { instantiateTemplate as instantiateTemplateTS } from '../utils/templateUtils';
import { generateWithAI } from '../services/aiAgent';
import {
    saveProjectIndexToDB, loadProjectIndexFromDB,
    saveProjectDataToDB2, loadProjectDataFromDB2, deleteProjectDataFromDB2,
    migrateFromLegacyStorage,
    type FullProjectSave,
} from '../utils/db';
import { generateLayoutThumbnail } from '../utils/generateThumbnail';

/** localStorage key that remembers which project was last open. */
const ACTIVE_PROJECT_ID_KEY = 'vectra_active_id';

/** Generate a collision-resistant project UUID. */
// Uses crypto.randomUUID() to avoid key collisions when two projects are created quickly.
const generateProjectId = (): string => `proj_${crypto.randomUUID().replace(/-/g, '')}`;

/** Per-project localStorage snap key (fast-boot cache). */
const snapKey = (id: string) => `vectra_snap_${id}`;
/** Per-project localStorage key for the SVG wireframe thumbnail.
 * Mirrors snapKey() — both are cleaned up together when a project is deleted. */
const thumbKey = (id: string) => `vectra_thumb_${id}`;

export type { VectraProject, Page };

// ─── WASM module ref ──────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any = null;

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface GlobalTheme {
    primary: string;
    secondary: string;
    accent: string;
    radius: '0px' | '0.25rem' | '0.5rem' | '0.75rem' | '1rem';
    font: string;
}

// Represents an external data source (REST, Supabase, PlanetScale) bound to canvas elements.
export type DataSourceKind = 'rest' | 'supabase' | 'planetscale';
export interface DataSource {
    id: string;
    name: string;
    /** Connection type. Defaults to 'rest' when absent (backward compat). */
    kind?: DataSourceKind;
    url: string;
    method: 'GET' | 'POST';
    /** Custom request headers (REST). */
    headers?: Record<string, string>;
    /** JSON body string for POST requests (REST). */
    body?: string;
    /** Supabase anon/public key — DS-ENV-1: written to .env.local, not displayed. */
    supabaseAnonKey?: string;
    /** Active Supabase table name for schema introspection. */
    supabaseTable?: string;
    /** PlanetScale host. */
    psHost?: string;
    /** PlanetScale username. */
    psUsername?: string;
    /** PlanetScale password — DS-ENV-1: written to .env.local only. */
    psPassword?: string;
    /** PlanetScale database name. */
    psDatabase?: string;
    /** Maps DataSource field names to their .env.local variable names for codegen. */
    envVarMap?: Record<string, string>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
    /** Transient connection state (not persisted to IDB). */
    status?: 'idle' | 'connecting' | 'connected' | 'error';
    errorMessage?: string;
    lastFetchedAt?: string;
}

/** Snapping result returned by querySnapping (mirrors Rust SnapResult). */

interface ProjectContextType {
    // ── Elements ──────────────────────────────────────────────────────────────
    elements: VectraProject;
    setElements: React.Dispatch<React.SetStateAction<VectraProject>>;
    /** Live ref that always contains the current elements — safe to read at 60fps without closure issues. */
    elementsRef: React.MutableRefObject<VectraProject>;
    /**
     * Write new elements and (optionally) push a history entry.
     * Accepts either the legacy boolean form (backward-compatible):
     *   updateProject(els, true)          — skip history (drag 60fps path)
     * or the new options-object form:
     *   updateProject(els, { skipHistory: true, skipLayout: true })
     * `skipLayout` prevents an O(N) spatial-hash rebuild on the drag path when
     * a future auto-sync effect is added (defensive; no-op today).
     */
    updateProject: (newElements: VectraProject, options?: boolean | { skipHistory?: boolean; skipLayout?: boolean }) => void;
    /** Commit current state to history — call once after a drag ends. */
    pushHistory: (elements: VectraProject) => void;
    deleteElement: (id: string) => void;
    /** Item 1 — Deep-clone a node + subtree with fresh IDs. Returns new root ID, or null if protected. */
    duplicateElement: (id: string) => string | null;
    /** Item 4 — Move a node to targetIndex inside targetParent.children. One history entry on drop. */
    reorderElement: (nodeId: string, targetParentId: string, targetIndex: number) => void;
    instantiateTemplate: (rootId: string, nodes: VectraProject) => { newNodes: VectraProject; rootId: string };
    /** O(1) child→parent lookup map. Replaces per-render O(N) Object.keys scan. */
    parentMap: Map<string, string>;

    // ── Pages ─────────────────────────────────────────────────────────────────
    pages: Page[];
    activePageId: string;
    setActivePageId: (id: string) => void;
    realPageId: string;
    addPage: (name: string, slug?: string) => void;
    deletePage: (id: string) => void;
    switchPage: (pageId: string) => void;
    /**
     * STI-PAGE-1: Atomic page import.
     * Merges `nodes` into elements, registers the page, sets it active.
     * Does NOT create an orphan canvas node — rootId IS the canvas.
     */
    importPage: (args: { pageName: string; slug: string; nodes: VectraProject; rootId: string }) => void;
    /**
     * Direction D — SEO Control
     * Merge-update the SEO fields for a specific page.
     * Only the fields provided are changed — all others are preserved.
     */
    updatePageSEO: (pageId: string, seo: Partial<import('../types/index.js').PageSEO>) => void;

    // ── History ───────────────────────────────────────────────────────────────
    /** @deprecated Use flat `undo`/`redo` — `history` object re-creates on every render */
    history: { undo: () => void; redo: () => void };
    /** Stable identity — safe in useEffect dep arrays */
    undo: () => void;
    /** Stable identity — safe in useEffect dep arrays */
    redo: () => void;

    // ── Snapping (Retained-Mode LayoutEngine) ─────────────────────────────────
    /**
     * Call ONCE on drag-start (pointer-down). Pushes all sibling rects into the
     * Wasm LayoutEngine so the 60fps query path transfers zero large data.
     */
    syncLayoutEngine: (draggedId: string) => void;
    /**
     * Fast 60fps snap query — only 5 scalar args cross the Wasm boundary.
     * Returns null if LayoutEngine is not yet initialised.
     */
    querySnapping: (x: number, y: number, w: number, h: number, threshold?: number) => SnapResult | null;

    // ── Theme & data sources ──────────────────────────────────────────────────
    theme: GlobalTheme;
    updateTheme: (updates: Partial<GlobalTheme>) => void;
    dataSources: DataSource[];
    addDataSource: (ds: DataSource) => void;
    removeDataSource: (id: string) => void;
    /** DB-1: partial update — for status/error/data updates after fetch. */
    updateDataSource: (id: string, patch: Partial<Omit<DataSource, 'id'>>) => void;

    // ── API Routes (Phase D) ──────────────────────────────────────────────────
    apiRoutes: ApiRoute[];
    addApiRoute: (name: string, path: string, methods: HttpMethod[]) => void;
    updateApiRoute: (id: string, patch: Partial<Omit<ApiRoute, 'id'>>) => void;
    deleteApiRoute: (id: string) => void;

    // ── Framework (Phase E) ───────────────────────────────────────────────────
    /** The active framework for this project. Determines VFS template + code gen. */
    framework: Framework;
    /** Exposed for the Header badge display. Read-only after project creation. */
    setFramework: React.Dispatch<React.SetStateAction<Framework>>;

    // ── Project lifecycle ─────────────────────────────────────────────────────
    createNewProject: (templateId: string) => void;
    exitProject: () => void;

    // ── AI ────────────────────────────────────────────────────────────────────
    runAI: (prompt: string) => Promise<string | undefined>;

    // ── CF-1: Frame Picker ─────────────────────────────────────────────────────
    /** Create a new artboard from a device preset, placed to the right of all existing frames. */
    addFrame: (preset: import('../data/framePresets').FramePreset) => void;

    // ── Rust SWC compiler (exposed for ContainerPreview) ────────────
    /**
     * Compile TSX/JSX → browser-ready CJS JS using the persistent Rust SWC engine.
     * Handles TypeScript stripping, JSX → React.createElement, and ESM→CJS shim.
     * Returns an error string (console.error inside) on failure, never throws.
     */
    compileComponent: (code: string) => Promise<string>;

    // ── Multi-project (Phase H) ───────────────────────────────────────────────
    /** UUID of the currently open project. */
    projectId: string;
    /** Human-readable name of the currently open project. */
    projectName: string;
    /** Full list of saved project metadata — used to render the Dashboard. */
    projectIndex: ProjectMeta[];
    /** Open an existing project by its metadata record. */
    loadProject: (meta: ProjectMeta) => Promise<void>;
    /** Rename a project. Updates index in IDB. */
    renameProject: (id: string, name: string) => Promise<void>;
    /** Duplicate a project. Creates a new UUID + copies element data. */
    duplicateProject: (meta: ProjectMeta) => Promise<void>;
    /** Permanently delete a project and its data. */
    deleteProject: (id: string) => Promise<void>;
    // ── Sprint 2: Soft-delete 3-stage API ─────────────────────────────────────
    /** Stage 1: remove from visible index only. IDB data is NOT deleted. */
    removeProjectFromIndex: (id: string) => Promise<void>;
    /** Stage 3: permanently delete IDB data + localStorage snap. */
    purgeProjectData: (id: string) => Promise<void>;
    /** Undo path: re-insert meta into the index. */
    restoreProjectToIndex: (meta: ProjectMeta) => Promise<void>;
}

// ─── CONTEXT ─────────────────────────────────────────────────────────────────

const ProjectContext = createContext<ProjectContextType | null>(null);

// ─── HELPER: Default API handler stub (Phase D) ──────────────────────────────
// Module-scope so no circular dep with codeGenerator.ts.
const buildDefaultHandlerStub = (methods: HttpMethod[], routePath: string): string => {
    const handlers = methods.map(method => {
        const bodyLine = ['POST', 'PUT', 'PATCH'].includes(method)
            ? '\n  const body = await request.json();\n  console.log(body);'
            : '';
        return `export async function ${method}(request: Request) {${bodyLine}\n  try {\n    // TODO: implement ${method} handler\n    return Response.json(\n      { success: true, message: 'OK', data: null },\n      { status: ${method === 'POST' ? '201' : '200'} }\n    );\n  } catch (error) {\n    return Response.json(\n      { success: false, message: 'Internal Server Error' },\n      { status: 500 }\n    );\n  }\n}`;
    });

    return `// Next.js App Router — Route Handler\n// Path: /api/${routePath}\n// Docs: https://nextjs.org/docs/app/building-your-application/routing/route-handlers\nimport { NextRequest } from 'next/server';\n\n${handlers.join('\n\n')}\n`;
};

// ─── PROVIDER ────────────────────────────────────────────────────────────────

export const ProjectProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // ── Elements: synchronous bootstrap from localStorage (zero-flicker) ──────
    // On first render we read localStorage so the editor is instantly populated.
    // A subsequent async effect checks IndexedDB for a newer save and upgrades
    // the state silently if one is found.
    const [elements, setElements] = useState<VectraProject>(() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || INITIAL_DATA; }
        catch { return INITIAL_DATA; }
    });

    const [pages, setPages] = useState<Page[]>([{ id: 'page-home', name: 'Home', slug: '/', rootId: 'page-home' }]);
    const [activePageId, setActivePageId] = useState('page-home');
    // stable ref mirroring activePageId so syncLayoutEngine ([] deps)
    // can read the current page without having activePageId in its dep array.
    const activePageIdRef = useRef(activePageId);
    useEffect(() => { activePageIdRef.current = activePageId; }, [activePageId]);

    // ── Wasm refs ─────────────────────────────────────────────────────────────
    // HistoryManager moved into history.worker.ts — it now runs entirely
    // off the main thread. The worker holds its own Wasm instance + compressed stack.
    const historyWorkerRef = useRef<Worker | null>(null);
    // SWC compiler moved into swc.worker.ts — compilation never blocks the 60fps main thread. Falls back to compilerRef (synchronous) if the worker hasn't booted yet
    const swcWorkerRef = useRef<Worker | null>(null);
    const pendingCompilesRef = useRef<Map<string, (result: string) => void>>(new Map());
    // Keep a live ref to elements so the worker's READY handler uses the
    // most-recent state (including any IDB-hydrated upgrade).
    const elementsRef = useRef<VectraProject>(elements);
    // Persistent SWC compiler — Globals created once, reused every compile()
    const compilerRef = useRef<any>(null);
    // Retained-mode snapping engine — sibling rects pushed once per drag
    const layoutEngineRef = useRef<any>(null);
    // Defensive flag — tells any future auto-sync effect to skip the O(N) grid rebuild during drag. Set to false by updateProject({skipLayout:true}) and automatically reset to true after each effect run
    const shouldSyncLayoutRef = useRef<boolean>(true);

    // Fingerprint of the tree topology (ids+types+children). Rebuilds parentMap only when nodes are added/removed, not on style edits.
    const structuralKey = useMemo(() => {
        const nodeIds = Object.keys(elements).sort();
        return nodeIds.map(id => {
            const node = elements[id];
            const children = (node.children || []).join(',');
            return `${id}:${node.type}:[${children}]`;
        }).join('|');
    }, [elements]);

    const parentMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const [nodeId, node] of Object.entries(elements)) {
            for (const childId of (node.children || [])) {
                map.set(childId, nodeId);
            }
        }
        return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [structuralKey]); // rebuild only on topology change, not style updates

    // Stable ref to parentMap — lets callbacks do O(1) parent lookups without listing parentMap in deps.
    const parentMapRef = useRef(parentMap);
    useEffect(() => { parentMapRef.current = parentMap; }, [parentMap]);


    // JS-fallback history stack (used when Wasm HistoryManager is unavailable)
    const [historyStack, setHistoryStack] = useState<VectraProject[]>([INITIAL_DATA]);
    const [historyIndex, setHistoryIndex] = useState(0);

    const [theme, setTheme] = useState<GlobalTheme>({ primary: '#3b82f6', secondary: '#64748b', accent: '#f59e0b', radius: '0.5rem', font: 'Inter' });
    const [dataSources, setDataSources] = useState<DataSource[]>([
        { id: 'ds-1', name: 'JSONPlaceholder', url: 'https://jsonplaceholder.typicode.com/users', method: 'GET', data: { name: 'Demo User' } }
    ]);

    // ── API Routes (Phase D) ──────────────────────────────────────────────────
    const [apiRoutes, setApiRoutes] = useState<ApiRoute[]>([]);

    // ── Framework (Phase E) ───────────────────────────────────────────────────
    const [framework, setFramework] = useState<Framework>(() =>
        (localStorage.getItem(FRAMEWORK_KEY) as Framework) || 'nextjs'
    );
    // Persist framework to localStorage whenever it changes.
    // ContainerContext reads it synchronously at boot.
    useEffect(() => {
        localStorage.setItem(FRAMEWORK_KEY, framework);
    }, [framework]);

    // ── Multi-project state ─────────────────────────────────────────
    const [projectId, setProjectId] = useState<string>(() =>
        localStorage.getItem(ACTIVE_PROJECT_ID_KEY) || ''
    );
    const [projectName, setProjectName] = useState<string>('My Project');
    const [projectIndex, setProjectIndex] = useState<ProjectMeta[]>([]);

    const addApiRoute = useCallback((name: string, path: string, methods: HttpMethod[]) => {
        const cleanPath = path.replace(/^\/+/, '').trim() || 'unnamed';
        const newRoute: ApiRoute = {
            id: `route-${Date.now()}`,
            name: name.trim() || cleanPath,
            path: cleanPath,
            methods,
            handlerCode: buildDefaultHandlerStub(methods, cleanPath),
            updatedAt: new Date().toISOString(),
        };
        setApiRoutes(prev => [...prev, newRoute]);
    }, []);

    const updateApiRoute = useCallback((id: string, patch: Partial<Omit<ApiRoute, 'id'>>) => {
        setApiRoutes(prev =>
            prev.map(r =>
                r.id === id
                    ? { ...r, ...patch, updatedAt: new Date().toISOString() }
                    : r
            )
        );
    }, []);

    const deleteApiRoute = useCallback((id: string) => {
        setApiRoutes(prev => prev.filter(r => r.id !== id));
    }, []);

    // Keeps elementsRef current so the history worker READY handler always sees the latest state.
    useEffect(() => { elementsRef.current = elements; }, [elements]);

    // On mount: migrate legacy data, load project index, then hydrate state from localStorage snap + IndexedDB.
    useEffect(() => {
        const boot = async () => {
            try {
                // Step 1 — Migration
                const migrated = await migrateFromLegacyStorage(STORAGE_KEY, FRAMEWORK_KEY);
                if (migrated) {
                    setProjectId(migrated.id);
                    setFramework(migrated.framework as Framework);
                    localStorage.setItem(ACTIVE_PROJECT_ID_KEY, migrated.id);
                }

                // Step 2 — Load index
                const index = await loadProjectIndexFromDB();
                setProjectIndex(index);

                // Step 3 — Determine active project
                const activeId = localStorage.getItem(ACTIVE_PROJECT_ID_KEY) || index[0]?.id || '';
                if (!activeId) {
                    // Fresh install — INITIAL_DATA already loaded from useState initialiser
                    console.log('[Vectra] Fresh install — no saved projects.');
                    return;
                }

                setProjectId(activeId);
                const meta = index.find(m => m.id === activeId);
                if (meta) setProjectName(meta.name);

                // Step 4a — localStorage snap (instant, sync)
                const snap = localStorage.getItem(snapKey(activeId));
                if (snap) {
                    try {
                        const parsed: FullProjectSave = JSON.parse(snap);
                        if (parsed.elements && Object.keys(parsed.elements).length > 0) {
                            setElements(parsed.elements as VectraProject);
                            if (parsed.pages?.length) setPages(parsed.pages as Page[]);
                            if (parsed.apiRoutes) setApiRoutes(parsed.apiRoutes as ApiRoute[]);
                            if (parsed.framework) setFramework(parsed.framework as Framework);
                        }
                    } catch { /* malformed snap — fall through to IDB */ }
                }

                // Step 4b — IDB upgrade (async, non-blocking)
                const idbData = await loadProjectDataFromDB2(activeId);
                if (idbData?.elements && Object.keys(idbData.elements).length > 0) {
                    setElements(idbData.elements as VectraProject);
                    if (idbData.pages?.length) setPages(idbData.pages as Page[]);
                    if (idbData.apiRoutes) setApiRoutes(idbData.apiRoutes as ApiRoute[]);
                    if (idbData.framework) setFramework(idbData.framework as Framework);
                }
            } catch (e) {
                console.warn('[ProjectContext] Multi-project boot error (non-fatal):', e);
            }
        };
        boot();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Wasm init: SwcCompiler + LayoutEngine only ─────────────────────────────
    // HistoryManager is intentionally omitted — it lives in history.worker.ts.
    useEffect(() => {
        (async () => {
            try {
                const wasm = await import('../../vectra-engine/pkg/vectra_engine.js');
                await wasm.default();
                wasmModule = wasm; // eslint-disable-line
                (window as any).vectraWasm = wasm; // expose to Header + CodeRenderer

                // Persistent SWC Globals (interner created once)
                compilerRef.current = new wasm.SwcCompiler();

                // Retained-mode LayoutEngine
                layoutEngineRef.current = new wasm.LayoutEngine();

                console.log('[Vectra] Rust engine ready — SwcCompiler + LayoutEngine cached');
            } catch (e) {
                console.warn('[Vectra] Rust engine init failed:', e);
            }
        })();
    }, []);

    // Starts history.worker.ts (Wasm HistoryManager). Sends INIT on READY; applies UNDO/REDO_RESULT to elements state.
    useEffect(() => {
        let worker: Worker;
        try {
            worker = new Worker(
                new URL('../workers/history.worker.ts', import.meta.url),
                { type: 'module' }
            );
            historyWorkerRef.current = worker;

            worker.onmessage = (e: MessageEvent) => {
                const { type, payload, index } = e.data as { type: string; payload?: string; index?: number };
                if (type === 'READY') {
                    // Use elementsRef so we get the IDB-hydrated state if it arrived first
                    worker.postMessage({ type: 'INIT', payload: elementsRef.current });
                } else if (type === 'UNDO_RESULT' || type === 'REDO_RESULT') {
                    try {
                        setElements(JSON.parse(payload!));
                        // Keep historyIndex in sync so the JS fallback starts at the correct slot if the worker crashes.
                        if (typeof index === 'number') setHistoryIndex(index);
                    }
                    catch (err) { console.error('[ProjectContext] History restore failed:', err); }
                }
            };

            worker.onerror = (err) =>
                console.warn('[ProjectContext] HistoryWorker runtime error:', err);
        } catch (err) {
            console.warn('[ProjectContext] HistoryWorker failed to start:', err);
        }
        return () => {
            historyWorkerRef.current?.terminate();
            historyWorkerRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Starts swc.worker.ts (Rust SWC compiler). Resolves compile promises via a pending-id map.
    useEffect(() => {
        let worker: Worker;
        try {
            worker = new Worker(
                new URL('../workers/swc.worker.ts', import.meta.url),
                { type: 'module' }
            );
            swcWorkerRef.current = worker;

            worker.onmessage = (e: MessageEvent) => {
                const data = e.data as { type?: string; id?: string; code?: string };
                if (data.type === 'READY' || data.type === 'ERROR') return; // boot signals
                if (data.id && pendingCompilesRef.current.has(data.id)) {
                    const resolve = pendingCompilesRef.current.get(data.id)!;
                    pendingCompilesRef.current.delete(data.id);
                    resolve(data.code ?? '');
                }
            };

            worker.onerror = (err) =>
                console.warn('[ProjectContext] SwcWorker runtime error:', err);
        } catch (err) {
            console.warn('[ProjectContext] SwcWorker failed to start — falling back to main thread:', err);
        }
        return () => {
            swcWorkerRef.current?.terminate();
            swcWorkerRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Debounced autosave (1s): writes to IndexedDB (primary) and localStorage snap (fast-boot cache).
    useEffect(() => {
        // Skip autosave before a project ID is assigned (fresh install before
        // first createNewProject call)
        if (!projectId) return;

        const timer = setTimeout(async () => {
            const payload: FullProjectSave = {
                id: projectId,
                framework,
                elements,
                pages,
                apiRoutes,
                theme,
            };

            // IDB: primary async save
            saveProjectDataToDB2(projectId, payload)
                .then(() => {
                    // Write localStorage snap after IDB resolves — never blocks the main thread.
                    try {
                        localStorage.setItem(snapKey(projectId), JSON.stringify(payload));
                    } catch { /* quota exceeded — IDB is the real store */ }
                })
                .catch(e => console.warn('[ProjectContext] IDB autosave failed:', e));

            // Update lastEditedAt + pageCount in the index
            const now = Date.now();
            setProjectIndex(prev => {
                const updated = prev.map(m =>
                    m.id === projectId
                        ? { ...m, lastEditedAt: now, pageCount: pages.length }
                        : m
                );
                saveProjectIndexToDB(updated).catch(() => { });
                return updated;
            });
        }, 1000);
        return () => clearTimeout(timer);
    }, [elements, pages, apiRoutes, theme, framework, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Stable ref to historyIndex — lets the JS-fallback pushHistory read the current index without a stale closure.
    const historyIndexRef = useRef(historyIndex);
    useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);

    const pushHistory = useCallback((newElements: VectraProject) => {
        if (historyWorkerRef.current) {
            historyWorkerRef.current.postMessage({ type: 'PUSH', payload: newElements });
        } else {
            // Functional updater reads current index — no stale-closure risk.
            setHistoryStack(prev => {
                const cur = historyIndexRef.current;
                return [...prev.slice(0, cur + 1), newElements].slice(-50);
            });
            setHistoryIndex(p => Math.min(p + 1, 49));
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Updates the element tree. Pass skipHistory:true for 60fps drag updates; skipLayout:true to skip LayoutEngine rebuild.
    const updateProject = useCallback((
        newElements: VectraProject,
        options: boolean | { skipHistory?: boolean; skipLayout?: boolean } = false,
    ) => {
        const skipHistory = typeof options === 'boolean' ? options : (options.skipHistory ?? false);
        const skipLayout = typeof options === 'boolean' ? false : (options.skipLayout ?? false);

        if (skipLayout) {
            // Lock out the next layout-sync effect cycle for this render
            shouldSyncLayoutRef.current = false;
        }
        setElements(newElements);
        if (!skipHistory) pushHistory(newElements);
    }, [pushHistory]);

    // Sends UNDO to the history worker; falls back to the JS history stack when the worker is unavailable.
    const undo = useCallback(() => {
        if (historyWorkerRef.current) {
            // Result arrives asynchronously via onmessage → UNDO_RESULT → setElements
            historyWorkerRef.current.postMessage({ type: 'UNDO' });
        } else {
            setHistoryIndex(prev => {
                if (prev <= 0) return prev;
                // historyStack is a replace-array (new ref on every push),
                // so reading it here is safe — it's the one captured at callback creation.
                setElements(historyStack[prev - 1]);
                return prev - 1;
            });
        }
    }, [historyStack]); // historyIndex removed — read via functional updater

    const redo = useCallback(() => {
        if (historyWorkerRef.current) {
            historyWorkerRef.current.postMessage({ type: 'REDO' });
        } else {
            setHistoryIndex(prev => {
                if (prev >= historyStack.length - 1) return prev;
                setElements(historyStack[prev + 1]);
                return prev + 1;
            });
        }
    }, [historyStack]); // historyIndex removed — read via functional updater

    // Called once on drag-start: loads all active-page sibling rects into the Wasm LayoutEngine for fast 60fps snapping.
    const syncLayoutEngine = useCallback((draggedId: string) => {
        if (!layoutEngineRef.current) return;
        const els = elementsRef.current; // stable ref — no closure on elements state

        // Filter to active-page elements only — prevents phantom snap guides from other pages.
        const currentPageId = activePageIdRef.current;
        const pageDescendants = new Set<string>();
        const walkPage = (id: string) => {
            if (pageDescendants.has(id)) return; // cycle-guard
            pageDescendants.add(id);
            (els[id]?.children || []).forEach(walkPage);
        };
        walkPage(currentPageId);

        const siblings = Object.values(els)
            .filter(el =>
                el.id !== draggedId &&
                pageDescendants.has(el.id) &&      // active-page only
                el.props?.style?.position === 'absolute'
            )
            .map(el => ({
                x: parseFloat(String(el.props.style?.left || '0')),
                y: parseFloat(String(el.props.style?.top || '0')),
                w: parseFloat(String(el.props.style?.width || '0')),
                h: parseFloat(String(el.props.style?.height || '0')),
            }))
            .filter(r => r.w > 0 && r.h > 0);

        try {
            layoutEngineRef.current.update_rects(siblings);
        } catch (e) {
            console.warn('[LayoutEngine] update_rects failed:', e);
        }
    }, []); // [] — reads elements + activePageId via refs, stable identity

    // Queries the Wasm LayoutEngine for snap guides at the current drag position. Returns null if not available.
    const querySnapping = useCallback((
        x: number, y: number, w: number, h: number, threshold = 5
    ): SnapResult | null => {
        if (!layoutEngineRef.current) return null;
        try {
            return layoutEngineRef.current.query_snapping(x, y, w, h, threshold) as SnapResult;
        } catch (e) {
            console.warn('[LayoutEngine] query_snapping failed:', e);
            return null;
        }
    }, []);

    // Deletes an element and all its children from the tree; protected nodes (page roots) are refused.
    const deleteElement = useCallback((id: string) => {
        if (!canDeleteNode(id)) {
            console.warn(`⚠️ Cannot delete protected node: ${id}`);
            return;
        }
        setElements(prev => {
            const next = deleteNodeRecursive(prev, id);
            pushHistory(next);
            return next;
        });
    }, [pushHistory]);

    // Deep-clones an element subtree with new IDs and places the copy just below the original in its parent.
    const duplicateElement = useCallback((id: string): string | null => {
        if (!canDeleteNode(id)) return null;
        // Read current elements from the live ref — never stale, no dep needed.
        const current = elementsRef.current;
        const source = current[id];
        if (!source) return null;

        // Clone subtree with fresh collision-free IDs (uses crypto.randomUUID internally)
        const { newNodes, rootId: newRootId } = instantiateTemplateTS(id, current);

        // Offset position so the copy doesn't land exactly on the original
        const newRoot = newNodes[newRootId];
        if (newRoot?.props?.style) {
            const s = newRoot.props.style as Record<string, any>;
            newNodes[newRootId] = {
                ...newRoot,
                props: {
                    ...newRoot.props, style: {
                        ...s,
                        left: `${parseFloat(String(s.left ?? '0')) + 20}px`,
                        top: `${parseFloat(String(s.top ?? '0')) + 20}px`,
                    }
                },
            };
        }

        setElements(prev => {
            const next: VectraProject = { ...prev, ...newNodes };
            // Insert the clone immediately after the source in its parent's children array.
            for (const key in next) {
                const node = next[key];
                if (node.children?.includes(id)) {
                    const idx = node.children.indexOf(id);
                    const newChildren = [...node.children];
                    newChildren.splice(idx + 1, 0, newRootId);
                    next[key] = { ...node, children: newChildren };
                    break;
                }
            }
            // Push history inside the updater so it always sees the committed state
            setTimeout(() => pushHistory(elementsRef.current), 0);
            return next;
        });
        return newRootId;
    }, [pushHistory]); // elements removed — reads via elementsRef.current

    // Moves a node to a new position within the same or a different parent. Canvas layer panel calls this on drag-drop.
    const reorderElement = useCallback((
        nodeId: string,
        targetParentId: string,
        targetIndex: number,
    ): void => {
        if (!canDeleteNode(nodeId)) return;
        setElements(prev => {
            // O(1) lookup via parentMapRef instead of O(N) Object.keys().find().
            // parentMapRef.current is always the latest map — safe to read inside any updater.
            const currentParentId = parentMapRef.current.get(nodeId) ?? null;
            if (!currentParentId) return prev;

            const next = { ...prev };

            // Remove from current parent
            const curParent = next[currentParentId];
            next[currentParentId] = {
                ...curParent,
                children: (curParent.children || []).filter(id => id !== nodeId),
            };

            // Insert into target parent
            const tgtParent = next[targetParentId];
            if (!tgtParent) return prev;
            const tgtChildren = (tgtParent.children || []).filter(id => id !== nodeId);
            const safeIdx = Math.min(Math.max(0, targetIndex), tgtChildren.length);
            tgtChildren.splice(safeIdx, 0, nodeId);
            next[targetParentId] = { ...tgtParent, children: tgtChildren };

            pushHistory(next);
            return next;
        });
    }, [pushHistory]);

    // Creates a new blank page with a unique slug and navigates to it.
    const addPage = useCallback((name: string, slug?: string) => {
        // Use crypto.randomUUID for collision-free IDs (NS-1/M-5 standard)
        const pageId = `page-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
        const canvasId = `canvas-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;

        // Ensure the slug is unique — append a counter if a page with the same slug already exists.
        const baseSlug = slug || `/${name.toLowerCase().replace(/\s+/g, '-')}`;
        const existingSlugs = new Set(pages.map(p => p.slug));
        let pageSlug = baseSlug;
        let counter = 2;
        while (existingSlugs.has(pageSlug)) {
            pageSlug = `${baseSlug}-${counter++}`;
        }

        setElements(prev => {
            const appRoot = prev['application-root'];
            return {
                ...prev,
                [pageId]: {
                    id: pageId, type: 'page', name, children: [canvasId],
                    props: { className: 'w-full h-full relative', style: { width: '100%', height: '100%' } },
                },
                [canvasId]: {
                    // pixel width so parseFloat never returns NaN in code-gen / zoom-to-fit
                    id: canvasId, type: 'webpage', name, children: [],
                    props: { layoutMode: 'canvas', style: { width: '1440px', minHeight: '100vh', backgroundColor: '#ffffff' } },
                },
                ...(appRoot ? {
                    // clone appRoot — do NOT write into the shared live-state reference
                    'application-root': { ...appRoot, children: [...(appRoot.children || []), pageId] },
                } : {}),
            };
        });
        setPages(prev => [...prev, { id: pageId, name, slug: pageSlug, rootId: pageId }]);
        setActivePageId(pageId);
    }, [pages]); // pages needed for slug uniqueness check

    // Inserts a pre-built node tree as a new page (used by Stitch and Figma import). Does not create an empty canvas.
    const importPage = useCallback(({ pageName, slug, nodes, rootId }: {
        pageName: string;
        slug: string;
        nodes: VectraProject;
        rootId: string;
    }) => {
        // sanitize strings — VFS hydration can produce undefined
        const safeName = typeof pageName === 'string' && pageName.trim() ? pageName.trim() : 'Imported Page';
        const safeSlug = typeof slug === 'string' && slug.trim() ? slug.trim() : '/imported';

        const pageId = `page-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;

        // Build the page node pointing directly at the imported canvas root
        const pageNode = {
            id: pageId, type: 'page' as const, name: safeName,
            children: [rootId],
            props: { className: 'w-full h-full relative', style: { width: '100%', height: '100%' } },
        };

        // Single setElements call: merge all imported nodes + page node + wire app-root
        setElements(prev => {
            const appRoot = prev['application-root'];
            return {
                ...prev,
                ...nodes,
                [pageId]: pageNode,
                ...(appRoot ? {
                    'application-root': { ...appRoot, children: [...(appRoot.children || []), pageId] },
                } : {}),
            };
        });

        // Register page in pages[] with slug uniqueness check
        setPages(prev => {
            const existingSlugs = new Set(prev.map(p => p.slug));
            let finalSlug = safeSlug.startsWith('/') ? safeSlug : `/${safeSlug}`;
            let counter = 2;
            while (existingSlugs.has(finalSlug)) finalSlug = `${safeSlug}-${counter++}`;
            return [...prev, {
                id: pageId,
                name: safeName,
                slug: finalSlug,
                rootId: pageId,
                // hide component-mode Figma staging pages from the Pages panel.
                // typeof guard prevents crash if safeName is somehow non-string.
                ...(typeof safeName === 'string' && safeName.startsWith('__figma_comp__') ? { hidden: true } : {}),
            }];
        });

        // Navigate to the new page
        setActivePageId(pageId);

        console.log(`[Vectra] STI-1: Imported page "${safeName}" → ${pageId} (${Object.keys(nodes).length} nodes)`);
    }, []); // no deps — only stable setState setters used inside

    // Listens for 'vectra:figma-image-patch' events and merges resolved image-fill URLs into the tree.
    useEffect(() => {
        const handleImagePatch = (e: Event) => {
            const { nodes: patchedNodes } = (e as CustomEvent<{ nodes: VectraProject }>).detail;
            setElements(prev => ({ ...prev, ...patchedNodes }));
            console.log(`[Vectra] FIG-1: Applied image fill patch — ${Object.keys(patchedNodes).length} nodes`);
        };
        window.addEventListener('vectra:figma-image-patch', handleImagePatch);
        return () => window.removeEventListener('vectra:figma-image-patch', handleImagePatch);
    }, []); // setElements is stable — empty deps is correct

    // Stable refs to callbacks that may change identity — used inside the [] MCP event listener.
    const addPageRef = useRef(addPage);
    useEffect(() => { addPageRef.current = addPage; }, [addPage]);
    const deleteElementRef = useRef(deleteElement);
    useEffect(() => { deleteElementRef.current = deleteElement; }, [deleteElement]);
    // Populated after runAI is defined below to avoid a forward-reference error.
    const runAIRef = useRef<((prompt: string) => Promise<string | undefined>) | null>(null);

    // Applies MCP canvas mutations (ADD_ELEMENT, UPDATE_ELEMENT, DELETE_ELEMENT, ADD_PAGE, RUN_AI, UPDATE_THEME) dispatched by MCPPanel.
    useEffect(() => {
        const handleMcpCommand = (e: Event) => {
            const mutation = (e as CustomEvent).detail as Record<string, unknown>;
            const { op } = mutation;

            switch (op) {
                case 'ADD_ELEMENT': {
                    const { parentId, element } = mutation as {
                        parentId: string;
                        element: VectraNode;
                    };
                    if (!element?.id || !parentId) break;
                    setElements(prev => {
                        const parent = prev[parentId];
                        if (!parent) {
                            console.warn(`[MCP] ADD_ELEMENT: parent "${parentId}" not found`);
                            return prev;
                        }
                        return {
                            ...prev,
                            [element.id]: element,
                            [parentId]: {
                                ...parent,
                                children: [...(parent.children || []), element.id],
                            },
                        };
                    });
                    break;
                }

                case 'UPDATE_ELEMENT': {
                    const { elementId, patch } = mutation as {
                        elementId: string;
                        patch: {
                            name?: string;
                            content?: string;
                            style?: React.CSSProperties;
                            className?: string;
                            props?: Record<string, unknown>;
                        };
                    };
                    if (!elementId) break;
                    setElements(prev => {
                        const el = prev[elementId];
                        if (!el) {
                            console.warn(`[MCP] UPDATE_ELEMENT: "${elementId}" not found`);
                            return prev;
                        }
                        return {
                            ...prev,
                            [elementId]: {
                                ...el,
                                ...(patch.name !== undefined ? { name: patch.name } : {}),
                                ...(patch.content !== undefined ? { content: patch.content } : {}),
                                props: {
                                    ...el.props,
                                    ...(patch.className !== undefined ? { className: patch.className } : {}),
                                    ...(patch.props || {}),
                                    style: { ...el.props?.style, ...(patch.style || {}) },
                                },
                            },
                        };
                    });
                    break;
                }

                case 'DELETE_ELEMENT': {
                    const { elementId } = mutation as { elementId: string };
                    if (elementId) deleteElementRef.current(elementId);
                    break;
                }

                case 'ADD_PAGE': {
                    const { name, slug } = mutation as { name: string; slug: string };
                    if (name) addPageRef.current(name, slug);
                    break;
                }

                case 'RUN_AI': {
                    const { prompt, pageId } = mutation as { prompt: string; pageId?: string };
                    if (!prompt) break;
                    if (pageId) setActivePageId(pageId);
                    runAIRef.current?.(prompt).catch(err =>
                        console.warn('[MCP] RUN_AI failed:', err)
                    );
                    break;
                }

                case 'UPDATE_THEME': {
                    const { theme: themeUpdates } = mutation as {
                        theme: Partial<GlobalTheme>;
                    };
                    if (themeUpdates && typeof themeUpdates === 'object') {
                        setTheme(prev => ({ ...prev, ...themeUpdates }));
                    }
                    break;
                }

                default:
                    console.warn(`[MCP] Unknown op: ${op}`);
            }

            console.log(`[Vectra] MCP-1: Applied op "${op}"`);
        };

        window.addEventListener('vectra:mcp-command', handleMcpCommand);
        return () => window.removeEventListener('vectra:mcp-command', handleMcpCommand);
    }, []); // setElements, setTheme, setActivePageId are stable React setters

    // Removes a page and its root node from the tree; navigates to the first remaining page.
    const deletePage = useCallback((id: string) => {
        if (pages.length <= 1 || id === 'page-home') return;
        // Compute fallback NOW while pages is still the un-filtered array
        const remaining = pages.filter(p => p.id !== id);
        setElements(prev => {
            const appRoot = prev['application-root'];
            const next = { ...prev };
            if (appRoot) {
                next['application-root'] = {
                    ...appRoot,
                    children: (appRoot.children || []).filter(c => c !== id),
                };
            }
            delete next[id];
            return next;
        });
        setPages(remaining);
        if (activePageId === id) {
            setActivePageId(remaining[0]?.id || 'page-home');
        }
        // Tell UIContext to evict this page's viewport cache entry.
        window.dispatchEvent(new CustomEvent('vectra:page-deleted', { detail: { pageId: id } }));
    }, [pages, activePageId]);

    // Switches the active page and fires 'vectra:page-switching' so Canvas can save/restore viewport state.
    const switchPage = useCallback((pageId: string) => {
        window.dispatchEvent(
            new CustomEvent('vectra:page-switching', {
                detail: { from: activePageId, to: pageId },
            })
        );
        setActivePageId(pageId);
    }, [activePageId]);

    // ── Project lifecycle ────────────────────────────────────────────
    const createNewProject = useCallback((templateId: string) => {
        const resolvedFramework: Framework =
            templateId === 'vite-react' ? 'vite' : 'nextjs';
        const newId = generateProjectId();
        const now = Date.now();
        const defaultName = `New ${resolvedFramework === 'nextjs' ? 'Next.js' : 'Vite'} Project`;

        console.log(`[Vectra] Creating project — id: ${newId}, framework: ${resolvedFramework}`);

        // Write to localStorage BEFORE switching view — ContainerContext reads
        // these synchronously during its boot sequence.
        localStorage.setItem(FRAMEWORK_KEY, resolvedFramework);
        localStorage.setItem(ACTIVE_PROJECT_ID_KEY, newId);

        // Update all project state
        setProjectId(newId);
        setProjectName(defaultName);
        setFramework(resolvedFramework);
        setElements(INITIAL_DATA);
        setHistoryStack([INITIAL_DATA]);
        setHistoryIndex(0);
        setPages([{ id: 'page-home', name: 'Home', slug: '/', rootId: 'page-home' }]);
        setActivePageId('page-home');
        setApiRoutes([]);

        // Insert into the in-memory index immediately (autosave keeps it current)
        const meta: ProjectMeta = {
            id: newId,
            name: defaultName,
            framework: resolvedFramework,
            createdAt: now,
            lastEditedAt: now,
            pageCount: 1,
        };
        setProjectIndex(prev => {
            const updated = [meta, ...prev];
            saveProjectIndexToDB(updated).catch(() => { });
            return updated;
        });

        // Save initial skeleton data so the project exists in IDB immediately
        saveProjectDataToDB2(newId, {
            id: newId,
            framework: resolvedFramework,
            elements: INITIAL_DATA,
            pages: [{ id: 'page-home', name: 'Home', slug: '/', rootId: 'page-home' }],
            apiRoutes: [],
            theme: {},
        }).catch(() => { });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const exitProject = useCallback(() => {
        if (confirm('Exit to dashboard? Your project is auto-saved.')) {
            // Generate + store wireframe thumbnail before leaving. Done here so the thumbnail always reflects the final saved state. elementsRef.current has the latest elements without stale closure issues
            try {
                if (projectId) {
                    const svg = generateLayoutThumbnail(elementsRef.current, pages);
                    localStorage.setItem(thumbKey(projectId), svg);
                }
            } catch { /* localStorage unavailable — non-fatal */ }
            window.dispatchEvent(new CustomEvent('vectra:exit-project'));
        }
    }, [projectId, pages, elementsRef]);

    // ── Open existing project ───────────────────────────────────────
    const loadProject = useCallback(async (meta: ProjectMeta) => {
        try {
            // Try localStorage snap first (instant)
            let loaded: FullProjectSave | undefined;
            const snap = localStorage.getItem(snapKey(meta.id));
            if (snap) {
                try { loaded = JSON.parse(snap); } catch { /* ignore */ }
            }

            // Fall through to IDB if snap missing or malformed
            if (!loaded) {
                loaded = await loadProjectDataFromDB2(meta.id);
            }

            if (!loaded) {
                console.warn('[Vectra] loadProject: no data found for', meta.id);
                return;
            }

            // Apply loaded state
            setProjectId(meta.id);
            setProjectName(meta.name);
            setFramework(meta.framework as Framework);
            setElements((loaded.elements as VectraProject) || INITIAL_DATA);
            setHistoryStack([(loaded.elements as VectraProject) || INITIAL_DATA]);
            setHistoryIndex(0);
            if (loaded.pages && (loaded.pages as Page[]).length > 0) {
                setPages(loaded.pages as Page[]);
            } else {
                setPages([{ id: 'page-home', name: 'Home', slug: '/', rootId: 'page-home' }]);
            }
            setActivePageId('page-home');
            setApiRoutes((loaded.apiRoutes as ApiRoute[]) || []);

            // Persist active project selection
            localStorage.setItem(ACTIVE_PROJECT_ID_KEY, meta.id);
            localStorage.setItem(FRAMEWORK_KEY, meta.framework);

            console.log('[Vectra] Project loaded:', meta.id, meta.name);
        } catch (e) {
            console.error('[Vectra] loadProject failed:', e);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Rename project ────────────────────────────────────────────────
    const renameProject = useCallback(async (id: string, name: string) => {
        setProjectIndex(prev => {
            const updated = prev.map(m => m.id === id ? { ...m, name } : m);
            saveProjectIndexToDB(updated).catch(() => { });
            return updated;
        });
        if (id === projectId) setProjectName(name);
    }, [projectId]);

    // ── Duplicate project ────────────────────────────────────────────
    const duplicateProject = useCallback(async (meta: ProjectMeta) => {
        try {
            const sourceData = await loadProjectDataFromDB2(meta.id);
            if (!sourceData) return;

            const newId = generateProjectId();
            const now = Date.now();
            const newMeta: ProjectMeta = {
                ...meta,
                id: newId,
                name: `${meta.name} (Copy)`,
                createdAt: now,
                lastEditedAt: now,
            };

            await saveProjectDataToDB2(newId, { ...sourceData, id: newId });

            setProjectIndex(prev => {
                // Insert copy directly after source
                const idx = prev.findIndex(m => m.id === meta.id);
                const updated = [...prev];
                updated.splice(idx + 1, 0, newMeta);
                saveProjectIndexToDB(updated).catch(() => { });
                return updated;
            });

            console.log('[Vectra] Project duplicated:', meta.id, '→', newId);
        } catch (e) {
            console.error('[Vectra] duplicateProject failed:', e);
        }
    }, []);

    // ── Sprint 2: Soft-delete — 3-stage pattern ────────────────────────────── Stage 1 — removeProjectFromIndex(): Removes meta from index. Project disappears from Dashboard immediately

    /** Stage 1: remove from visible index. Does NOT delete IDB data. */
    const removeProjectFromIndex = useCallback(async (id: string) => {
        setProjectIndex(prev => {
            const updated = prev.filter(m => m.id !== id);
            saveProjectIndexToDB(updated).catch(() => { });
            return updated;
        });
    }, []);

    /** Stage 2 (undo path): restore meta to index. */
    const restoreProjectToIndex = useCallback(async (meta: ProjectMeta) => {
        setProjectIndex(prev => {
            if (prev.some(m => m.id === meta.id)) return prev; // guard duplicate
            const updated = [...prev, meta];
            saveProjectIndexToDB(updated).catch(() => { });
            return updated;
        });
    }, []);

    /** Stage 3 (expiry path): permanently delete IDB data + snap. */
    const purgeProjectData = useCallback(async (id: string) => {
        await deleteProjectDataFromDB2(id).catch(() => { });
        localStorage.removeItem(snapKey(id));
        localStorage.removeItem(thumbKey(id));   // clean up wireframe alongside snap
        console.log('[Vectra] Project permanently purged:', id);
    }, []);

    /**
     * deleteProject: legacy one-shot delete (stages 1 + 3 combined).
     * Preserved for any callers that don't need the undo window.
     * Dashboard now uses removeProjectFromIndex + purgeProjectData instead.
     */
    const deleteProject = useCallback(async (id: string) => {
        await removeProjectFromIndex(id);
        await purgeProjectData(id);
    }, [removeProjectFromIndex, purgeProjectData]);

    // ── AI ──────────────────────────────────────────────────────────────────────── Item 3 fixes: 1. useCallback — stable identity, not recreated every render
    const runAI = useCallback(async (prompt: string): Promise<string | undefined> => {
        // Signal useFileSync that AI generation is active. useFileSync reads window.__vectra_ai_running to clamp debounce at 1000ms and suppress mid-generation VFS writes. Cleared in finally block
        (window as any).__vectra_ai_running = true;
        try {
            console.log('🎨 AI Agent processing:', prompt);

            // Read current state via refs — avoids stale closure captures
            // when this callback is invoked async after a re-render.
            const currentElements = elementsRef.current;
            const currentPages = pages;          // pages is stable between renders
            const currentPageId = activePageId;  // same
            const currentPage = currentPages.find(p => p.id === currentPageId);
            if (!currentPage) return 'No active page';

            // target ONLY the 'webpage' (desktop) artboard. The 'canvas' type was the old mobile mirror node — it is now a derived read-only view rendered by RenderNode and has no data-model entry
            const pageNode = currentElements[currentPage.rootId];
            const canvasNodeId =
                pageNode?.children?.find(
                    (cid: string) => currentElements[cid]?.type === 'webpage'
                )
                ?? pageNode?.children?.find(
                    (cid: string) => currentElements[cid]?.type === 'artboard'
                )
                ?? currentPage.rootId;

            const result = await generateWithAI(prompt, currentElements, {
                pageRootId: canvasNodeId,   // canvas context describes the artboard tree
                pageName: currentPage.name,
            });

            if (result.action === 'error') {
                console.warn('❌ AI Error:', result.message);
                return result.message;
            }

            if (result.action === 'create' && result.elements && result.rootId) {
                const isFullPage = /page|website|portfolio|landing|blog|store|dashboard/i.test(prompt);

                // Compute merged directly from elementsRef.current (H-4 pattern).
                // elementsRef.current is always the latest committed state — same guarantee
                // as all 60fps event handlers. This replaces the functional setElements +
                // setTimeout(pushHistory) pattern which had two risks:
                //   1. The functional updater is invoked twice in StrictMode dev builds,
                //      meaning `merged` was re-assigned (harmlessly) but the setTimeout
                //      scheduled from INSIDE an updater would fire twice on the update-path.
                //   2. setTimeout defers pushHistory by one event-loop tick — a second
                //      rapid AI call could slip in before history was committed.
                // Using elementsRef.current + synchronous pushHistory(merged) eliminates
                // both risks with zero behaviour change in production.
                const merged = mergeAIContent(
                    elementsRef.current,
                    canvasNodeId,
                    result.elements!,
                    result.rootId!,
                    isFullPage,
                    result.aiMeta   // ← AI-SOURCE-1: thread prompt+model for provenance stamping
                );
                setElements(merged);
                pushHistory(merged);

                const sectionCount = Object.values(result.elements!).filter(
                    n => n.type === 'custom_code'
                ).length;

                // Fire-and-forget event for AISuccessToast.
                // Listeners: src/components/modals/AISuccessToast.tsx (App.tsx render tree).
                // Safe even if no listener — CustomEvent is silently dropped.
                window.dispatchEvent(new CustomEvent('vectra:ai-done', {
                    detail: { sectionCount, prompt }
                }));

                console.log(
                    '✅ AI: Canvas updated with',
                    Object.keys(result.elements!).length,
                    'elements — pushed to history.'
                );

                return result.message;
            }

            if (result.action === 'update' && result.elements) {
                // Same pattern as create path — read from ref, push synchronously.
                // The update path had a worse form of the bug: setTimeout was INSIDE the
                // functional updater, which StrictMode invokes twice → two history pushes.
                const updated = { ...elementsRef.current, ...result.elements };
                setElements(updated);
                pushHistory(updated);
                console.log('✅ AI: Updated', Object.keys(result.elements).length, 'elements — pushed to history.');
                return result.message;
            }

        } catch (e) {
            console.error('❌ AI Error:', e);
            return 'Something went wrong.';
        } finally {
            // Always clear the flag so useFileSync resumes normal
            // debounce. The finally block guarantees this even if runAI throws.
            (window as any).__vectra_ai_running = false;
        }
    }, [pages, activePageId, pushHistory]);
    // Note: elements intentionally omitted from deps — read via elementsRef
    // to prevent runAI from being recreated on every element change (60fps).

    // populate runAIRef now that runAI is defined. runAIRef was initialized as null earlier (before runAI's useCallback) to avoid a forward-reference TS error
    useEffect(() => { runAIRef.current = runAI; }, [runAI]);

    // CF-1 — addFrame ─────────────────────────────────────────────────────────────
    // Spawns a mirror frame. ALL spawned frames have props.mirrorOf=sourceFrameId
    // and empty children[]. RenderNode renders the SOURCE frame's children
    // with width-aware CSS stacking via buildDeviceCSS().
    //
    // //   spawned frames NEVER own children. element.children stays [].
    //   runAI canvasNodeId search MUST skip nodes with props.mirrorOf.
    //   ArtboardResizeHandle MUST be suppressed for mirror frames.
    //
    // //   left = rightmost existing frame right-edge + 120px.
    const addFrame = useCallback((preset: import('../data/framePresets').FramePreset) => {
        const GAP = 120;
        const TOP = 100;

        const pageNode = elementsRef.current[activePageId];
        let sourceFrameId = '';
        let rightEdge = 100;

        // AUTO_MIRROR constants — must match RenderNode.tsx exactly. The auto-mobile-mirror div is rendered by RenderNode beside every source frame (mirrorOf === undefined). It is DOM-only — NOT a node
        const AUTO_MIRROR_GAP = 80;   // matches RenderNode: const GAP = 80
        const AUTO_MIRROR_W = 390;  // matches RenderNode: const MIRROR_W = 390

        if (pageNode?.children) {
            for (const cid of pageNode.children) {
                const el = elementsRef.current[cid];
                if (!el) continue;

                // Source = first webpage/canvas without mirrorOf
                if (!sourceFrameId && (el.type === 'webpage' || el.type === 'canvas') && !el.props?.mirrorOf) {
                    sourceFrameId = cid;
                }

                const l = parseFloat(String(el.props?.style?.left ?? 0)) || 0;
                const w = parseFloat(String(el.props?.style?.width ?? 0)) || 0;
                let frameRight = l + w;

                // if this is a source frame (no mirrorOf), RenderNode renders an auto-mobile-mirror div to its right. That div is invisible to elementsRef — extend frameRight manually
                if ((el.type === 'webpage' || el.type === 'canvas') && !el.props?.mirrorOf) {
                    frameRight = l + w + AUTO_MIRROR_GAP + AUTO_MIRROR_W;
                }

                if (frameRight > rightEdge) rightEdge = frameRight;
            }
        }

        if (!sourceFrameId) {
            console.warn('[addFrame] No source frame found on active page.');
            return;
        }

        const newLeft = rightEdge + GAP;
        const frameId = `frame-${preset.id}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;

        const newFrame: VectraNode = {
            id: frameId,
            type: 'webpage',
            name: preset.label,
            children: [],
            props: {
                layoutMode: 'canvas',
                mirrorOf: sourceFrameId,
                framePresetId: preset.id,
                style: {
                    position: 'absolute',
                    left: `${newLeft}px`,
                    top: `${TOP}px`,
                    width: `${preset.width}px`,
                    minHeight: `${preset.height}px`,
                    backgroundColor: '#ffffff',
                },
            },
        };

        setElements(cur => {
            const page = cur[activePageId];
            if (!page) return cur;
            return {
                ...cur,
                [frameId]: newFrame,
                [activePageId]: { ...page, children: [...(page.children ?? []), frameId] },
            };
        });
    }, [activePageId, elementsRef, setElements]);

    // Direction D: updatePageSEO — merge-update SEO fields for a specific page.
    // All fields are optional; only the provided keys are changed.
    const updatePageSEO = useCallback(
        (pageId: string, seo: Partial<import('../types/index.js').PageSEO>) => {
            setPages(prev => prev.map(p =>
                p.id === pageId ? { ...p, seo: { ...p.seo, ...seo } } : p
            ));
        },
        []
    );

    // ── Phase 6 + 10: Rust SWC Compiler ────────────────────────────────────── TSX→JS via Rust SWC (no Babel), ESM→CJS shim for iframe shell. Worker-first — sends compilation to swc.worker.ts so 5ms Rust
    const compileComponent = useCallback(async (code: string): Promise<string> => {
        if (!code.trim()) return '';

        // ── Worker path (Phase 10) — compilation off main thread ──────────
        if (swcWorkerRef.current) {
            return new Promise<string>((resolve) => {
                // Math.random() collision space ≈ 101B — non-zero for rapid concurrent compilations. crypto.randomUUID() is collision-proof and consistent with the project-wide ID generation standard
                const id = crypto.randomUUID();
                pendingCompilesRef.current.set(id, resolve);
                swcWorkerRef.current!.postMessage({ id, code });

                // 3s safety timeout — prevents hanging promises if worker stalls
                setTimeout(() => {
                    if (pendingCompilesRef.current.has(id)) {
                        console.warn('[compileComponent] SwcWorker timed out for', id);
                        pendingCompilesRef.current.delete(id);
                        resolve('');
                    }
                }, 3000);
            });
        }

        // ── Main-thread fallback (Phase 6 — active until worker is ready) ─
        let transpiled = '';
        try {
            if (compilerRef.current) {
                transpiled = compilerRef.current.compile(code);      // fast path: ~5ms
            } else if (wasmModule?.compile_component) {               // eslint-disable-line
                transpiled = wasmModule.compile_component(code);     // cold-boot shim
            } else {
                throw new Error('Rust compiler not ready yet');
            }
        } catch (e) {
            const msg = (e instanceof Error ? e.message : String(e)).replace(/'/g, "\\'");
            console.error('[compileComponent] Rust compilation failed:', msg);
            return [
                'exports.default = function ErrorComponent() {',
                "  return React.createElement('div',",
                "    { style: { color:'#f87171', padding:'2rem', fontFamily:'monospace' } },",
                "    React.createElement('strong', null, 'Compilation Error'),",
                "    React.createElement('br', null),",
                `    '${msg}'`,
                '  );',
                '};',
            ].join('\n');
        }
        // ESM → CJS shim (swc.worker.ts applies this internally — here for fallback parity)
        transpiled = transpiled
            .replace(/export\s+default\s+function\s+(\w+)/, 'exports.default = function $1')
            .replace(/export\s+default\s+class\s+(\w+)/, 'exports.default = class $1')
            .replace(/export\s+default\s+/, 'exports.default = ');
        return transpiled;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps


    return (
        <ProjectContext.Provider value={{
            elements, setElements, elementsRef, updateProject, pushHistory,
            deleteElement, duplicateElement, reorderElement,
            instantiateTemplate: instantiateTemplateTS,
            parentMap,
            pages, activePageId, setActivePageId, realPageId: activePageId,
            addPage, deletePage, switchPage, importPage, updatePageSEO,
            // expose undo/redo as flat stable values in addition to the deprecated `history` shape (kept for back-compat). `history: { undo, redo }` re-created a new object every render,
            history: { undo, redo },
            undo,
            redo,
            syncLayoutEngine, querySnapping,
            theme, updateTheme: (u) => setTheme(p => ({ ...p, ...u })),
            dataSources,
            addDataSource: (ds) => setDataSources(p => [...p, ds]),
            removeDataSource: (id) => setDataSources(p => p.filter(d => d.id !== id)),
            updateDataSource: (id, patch) => setDataSources(p => p.map(d => d.id === id ? { ...d, ...patch } : d)),
            apiRoutes, addApiRoute, updateApiRoute, deleteApiRoute,
            framework, setFramework,
            createNewProject, exitProject, runAI, compileComponent, addFrame,
            // ── Phase H ──────────────────────────────────────────────────────
            projectId, projectName, projectIndex,
            loadProject, renameProject, duplicateProject, deleteProject,
            // ── Sprint 2: soft-delete API ─────────────────────────────────────
            removeProjectFromIndex, purgeProjectData, restoreProjectToIndex,
        }}>
            {children}
        </ProjectContext.Provider>
    );
};

export const useProject = (): ProjectContextType => {
    const ctx = useContext(ProjectContext);
    if (!ctx) throw new Error('useProject must be used within ProjectProvider');
    return ctx;
};

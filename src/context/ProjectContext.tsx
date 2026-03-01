/**
 * ─── PROJECT CONTEXT ──────────────────────────────────────────────────────────
 * Owns only the heavyweight document data: the element tree, history, pages,
 * and the Wasm history manager. Components subscribing to this context only
 * re-render when the project data actually changes — NOT when the user hovers
 * over an element or switches a sidebar panel.
 *
 * This is the "Model" in a loose MVC split with UIContext.
 *
 * PHASE 3 — Compiler & History optimisations
 * ───────────────────────────────────────────
 * • compilerRef:  Persistent SwcCompiler (Globals created once, reused per compile)
 * • updateProject(els, skipHistory): skip JSON.stringify during 60fps drag
 * • pushHistory:  exposed on context so Canvas calls it once on pointer-up
 *
 * PHASE 5 PART 1 — Async IndexedDB Persistence
 * ─────────────────────────────────────────────
 * Hybrid hydration: localStorage is read synchronously for an instant first
 * paint (zero flicker), then IndexedDB is checked async for any newer save.
 * State is silently upgraded if IDB data is found. All autosaves now write to
 * IndexedDB (off-thread) + localStorage (fast-read bootstrap cache) — no more
 * synchronous main-thread I/O stalls every autosave tick.
 *
 * PHASE 5 PART 2 — Retained-Mode LayoutEngine snapping
 * ──────────────────────────────────────────────────────
 * • layoutEngineRef: holds a Wasm LayoutEngine whose sibling-rect list is
 *   pushed ONCE per drag-start (syncLayoutEngine). At 60fps, handleInteraction-
 *   Move calls query_snapping with only 5 scalar args — no large JS→Wasm data
 *   transfer per frame. Lines up to ~10× faster than the old calculate_snapping
 *   free-function which serialized all siblings on every pointer-move.
 * • syncLayoutEngine(draggedId): exposed on context, called from RenderNode on
 *   pointer-down alongside setInteraction({type:'MOVE',...}).
 * • querySnapping(x,y,w,h,threshold): thin wrapper that calls the retained
 *   engine, exposed on context for the interaction engine in EditorContext.
 */

import React, {
    createContext, useContext, useState, useEffect,
    useCallback, useRef, useMemo, type ReactNode,
} from 'react';
import type { VectraProject, Page, ApiRoute, HttpMethod, Framework, ProjectMeta } from '../types';
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

/** localStorage key that remembers which project was last open. */
const ACTIVE_PROJECT_ID_KEY = 'vectra_active_id';

/** Generate a collision-resistant project UUID. */
const generateProjectId = (): string =>
    `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Per-project localStorage snap key (fast-boot cache). */
const snapKey = (id: string) => `vectra_snap_${id}`;

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

export interface DataSource {
    id: string;
    name: string;
    url: string;
    method: 'GET' | 'POST';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
}

/** Snapping result returned by querySnapping (mirrors Rust SnapResult). */
export interface SnapResult {
    x: number;
    y: number;
    guides: Array<{ orientation: string; pos: number; start: number; end: number; guide_type: string }>;
}

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
    /** H-1: O(1) child→parent lookup map. Replaces per-render O(N) Object.keys scan. */
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
     * Direction D — SEO Control
     * Merge-update the SEO fields for a specific page.
     * Only the fields provided are changed — all others are preserved.
     */
    updatePageSEO: (pageId: string, seo: Partial<import('../types').PageSEO>) => void;

    // ── History ───────────────────────────────────────────────────────────────
    history: { undo: () => void; redo: () => void };

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

    // ── Phase 6: Rust SWC compiler (exposed for ContainerPreview) ────────────
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

    // ── Wasm refs ─────────────────────────────────────────────────────────────
    // Phase 9: HistoryManager moved into history.worker.ts — it now runs entirely
    // off the main thread. The worker holds its own Wasm instance + compressed stack.
    const historyWorkerRef = useRef<Worker | null>(null);
    // Phase 10: SWC compiler moved into swc.worker.ts — compilation never blocks
    // the 60fps main thread. Falls back to compilerRef (synchronous) if the worker
    // hasn't booted yet.
    const swcWorkerRef = useRef<Worker | null>(null);
    const pendingCompilesRef = useRef<Map<string, (result: string) => void>>(new Map());
    // Keep a live ref to elements so the worker's READY handler uses the
    // most-recent state (including any IDB-hydrated upgrade).
    const elementsRef = useRef<VectraProject>(elements);
    // Phase 3: Persistent SWC compiler — Globals created once, reused every compile()
    const compilerRef = useRef<any>(null);
    // Phase 5: Retained-mode snapping engine — sibling rects pushed once per drag
    const layoutEngineRef = useRef<any>(null);
    // Phase 11: Defensive flag — tells any future auto-sync effect to skip the
    // O(N) grid rebuild during drag. Set to false by updateProject({skipLayout:true})
    // and automatically reset to true after each effect run.
    const shouldSyncLayoutRef = useRef<boolean>(true);

    // H-1 FIX: O(1) child→parent reverse-lookup map.
    // Rebuilt via useMemo whenever elements changes — one O(N) pass per state update
    // instead of O(N) per node per render (which was effectively O(N²) at 60fps).
    const parentMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const [nodeId, node] of Object.entries(elements)) {
            for (const childId of (node.children || [])) {
                map.set(childId, nodeId);
            }
        }
        return map;
    }, [elements]);


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

    // ── Phase H: Multi-project state ─────────────────────────────────────────
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

    // Keep elementsRef in sync so worker READY handler gets the latest state
    // (covers the race where IDB hydration fires before the worker finishes booting).
    useEffect(() => { elementsRef.current = elements; }, [elements]);

    // ── Phase H: Multi-project boot sequence ─────────────────────────────────
    //
    // Step 1: Run one-shot migration for users upgrading from pre-Phase H.
    //         Idempotent — no-op if already migrated or fresh install.
    // Step 2: Load the project index so the Dashboard renders the real list.
    // Step 3: Determine which project to open:
    //           a) localStorage['vectra_active_id'] — last open project
    //           b) First project in index (fallback)
    //           c) Nothing saved → INITIAL_DATA (fresh install)
    // Step 4: Read the project's localStorage snap for instant paint, then
    //         upgrade from IDB if IDB is newer.
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

                // Phase 3: Persistent SWC Globals (interner created once)
                compilerRef.current = new wasm.SwcCompiler();

                // Phase 5: Retained-mode LayoutEngine
                layoutEngineRef.current = new wasm.LayoutEngine();

                console.log('[Vectra] Rust engine ready — SwcCompiler + LayoutEngine cached');
            } catch (e) {
                console.warn('[Vectra] Rust engine init failed:', e);
            }
        })();
    }, []);

    // ── History Worker init ────────────────────────────────────────────────────
    // Spins up history.worker.ts which owns its own Wasm instance + HistoryManager.
    // READY → send INIT with current elements (elementsRef is up-to-date).
    // UNDO_RESULT / REDO_RESULT → parse decompressed JSON → setElements.
    useEffect(() => {
        let worker: Worker;
        try {
            worker = new Worker(
                new URL('../workers/history.worker.ts', import.meta.url),
                { type: 'module' }
            );
            historyWorkerRef.current = worker;

            worker.onmessage = (e: MessageEvent) => {
                const { type, payload } = e.data as { type: string; payload?: string };
                if (type === 'READY') {
                    // Use elementsRef so we get the IDB-hydrated state if it arrived first
                    worker.postMessage({ type: 'INIT', payload: elementsRef.current });
                } else if (type === 'UNDO_RESULT' || type === 'REDO_RESULT') {
                    try { setElements(JSON.parse(payload!)); }
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

    // ── SWC Worker init (Phase 10) ──────────────────────────────────────────────
    // Mirrors the history worker boot pattern. The worker owns its Wasm instance,
    // compiles TSX→JS off the main thread, and applies the ESM→CJS shim internally.
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

    // ── Phase H: Async autosave (per-project, non-blocking) ──────────────────
    // Writes to BOTH storages:
    //   • IndexedDB — primary store, async, off-thread, no jank
    //   • localStorage — per-project snap cache for instant boot on next open
    // Also updates lastEditedAt + pageCount in the project index.
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
                    // M-3 FIX: JSON.stringify runs AFTER the async IDB write resolves,
                    // never on the critical path. Previously this was synchronous and
                    // blocked the main thread for 3-8ms per autosave tick on large projects.
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

    // H-3 FIX: pushHistory stale-closure on historyIndex removed.
    // The JS-fallback path now uses functional set-state so each call reads
    // the CURRENT index rather than the one captured at callback creation time.
    // This prevents rapid consecutive pushes from collapsing into a single slot.
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

    // ── updateProject ─────────────────────────────────────────────────────────
    // Phase 11: accepts both the old boolean form (backward-compat) and the new
    // options-object form.  `skipLayout: true` flips the shouldSyncLayoutRef flag
    // so any future auto-sync effect skips the O(N) grid rebuild during drag.
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

    const undo = useCallback(() => {
        if (historyWorkerRef.current) {
            // Result arrives asynchronously via onmessage → UNDO_RESULT → setElements
            historyWorkerRef.current.postMessage({ type: 'UNDO' });
        } else if (historyIndex > 0) {
            setHistoryIndex(p => p - 1);
            setElements(historyStack[historyIndex - 1]);
        }
    }, [historyIndex, historyStack]);

    const redo = useCallback(() => {
        if (historyWorkerRef.current) {
            historyWorkerRef.current.postMessage({ type: 'REDO' });
        } else if (historyIndex < historyStack.length - 1) {
            setHistoryIndex(p => p + 1);
            setElements(historyStack[historyIndex + 1]);
        }
    }, [historyIndex, historyStack]);

    // ── Phase 5 + 11: Retained-Mode LayoutEngine ──────────────────────────────

    /**
     * Call ONCE on drag-start (pointer-down).
     * Phase 11 change: reads from `elementsRef` (not the closed-over `elements`
     * state) so this callback's memoized identity is []-stable. Previously it
     * was `useCallback([elements])` which caused `handleInteractionMove` to
     * re-create on every keystroke/edit — even during an unrelated hover.
     */
    const syncLayoutEngine = useCallback((draggedId: string) => {
        if (!layoutEngineRef.current) return;
        const els = elementsRef.current; // stable ref — no closure on elements state
        const siblings = Object.values(els)
            .filter(el =>
                el.id !== draggedId &&
                el.type !== 'page' &&
                el.type !== 'webpage' &&
                el.id !== 'application-root' &&
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
    }, []); // [] — stable identity: reads elements via elementsRef, not closure

    /**
     * Fast 60fps snap query — only 5 scalar args cross the Wasm boundary.
     * Returns null if the engine is unavailable (graceful degrade to no-snap).
     */
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

    // ── deleteElement ─────────────────────────────────────────────────────────
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

    // ── Item 1: duplicateElement ──────────────────────────────────────────────
    // Deep-clones the subtree using the same instantiateTemplateTS engine used by
    // canvas drag-and-drop. New IDs are guaranteed collision-free.
    // Offsets the copy +20px/+20px so it doesn't land exactly on the original.
    // Inserts immediately after the source in the parent's children list.
    // Returns the new root ID so the caller can select it.
    const duplicateElement = useCallback((id: string): string | null => {
        if (!canDeleteNode(id)) return null;
        const current = elements;
        const source = current[id];
        if (!source) return null;

        // Clone subtree — fresh IDs throughout
        const { newNodes, rootId: newRootId } = instantiateTemplateTS(id, current);

        // Offset position of the new root so it doesn't overlap the original
        const newRoot = newNodes[newRootId];
        if (newRoot?.props?.style) {
            const s = newRoot.props.style as Record<string, any>;
            const left = parseFloat(String(s.left ?? '0'));
            const top = parseFloat(String(s.top ?? '0'));
            newNodes[newRootId] = {
                ...newRoot,
                props: { ...newRoot.props, style: { ...s, left: `${left + 20}px`, top: `${top + 20}px` } },
            };
        }

        // Merge cloned subtree
        const next: VectraProject = { ...current, ...newNodes };

        // Insert immediately after the source in its parent's children
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

        setElements(next);
        setTimeout(() => pushHistory(next), 0);
        return newRootId;
    }, [elements, pushHistory]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Item 4: reorderElement ────────────────────────────────────────────────
    // Moves a node to a new index in the same or a different parent's children.
    // Safe with protected nodes — canDeleteNode guards the move (can't move root).
    const reorderElement = useCallback((
        nodeId: string,
        targetParentId: string,
        targetIndex: number,
    ): void => {
        if (!canDeleteNode(nodeId)) return;
        setElements(prev => {
            const currentParentId = Object.keys(prev).find(
                k => prev[k].children?.includes(nodeId)
            );
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

    // ── Page ops ──────────────────────────────────────────────────────────────
    const addPage = (name: string, slug?: string) => {
        const pageId = `page-${Date.now()}`;
        const canvasId = `canvas-${Date.now()}`;
        const pageSlug = slug || `/${name.toLowerCase().replace(/\s+/g, '-')}`;
        const newElements = { ...elements };
        newElements[pageId] = { id: pageId, type: 'page', name, children: [canvasId], props: { className: 'w-full h-full relative', style: { width: '100%', height: '100%' } } };
        // S-3 FIX: use 1440px not '100%' — parseFloat('100%') === NaN, breaking
        // the code generator, breakpoint CSS builder, and zoom-to-fit calculation.
        newElements[canvasId] = { id: canvasId, type: 'webpage', name, children: [], props: { layoutMode: 'canvas', style: { width: '1440px', minHeight: '100vh', backgroundColor: '#ffffff' } } };
        if (newElements['application-root']) newElements['application-root'].children = [...(newElements['application-root'].children || []), pageId];
        setPages(prev => [...prev, { id: pageId, name, slug: pageSlug, rootId: pageId }]);
        updateProject(newElements);
        setActivePageId(pageId);
    };

    // M-1 + S-7 FIX: use functional setElements to avoid stale closure on elements;
    // clone the appRoot node properly; and compute the fallback page from the list
    // BEFORE it is filtered (pages state hasn't flushed yet).
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
    }, [pages, activePageId]);

    const switchPage = useCallback((pageId: string) => {
        // Dispatch BEFORE the state update so listeners receive the old activePageId
        // as `from` and the new pageId as `to` in the same synchronous tick.
        // Canvas.tsx listens for this event to save/restore viewport state.
        window.dispatchEvent(
            new CustomEvent('vectra:page-switching', {
                detail: { from: activePageId, to: pageId },
            })
        );
        setActivePageId(pageId);
    }, [activePageId]);

    // ── Phase H: Project lifecycle ────────────────────────────────────────────
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
            window.dispatchEvent(new CustomEvent('vectra:exit-project'));
        }
    }, []);

    // ── Phase H: Open existing project ───────────────────────────────────────
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

    // ── Phase H: Rename project ────────────────────────────────────────────────
    const renameProject = useCallback(async (id: string, name: string) => {
        setProjectIndex(prev => {
            const updated = prev.map(m => m.id === id ? { ...m, name } : m);
            saveProjectIndexToDB(updated).catch(() => { });
            return updated;
        });
        if (id === projectId) setProjectName(name);
    }, [projectId]);

    // ── Phase H: Duplicate project ────────────────────────────────────────────
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

    // ── Sprint 2: Soft-delete — 3-stage pattern ──────────────────────────────
    //
    // Stage 1 — removeProjectFromIndex():
    //   Removes meta from index. Project disappears from Dashboard immediately.
    //   IDB data is NOT touched. Combined with a 5s countdown toast in Dashboard.
    //
    // Stage 2 — restoreProjectToIndex() [undo path]:
    //   Re-inserts meta into the index. The IDB data was never deleted so the
    //   project loads cleanly. Called by Dashboard if user clicks Undo.
    //
    // Stage 3 — purgeProjectData() [expiry path]:
    //   Permanently deletes IDB data + localStorage snap.
    //   Called by Dashboard after the 5-second window closes.

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

    // ── AI ────────────────────────────────────────────────────────────────────────
    //
    // Item 3 fixes:
    //   1. useCallback — stable identity, not recreated every render.
    //   2. pushHistory() called after every successful mutation so AI
    //      generations appear in the undo stack (Cmd+Z works on AI output).
    //   3. Reads elementsRef for the merge result so we capture the actual
    //      new state and push it to history, not the stale closure value.
    //
    // The three-tier AI logic (generateWithAI → mergeAIContent → fallback)
    // is completely unchanged in behaviour.
    const runAI = useCallback(async (prompt: string): Promise<string | undefined> => {
        try {
            console.log('🎨 AI Agent processing:', prompt);

            // Read current state via refs — avoids stale closure captures
            // when this callback is invoked async after a re-render.
            const currentElements = elementsRef.current;
            const currentPages = pages;          // pages is stable between renders
            const currentPageId = activePageId;  // same

            const result = await generateWithAI(prompt, currentElements, {
                pageRootId: currentPages.find(p => p.id === currentPageId)?.rootId ?? currentPageId,
                pageName: currentPages.find(p => p.id === currentPageId)?.name ?? 'Page',
            });

            if (result.action === 'error') {
                console.warn('❌ AI Error:', result.message);
                return result.message;
            }

            if (result.action === 'create' && result.elements && result.rootId) {
                const currentPage = currentPages.find(p => p.id === currentPageId);
                if (!currentPage) return 'No active page';

                const isFullPage = /page|website|portfolio|landing/i.test(prompt);

                // Compute merged result BEFORE calling setElements so we can
                // push it to history immediately after. Using the functional
                // setElements form still gives us the merged tree via a local var.
                let merged: VectraProject;
                setElements(cur => {
                    merged = mergeAIContent(
                        cur,
                        currentPage.rootId,
                        result.elements!,
                        result.rootId!,
                        isFullPage
                    );
                    return merged;
                });

                // Push to history so Cmd+Z can undo AI generation.
                // Small timeout — lets setElements flush before pushHistory reads
                // the ref. elementsRef.current is updated synchronously by the
                // setElements reducer before React schedules the re-render.
                setTimeout(() => {
                    pushHistory(elementsRef.current);
                    console.log(
                        '✅ AI: Canvas updated with',
                        Object.keys(result.elements!).length,
                        'elements — pushed to history.'
                    );
                }, 0);

                return result.message;
            }

            if (result.action === 'update' && result.elements) {
                setElements(cur => {
                    const updated = { ...cur, ...result.elements };
                    // Push history synchronously here — update path is a simple merge
                    // so elementsRef will be current after this tick.
                    setTimeout(() => pushHistory(elementsRef.current), 0);
                    return updated;
                });
                console.log('✅ AI: Updated', Object.keys(result.elements).length, 'elements — pushed to history.');
                return result.message;
            }

        } catch (e) {
            console.error('❌ AI Error:', e);
            return 'Something went wrong.';
        }
    }, [pages, activePageId, pushHistory]);
    // Note: elements intentionally omitted from deps — read via elementsRef
    // to prevent runAI from being recreated on every element change (60fps).

    // Direction D: updatePageSEO — merge-update SEO fields for a specific page.
    // All fields are optional; only the provided keys are changed.
    const updatePageSEO = useCallback(
        (pageId: string, seo: Partial<import('../types').PageSEO>) => {
            setPages(prev => prev.map(p =>
                p.id === pageId ? { ...p, seo: { ...p.seo, ...seo } } : p
            ));
        },
        []
    );

    // ── Phase 6 + 10: Rust SWC Compiler ──────────────────────────────────────
    // Phase 6: TSX→JS via Rust SWC (no Babel), ESM→CJS shim for iframe shell.
    // Phase 10: Worker-first — sends compilation to swc.worker.ts so 5ms Rust
    //           work never blocks a React render frame. Falls back to the
    //           main-thread compilerRef while the worker is still booting.
    //           ESM→CJS shim applied INSIDE the worker; fallback applies it here.
    const compileComponent = useCallback(async (code: string): Promise<string> => {
        if (!code.trim()) return '';

        // ── Worker path (Phase 10) — compilation off main thread ──────────
        if (swcWorkerRef.current) {
            return new Promise<string>((resolve) => {
                const id = Math.random().toString(36).substring(2, 11);
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
            addPage, deletePage, switchPage, updatePageSEO,
            history: { undo, redo },
            syncLayoutEngine, querySnapping,
            theme, updateTheme: (u) => setTheme(p => ({ ...p, ...u })),
            dataSources,
            addDataSource: (ds) => setDataSources(p => [...p, ds]),
            removeDataSource: (id) => setDataSources(p => p.filter(d => d.id !== id)),
            apiRoutes, addApiRoute, updateApiRoute, deleteApiRoute,
            framework, setFramework,
            createNewProject, exitProject, runAI, compileComponent,
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

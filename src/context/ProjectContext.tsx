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
    useCallback, useRef, type ReactNode,
} from 'react';
import type { VectraProject, Page } from '../types';
import { INITIAL_DATA, STORAGE_KEY } from '../data/constants';
import { mergeAIContent } from '../utils/aiHelpers';
import { deleteNodeRecursive, canDeleteNode } from '../utils/treeUtils';
import { instantiateTemplate as instantiateTemplateTS } from '../utils/templateUtils';
import { generateWithAI } from '../services/aiAgent';
import { saveProjectToDB, loadProjectFromDB, deleteProjectFromDB } from '../utils/db';

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
    instantiateTemplate: (rootId: string, nodes: VectraProject) => { newNodes: VectraProject; rootId: string };

    // ── Pages ─────────────────────────────────────────────────────────────────
    pages: Page[];
    activePageId: string;
    setActivePageId: (id: string) => void;
    realPageId: string;
    addPage: (name: string, slug?: string) => void;
    deletePage: (id: string) => void;
    switchPage: (pageId: string) => void;

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
}

// ─── CONTEXT ─────────────────────────────────────────────────────────────────

const ProjectContext = createContext<ProjectContextType | null>(null);

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


    // JS-fallback history stack (used when Wasm HistoryManager is unavailable)
    const [historyStack, setHistoryStack] = useState<VectraProject[]>([INITIAL_DATA]);
    const [historyIndex, setHistoryIndex] = useState(0);

    const [theme, setTheme] = useState<GlobalTheme>({ primary: '#3b82f6', secondary: '#64748b', accent: '#f59e0b', radius: '0.5rem', font: 'Inter' });
    const [dataSources, setDataSources] = useState<DataSource[]>([
        { id: 'ds-1', name: 'JSONPlaceholder', url: 'https://jsonplaceholder.typicode.com/users', method: 'GET', data: { name: 'Demo User' } }
    ]);

    // Keep elementsRef in sync so worker READY handler gets the latest state
    // (covers the race where IDB hydration fires before the worker finishes booting).
    useEffect(() => { elementsRef.current = elements; }, [elements]);

    // ── IDB hydration (async upgrade after synchronous localStorage bootstrap) ───
    // If IndexedDB has a saved project (from a previous async save), it may be
    // newer than what localStorage cached. We silently upgrade to it.
    // This effect runs ONCE on mount and never blocks the first render.
    useEffect(() => {
        loadProjectFromDB<VectraProject>(STORAGE_KEY)
            .then(saved => {
                if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
                    setElements(saved);
                    setHistoryStack([saved]);
                }
            })
            .catch(e => console.warn('[ProjectContext] IDB hydration failed (non-fatal):', e));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Wasm init: SwcCompiler + LayoutEngine only ─────────────────────────────
    // HistoryManager is intentionally omitted — it lives in history.worker.ts.
    useEffect(() => {
        (async () => {
            try {
                const wasm = await import('../../vectra-engine/pkg/vectra_engine.js');
                await wasm.default();
                wasmModule = wasm; // eslint-disable-line

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

    // ── Async autosave (Phase 5: non-blocking) ────────────────────────────────
    // Writes to BOTH storages:
    //   • IndexedDB — async, off-thread, no jank, is the primary store
    //   • localStorage — sync but fast (just a cache for instant next-load hydration)
    //     We write localStorage with a short string-size guard to avoid quota errors.
    useEffect(() => {
        const timer = setTimeout(() => {
            // IDB: primary async save (never blocks)
            saveProjectToDB(STORAGE_KEY, elements).catch(e =>
                console.warn('[ProjectContext] IDB auto-save failed:', e)
            );
            // localStorage: cheap bootstrap cache (sync but small window)
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(elements)); }
            catch { /* localStorage quota exceeded — IDB is the real store */ }
        }, 1000);
        return () => clearTimeout(timer);
    }, [elements]);

    // ── pushHistory ────────────────────────────────────────────────────────────
    // Phase 9: fire-and-forget to the history worker. JSON.stringify + Gzip happen
    // entirely off the main thread. JS fallback used only before worker is ready.
    const pushHistory = useCallback((newElements: VectraProject) => {
        if (historyWorkerRef.current) {
            // Structured Clone copies the object; worker serialises + compresses it.
            historyWorkerRef.current.postMessage({ type: 'PUSH', payload: newElements });
        } else {
            // JS fallback: worker not ready yet — write to in-memory stack instead.
            queueMicrotask(() => {
                setHistoryStack(p => [...p.slice(0, historyIndex + 1), newElements].slice(-50));
                setHistoryIndex(p => Math.min(p + 1, 49));
            });
        }
    }, [historyIndex]);

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

    // ── Page ops ──────────────────────────────────────────────────────────────
    const addPage = (name: string, slug?: string) => {
        const pageId = `page-${Date.now()}`;
        const canvasId = `canvas-${Date.now()}`;
        const pageSlug = slug || `/${name.toLowerCase().replace(/\s+/g, '-')}`;
        const newElements = { ...elements };
        newElements[pageId] = { id: pageId, type: 'page', name, children: [canvasId], props: { className: 'w-full h-full relative', style: { width: '100%', height: '100%' } } };
        newElements[canvasId] = { id: canvasId, type: 'webpage', name, children: [], props: { layoutMode: 'canvas', style: { width: '100%', minHeight: '100vh', backgroundColor: '#ffffff' } } };
        if (newElements['application-root']) newElements['application-root'].children = [...(newElements['application-root'].children || []), pageId];
        setPages(prev => [...prev, { id: pageId, name, slug: pageSlug, rootId: pageId }]);
        updateProject(newElements);
        setActivePageId(pageId);
    };

    const deletePage = (id: string) => {
        if (pages.length <= 1 || id === 'page-home') return;
        const newElements = { ...elements };
        if (newElements['application-root']) newElements['application-root'].children = newElements['application-root'].children?.filter(c => c !== id);
        delete newElements[id];
        setPages(prev => prev.filter(p => p.id !== id));
        updateProject(newElements);
        if (activePageId === id) setActivePageId(pages[0].id);
    };

    const switchPage = (pageId: string) => setActivePageId(pageId);

    // ── Project lifecycle ─────────────────────────────────────────────────────
    const createNewProject = useCallback((templateId: string) => {
        console.log(`[Vectra] Initializing project with template: ${templateId}...`);
        setElements(INITIAL_DATA);
        setHistoryStack([INITIAL_DATA]);
        setHistoryIndex(0);
        setPages([{ id: 'page-home', name: 'Home', slug: '/', rootId: 'page-home' }]);
        setActivePageId('page-home');
        // Clear both stores so next load doesn't restore old data
        localStorage.removeItem(STORAGE_KEY);
        deleteProjectFromDB(STORAGE_KEY).catch(() => { });
    }, []);

    const exitProject = useCallback(() => {
        if (confirm('Exit to dashboard? Unsaved changes will be kept in local history.')) {
            window.dispatchEvent(new CustomEvent('vectra:exit-project'));
        }
    }, []);

    // ── AI ────────────────────────────────────────────────────────────────────
    const runAI = async (prompt: string): Promise<string | undefined> => {
        try {
            console.log('🎨 AI Agent processing:', prompt);
            const result = await generateWithAI(prompt, elements);
            if (result.action === 'error') { console.warn('❌ AI Error:', result.message); return result.message; }

            if (result.action === 'create' && result.elements && result.rootId) {
                const currentPage = pages.find(p => p.id === activePageId);
                if (!currentPage) return 'No active page';
                const isFullPage = /page|website|portfolio|landing/i.test(prompt);
                setElements(cur => mergeAIContent(cur, currentPage.rootId, result.elements!, result.rootId!, isFullPage));
                console.log('✅ Canvas updated with', Object.keys(result.elements).length, 'new elements');
                return result.message;
            }
            if (result.action === 'update' && result.elements) {
                setElements(cur => ({ ...cur, ...result.elements }));
                console.log('✅ Updated', Object.keys(result.elements).length, 'elements');
                return result.message;
            }
        } catch (e) {
            console.error('❌ AI Error:', e);
            return 'Something went wrong.';
        }
    };

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
            elements, setElements, updateProject, pushHistory, deleteElement,
            instantiateTemplate: instantiateTemplateTS,
            pages, activePageId, setActivePageId, realPageId: activePageId,
            addPage, deletePage, switchPage,
            history: { undo, redo },
            syncLayoutEngine, querySnapping,
            theme, updateTheme: (u) => setTheme(p => ({ ...p, ...u })),
            dataSources,
            addDataSource: (ds) => setDataSources(p => [...p, ds]),
            removeDataSource: (id) => setDataSources(p => p.filter(d => d.id !== id)),
            createNewProject, exitProject, runAI, compileComponent,
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

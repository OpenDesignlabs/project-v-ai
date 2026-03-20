import { useState, useEffect, useRef, lazy, Suspense } from 'react';

import { useEditor } from '../../context/EditorContext';
import { useContainer } from '../../context/ContainerContext';
import { copyToClipboard, generateGridPage } from '../../utils/codegen/codeGenerator';
import {
    Play, Undo, Redo, Grid,
    Check, X, Copy, Trash2,
    Home, Wand2, Loader2,
    Cpu, Maximize, ExternalLink, ChevronDown, Plus, FileText,
    Upload, Send, FileArchive, Figma,
} from 'lucide-react';
// PublishModal: 982-line modal, only needed when user clicks Publish
const PublishModal = lazy(() => import('../modals/PublishModal').then(m => ({ default: m.PublishModal })));

import { cn } from '../../lib/utils';

export const Header = () => {
    const {
        history, previewMode, setPreviewMode, elements,
        setSelectedId, selectedId,
        deleteElement, exitProject, setMagicBarOpen,
        pages, framework, setActivePanel,
        projectId,
        realPageId, switchPage, addPage,
    } = useEditor();

    const { status, url: containerUrl } = useContainer();


    // Page switcher dropdown. Uses 50ms setTimeout on the global mousedown listener to prevent the opening click from also triggering the close handler
    const [pageDropOpen, setPageDropOpen] = useState(false);
    const pageDropRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!pageDropOpen) return;
        const close = (e: MouseEvent) => {
            if (pageDropRef.current && !pageDropRef.current.contains(e.target as Node)) {
                setPageDropOpen(false);
            }
        };
        const t = setTimeout(() => window.addEventListener('mousedown', close), 50);
        return () => { clearTimeout(t); window.removeEventListener('mousedown', close); };
    }, [pageDropOpen]);

    // Live save-state indicator.
    // Driven by vectra:save-state events from useFileSync — zero coupling to sync internals.
    const [isSaving, setIsSaving] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const justSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const handle = (e: Event) => {
            const saving = (e as CustomEvent<{ saving: boolean }>).detail.saving;
            setIsSaving(saving);
            if (!saving) {
                if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current);
                setJustSaved(true);
                justSavedTimerRef.current = setTimeout(() => setJustSaved(false), 2000);
            }
        };
        window.addEventListener('vectra:save-state', handle);
        return () => {
            window.removeEventListener('vectra:save-state', handle);
            if (justSavedTimerRef.current) clearTimeout(justSavedTimerRef.current);
        };
    }, []);

    // ── Import dropdown ───────────────────────────────────────────────────────
    const [showImportMenu, setShowImportMenu] = useState(false);
    const importMenuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!showImportMenu) return;
        const handler = (e: MouseEvent) => {
            if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node))
                setShowImportMenu(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showImportMenu]);

    // ── Publish modal ─────────────────────────────────────────────────────────
    const [showPublishModal, setShowPublishModal] = useState(false);

    // ── Grid converter state ──────────────────────────────────────
    // ── Item 3: Multi-page grid results ─────────────────────────────────────────
    interface GridPageResult {
        code: string;
        error: string | null;
        layout: import('../../utils/codegen/codeGenerator').GridLayout | null;
    }

    // Map<pageId, GridPageResult> — keyed by page.id
    const [gridPageResults, setGridPageResults] = useState<Map<string, GridPageResult>>(new Map());
    const [gridSelectedPageId, setGridSelectedPageId] = useState<string>('');

    // KEEP these existing state vars:
    const [showGridCode, setShowGridCode] = useState(false);
    const [gridCopied, setGridCopied] = useState(false);
    const [isConvertingGrid, setIsConvertingGrid] = useState(false);
    const [useFrUnits, setUseFrUnits] = useState(false);



    const togglePreview = () => {
        if (!previewMode) setSelectedId(null);
        setPreviewMode(!previewMode);
    };

    // ── Gap 2 Fix: Clear grid results when project switches ─────────────────
    useEffect(() => {
        setGridPageResults(new Map());
        setGridSelectedPageId('');
        setShowGridCode(false);
    }, [projectId]);


    // ── Item 3: Multi-page grid converter ────────────────────────────────────────
    // Iterates over all pages, runs WASM + generateGridPage() per page.
    // A per-page failure stores an error result without aborting other pages.
    // The modal tab bar lets the user review each page's output independently.
    const handleConvertToGrid = () => {
        if (!(window as any).vectraWasm?.absolute_to_grid) {
            // Surface the WASM error as a single result for all pages
            const errorResult: GridPageResult = {
                code: '',
                error: 'Rust WASM engine is not loaded.\n\nCompile the engine first:\n  cd vectra-engine && wasm-pack build --target web',
                layout: null,
            };
            const results = new Map<string, GridPageResult>();
            pages.forEach(p => results.set(p.id, errorResult));
            setGridPageResults(results);
            setGridSelectedPageId(pages[0]?.id || '');
            setShowGridCode(true);
            return;
        }

        setIsConvertingGrid(true);
        setGridPageResults(new Map());

        const px = (val: unknown): number => {
            const n = parseFloat(String(val || 0));
            return isNaN(n) ? 0 : n;
        };

        const results = new Map<string, GridPageResult>();
        let firstPageId = '';

        for (const page of pages) {
            if (!firstPageId) firstPageId = page.id;

            try {
                const pageRoot = elements[page.rootId];
                const canvasFrameId = pageRoot?.children?.find(
                    (cid: string) => elements[cid]?.type === 'webpage'
                ) || pageRoot?.children?.[0];

                if (!canvasFrameId) {
                    results.set(page.id, {
                        code: '', error: `No canvas frame found on page "${page.name}".`, layout: null,
                    });
                    continue;
                }

                const canvasFrame = elements[canvasFrameId];
                const childIds: string[] = canvasFrame?.children || [];

                if (childIds.length === 0) {
                    results.set(page.id, {
                        code: '', error: `Page "${page.name}" has no canvas children to convert.`, layout: null,
                    });
                    continue;
                }

                const gridNodes = childIds
                    .map(id => {
                        const node = elements[id];
                        if (!node) return null;
                        const style = (node.props?.style as any) || {};
                        return { id, x: px(style.left), y: px(style.top), w: px(style.width), h: px(style.height) };
                    })
                    .filter((n): n is NonNullable<typeof n> => n !== null && n.w > 0 && n.h > 0);

                if (gridNodes.length === 0) {
                    results.set(page.id, {
                        code: '',
                        error: `No nodes with valid dimensions on page "${page.name}".\nMake sure canvas children have explicit width/height.`,
                        layout: null,
                    });
                    continue;
                }

                const canvasWidth = px((canvasFrame.props?.style as any)?.width) || 1440;
                const resultJson: string = (window as any).vectraWasm.absolute_to_grid(
                    JSON.stringify(gridNodes),
                    canvasWidth
                );
                const gridLayout = JSON.parse(resultJson);
                const generated = generateGridPage(
                    page, elements, gridLayout,
                    framework as 'nextjs' | 'vite',
                    useFrUnits
                );

                results.set(page.id, { code: generated, error: null, layout: gridLayout });

                console.log(
                    `[Vectra] ✅ Grid: "${page.name}" — ` +
                    `${gridLayout.templateColumns.split(' ').length} cols × ` +
                    `${gridLayout.templateRows.split(' ').length} rows`
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[Vectra] Grid conversion failed for page "${page.name}":`, err);
                results.set(page.id, { code: '', error: msg, layout: null });
            }
        }

        setGridPageResults(results);
        setGridSelectedPageId(firstPageId);
        setUseFrUnits(false);
        setShowGridCode(true);
        setGridCopied(false);
        setIsConvertingGrid(false);
    };

    // ─── Sprint 1 / Item 3: fr/px unit toggle ─────────────────────────────────
    // Regenerate all pages that have a valid layout
    const handleFrToggle = () => {
        const nextFr = !useFrUnits;
        setUseFrUnits(nextFr);
        setGridCopied(false);

        // Regenerate all pages that have a valid layout (no WASM re-call)
        setGridPageResults(prev => {
            const updated = new Map(prev);
            for (const page of pages) {
                const result = prev.get(page.id);
                if (!result?.layout) continue; // skip pages with errors
                const regenerated = generateGridPage(
                    page, elements, result.layout,
                    framework as 'nextjs' | 'vite',
                    nextFr
                );
                updated.set(page.id, { ...result, code: regenerated });
            }
            return updated;
        });
    }; // reset — code changed

    return (
        <>
            {/* TOP BAR */}
            <div className="h-[50px] bg-[#333333] border-b border-[#252526] flex items-center justify-between px-4 shrink-0 z-50 text-[#cccccc]">

                {/* LEFT: Branding + Page Switcher */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={exitProject}
                        className="p-2 hover:bg-[#3e3e42] rounded text-[#858585] hover:text-white transition-colors"
                        title="Back to Dashboard"
                    >
                        <Home size={16} />
                    </button>

                    <div className="flex items-center gap-2">
                        <svg width="28" height="28" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="0" y="0" width="40" height="40" rx="10" fill="#a5b4fc" />
                            <svg x="6" y="6" width="28" height="28" viewBox="0 0 24 24">
                                <path d="M5 6L12 20" stroke="#1e1b4b" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 3" />
                                <path d="M12 20L19 6" stroke="#1e1b4b" strokeWidth="2.5" strokeLinecap="round" />
                                <circle cx="5" cy="6" r="1.5" fill="#1e1b4b" />
                                <circle cx="19" cy="6" r="1.5" fill="#1e1b4b" />
                                <rect x="10.5" y="18.5" width="3" height="3" fill="#1e1b4b" />
                            </svg>
                        </svg>
                        <span className="text-sm font-bold text-[#cccccc] hidden md:block">Vectra</span>
                    </div>

                    <div className="h-4 w-px bg-[#3e3e42]" />

                    {/* Framework Badge */}
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-bold ${framework === 'nextjs'
                        ? 'bg-white/5 border-white/10 text-[#999]'
                        : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                        }`}>
                        <Cpu size={10} />
                        {framework === 'nextjs' ? 'Next.js 14' : 'Vite + React'}
                    </div>

                    {/* Page Switcher */}
                    <div className="relative" ref={pageDropRef}>
                        <button
                            onClick={() => setPageDropOpen(p => !p)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-all max-w-[150px]",
                                pageDropOpen
                                    ? "bg-[#007acc]/15 border-[#007acc]/40 text-white"
                                    : "bg-[#252526] border-[#3e3e42] text-[#ccc] hover:text-white hover:border-[#555]"
                            )}
                            title="Switch page"
                        >
                            <FileText size={11} className="text-[#007acc] shrink-0" />
                            <span className="truncate max-w-[90px]">
                                {pages.find(p => p.id === realPageId)?.name ?? 'Page'}
                            </span>
                            <ChevronDown size={10} className={cn("shrink-0 transition-transform duration-150", pageDropOpen && "rotate-180")} />
                        </button>

                        {pageDropOpen && (
                            <div className="absolute top-full left-0 mt-1 z-[200] bg-[#252526] border border-[#3f3f46] rounded-xl shadow-2xl py-1 min-w-[190px]">
                                <div className="px-3 py-1.5 text-[9px] font-bold text-[#555] uppercase tracking-widest border-b border-[#2a2a2c] mb-1">Pages</div>
                                {pages.filter(p => !p.hidden).map(page => (
                                    <button
                                        key={page.id}
                                        onClick={() => { switchPage(page.id); setPageDropOpen(false); }}
                                        className={cn(
                                            "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors",
                                            page.id === realPageId
                                                ? "text-white bg-[#007acc]/15"
                                                : "text-[#aaa] hover:text-white hover:bg-[#2a2a2c]"
                                        )}
                                    >
                                        <span className={cn(
                                            "w-1.5 h-1.5 rounded-full shrink-0",
                                            page.id === realPageId ? "bg-[#007acc]" : "bg-[#444]"
                                        )} />
                                        <span className="flex-1 truncate">{page.name}</span>
                                        <span className="text-[9px] text-[#444] font-mono shrink-0 max-w-[60px] truncate">{page.slug}</span>
                                    </button>
                                ))}
                                <div className="h-px bg-[#2a2a2c] my-1" />
                                <button
                                    onClick={() => { addPage('New Page'); setPageDropOpen(false); }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[#007acc] hover:bg-[#007acc]/10 transition-colors"
                                >
                                    <Plus size={11} /> New Page
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Actions */}
                <div className="flex items-center gap-2">
                    {/* History & Zoom */}
                    <div className="flex items-center gap-0.5 opacity-80">
                        <button onClick={history.undo} className="p-2 hover:bg-[#3e3e42] hover:text-white rounded text-[#858585] transition-colors" title="Undo"><Undo size={14} /></button>
                        <button onClick={history.redo} className="p-2 hover:bg-[#3e3e42] hover:text-white rounded text-[#858585] transition-colors" title="Redo"><Redo size={14} /></button>
                        <button onClick={() => window.dispatchEvent(new CustomEvent('vectra:zoom-to-fit'))} className="p-2 hover:bg-[#3e3e42] hover:text-white rounded text-[#858585] transition-colors" title="Zoom to Fit (⌘0)"><Maximize size={14} /></button>
                        {/* Save state pill */}
                        {(isSaving || justSaved) && (
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all ml-1 ${
                                isSaving ? 'text-[#888] bg-[#2a2a2d]' : 'text-green-400 bg-green-500/10'
                            }`}>
                                {isSaving
                                    ? <><span className="w-1.5 h-1.5 rounded-full bg-[#666] animate-pulse" />Saving…</>
                                    : <><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Saved</>
                                }
                            </div>
                        )}
                    </div>

                    {/* AI Magic Bar Toggle */}
                    <button
                        onClick={() => setMagicBarOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-[#7c3aed] to-[#2563eb] text-white rounded text-[10px] font-black hover:shadow-lg transition-all border border-white/10 group active:scale-95"
                    >
                        <Wand2 size={12} className="group-hover:rotate-12 transition-transform" />
                        <span className="hidden lg:inline uppercase tracking-tight">Ask AI</span>
                        <span className="text-[8px] opacity-40 font-mono hidden xl:inline border border-white/20 px-1 rounded ml-1 group-hover:opacity-100">⌘K</span>
                    </button>

                    <div className="h-4 w-px bg-[#3e3e42] mx-1" />

                    {/* Delete Button */}
                    <button
                        onClick={() => {
                            if (selectedId && !['application-root', 'page-home', 'main-canvas'].includes(selectedId)) {
                                deleteElement(selectedId);
                            }
                        }}
                        disabled={!selectedId || ['application-root', 'page-home', 'main-canvas'].includes(selectedId)}
                        className={cn(
                            "p-2 rounded transition-colors",
                            (selectedId && !['application-root', 'page-home', 'main-canvas'].includes(selectedId))
                                ? "text-[#858585] hover:text-red-400 hover:bg-[#3e3e42]"
                                : "text-[#555] cursor-not-allowed"
                        )}
                        title="Delete Selected (Del)"
                    >
                        <Trash2 size={14} />
                    </button>

                    <div className="h-4 w-px bg-[#3e3e42] mx-1" />

                    {/* ── To Grid ───────────────────────────────────── */}
                    <button
                        id="convert-to-grid-btn"
                        onClick={handleConvertToGrid}
                        disabled={isConvertingGrid || status !== 'ready'}
                        title="Convert canvas layout to responsive CSS Grid"
                        className={cn(
                            'flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-bold transition-all border',
                            isConvertingGrid
                                ? 'bg-[#252526] border-[#3e3e42] text-purple-400 cursor-wait'
                                : 'bg-[#252526] border-[#3e3e42] text-[#858585] hover:text-purple-400 hover:border-purple-500/40 disabled:opacity-30 disabled:cursor-not-allowed'
                        )}
                    >
                        {isConvertingGrid
                            ? <><Loader2 size={11} className="animate-spin" /><span>Converting...</span></>
                            : <><Grid size={11} /><span>To Grid</span></>
                        }
                    </button>

                    {/* ── Import Dropdown ────────────────────────────── */}
                    <div className="relative" ref={importMenuRef}>
                        <button
                            onClick={() => setShowImportMenu(p => !p)}
                            className={cn(
                                'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold transition-all border',
                                showImportMenu
                                    ? 'bg-[#3e3e42] border-[#5e5e62] text-white'
                                    : 'bg-[#252526] border-[#3e3e42] text-[#858585] hover:text-white hover:border-[#5e5e62]'
                            )}
                            title="Import from Figma or Stitch"
                        >
                            <Upload size={12} />
                            <span>Import</span>
                            <ChevronDown size={10} className={cn('transition-transform', showImportMenu && 'rotate-180')} />
                        </button>

                        {showImportMenu && (
                            <div className="absolute right-0 top-full mt-1.5 w-52 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg shadow-2xl z-[300] overflow-hidden py-1">
                                <div className="px-3 py-1.5 text-[9px] font-bold text-[#555] uppercase tracking-wider">Import from</div>

                                <button
                                    onClick={() => { setActivePanel('figma'); setShowImportMenu(false); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#cccccc] hover:bg-[#2a2a2d] hover:text-white transition-colors"
                                >
                                    <Figma size={13} className="text-pink-400 shrink-0" />
                                    <div className="text-left">
                                        <div className="font-semibold">Figma</div>
                                        <div className="text-[10px] text-[#666]">Import frames from Figma</div>
                                    </div>
                                </button>

                                <button
                                    onClick={() => { setActivePanel('stitch'); setShowImportMenu(false); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[#cccccc] hover:bg-[#2a2a2d] hover:text-white transition-colors"
                                >
                                    <FileArchive size={13} className="text-amber-400 shrink-0" />
                                    <div className="text-left">
                                        <div className="font-semibold">Stitch</div>
                                        <div className="text-[10px] text-[#666]">Import ZIP component bundle</div>
                                    </div>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Publish Button ─────────────────────────────── */}
                    <button
                        onClick={() => setShowPublishModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-all border bg-[#252526] border-[#3e3e42] text-[#858585] hover:text-white hover:border-purple-500/60 hover:bg-purple-600/10"
                        title="Publish project"
                    >
                        <Send size={12} />
                        <span>Publish</span>
                    </button>

                    <div className="h-4 w-px bg-[#3e3e42] mx-2" />

                    {/* WebContainer Status Indicator */}
                    <div className="flex items-center gap-2 mr-2">
                        <span className={`w-2 h-2 rounded-full ${status === 'ready' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-yellow-500 animate-pulse'}`} />
                        <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider">
                            {status === 'ready' ? 'Ready' : 'Building...'}
                        </span>
                    </div>

                    {/* Preview Button (Primary Action) */}
                    <button
                        onClick={togglePreview}
                        className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all",
                            previewMode
                                ? 'bg-[#007acc] text-white hover:bg-[#0063a5] shadow-sm'
                                : 'bg-[#252526] text-[#cccccc] border border-[#3e3e42] hover:border-[#007acc] hover:text-[#007acc]'
                        )}
                    >
                        <Play size={10} fill={previewMode ? "currentColor" : "none"} />
                        {previewMode ? 'Running' : 'Preview'}
                    </button>

                    {/* SPRINT-E-FIX-24: Open in Browser — opens the live WebContainer
                        server URL in a new tab so multi-page navigation actually works.
                        The instant preview iframe uses a sandboxed srcdoc that can't
                        follow React Router <Link> navigation between pages.
                        containerUrl comes from the server-ready event (MCP-WC-1) —
                        never a hardcoded localhost port. Only rendered when the dev
                        server is running (containerUrl non-null). */}
                    {containerUrl && (
                        <a
                            href={containerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open live dev server in new tab — supports multi-page navigation"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold transition-all bg-[#252526] border border-[#3e3e42] text-[#858585] hover:text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-500/8 active:scale-95 ml-1"
                        >
                            <ExternalLink size={11} />
                            <span className="hidden xl:inline">Open in Browser</span>
                        </a>
                    )}
                </div>
            </div >


            {/* ── Item 3: Multi-page Grid Code Modal ─────────────────────────────── */}
            {showGridCode && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-8 backdrop-blur-sm">
                    <div className="bg-[#1e1e1e] w-full max-w-5xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-[#333]">

                        {/* Modal header */}
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#333] bg-[#252526] flex-wrap">
                            <span className="font-medium text-gray-200 flex items-center gap-2 shrink-0">
                                <Grid size={16} className="text-purple-400" />
                                Responsive CSS Grid
                            </span>

                            {/* Page tab bar */}
                            {pages.length > 1 && (
                                <div className="flex items-center gap-1 flex-1 flex-wrap">
                                    {pages.map(page => {
                                        const result = gridPageResults.get(page.id);
                                        const isActive = page.id === gridSelectedPageId;
                                        const hasError = !!result?.error;
                                        return (
                                            <button
                                                key={page.id}
                                                onClick={() => { setGridSelectedPageId(page.id); setGridCopied(false); }}
                                                className={cn(
                                                    'px-2.5 py-1 rounded text-[10px] font-bold transition-all border',
                                                    isActive
                                                        ? hasError
                                                            ? 'bg-red-500/15 border-red-500/30 text-red-400'
                                                            : 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                                                        : 'bg-transparent border-transparent text-[#555] hover:text-[#888]'
                                                )}
                                            >
                                                {hasError ? '⚠ ' : ''}{page.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {/* fr/px toggle */}
                            {(() => {
                                const hasAnyLayout = [...gridPageResults.values()].some(r => r.layout !== null);
                                return hasAnyLayout && (
                                    <button
                                        onClick={handleFrToggle}
                                        title={useFrUnits ? 'Switch to px' : 'Switch to fr (fluid)'}
                                        className={cn(
                                            'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-bold border transition-all shrink-0',
                                            useFrUnits
                                                ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                                                : 'bg-[#2d2d2d] border-[#3e3e42] text-[#666] hover:text-[#999]'
                                        )}
                                    >
                                        <span className={cn(
                                            'w-6 h-3 rounded-full flex items-center transition-colors px-0.5',
                                            useFrUnits ? 'bg-purple-500 justify-end' : 'bg-[#444] justify-start'
                                        )}>
                                            <span className="w-2 h-2 rounded-full bg-white shadow-sm" />
                                        </span>
                                        {useFrUnits ? 'fr units' : 'px units'}
                                    </button>
                                );
                            })()}

                            {/* Copy button */}
                            {(() => {
                                const activeResult = gridPageResults.get(gridSelectedPageId);
                                return activeResult?.code && (
                                    <button
                                        onClick={async () => {
                                            const ok = await copyToClipboard(activeResult.code);
                                            if (ok) { setGridCopied(true); setTimeout(() => setGridCopied(false), 2000); }
                                        }}
                                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded flex items-center gap-2 transition-colors shrink-0"
                                    >
                                        {gridCopied ? <><Check size={12} />Copied!</> : <><Copy size={12} />Copy</>}
                                    </button>
                                );
                            })()}

                            <button
                                onClick={() => { setShowGridCode(false); setGridPageResults(new Map()); }}
                                className="p-1.5 hover:bg-[#3e3e42] rounded text-gray-400 transition-colors shrink-0 ml-auto"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Modal body — show selected page result */}
                        <div className="flex-1 overflow-auto">
                            {(() => {
                                const activeResult = gridPageResults.get(gridSelectedPageId);
                                const activePage = pages.find(p => p.id === gridSelectedPageId);

                                if (!activeResult) {
                                    return (
                                        <div className="flex items-center justify-center h-full text-[#555] text-sm">
                                            No results yet.
                                        </div>
                                    );
                                }

                                if (activeResult.error) {
                                    return (
                                        <div className="p-6">
                                            <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-4">
                                                <p className="text-red-400 text-xs font-bold mb-2 flex items-center gap-2">
                                                    <X size={12} /> Conversion failed — {activePage?.name}
                                                </p>
                                                <pre className="text-red-300/80 text-[11px] font-mono whitespace-pre-wrap leading-relaxed">
                                                    {activeResult.error}
                                                </pre>
                                            </div>
                                            <div className="p-3 bg-[#252526] border border-[#3e3e42] rounded text-[10px] text-[#666] font-mono space-y-1">
                                                <p>Checklist:</p>
                                                <p>• Canvas frame must have children with explicit left/top/width/height</p>
                                                <p>• Elements need position:absolute (canvas layoutMode nodes)</p>
                                                <p>• WASM must be compiled: cd vectra-engine &amp;&amp; wasm-pack build --target web</p>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <pre className="p-6 text-[#d4d4d4] text-xs font-mono leading-relaxed whitespace-pre overflow-x-auto h-full">
                                        <code>{activeResult.code}</code>
                                    </pre>
                                );
                            })()}
                        </div>

                        {/* Modal footer */}
                        <div className="px-4 py-2 border-t border-[#333] bg-[#1a1a1a] flex items-center gap-3">
                            <span className="text-[10px] text-[#555]">
                                {pages.length > 1
                                    ? `${[...gridPageResults.values()].filter(r => !r.error).length} of ${pages.length} pages converted successfully`
                                    : 'Replace app/page.tsx with this file, or use as a starting point.'}
                            </span>
                            <span className="ml-auto text-[9px] text-[#444] font-mono">
                                Phase F2 — Rust WASM Grid Engine
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Publish Modal ──────────────────────────────────────────── */}
            {showPublishModal && (
                <Suspense fallback={null}>
                    <PublishModal onClose={() => setShowPublishModal(false)} />
                </Suspense>
            )}
        </>
    );
};

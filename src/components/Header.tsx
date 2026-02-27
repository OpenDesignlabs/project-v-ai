import { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useEditor } from '../context/EditorContext';
import { useContainer } from '../context/ContainerContext';
import { generateCode, copyToClipboard, generateNextProjectCode, generateProjectCode, generateGridPage } from '../utils/codeGenerator';
import { INITIAL_DATA, STORAGE_KEY } from '../data/constants';
import {
    Play, Undo, Redo, Code, Grid,
    Check, X, Copy, Trash2,
    Layers, Palette, RotateCcw, Home, Wand2, Download, Loader2, PackageCheck,
    Cpu,
} from 'lucide-react';

import { cn } from '../lib/utils';

export const Header = () => {
    const {
        history, previewMode, setPreviewMode, elements, setElements,
        activePageId, setSelectedId, viewMode, setViewMode, selectedId,
        deleteElement, exitProject, setMagicBarOpen,
        pages, dataSources, framework,
    } = useEditor();

    const { instance, status } = useContainer();
    const [showCode, setShowCode] = useState(false);
    const [code, setCode] = useState('');
    const [copied, setCopied] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportDone, setExportDone] = useState(false);
    // ── Phase F2: Grid converter state ──────────────────────────────────────
    const [gridCode, setGridCode] = useState('');
    const [showGridCode, setShowGridCode] = useState(false);
    const [gridCopied, setGridCopied] = useState(false);
    const [isConvertingGrid, setIsConvertingGrid] = useState(false);
    const [gridError, setGridError] = useState<string | null>(null);
    // Sprint 1: fr unit toggle
    const [useFrUnits, setUseFrUnits] = useState(false);
    const [currentGridLayout, setCurrentGridLayout] = useState<import('../utils/codeGenerator').GridLayout | null>(null);

    const handleGenerate = () => {
        // HYBRID GENERATION: Try Rust first, then fallback to TS
        let generated = "";

        if ((window as any).vectraWasm) {
            try {
                generated = (window as any).vectraWasm.generate_react_code(elements, activePageId);
                console.log("Code generated using Rust Engine");
            } catch (e) {
                console.warn("Rust export failed, falling back to TS", e);
                generated = generateCode(elements, activePageId);
            }
        } else {
            generated = generateCode(elements, activePageId);
        }

        setCode(generated);
        setShowCode(true);
        setCopied(false);
    };

    const handleCopy = async () => {
        const success = await copyToClipboard(code);
        if (success) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
    };

    const togglePreview = () => {
        if (!previewMode) setSelectedId(null);
        setPreviewMode(!previewMode);
    };

    const handleReset = () => {
        if (confirm('Reset project to default? This will clear all changes.')) {
            setElements(INITIAL_DATA);
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
        }
    };

    // ── Phase F2: WASM Grid Converter ─────────────────────────────────────────
    // Collects the direct children of the active page's canvas frame,
    // strips their style values to plain numbers, calls the Rust WASM
    // absolute_to_grid() function, then generates a responsive CSS Grid page.
    const handleConvertToGrid = () => {
        if (!(window as any).vectraWasm?.absolute_to_grid) {
            setGridError(
                'Rust WASM engine is not loaded.\n\n' +
                'Compile the engine first:\n' +
                '  cd vectra-engine && wasm-pack build --target web'
            );
            setShowGridCode(true);
            setGridCode('');
            return;
        }

        setIsConvertingGrid(true);
        setGridError(null);

        try {
            // 1. Find the active page and its canvas frame
            const activePage = pages.find(p => p.id === activePageId);
            if (!activePage) throw new Error('No active page found.');

            const pageRoot = elements[activePage.rootId];
            const canvasFrameId = pageRoot?.children?.find(
                (cid: string) => elements[cid]?.type === 'webpage'
            ) || pageRoot?.children?.[0];

            if (!canvasFrameId) throw new Error('No canvas frame found on this page.');

            const canvasFrame = elements[canvasFrameId];
            const childIds: string[] = canvasFrame?.children || [];

            if (childIds.length === 0) {
                throw new Error('The canvas frame has no children to convert.');
            }

            // 2. Parse coordinates for each child — strip "px", clamp NaN to 0
            const px = (val: unknown): number => {
                const n = parseFloat(String(val || 0));
                return isNaN(n) ? 0 : n;
            };

            const gridNodes = childIds
                .map(id => {
                    const node = elements[id];
                    if (!node) return null;
                    const style = (node.props?.style as any) || {};
                    return { id, x: px(style.left), y: px(style.top), w: px(style.width), h: px(style.height) };
                })
                .filter((n): n is NonNullable<typeof n> => n !== null && n.w > 0 && n.h > 0);

            if (gridNodes.length === 0) {
                throw new Error(
                    'No nodes with valid dimensions found.\n\n' +
                    'Make sure canvas children have explicit width/height set.'
                );
            }

            const canvasWidth = px((canvasFrame.props?.style as any)?.width) || 1440;

            // 3. Call WASM — synchronous, returns JSON string
            const resultJson: string = (window as any).vectraWasm.absolute_to_grid(
                JSON.stringify(gridNodes),
                canvasWidth
            );
            const gridLayout = JSON.parse(resultJson);

            // Sprint 1: store raw layout so fr/px toggle can re-generate without WASM re-call
            setCurrentGridLayout(gridLayout);
            setUseFrUnits(false); // always reset to px on new conversion

            // 4. Generate the responsive page TSX
            const generated = generateGridPage(
                activePage,
                elements,
                gridLayout,
                framework as 'nextjs' | 'vite',
                false // start with px units
            );

            setGridCode(generated);
            setGridError(null);
            setShowGridCode(true);
            setGridCopied(false);

            const cols = gridLayout.templateColumns.split(' ').length;
            const rows = gridLayout.templateRows.split(' ').length;
            console.log(`[Vectra] ✅ Grid conversion complete — ${cols} cols × ${rows} rows`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[Vectra] Grid conversion failed:', err);
            setGridError(msg);
            setGridCode('');
            setShowGridCode(true);
        } finally {
            setIsConvertingGrid(false);
        }
    };

    // ─── Sprint 1: fr/px unit toggle ──────────────────────────────────────────
    // Re-generates the grid page with fr or px units without re-calling WASM.
    // currentGridLayout is already in memory from the previous WASM call.
    const handleFrToggle = () => {
        if (!currentGridLayout) return;
        const activePage = pages.find(p => p.id === activePageId);
        if (!activePage) return;
        const nextFr = !useFrUnits;
        setUseFrUnits(nextFr);
        const regenerated = generateGridPage(
            activePage,
            elements,
            currentGridLayout,
            framework as 'nextjs' | 'vite',
            nextFr
        );
        setGridCode(regenerated);
        setGridCopied(false); // reset — code changed
    };

    const handleExportZip = async () => {
        if (!instance || status !== 'ready') {
            alert('Virtual File System is still booting. Please wait a moment.');
            return;
        }

        setIsExporting(true);
        setExportDone(false);

        try {
            // ── PRE-EXPORT FLUSH ───────────────────────────────────────────────
            // Generate and write all page/layout files directly before reading VFS.
            // This guarantees the ZIP has the latest state even if useFileSync's
            // 600ms debounce hasn't fired yet.
            try {
                if (framework === 'nextjs') {
                    const { files } = generateNextProjectCode(elements, pages, dataSources || []);
                    for (const [path, content] of Object.entries(files)) {
                        await instance.fs.writeFile(path, content).catch(() => { });
                    }
                } else {
                    const { files } = generateProjectCode(elements, pages, dataSources || []);
                    for (const [path, content] of Object.entries(files)) {
                        await instance.fs.writeFile(path, content).catch(() => { });
                    }
                }
                console.log('[Vectra] Pre-export flush complete.');
            } catch (flushErr) {
                console.warn('[Vectra] Pre-export flush warn (non-fatal):', flushErr);
            }

            const zip = new JSZip();

            // ── Sprint 3: Grid page injection ──────────────────────────────────
            // If the user ran "Convert to Grid" this session and no error occurred,
            // inject the generated grid page TSX into a /grid/ folder in the ZIP.
            // This does NOT modify the VFS — written directly to JSZip object.
            if (gridCode && !gridError) {
                const activePage = pages.find(p => p.id === activePageId);
                const pageName = (activePage?.name || 'Page').replace(/[^a-zA-Z0-9]/g, '');
                const gridFolder = zip.folder('grid')!;
                gridFolder.file(`${pageName}Grid.tsx`, gridCode);
                const unitType = useFrUnits ? 'fr (fluid)' : 'px (fixed)';
                const colCount = (gridCode.match(/gridTemplateColumns:\s*'([^']+)'/) || [])[1]?.split(' ').length ?? '?';
                const rowCount = (gridCode.match(/gridTemplateRows:\s*'([^']+)'/) || [])[1]?.split(' ').length ?? '?';
                gridFolder.file('README.md', [
                    `# Grid Layout \u2014 ${pageName}`,
                    ``,
                    `Auto-generated by Vectra "Convert to Grid" (Phase F2).`,
                    ``,
                    `## File`,
                    `\`${pageName}Grid.tsx\` \u2014 ${colCount} columns \u00d7 ${rowCount} rows, ${unitType}`,
                    ``,
                    `## Usage`,
                    `Replace \`app/page.tsx\` (Next.js) or \`src/pages/${pageName}.tsx\` (Vite)`,
                    `with this file, or copy the grid layout styles into your existing page.`,
                    ``,
                    `## Customising tracks`,
                    `- Change \`gridTemplateColumns\` and \`gridTemplateRows\` to adjust track sizes`,
                    `- Convert px tracks to fr for fluid layouts: \`360px \u2192 0.5fr\``,
                    `- Add \`gap: '16px'\` to the container style for gutters between cells`,
                    ``,
                    `Generated: ${new Date().toISOString()}`,
                    `Framework: ${framework === 'nextjs' ? 'Next.js 14 App Router' : 'Vite + React'}`,
                ].join('\n'));
                console.log(`[Vectra] \uD83D\uDCCF Grid page injected into ZIP: grid/${pageName}Grid.tsx`);
            }
            // ── End Sprint 3 ────────────────────────────────────────────────────

            // Recursively read VFS directory → populate zip
            const addDir = async (dirPath: string, zipFolder: JSZip) => {
                const entries = await instance.fs.readdir(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    // Skip heavy / irrelevant dirs
                    if (['node_modules', '.git', '.vite', 'dist', '.next'].includes(entry.name)) continue;

                    const fullPath = dirPath === '/'
                        ? `/${entry.name}`
                        : `${dirPath}/${entry.name}`;

                    if (entry.isDirectory()) {
                        await addDir(fullPath, zipFolder.folder(entry.name)!);
                    } else {
                        const content = await instance.fs.readFile(fullPath, 'utf-8');
                        zipFolder.file(entry.name, content);
                    }
                }
            };

            const projectName = framework === 'nextjs' ? 'vectra-nextjs' : 'vectra-vite';
            console.log(`[Vectra] 📦 Building ${projectName} ZIP from VFS...`);
            await addDir('/', zip);

            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 },
            });

            saveAs(blob, `${projectName}-project.zip`);
            console.log(`[Vectra] ✅ ${projectName}-project.zip downloaded!`);

            // Show green checkmark briefly
            setExportDone(true);
            setTimeout(() => setExportDone(false), 3000);

        } catch (err) {
            console.error('[Vectra] ❌ Export failed:', err);
            alert(`Export failed: ${(err as Error).message}\n\nCheck the browser console for details.`);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <>
            {/* TOP BAR: VS Code Theme Match (#333333) */}
            <div className="h-[50px] bg-[#333333] border-b border-[#252526] flex items-center justify-between px-4 shrink-0 z-50 text-[#cccccc]">

                {/* LEFT: Branding & Reset */}
                <div className="flex items-center gap-4">
                    {/* NEW HOME BUTTON */}
                    <button
                        onClick={exitProject}
                        className="p-2 hover:bg-[#3e3e42] rounded text-[#858585] hover:text-white transition-colors"
                        title="Back to Dashboard"
                    >
                        <Home size={16} />
                    </button>

                    <div className="flex items-center gap-2">
                        <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="0" y="0" width="40" height="40" rx="10" fill="#a5b4fc" />
                            <svg x="6" y="6" width="28" height="28" viewBox="0 0 24 24">
                                <path d="M5 6L12 20" stroke="#1e1b4b" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 3" />
                                <path d="M12 20L19 6" stroke="#1e1b4b" strokeWidth="2.5" strokeLinecap="round" />
                                <circle cx="5" cy="6" r="1.5" fill="#1e1b4b" />
                                <circle cx="19" cy="6" r="1.5" fill="#1e1b4b" />
                                <rect x="10.5" y="18.5" width="3" height="3" fill="#1e1b4b" />
                            </svg>
                        </svg>
                        <div className="flex flex-col justify-center">
                            <span className="text-sm font-bold text-[#cccccc]">Vectra Project</span>
                        </div>
                    </div>

                    {/* Reset Action */}
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-[#858585] hover:text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
                        title="Reset to factory settings"
                    >
                        <RotateCcw size={10} /> Reset
                    </button>

                    {/* Phase E: Framework Badge */}
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-bold ${framework === 'nextjs'
                        ? 'bg-white/5 border-white/10 text-[#999]'
                        : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                        }`}>
                        {framework === 'nextjs' ? <Cpu size={10} /> : <Code size={10} />}
                        {framework === 'nextjs' ? 'Next.js 14' : 'Vite + React'}
                    </div>
                </div>

                {/* CENTER: View Switcher & Device Toggles */}
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-4">

                    {/* View Mode (Layout | Design)  */}
                    <div className="flex items-center bg-[#252526] rounded-md p-0.5 border border-[#3e3e42]">
                        <button
                            onClick={() => setViewMode('skeleton')}
                            className={cn(
                                "flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-medium transition-all",
                                viewMode === 'skeleton' ? "bg-[#3e3e42] text-white shadow-sm" : "text-[#858585] hover:text-[#cccccc]"
                            )}
                        >
                            <Layers size={12} /> Layout
                        </button>
                        <button
                            onClick={() => setViewMode('visual')}
                            className={cn(
                                "flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[10px] font-medium transition-all",
                                viewMode === 'visual' ? "bg-[#3e3e42] text-white shadow-sm" : "text-[#858585] hover:text-[#cccccc]"
                            )}
                        >
                            <Palette size={12} /> Design
                        </button>
                    </div>
                </div>

                {/* RIGHT: Actions */}
                <div className="flex items-center gap-2">
                    {/* History */}
                    <div className="flex items-center gap-0.5 opacity-80">
                        <button onClick={history.undo} className="p-2 hover:bg-[#3e3e42] hover:text-white rounded text-[#858585] transition-colors" title="Undo"><Undo size={14} /></button>
                        <button onClick={history.redo} className="p-2 hover:bg-[#3e3e42] hover:text-white rounded text-[#858585] transition-colors" title="Redo"><Redo size={14} /></button>
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

                    <div className="h-4 w-px bg-[#3e3e42] mx-2" />

                    {/* Export Code */}
                    <button onClick={handleGenerate} className="p-2 text-[#858585] hover:text-white hover:bg-[#3e3e42] rounded transition-colors" title="Export Code">
                        <Code size={16} />
                    </button>

                    {/* ── Phase F2: Convert to Grid ──────────────────────────────── */}
                    <button
                        id="convert-to-grid-btn"
                        onClick={handleConvertToGrid}
                        disabled={isConvertingGrid || !(window as any).vectraWasm?.absolute_to_grid}
                        title={
                            !(window as any).vectraWasm?.absolute_to_grid
                                ? 'WASM engine not loaded — run: cd vectra-engine && wasm-pack build --target web'
                                : 'Convert canvas layout to responsive CSS Grid'
                        }
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

                    {/* ── Download ZIP Button ────────────────────────────── */}
                    <button
                        onClick={handleExportZip}
                        disabled={isExporting || status !== 'ready'}
                        title={status !== 'ready' ? 'Waiting for VFS...' : 'Download production-ready ZIP'}
                        className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold transition-all border',
                            exportDone
                                ? 'bg-green-500/20 border-green-500/50 text-green-400'
                                : isExporting
                                    ? 'bg-[#252526] border-[#3e3e42] text-blue-400 cursor-wait'
                                    : 'bg-[#252526] border-[#3e3e42] text-[#858585] hover:text-white hover:border-[#007acc] disabled:opacity-40 disabled:cursor-not-allowed'
                        )}
                    >
                        {isExporting ? (
                            <><Loader2 size={12} className="animate-spin" /><span>Zipping...</span></>
                        ) : exportDone ? (
                            <><PackageCheck size={12} /><span>Downloaded!</span></>
                        ) : (
                            <><Download size={12} /><span>Export ZIP</span></>
                        )}
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
                </div>
            </div >

            {/* Code Modal (Dark Theme Adapted) */}
            {
                showCode && (
                    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-8 backdrop-blur-sm animate-fade-in">
                        <div className="bg-[#1e1e1e] w-full max-w-5xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-[#333]">
                            <div className="flex justify-between items-center p-4 border-b border-[#333] bg-[#252526]">
                                <span className="font-medium text-gray-200 flex items-center gap-2">
                                    <Code size={16} className="text-[#007acc]" /> Generated React Code
                                </span>
                                <div className="flex gap-2">
                                    <button onClick={handleCopy} className="px-3 py-1.5 bg-[#007acc] hover:bg-[#0063a5] text-white text-xs font-bold rounded flex items-center gap-2 transition-colors">
                                        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied!' : 'Copy'}
                                    </button>
                                    <button onClick={() => setShowCode(false)} className="p-1.5 hover:bg-[#3e3e42] rounded transition-colors">
                                        <X size={18} className="text-[#858585] hover:text-white" />
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-auto p-6 bg-[#1e1e1e]">
                                <pre className="text-[13px] font-mono text-[#d4d4d4] leading-relaxed whitespace-pre-wrap"><code>{code}</code></pre>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* ── Phase F2: Grid Code Modal ─────────────────────────────────────────── */}
            {showGridCode && (
                <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-8 backdrop-blur-sm animate-fade-in">
                    <div className="bg-[#1e1e1e] w-full max-w-5xl h-[85vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-[#333]">

                        {/* Modal header */}
                        <div className="flex justify-between items-center p-4 border-b border-[#333] bg-[#252526]">
                            <span className="font-medium text-gray-200 flex items-center gap-2">
                                <Grid size={16} className="text-purple-400" />
                                Responsive CSS Grid — {pages.find(p => p.id === activePageId)?.name || 'Page'}
                                {!gridError && gridCode && (
                                    <span className="text-[10px] text-[#555] font-normal font-mono ml-2">
                                        {(() => {
                                            try {
                                                const m = gridCode.match(/gridTemplateColumns: '([^']+)'/);
                                                const r = gridCode.match(/gridTemplateRows: '([^']+)'/);
                                                if (m?.[1] && r?.[1]) return `${m[1].split(' ').length} cols \u00d7 ${r[1].split(' ').length} rows`;
                                            } catch { return ''; }
                                            return '';
                                        })()}
                                    </span>
                                )}
                            </span>
                            <div className="flex gap-2">
                                {/* Sprint 1: fr/px unit toggle */}
                                {!gridError && currentGridLayout && (
                                    <button
                                        onClick={handleFrToggle}
                                        title={useFrUnits ? 'Switch to fixed pixel tracks' : 'Switch to fluid fr units (responsive)'}
                                        className={cn(
                                            'flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold border transition-all',
                                            useFrUnits
                                                ? 'bg-purple-500/20 border-purple-500/40 text-purple-300 hover:bg-purple-500/30'
                                                : 'bg-[#2d2d2d] border-[#3e3e42] text-[#666] hover:text-[#999] hover:border-[#555]'
                                        )}
                                    >
                                        <span className={cn(
                                            'w-6 h-3 rounded-full flex items-center transition-colors px-0.5',
                                            useFrUnits ? 'bg-purple-500 justify-end' : 'bg-[#444] justify-start'
                                        )}>
                                            <span className="w-2 h-2 rounded-full bg-white shadow-sm" />
                                        </span>
                                        <span>{useFrUnits ? 'fr units' : 'px units'}</span>
                                    </button>
                                )}
                                {!gridError && gridCode && (
                                    <button
                                        onClick={async () => {
                                            const ok = await copyToClipboard(gridCode);
                                            if (ok) { setGridCopied(true); setTimeout(() => setGridCopied(false), 2000); }
                                        }}
                                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded flex items-center gap-2 transition-colors"
                                    >
                                        {gridCopied ? <><Check size={12} />Copied!</> : <><Copy size={12} />Copy</>}
                                    </button>
                                )}
                                <button
                                    onClick={() => { setShowGridCode(false); setGridError(null); }}
                                    className="p-1.5 hover:bg-[#3e3e42] rounded text-[#858585] hover:text-white transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Modal body */}
                        <div className="flex-1 overflow-auto">
                            {gridError ? (
                                <div className="p-6">
                                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-4">
                                        <p className="text-red-400 text-xs font-bold mb-2 flex items-center gap-2">
                                            <X size={12} /> Conversion failed
                                        </p>
                                        <pre className="text-red-300/80 text-[11px] font-mono whitespace-pre-wrap leading-relaxed">{gridError}</pre>
                                    </div>
                                    <div className="p-3 bg-[#252526] border border-[#3e3e42] rounded text-[10px] text-[#666] font-mono space-y-1">
                                        <p className="text-[#888] font-bold mb-1">Checklist:</p>
                                        <p>• Canvas frame children must have explicit left / top / width / height</p>
                                        <p>• WASM must be compiled: cd vectra-engine &amp;&amp; wasm-pack build --target web</p>
                                        <p>• Elements must use absolute layout (canvas layoutMode nodes)</p>
                                    </div>
                                </div>
                            ) : (
                                <pre className="p-6 text-[#d4d4d4] text-xs font-mono leading-relaxed whitespace-pre overflow-x-auto h-full">
                                    <code>{gridCode}</code>
                                </pre>
                            )}
                        </div>

                        {/* Modal footer */}
                        {!gridError && gridCode && (
                            <div className="px-4 py-2 border-t border-[#333] bg-[#1a1a1a] flex items-center gap-3">
                                <span className="text-[10px] text-[#555]">
                                    Replace <code className="text-[#777]">app/page.tsx</code> with this file, or adapt it for responsive redesign.
                                </span>
                                <span className="ml-auto text-[9px] text-[#444] font-mono">Phase F2 — Rust WASM Grid Engine</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

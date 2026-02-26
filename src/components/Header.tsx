import { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useEditor } from '../context/EditorContext';
import { useContainer } from '../context/ContainerContext';
import { generateCode, copyToClipboard } from '../utils/codeGenerator';
import { INITIAL_DATA, STORAGE_KEY } from '../data/constants';
import {
    Play, Undo, Redo, Code,
    Check, X, Copy, Trash2,
    Layers, Palette, RotateCcw, Home, Wand2, Download, Loader2, PackageCheck
} from 'lucide-react';

import { cn } from '../lib/utils';

export const Header = () => {
    const {
        history, previewMode, setPreviewMode, elements, setElements,
        activePageId, setSelectedId, viewMode, setViewMode, selectedId,
        deleteElement, exitProject, setMagicBarOpen,
    } = useEditor();

    const { instance, status } = useContainer();
    const [showCode, setShowCode] = useState(false);
    const [code, setCode] = useState('');
    const [copied, setCopied] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportDone, setExportDone] = useState(false);

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

    // ─── ZIP EXPORTER ──────────────────────────────────────────────────────────
    // Recursively walks the WebContainer VFS, collects every file (excluding
    // node_modules and .git), and bundles them into a downloadable .zip.
    // Because useFileSync has already written real .tsx files there, the zip
    // contains a 100% production-ready Vite + React project.
    const handleExportZip = async () => {
        if (!instance || status !== 'ready') {
            alert('Virtual File System is still booting. Please wait a moment.');
            return;
        }

        setIsExporting(true);
        setExportDone(false);

        try {
            const zip = new JSZip();

            // Recursively read VFS directory → populate zip
            const addDir = async (dirPath: string, zipFolder: JSZip) => {
                const entries = await instance.fs.readdir(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    // Skip heavy / irrelevant dirs
                    if (['node_modules', '.git', '.vite', 'dist'].includes(entry.name)) continue;

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

            console.log('[Vectra] 📦 Building production ZIP from VFS...');
            await addDir('/', zip);

            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 },
            });

            saveAs(blob, 'vectra-project.zip');
            console.log('[Vectra] ✅ vectra-project.zip downloaded successfully!');

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
        </>
    );
};

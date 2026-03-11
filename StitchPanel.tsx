/**
 * ─── STITCH IMPORT PANEL v2 ───────────────────────────────────────────────────
 * STI-1 — Full Page Import UI.
 *
 * Change Log v2:
 * ADDED: Page name + slug editor step between preview and import
 * ADDED: Node type breakdown — visual count bars per element type
 * ADDED: CSS preview — collapsible first 14 lines before injection
 * RESOLVED: STI-FUTURE-2 — framework-aware CSS path (nextjs / vite)
 * ADDED: Warning expander — each warning shown individually, collapsible
 * PRESERVED: STI-SAFE-1,2,3, STI-CSS-1, STI-INJECT-1, STI-PAGE-1 (unchanged)
 *
 * KEY INTEGRATION POINTS
 * ───────────────────────
 * • parseZipToVectraPage() — zipImporter.ts (pure parser)
 * • importPage()           — ProjectContext (atomic: merge + register + navigate)
 * • addAsset()             — UIContext (via useEditor)
 * • instance.fs.*          — ContainerContext (CSS injection → globals.css / index.css)
 * • framework              — useEditor() (STI-FUTURE-2: branch CSS path)
 *
 * STI-INJECT-1 [PERMANENT]: CSS injection is APPEND-ONLY.
 *   Never overwrite globals.css or index.css. These contain critical Tailwind directives.
 *
 * STI-FUTURE-2 [RESOLVED]: CSS path now branches on framework:
 *   Next.js → /app/globals.css
 *   Vite    → /src/index.css
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
    Upload, FileArchive, CheckCircle2, AlertTriangle,
    XCircle, Loader2, Layers, ImageIcon, Palette,
    ChevronRight, ChevronDown, Code2, Type, Box,
    Edit2, RefreshCw,
} from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { useContainer } from '../../context/ContainerContext';
import { parseZipToVectraPage, type ZipImportResult } from '../../utils/zipImporter';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportStep = 'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error';

interface ParsedPreview {
    result: ZipImportResult;
    nodeCount: number;
    topLevelCount: number;
    cssSize: string;
    imageCount: number;
    typeCounts: Record<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const slugify = (name: string): string =>
    '/' + name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'imported';

const TYPE_COLORS: Record<string, string> = {
    container: 'bg-blue-500/40',
    text:      'bg-emerald-500/40',
    heading:   'bg-purple-500/40',
    image:     'bg-orange-500/40',
    button:    'bg-pink-500/40',
    section:   'bg-cyan-500/40',
    webpage:   'bg-zinc-500/40',
};

const TYPE_LABELS: Record<string, string> = {
    container: 'Container',
    text:      'Text',
    heading:   'Heading',
    image:     'Image',
    button:    'Button',
    section:   'Section',
    webpage:   'Webpage',
};

// ─── Component ────────────────────────────────────────────────────────────────

export const StitchPanel: React.FC = () => {
    const { importPage, addAsset, framework } = useEditor();
    const { instance, status: vfsStatus }   = useContainer();

    const [step, setStep]       = useState<ImportStep>('idle');
    const [preview, setPreview] = useState<ParsedPreview | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [importLog, setImportLog]   = useState<string[]>([]);

    // Name / slug editing
    const [pageName, setPageName]       = useState('');
    const [pageSlug, setPageSlug]       = useState('');
    const [slugManual, setSlugManual]   = useState(false);

    // CSS preview toggle
    const [cssOpen, setCssOpen]         = useState(false);
    const [warningsOpen, setWarningsOpen] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const log = useCallback((msg: string) => {
        setImportLog(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]);
    }, []);

    // STI-FUTURE-2 [RESOLVED]: branch CSS path on framework
    const cssPath = useMemo(() => {
        return (framework as string) === 'vite' ? '/src/index.css' : '/app/globals.css';
    }, [framework]);

    // ── CSS Injection (STI-INJECT-1: append-only) ─────────────────────────────
    const injectCSS = useCallback(async (css: string) => {
        if (!css.trim()) return;
        const MARKER = '/* ─── STI-1 Imported Styles ─── */';
        try {
            if (vfsStatus === 'ready' && instance) {
                let existing = '';
                try { existing = await instance.fs.readFile(cssPath, 'utf-8'); }
                catch { /* file may not exist yet */ }

                if (!existing.includes(MARKER)) {
                    await instance.fs.writeFile(cssPath, `${existing}\n\n${MARKER}\n${css}`);
                } else {
                    const markerIdx = existing.indexOf(MARKER);
                    const base = existing.slice(0, markerIdx);
                    await instance.fs.writeFile(cssPath, `${base}${MARKER}\n${css}`);
                }
                log(`✅ CSS appended → ${cssPath}`);
            } else {
                try { localStorage.setItem('vectra_stitch_css', css); } catch { /* ok */ }
                log(`⚠️ VFS not ready — CSS staged for next boot`);
            }
        } catch (err) {
            log(`⚠️ CSS injection failed: ${(err as Error).message}`);
        }
    }, [instance, vfsStatus, cssPath, log]);

    // ── Count node types ──────────────────────────────────────────────────────
    const countTypes = (result: ZipImportResult): Record<string, number> => {
        const counts: Record<string, number> = {};
        for (const node of Object.values(result.nodes)) {
            const t = node.type ?? 'container';
            counts[t] = (counts[t] ?? 0) + 1;
        }
        return counts;
    };

    // ── Parse ZIP ─────────────────────────────────────────────────────────────
    const handleFile = useCallback(async (file: File) => {
        if (!file.name.match(/\.zip$/i)) {
            setErrorMsg('Only .zip files are supported.');
            setStep('error');
            return;
        }

        setStep('parsing');
        setErrorMsg('');
        setImportLog([]);
        setPreview(null);
        setCssOpen(false);
        setWarningsOpen(false);

        try {
            log(`Parsing ${file.name}…`);
            const result = await parseZipToVectraPage(file);
            const nodeCount    = Object.keys(result.nodes).length;
            const topLevelCount = result.nodes[result.rootId]?.children?.length ?? 0;
            const cssSize      = formatBytes(new Blob([result.css]).size);
            const typeCounts   = countTypes(result);

            log(`✅ ${nodeCount} nodes · ${topLevelCount} sections · ${result.imageAssets.length} images`);
            result.warnings.forEach(w => log(`⚠️ ${w}`));

            // Pre-fill editable name / slug
            setPageName(result.pageName);
            setPageSlug(slugify(result.pageName));
            setSlugManual(false);

            setPreview({ result, nodeCount, topLevelCount, cssSize, imageCount: result.imageAssets.length, typeCounts });
            setStep('preview');
        } catch (err) {
            const msg = (err as Error).message;
            setErrorMsg(msg);
            log(`❌ ${msg}`);
            setStep('error');
        }
    }, [log]);

    // ── Confirm Import ────────────────────────────────────────────────────────
    const confirmImport = useCallback(async () => {
        if (!preview) return;
        setStep('importing');

        const { result } = preview;
        const finalSlug = pageSlug.startsWith('/') ? pageSlug : `/${pageSlug}`;

        try {
            // 1. Register image assets (non-blocking)
            if (result.imageAssets.length > 0) {
                log(`Registering ${result.imageAssets.length} image asset(s)…`);
                for (const asset of result.imageAssets) addAsset(asset.file);
                log('✅ Assets registered');
            }

            // 2. Inject CSS (STI-INJECT-1: append-only)
            if (result.css.trim()) {
                log(`Injecting CSS → ${cssPath}…`);
                await injectCSS(result.css);
            }

            // 3. STI-PAGE-1: atomic importPage()
            log(`Importing page "${pageName}"…`);
            importPage({
                nodes: result.nodes,
                rootId: result.rootId,
                pageName,
                slug: finalSlug,
            });
            log('✅ Page imported and activated');

            setStep('done');
        } catch (err) {
            const msg = (err as Error).message;
            setErrorMsg(msg);
            log(`❌ ${msg}`);
            setStep('error');
        }
    }, [preview, pageName, pageSlug, addAsset, injectCSS, importPage, cssPath, log]);

    // ── Drag & drop handlers ──────────────────────────────────────────────────
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleReset = useCallback(() => {
        setStep('idle');
        setPreview(null);
        setErrorMsg('');
        setImportLog([]);
        setPageName('');
        setPageSlug('');
        setCssOpen(false);
        setWarningsOpen(false);
    }, []);

    // ─── CSS preview lines ────────────────────────────────────────────────────
    const cssPreviewLines = useMemo(() => {
        if (!preview?.result.css) return [];
        return preview.result.css.split('\n').filter(l => l.trim()).slice(0, 14);
    }, [preview]);

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full text-[#ccc] select-none">

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="px-3 pt-3 pb-2.5 border-b border-[#2c2c2e] shrink-0">
                <div className="flex items-center gap-2 mb-1">
                    <Layers size={13} className="text-blue-400" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">Stitch Import</span>
                    <span className="ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-blue-500/10 text-blue-400">
                        {(framework as string) === 'vite' ? 'Vite' : 'Next.js'}
                    </span>
                </div>
                <p className="text-[9px] text-[#48484a] leading-relaxed">
                    Drop a ZIP export (HTML + CSS + images) to import it as a new page.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">

                {/* ── Idle / Drop Zone ──────────────────────────────────────── */}
                {(step === 'idle' || step === 'error') && (
                    <div className="p-3 space-y-3">
                        <div
                            onDrop={handleDrop}
                            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                            onDragLeave={() => setIsDragOver(false)}
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                                'border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all',
                                isDragOver
                                    ? 'border-blue-500/60 bg-blue-500/5'
                                    : 'border-[#2c2c2e] hover:border-[#3a3a3c] hover:bg-[#1c1c1e]'
                            )}
                        >
                            <FileArchive size={28} className={isDragOver ? 'text-blue-400' : 'text-[#3a3a3c]'} />
                            <div className="text-center">
                                <p className="text-[11px] font-semibold text-[#636366] mb-0.5">
                                    {isDragOver ? 'Drop ZIP to import' : 'Drop ZIP or click to browse'}
                                </p>
                                <p className="text-[9px] text-[#3a3a3c]">Supports HTML, CSS, images</p>
                            </div>
                        </div>
                        <input ref={fileInputRef} type="file" accept=".zip" className="hidden"
                            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

                        {step === 'error' && errorMsg && (
                            <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                                <XCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
                                <span className="text-[10px] text-red-300 font-mono break-all">{errorMsg}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Parsing ───────────────────────────────────────────────── */}
                {step === 'parsing' && (
                    <div className="flex flex-col items-center gap-3 py-12 px-4">
                        <Loader2 size={24} className="text-blue-400 animate-spin" />
                        <p className="text-[11px] font-semibold text-[#636366]">Parsing ZIP…</p>
                        <div className="w-full space-y-0.5 max-h-24 overflow-y-auto">
                            {importLog.map((l, i) => (
                                <div key={i} className="text-[9px] font-mono text-[#48484a]">{l}</div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Preview ───────────────────────────────────────────────── */}
                {step === 'preview' && preview && (
                    <div className="p-3 space-y-3">
                        {/* Stat pills */}
                        <div className="grid grid-cols-3 gap-1.5">
                            {[
                                { label: 'Nodes',    value: preview.nodeCount,    icon: Box },
                                { label: 'Sections', value: preview.topLevelCount, icon: Layers },
                                { label: 'Images',   value: preview.imageCount,   icon: ImageIcon },
                            ].map(({ label, value, icon: Icon }) => (
                                <div key={label} className="flex flex-col items-center gap-0.5 bg-[#1c1c1e] border border-[#2c2c2e] rounded-xl py-2">
                                    <Icon size={12} className="text-[#636366]" />
                                    <span className="text-[13px] font-bold text-white">{value}</span>
                                    <span className="text-[8px] text-[#48484a] uppercase tracking-wide">{label}</span>
                                </div>
                            ))}
                        </div>

                        {/* Node type breakdown */}
                        {Object.keys(preview.typeCounts).length > 0 && (
                            <div className="space-y-1.5">
                                <span className="text-[9px] font-bold text-[#636366] uppercase tracking-wider">Node Types</span>
                                {Object.entries(preview.typeCounts)
                                    .sort(([, a], [, b]) => b - a)
                                    .slice(0, 6)
                                    .map(([type, count]) => {
                                        const maxCount = Math.max(...Object.values(preview.typeCounts));
                                        const pct = Math.round((count / maxCount) * 100);
                                        return (
                                            <div key={type} className="flex items-center gap-2">
                                                <span className="text-[9px] font-mono text-[#636366] w-16 truncate shrink-0">
                                                    {TYPE_LABELS[type] ?? type}
                                                </span>
                                                <div className="flex-1 h-1.5 bg-[#1c1c1e] rounded-full overflow-hidden">
                                                    <div
                                                        className={cn('h-full rounded-full', TYPE_COLORS[type] ?? 'bg-zinc-500/40')}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                                <span className="text-[9px] text-[#48484a] w-5 text-right shrink-0">{count}</span>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}

                        {/* CSS preview */}
                        {cssPreviewLines.length > 0 && (
                            <div className="rounded-xl overflow-hidden border border-[#2c2c2e]">
                                <button onClick={() => setCssOpen(p => !p)}
                                    className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#1c1c1e] text-[9px] font-bold text-[#636366] hover:text-[#aeaeb2] transition-colors">
                                    <span className="flex items-center gap-1.5"><Code2 size={9} /> CSS Preview ({preview.cssSize})</span>
                                    {cssOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                </button>
                                {cssOpen && (
                                    <div className="bg-[#0e0e10] px-2.5 py-2 max-h-24 overflow-y-auto custom-scrollbar">
                                        {cssPreviewLines.map((line, i) => (
                                            <div key={i} className="text-[9px] font-mono text-[#48484a] leading-relaxed whitespace-pre-wrap">{line}</div>
                                        ))}
                                        {preview.result.css.split('\n').filter(l => l.trim()).length > 14 && (
                                            <div className="text-[8px] text-[#3a3a3c] mt-1">
                                                +{preview.result.css.split('\n').filter(l => l.trim()).length - 14} more lines…
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Warnings */}
                        {preview.result.warnings.length > 0 && (
                            <div className="rounded-xl overflow-hidden border border-yellow-500/20">
                                <button onClick={() => setWarningsOpen(p => !p)}
                                    className="w-full flex items-center justify-between px-2.5 py-1.5 bg-yellow-500/5 text-[9px] font-bold text-yellow-500/80 hover:text-yellow-400 transition-colors">
                                    <span className="flex items-center gap-1.5">
                                        <AlertTriangle size={9} /> {preview.result.warnings.length} Warning{preview.result.warnings.length !== 1 ? 's' : ''}
                                    </span>
                                    {warningsOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                </button>
                                {warningsOpen && (
                                    <div className="bg-[#0e0e10] px-2.5 py-2 space-y-1.5">
                                        {preview.result.warnings.map((w, i) => (
                                            <div key={i} className="flex items-start gap-1.5">
                                                <span className="text-yellow-500/60 mt-0.5 shrink-0">⚠</span>
                                                <span className="text-[9px] text-yellow-400/70 leading-relaxed">{w}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Name + Slug editor ─────────────────────────────── */}
                        <div className="border border-[#2c2c2e] rounded-xl p-2.5 space-y-2 bg-[#161618]">
                            <div className="flex items-center gap-1.5 mb-1">
                                <Edit2 size={9} className="text-[#636366]" />
                                <span className="text-[9px] font-bold text-[#636366] uppercase tracking-wider">Page Name & Slug</span>
                            </div>
                            <div>
                                <label className="block text-[9px] text-[#48484a] mb-0.5">Page Name</label>
                                <input
                                    value={pageName}
                                    onChange={e => {
                                        setPageName(e.target.value);
                                        if (!slugManual) setPageSlug(slugify(e.target.value));
                                    }}
                                    className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1 text-[10px] text-zinc-300 outline-none focus:border-blue-500/40"
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] text-[#48484a] mb-0.5">URL Slug</label>
                                <input
                                    value={pageSlug}
                                    onChange={e => {
                                        setSlugManual(true);
                                        setPageSlug(e.target.value.startsWith('/') ? e.target.value : `/${e.target.value}`);
                                    }}
                                    className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1 text-[10px] font-mono text-zinc-300 outline-none focus:border-blue-500/40"
                                />
                            </div>
                        </div>

                        {/* CSS path info */}
                        <p className="text-[8px] text-[#3a3a3c] leading-relaxed px-0.5">
                            CSS will be appended (append-only) to <code className="text-[#48484a]">{cssPath}</code>
                        </p>

                        {/* Actions */}
                        <div className="flex gap-2">
                            <button onClick={handleReset}
                                className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-[#636366] hover:text-[#aeaeb2] border border-[#3a3a3c] transition-colors">
                                Cancel
                            </button>
                            <button onClick={confirmImport}
                                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all">
                                <Upload size={10} /> Import Page
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Importing ─────────────────────────────────────────────── */}
                {step === 'importing' && (
                    <div className="flex flex-col items-center gap-3 py-12 px-4">
                        <Loader2 size={24} className="text-blue-400 animate-spin" />
                        <p className="text-[11px] font-semibold text-[#636366]">Importing…</p>
                        <div className="w-full space-y-0.5 max-h-32 overflow-y-auto">
                            {importLog.map((l, i) => (
                                <div key={i} className={cn(
                                    'text-[9px] font-mono',
                                    l.includes('❌') ? 'text-red-400'
                                    : l.includes('✅') ? 'text-emerald-400'
                                    : l.includes('⚠️') ? 'text-yellow-400'
                                    : 'text-[#48484a]'
                                )}>{l}</div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Done ──────────────────────────────────────────────────── */}
                {step === 'done' && (
                    <div className="p-4 space-y-3">
                        <div className="flex flex-col items-center gap-2 py-6">
                            <CheckCircle2 size={28} className="text-emerald-400" />
                            <p className="text-[13px] font-bold text-white">Page Imported</p>
                            <p className="text-[10px] text-[#636366] text-center">
                                <span className="text-white font-semibold">{pageName}</span> is now active in the canvas.
                            </p>
                            <p className="text-[9px] font-mono text-[#48484a]">{pageSlug}</p>
                        </div>
                        <button onClick={handleReset}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold bg-[#2c2c2e] hover:bg-[#3a3a3c] text-[#aeaeb2] transition-colors">
                            <RefreshCw size={10} /> Import Another
                        </button>
                        {/* Log */}
                        <div className="space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                            {importLog.map((l, i) => (
                                <div key={i} className={cn('text-[9px] font-mono', l.includes('✅') ? 'text-emerald-400' : 'text-[#48484a]')}>{l}</div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StitchPanel;

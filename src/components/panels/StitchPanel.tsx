/**
 * ─── STITCH IMPORT PANEL ──────────────────────────────────────────────────────
 * STI-1 — Full Page Import UI.
 *
 * Flow: Drop ZIP → parse → preview summary → confirm → page created + CSS injected.
 *
 * KEY INTEGRATION POINTS
 * ───────────────────────
 * • parseZipToVectraPage() — zipImporter.ts (pure parser)
 * • importPage()           — ProjectContext  (atomic: merge + register + navigate)
 * • addAsset()             — UIContext (via useEditor)
 * • instance.fs.*          — ContainerContext (CSS injection → globals.css)
 *
 * STI-INJECT-1 [PERMANENT]: CSS injection is APPEND-ONLY.
 *   Never overwrite globals.css. Contains critical Tailwind @tailwind directives.
 *
 * STI-FUTURE-2 [DEFERRED]: CSS path should branch on framework.
 *   Next.js → '/app/globals.css'  |  Vite → '/src/index.css'
 *   Currently hardcoded to Next.js path. Branch when framework is stable in context.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
    Upload, FileArchive, CheckCircle2, AlertTriangle,
    XCircle, Loader2, Layers, ImageIcon, Palette, ChevronRight,
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
}

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export const StitchPanel: React.FC = () => {
    const { importPage, addAsset } = useEditor();
    const { instance, status: vfsStatus } = useContainer();

    const [step, setStep] = useState<ImportStep>('idle');
    const [preview, setPreview] = useState<ParsedPreview | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [importLog, setImportLog] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const log = useCallback((msg: string) => {
        setImportLog(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]);
    }, []);

    // ── CSS Injection (STI-INJECT-1: append-only) ─────────────────────────────
    const injectCSS = useCallback(async (css: string) => {
        if (!css.trim()) return;

        // STI-FUTURE-2: branch on framework later
        const globalsPath = '/app/globals.css';
        const MARKER = '/* ─── STI-1 Imported Styles ─── */';

        try {
            if (vfsStatus === 'ready' && instance) {
                let existing = '';
                try { existing = await instance.fs.readFile(globalsPath, 'utf-8'); }
                catch { /* file may not exist */ }

                if (!existing.includes(MARKER)) {
                    await instance.fs.writeFile(globalsPath, `${existing}\n\n${MARKER}\n${css}`);
                } else {
                    // Replace the block after the marker (keep Tailwind directives above it)
                    const markerIdx = existing.indexOf(MARKER);
                    const base = existing.slice(0, markerIdx);
                    await instance.fs.writeFile(globalsPath, `${base}${MARKER}\n${css}`);
                }
                log('✅ CSS appended to globals.css');
            } else {
                // Stage for later — VFS not ready
                try { localStorage.setItem('vectra_stitch_css', css); }
                catch { /* storage unavailable */ }
                log('⚠️ VFS not ready — CSS staged for next boot');
            }
        } catch (err) {
            log(`⚠️ CSS injection failed: ${(err as Error).message}`);
            // Non-fatal — import continues without CSS
        }
    }, [instance, vfsStatus, log]);

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

        try {
            log(`Parsing ${file.name}…`);
            const result = await parseZipToVectraPage(file);
            const nodeCount = Object.keys(result.nodes).length;
            const topLevelCount = result.nodes[result.rootId]?.children?.length ?? 0;
            const cssSize = formatBytes(new Blob([result.css]).size);

            log(`✅ ${nodeCount} nodes · ${topLevelCount} sections · ${result.imageAssets.length} images`);
            result.warnings.forEach(w => log(`⚠️ ${w}`));

            setPreview({ result, nodeCount, topLevelCount, cssSize, imageCount: result.imageAssets.length });
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
        const slug = `/${result.pageName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;

        try {
            // 1. Register image assets (non-blocking)
            if (result.imageAssets.length > 0) {
                log(`Registering ${result.imageAssets.length} image asset(s)…`);
                for (const asset of result.imageAssets) {
                    addAsset(asset.file);
                }
                log(`✅ Assets registered`);
            }

            // 2. Inject CSS
            if (result.css.trim()) {
                log('Injecting CSS into globals.css…');
                await injectCSS(result.css);
            }

            // 3. importPage() — atomic: merges nodes, registers page, navigates
            log(`Wiring ${Object.keys(result.nodes).length} nodes…`);
            importPage(result.pageName, slug, result.nodes, result.rootId);

            log(`✅ Import complete — page "${result.pageName}" is now active`);
            setStep('done');
        } catch (err) {
            const msg = (err as Error).message;
            setErrorMsg(msg);
            log(`❌ ${msg}`);
            setStep('error');
        }
    }, [preview, importPage, addAsset, injectCSS, log]);

    // ── Drop handlers ─────────────────────────────────────────────────────────
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const reset = useCallback(() => {
        setStep('idle');
        setPreview(null);
        setErrorMsg('');
        setImportLog([]);
    }, []);

    // ─── RENDER ──────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">

            {/* Description */}
            <div className="px-4 pt-3 pb-2 border-b border-[#2c2c2e]">
                <p className="text-[10px] text-[#48484a] leading-relaxed">
                    Drop a <span className="text-blue-400 font-mono">.zip</span> export from Webflow, Framer,
                    Bootstrap, or any static HTML site. Structure is converted to an editable Vectra page.
                </p>
            </div>

            <div className="flex-1 p-4 space-y-4 pb-16">

                {/* IDLE — Drop Zone */}
                {step === 'idle' && (
                    <div
                        onDrop={handleDrop}
                        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                        onDragLeave={() => setIsDragOver(false)}
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                            'border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-4',
                            'text-center cursor-pointer transition-all duration-200',
                            isDragOver
                                ? 'border-blue-400 bg-blue-500/10 scale-[1.01]'
                                : 'border-[#3a3a3c] hover:border-blue-500/40 hover:bg-blue-500/5'
                        )}
                    >
                        <input ref={fileInputRef} type="file" accept=".zip" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); if (fileInputRef.current) fileInputRef.current.value = ''; }} />

                        <div className={cn(
                            'w-14 h-14 rounded-2xl flex items-center justify-center transition-colors',
                            isDragOver ? 'bg-blue-500/20 text-blue-400' : 'bg-[#2c2c2e] text-[#48484a]'
                        )}>
                            <Upload size={26} />
                        </div>

                        <div>
                            <p className="text-[13px] font-semibold text-[#e5e5ea]">Drop ZIP file here</p>
                            <p className="text-[11px] text-[#48484a] mt-0.5">or click to browse</p>
                        </div>

                        <div className="flex flex-wrap justify-center gap-1.5">
                            {['Webflow Export', 'Framer Export', 'Bootstrap', 'Custom HTML'].map(label => (
                                <span key={label} className="px-2 py-0.5 bg-[#2c2c2e] border border-[#3a3a3c] rounded text-[9px] text-[#48484a]">
                                    {label}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* PARSING — spinner */}
                {step === 'parsing' && (
                    <div className="flex flex-col items-center gap-3 py-12">
                        <Loader2 size={30} className="animate-spin text-blue-400" />
                        <p className="text-[12px] text-[#636366]">Parsing ZIP file…</p>
                    </div>
                )}

                {/* PREVIEW — summary + confirm */}
                {step === 'preview' && preview && (
                    <div className="space-y-3">
                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2">
                            {([
                                { Icon: Layers, label: 'Nodes', value: String(preview.nodeCount), color: 'text-blue-400' },
                                { Icon: ChevronRight, label: 'Sections', value: String(preview.topLevelCount), color: 'text-violet-400' },
                                { Icon: Palette, label: 'CSS', value: preview.cssSize, color: 'text-emerald-400' },
                                { Icon: ImageIcon, label: 'Images', value: String(preview.imageCount), color: 'text-orange-400' },
                            ] as const).map(({ Icon, label, value, color }) => (
                                <div key={label} className="bg-[#1c1c1e] border border-[#2c2c2e] rounded-xl p-3 flex items-center gap-2.5">
                                    <Icon size={14} className={color} />
                                    <div>
                                        <div className="text-[9px] text-[#48484a] uppercase tracking-wider">{label}</div>
                                        <div className="text-[12px] font-bold text-white">{value}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Page name */}
                        <div className="bg-[#1c1c1e] border border-[#2c2c2e] rounded-xl p-3">
                            <div className="text-[9px] text-[#48484a] uppercase tracking-wider mb-1">New Page</div>
                            <div className="text-[13px] font-semibold text-white truncate">{preview.result.pageName}</div>
                        </div>

                        {/* Warnings */}
                        {preview.result.warnings.length > 0 && (
                            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-1.5">
                                {preview.result.warnings.map((w, i) => (
                                    <div key={i} className="flex items-start gap-2 text-[11px] text-amber-400/90">
                                        <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                                        <span>{w}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2">
                            <button onClick={reset}
                                className="flex-1 py-2 rounded-lg text-[11px] border border-[#3a3a3c] text-[#636366] hover:text-[#aeaeb2] transition-colors">
                                Cancel
                            </button>
                            <button onClick={confirmImport}
                                className="flex-1 py-2 rounded-lg text-[11px] font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors flex items-center justify-center gap-1.5">
                                <FileArchive size={12} /> Import Page
                            </button>
                        </div>
                    </div>
                )}

                {/* LOG — shown when importing or done with log */}
                {(step === 'importing' || (step === 'done' && importLog.length > 0)) && (
                    <div className="bg-[#0d0d0f] border border-[#2c2c2e] rounded-xl p-3 font-mono space-y-1 max-h-52 overflow-y-auto custom-scrollbar">
                        {importLog.map((line, i) => (
                            <div key={i} className="text-[10px] text-[#636366] leading-relaxed">{line}</div>
                        ))}
                        {step === 'importing' && (
                            <div className="flex items-center gap-1.5 pt-1">
                                <Loader2 size={10} className="animate-spin text-blue-400" />
                                <span className="text-[10px] text-blue-400">importing…</span>
                            </div>
                        )}
                    </div>
                )}

                {/* DONE */}
                {step === 'done' && (
                    <div className="flex flex-col items-center gap-3 py-8">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                            <CheckCircle2 size={28} className="text-emerald-400" />
                        </div>
                        <div className="text-center">
                            <p className="text-[13px] font-bold text-white">Import complete</p>
                            <p className="text-[11px] text-[#636366] mt-0.5">Page created and now active</p>
                        </div>
                        <button onClick={reset}
                            className="px-4 py-1.5 rounded-lg text-[11px] border border-[#3a3a3c] text-[#636366] hover:text-[#aeaeb2] transition-colors">
                            Import another
                        </button>
                    </div>
                )}

                {/* ERROR */}
                {step === 'error' && (
                    <div className="space-y-3">
                        <div className="bg-red-500/10 border border-red-500/25 rounded-xl p-4 flex items-start gap-3">
                            <XCircle size={15} className="text-red-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-[11px] font-bold text-red-400 mb-1">Import Failed</p>
                                <p className="text-[10px] text-[#636366] font-mono break-all">{errorMsg}</p>
                            </div>
                        </div>
                        <button onClick={reset}
                            className="w-full py-2 rounded-lg text-[11px] border border-[#3a3a3c] text-[#636366] hover:text-[#aeaeb2] transition-colors">
                            Try Again
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StitchPanel;

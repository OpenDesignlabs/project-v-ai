/**
 * --- FIGMA PANEL ------------------------------------------------------------
 * Left-sidebar panel for importing designs from Figma.
 * Accepts a Figma file URL + personal access token, calls the Figma REST API
 * (via figmaProxy.ts to bypass CORS), and converts the Figma node tree into
 * Vectra canvas elements using figmaImporter.ts.
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
    Figma, Link, Key, Loader2,
    CheckCircle2, XCircle, AlertTriangle,
    Layout, Box, RefreshCw, Eye, EyeOff,
    Search, X,
} from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { useContainer } from '../../context/ContainerContext';
import { useProject } from '../../context/ProjectContext';
import { ensureProxy, figmaFetch, resetProxy } from '../../utils/figma/figmaProxy';
import {
    extractFileKey,
    extractTopLevelFrames,
    transformFigmaFrame,
    applyImageFills,
    findNodeById,
    type FigmaFrameInfo,
    type FigmaFileResponse,
    type FigmaImageResponse,
    type FigmaTransformResult,
} from '../../utils/figma/figmaImporter';
import { cn } from '../../lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIGMA_TOKEN_KEY = 'vectra_figma_token'; // sessionStorage only — FIGMA-SEC-1

// ─── Types ────────────────────────────────────────────────────────────────────

type PanelStep = 'connect' | 'booting_proxy' | 'fetching' | 'pick' | 'importing' | 'done' | 'error';

interface FrameSelection {
    info: FigmaFrameInfo;
    mode: 'page' | 'component';
    selected: boolean;
}

interface ImportProgress {
    frameId: string;
    frameName: string;
    status: 'pending' | 'running' | 'done' | 'error';
    message?: string;
}

interface ImportSummary {
    pagesCreated: number;
    componentsCreated: number;
    totalNodes: number;
    frameNames: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FigmaPanel: React.FC = () => {
    const { registerComponent } = useEditor();
    const { importPage }        = useProject();
    const { instance, status: vfsStatus } = useContainer();

    // ── Auth state ────────────────────────────────────────────────────────────
    const [token, setToken]       = useState<string>(() => sessionStorage.getItem(FIGMA_TOKEN_KEY) ?? '');
    const [fileUrl, setFileUrl]   = useState('');
    const [showToken, setShowToken] = useState(false);

    // ── Panel state ───────────────────────────────────────────────────────────
    const [step, setStep]         = useState<PanelStep>('connect');
    const [errorMsg, setErrorMsg] = useState('');
    const [importLog, setImportLog] = useState<string[]>([]);
    const [fileName, setFileName] = useState('');

    // ── Frame selection ───────────────────────────────────────────────────────
    const [frameSelections, setFrameSelections] = useState<FrameSelection[]>([]);
    const [frameSearch, setFrameSearch]         = useState('');
    const [importProgress, setImportProgress]   = useState<ImportProgress[]>([]);

    // ── Post-import summary ───────────────────────────────────────────────────
    const [summary, setSummary] = useState<ImportSummary | null>(null);

    const fileDataRef = useRef<FigmaFileResponse | null>(null);
    const abortRef    = useRef<AbortController | null>(null);

    const log = useCallback((msg: string) => {
        setImportLog(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]);
    }, []);

    // ── Token persistence (FIGMA-SEC-1) ──────────────────────────────────────
    const saveToken = useCallback((t: string) => {
        setToken(t);
        if (t) sessionStorage.setItem(FIGMA_TOKEN_KEY, t);
        else   sessionStorage.removeItem(FIGMA_TOKEN_KEY);
    }, []);

    // ── Filtered frames ───────────────────────────────────────────────────────
    const filteredFrames = useMemo(() => {
        if (!frameSearch.trim()) return frameSelections;
        const q = frameSearch.toLowerCase();
        return frameSelections.filter(fs => fs.info.name.toLowerCase().includes(q));
    }, [frameSelections, frameSearch]);

    const selectedCount = frameSelections.filter(f => f.selected).length;

    // ── Connect + fetch ───────────────────────────────────────────────────────
    const handleConnect = useCallback(async () => {
        if (!token.trim()) { setErrorMsg('Figma PAT is required.'); return; }
        if (!fileUrl.trim()) { setErrorMsg('Figma file URL is required.'); return; }

        const fileKey = extractFileKey(fileUrl);
        if (!fileKey) { setErrorMsg('Could not extract file key from URL.'); return; }

        if (vfsStatus !== 'ready' || !instance) {
            setErrorMsg('WebContainer is not ready yet. Wait a moment and try again.');
            return;
        }

        setErrorMsg('');
        setImportLog([]);
        setStep('booting_proxy');

        try {
            log('Starting Figma CORS proxy in WebContainer…');
            await ensureProxy(instance);
            log('✅ Proxy running on port 3001');
        } catch (err) {
            setErrorMsg(`Proxy failed to start: ${(err as Error).message}`);
            setStep('error');
            return;
        }

        setStep('fetching');
        log(`Fetching Figma file: ${fileKey}…`);
        abortRef.current = new AbortController();

        try {
            const data = await figmaFetch<FigmaFileResponse>(
                `/v1/files/${fileKey}`,
                token,
                abortRef.current.signal,
            );

            fileDataRef.current = data;
            setFileName(data.name);
            log(`✅ File loaded: "${data.name}"`);
            log(`Last modified: ${new Date(data.lastModified).toLocaleString()}`);

            const frames = extractTopLevelFrames(data.document);
            log(`Found ${frames.length} top-level frame(s)`);

            if (frames.length === 0) {
                setErrorMsg('No importable frames found. Make sure the file has top-level FRAME nodes.');
                setStep('error');
                return;
            }

            setFrameSelections(frames.map(info => ({
                info,
                mode: info.isComponent ? 'component' : 'page',
                selected: !info.isComponent,
            })));
            setFrameSearch('');
            setStep('pick');

        } catch (err) {
            if ((err as Error).name === 'AbortError') return;
            const msg = (err as Error).message;
            setErrorMsg(`Failed to fetch file: ${msg}`);
            log(`❌ ${msg}`);
            setStep('error');
        }
    }, [token, fileUrl, vfsStatus, instance, log]);

    // ── Frame controls ────────────────────────────────────────────────────────
    const toggleFrame  = useCallback((id: string) => setFrameSelections(prev => prev.map(fs => fs.info.id === id ? { ...fs, selected: !fs.selected } : fs)), []);
    const toggleMode   = useCallback((id: string) => setFrameSelections(prev => prev.map(fs => fs.info.id === id ? { ...fs, mode: fs.mode === 'page' ? 'component' : 'page' } : fs)), []);
    const selectAll    = useCallback(() => setFrameSelections(prev => prev.map(fs => ({ ...fs, selected: true  }))), []);
    const deselectAll  = useCallback(() => setFrameSelections(prev => prev.map(fs => ({ ...fs, selected: false }))), []);

    // ── Import ────────────────────────────────────────────────────────────────
    const handleImport = useCallback(async () => {
        const selected = frameSelections.filter(fs => fs.selected);
        if (selected.length === 0) return;
        if (!fileDataRef.current) return;

        setStep('importing');
        const fileKey = extractFileKey(fileUrl)!;

        const progress: ImportProgress[] = selected.map(fs => ({
            frameId: fs.info.id,
            frameName: fs.info.name,
            status: 'pending',
        }));
        setImportProgress(progress);

        let pagesCreated = 0;
        let componentsCreated = 0;
        let totalNodes = 0;
        const frameNames: string[] = [];

        for (let i = 0; i < selected.length; i++) {
            const { info, mode } = selected[i];

            setImportProgress(prev => prev.map(p =>
                p.frameId === info.id ? { ...p, status: 'running' } : p
            ));

            log(`Importing "${info.name}" as ${mode}…`);

            try {
                const figmaNode = findNodeById(fileDataRef.current!, info.id);
                if (!figmaNode) throw new Error(`Frame "${info.name}" not found in document`);

                const result: FigmaTransformResult = transformFigmaFrame(
                                figmaNode,
                                mode, // 'page' | 'component'
                            );
                totalNodes += Object.keys(result.nodes).length;
                frameNames.push(info.name);

                if (mode === 'page') {
                    const slug = `/${info.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
                    importPage({ nodes: result.nodes, rootId: result.rootId, pageName: info.name, slug });
                    pagesCreated++;
                } else {
                    // Component mode — import as hidden staging page (FIG-A: hidden flag)
                    const hiddenSlug = `/__figma_comp__${info.id.slice(0, 8)}`;
                    importPage({ nodes: result.nodes, rootId: result.rootId, pageName: `__figma_comp__${info.name}`, slug: hiddenSlug });
                    registerComponent(`figma-${info.id}`, {
                        label: info.name,
                        type: 'figma-frame',
                        importMeta: { source: 'figma', fileKey, frameId: info.id },
                    } as any);
                    componentsCreated++;
                }

                setImportProgress(prev => prev.map(p =>
                    p.frameId === info.id ? { ...p, status: 'done', message: `${Object.keys(result.nodes).length} nodes` } : p
                ));
                log(`✅ "${info.name}" done (${Object.keys(result.nodes).length} nodes)`);

                // Async image fills — FIG-SAFE-3: no mutation of raw Figma response
                (async () => {
                    try {
                        const imgRes = await figmaFetch<FigmaImageResponse>(
                            `/v1/images/${fileKey}?ids=${info.id}&format=png`,
                            token,
                        );
                        if (!imgRes?.images) return;
                        // applyImageFills needs 3 args: nodes, imageFillMap, figmaImageUrls
                        const patchedNodes = applyImageFills(result.nodes, result.imageFillMap, imgRes.images);
                        window.dispatchEvent(new CustomEvent('vectra:figma-image-patch', {
                            detail: { nodes: patchedNodes, rootId: result.rootId },
                        }));
                    } catch { /* non-fatal — images are optional */ }
                })();

            } catch (err) {
                const msg = (err as Error).message;
                setImportProgress(prev => prev.map(p =>
                    p.frameId === info.id ? { ...p, status: 'error', message: msg } : p
                ));
                log(`❌ "${info.name}": ${msg}`);
            }
        }

        setSummary({ pagesCreated, componentsCreated, totalNodes, frameNames });
        log(`✅ Import complete — ${pagesCreated} page(s), ${componentsCreated} component(s)`);
        setStep('done');

    }, [frameSelections, fileUrl, token, importPage, registerComponent, log]);

    // ── Reconnect ─────────────────────────────────────────────────────────────
    const handleReconnect = useCallback(async () => {
        await resetProxy(); // async — waits for graceful process exit
        abortRef.current?.abort();
        setStep('connect');
        setErrorMsg('');
        setImportLog([]);
        setFrameSelections([]);
        setFrameSearch('');
        setImportProgress([]);
        setSummary(null);
        setFileName('');
        fileDataRef.current = null;
    }, []);

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full text-[#ccc] select-none overflow-hidden">

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="px-3 pt-3 pb-2.5 border-b border-[#2c2c2e] shrink-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <Figma size={13} className="text-pink-400" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">Figma Import</span>
                    {fileName && (
                        <span className="ml-auto text-[9px] font-mono text-[#48484a] truncate max-w-[120px]">{fileName}</span>
                    )}
                </div>
                <p className="text-[9px] text-[#48484a] leading-relaxed">
                    Import frames from any Figma file you have access to.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">

                {/* ── Connect step ──────────────────────────────────────────── */}
                {step === 'connect' && (
                    <div className="p-3 space-y-2.5">
                        {/* PAT */}
                        <div>
                            <label className="flex items-center gap-1.5 text-[9px] font-bold text-[#636366] uppercase tracking-wider mb-1">
                                <Key size={9} /> Personal Access Token
                                <span className="text-[#3a3a3c] normal-case font-normal ml-1">(session only)</span>
                            </label>
                            <div className="relative">
                                <input
                                    type={showToken ? 'text' : 'password'}
                                    value={token}
                                    onChange={e => saveToken(e.target.value)}
                                    placeholder="figd_…"
                                    className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-700 outline-none focus:border-pink-500/40 pr-7"
                                    autoComplete="off"
                                />
                                <button type="button" onClick={() => setShowToken(p => !p)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-700 hover:text-zinc-500">
                                    {showToken ? <EyeOff size={10} /> : <Eye size={10} />}
                                </button>
                            </div>
                            <p className="text-[8px] text-[#3a3a3c] mt-0.5">
                                figma.com → Account Settings → Personal access tokens
                            </p>
                        </div>

                        {/* File URL */}
                        <div>
                            <label className="flex items-center gap-1.5 text-[9px] font-bold text-[#636366] uppercase tracking-wider mb-1">
                                <Link size={9} /> File URL
                            </label>
                            <input
                                value={fileUrl}
                                onChange={e => setFileUrl(e.target.value)}
                                placeholder="https://www.figma.com/file/…"
                                className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-700 outline-none focus:border-pink-500/40"
                            />
                        </div>

                        {errorMsg && (
                            <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                                <AlertTriangle size={10} className="text-red-400 shrink-0 mt-0.5" />
                                <span className="text-[10px] text-red-300 break-all">{errorMsg}</span>
                            </div>
                        )}

                        <button onClick={handleConnect} disabled={!token.trim() || !fileUrl.trim()}
                            className={cn(
                                'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-bold transition-all',
                                token.trim() && fileUrl.trim()
                                    ? 'bg-pink-600 hover:bg-pink-500 text-white shadow-sm hover:shadow-[0_0_12px_rgba(236,72,153,0.3)]'
                                    : 'bg-[#2c2c2e] text-[#48484a] cursor-not-allowed'
                            )}>
                            <Figma size={11} /> Connect to Figma
                        </button>
                    </div>
                )}

                {/* ── Booting / Fetching ────────────────────────────────────── */}
                {(step === 'booting_proxy' || step === 'fetching') && (
                    <div className="flex flex-col items-center gap-3 py-12 px-4">
                        <Loader2 size={24} className="text-pink-400 animate-spin" />
                        <p className="text-[11px] font-semibold text-[#636366]">
                            {step === 'booting_proxy' ? 'Starting CORS proxy…' : 'Fetching file…'}
                        </p>
                        <div className="w-full space-y-0.5 max-h-24 overflow-y-auto">
                            {importLog.map((l, i) => (
                                <div key={i} className={cn('text-[9px] font-mono', l.includes('✅') ? 'text-emerald-400' : l.includes('❌') ? 'text-red-400' : 'text-[#48484a]')}>{l}</div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Pick step ─────────────────────────────────────────────── */}
                {step === 'pick' && (
                    <div className="p-3 space-y-2.5">
                        {/* Header row */}
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-[#636366] uppercase tracking-wider">
                                {frameSelections.length} Frame{frameSelections.length !== 1 ? 's' : ''}
                            </span>
                            <div className="flex items-center gap-2">
                                <button onClick={selectAll}   className="text-[9px] text-[#636366] hover:text-[#aeaeb2] transition-colors">All</button>
                                <span className="text-[#3a3a3c]">·</span>
                                <button onClick={deselectAll} className="text-[9px] text-[#636366] hover:text-[#aeaeb2] transition-colors">None</button>
                                <span className="text-[9px] text-[#48484a]">{selectedCount} selected</span>
                            </div>
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <Search size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#48484a]" />
                            <input
                                value={frameSearch}
                                onChange={e => setFrameSearch(e.target.value)}
                                placeholder="Filter frames…"
                                className="w-full bg-[#1c1c1e] border border-[#2c2c2e] rounded-lg px-2 py-1.5 pl-6 text-[10px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-[#3a3a3c]"
                            />
                            {frameSearch && (
                                <button onClick={() => setFrameSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#48484a] hover:text-zinc-400">
                                    <X size={9} />
                                </button>
                            )}
                        </div>

                        {/* Frame list */}
                        <div className="space-y-1.5">
                            {filteredFrames.length === 0 && (
                                <p className="text-[10px] text-[#48484a] text-center py-4">No frames match "{frameSearch}"</p>
                            )}
                            {filteredFrames.map(fs => (
                                <div key={fs.info.id}
                                    className={cn(
                                        'flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all cursor-pointer group',
                                        fs.selected
                                            ? 'border-pink-500/30 bg-pink-500/5'
                                            : 'border-[#2c2c2e] hover:border-[#3a3a3c]'
                                    )}
                                    onClick={() => toggleFrame(fs.info.id)}
                                >
                                    <div className={cn(
                                        'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-all',
                                        fs.selected ? 'bg-pink-500 border-pink-500' : 'border-[#3a3a3c] group-hover:border-[#636366]'
                                    )}>
                                        {fs.selected && <CheckCircle2 size={9} className="text-white" />}
                                    </div>

                                    {fs.mode === 'page'
                                        ? <Layout size={10} className={fs.selected ? 'text-pink-400' : 'text-[#48484a]'} />
                                        : <Box     size={10} className={fs.selected ? 'text-purple-400' : 'text-[#48484a]'} />}

                                    <span className="flex-1 text-[10px] font-semibold truncate text-[#e5e5ea]">{fs.info.name}</span>

                                    {/* Dimension badge — from .bounds (FigmaFrameInfo has no direct width/height) */}
                                    {fs.info.bounds && (
                                        <span className="text-[8px] font-mono text-[#48484a] shrink-0 bg-[#1c1c1e] px-1 py-0.5 rounded">
                                            {Math.round(fs.info.bounds.width)}×{Math.round(fs.info.bounds.height)}
                                        </span>
                                    )}

                                    {/* Mode toggle */}
                                    <button
                                        onClick={e => { e.stopPropagation(); toggleMode(fs.info.id); }}
                                        className={cn(
                                            'text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 transition-all',
                                            fs.mode === 'page'
                                                ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25'
                                                : 'bg-purple-500/15 text-purple-400 hover:bg-purple-500/25'
                                        )}
                                    >
                                        {fs.mode}
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={handleImport}
                            disabled={selectedCount === 0}
                            className={cn(
                                'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-bold transition-all',
                                selectedCount > 0
                                    ? 'bg-pink-600 hover:bg-pink-500 text-white'
                                    : 'bg-[#2c2c2e] text-[#48484a] cursor-not-allowed'
                            )}
                        >
                            <Figma size={11} />
                            Import {selectedCount > 0 ? `${selectedCount} Frame${selectedCount !== 1 ? 's' : ''}` : 'Frames'}
                        </button>
                    </div>
                )}

                {/* ── Importing ─────────────────────────────────────────────── */}
                {step === 'importing' && (
                    <div className="p-3 space-y-2">
                        <div className="flex items-center gap-2 py-2">
                            <Loader2 size={13} className="text-pink-400 animate-spin" />
                            <span className="text-[11px] font-semibold text-[#636366]">Importing frames…</span>
                        </div>
                        {importProgress.map(p => (
                            <div key={p.frameId} className="flex items-center gap-2 px-2 py-1.5 bg-[#1c1c1e] rounded-lg border border-[#2c2c2e]">
                                {p.status === 'pending'  && <div className="w-2 h-2 rounded-full border border-[#48484a] shrink-0" />}
                                {p.status === 'running'  && <Loader2 size={9} className="text-pink-400 animate-spin shrink-0" />}
                                {p.status === 'done'     && <CheckCircle2 size={9} className="text-emerald-400 shrink-0" />}
                                {p.status === 'error'    && <XCircle size={9} className="text-red-400 shrink-0" />}
                                <span className="text-[10px] flex-1 truncate text-[#e5e5ea]">{p.frameName}</span>
                                {p.message && <span className="text-[9px] text-[#636366]">{p.message}</span>}
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Done ──────────────────────────────────────────────────── */}
                {step === 'done' && summary && (
                    <div className="p-3 space-y-3">
                        <div className="flex flex-col items-center gap-2 py-4">
                            <CheckCircle2 size={28} className="text-emerald-400" />
                            <p className="text-[13px] font-bold text-white">Import Complete</p>
                        </div>

                        {/* Summary card */}
                        <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-xl p-3 space-y-2">
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <div>
                                    <div className="text-[16px] font-bold text-white">{summary.totalNodes}</div>
                                    <div className="text-[8px] text-[#636366] uppercase tracking-wide">Nodes</div>
                                </div>
                                <div>
                                    <div className="text-[16px] font-bold text-blue-400">{summary.pagesCreated}</div>
                                    <div className="text-[8px] text-[#636366] uppercase tracking-wide">Pages</div>
                                </div>
                                <div>
                                    <div className="text-[16px] font-bold text-purple-400">{summary.componentsCreated}</div>
                                    <div className="text-[8px] text-[#636366] uppercase tracking-wide">Components</div>
                                </div>
                            </div>
                            <div className="border-t border-[#2c2c2e] pt-2 space-y-0.5">
                                {summary.frameNames.map(n => (
                                    <div key={n} className="flex items-center gap-1.5 text-[9px] text-[#636366]">
                                        <CheckCircle2 size={8} className="text-emerald-400 shrink-0" />
                                        <span className="truncate">{n}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Log */}
                        <div className="space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                            {importLog.map((l, i) => (
                                <div key={i} className={cn('text-[9px] font-mono', l.includes('✅') ? 'text-emerald-400' : l.includes('❌') ? 'text-red-400' : 'text-[#48484a]')}>{l}</div>
                            ))}
                        </div>

                        <div className="flex gap-2">
                            <button onClick={handleReconnect}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold bg-[#2c2c2e] hover:bg-[#3a3a3c] text-[#aeaeb2] transition-colors">
                                <RefreshCw size={10} /> Import More
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Error ─────────────────────────────────────────────────── */}
                {step === 'error' && (
                    <div className="p-3 space-y-3">
                        <div className="flex flex-col items-center gap-2 py-6">
                            <XCircle size={24} className="text-red-400" />
                            <p className="text-[11px] font-semibold text-[#636366] text-center">{errorMsg}</p>
                        </div>
                        <div className="space-y-0.5 max-h-20 overflow-y-auto">
                            {importLog.map((l, i) => (
                                <div key={i} className="text-[9px] font-mono text-[#48484a]">{l}</div>
                            ))}
                        </div>
                        <button onClick={handleReconnect}
                            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-bold bg-pink-600/20 hover:bg-pink-600/30 text-pink-400 border border-pink-500/20 transition-all">
                            <RefreshCw size={10} /> Reconnect
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FigmaPanel;

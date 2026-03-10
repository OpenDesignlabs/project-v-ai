/**
 * ─── FIGMA IMPORT PANEL ───────────────────────────────────────────────────────
 * FIG-1 — Full Figma import UI.
 *
 * USER FLOW
 * ─────────
 *   Step 1 — Connect:     PAT + File URL → "Connect" → boot proxy → fetch file
 *   Step 2 — Pick frames: Checklist of top-level FRAMEs with mode toggle (Page / Component)
 *   Step 3 — Import:      Progress log per frame → importPage() per selection
 *   Step 4 — Async fills: Image fills resolved in background via Figma Images API
 *
 * SECURITY
 * ─────────
 * FIGMA-SEC-1: PAT in sessionStorage only. Key = 'vectra_figma_token'.
 * FIGMA-SEC-2: Token forwarded as X-Figma-Token header (inside figmaFetch).
 *
 * INTEGRATION
 * ───────────
 * importPage()           — ProjectContext (STI-PAGE-1 atomic import)
 * registerComponent()    — UIContext (via useEditor)
 * ensureProxy()          — figmaProxy.ts
 * figmaFetch()           — figmaProxy.ts
 * transformFigmaFrame()  — figmaImporter.ts
 * findNodeById()         — figmaImporter.ts
 * applyImageFills()      — figmaImporter.ts
 */

import React, { useState, useCallback, useRef } from 'react';
import {
    Figma, Link, Key, Loader2,
    CheckCircle2, XCircle, AlertTriangle,
    Layout, Box, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { useContainer } from '../../context/ContainerContext';
import { useProject } from '../../context/ProjectContext';
import { ensureProxy, figmaFetch } from '../../utils/figmaProxy';
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
} from '../../utils/figmaImporter';
import { cn } from '../../lib/utils';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const FIGMA_TOKEN_KEY = 'vectra_figma_token'; // sessionStorage only — FIGMA-SEC-1

// ─── TYPES ────────────────────────────────────────────────────────────────────

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

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export const FigmaPanel: React.FC = () => {
    const { registerComponent } = useEditor();
    const { importPage } = useProject();
    const { instance, status: vfsStatus } = useContainer();

    // ── Auth state (FIGMA-SEC-1: sessionStorage only) ─────────────────────────
    const [token, setToken] = useState<string>(() =>
        sessionStorage.getItem(FIGMA_TOKEN_KEY) ?? ''
    );
    const [showToken, setShowToken] = useState(false);
    const [fileUrl, setFileUrl] = useState('');

    // ── Panel state ───────────────────────────────────────────────────────────
    const [step, setStep] = useState<PanelStep>('connect');
    const [errorMsg, setErrorMsg] = useState('');
    const [importLog, setImportLog] = useState<string[]>([]);

    // ── File + frame state ────────────────────────────────────────────────────
    const [fileName, setFileName] = useState('');
    const [fileData, setFileData] = useState<FigmaFileResponse | null>(null);
    const [frameSelections, setFrameSelections] = useState<FrameSelection[]>([]);
    const [importProgress, setImportProgress] = useState<ImportProgress[]>([]);

    const abortRef = useRef<AbortController | null>(null);
    const transformResultsRef = useRef<Map<string, FigmaTransformResult>>(new Map());

    const log = useCallback((msg: string) => {
        setImportLog(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);
    }, []);

    // ── Token persistence ─────────────────────────────────────────────────────
    const handleTokenChange = useCallback((val: string) => {
        setToken(val);
        if (val) sessionStorage.setItem(FIGMA_TOKEN_KEY, val);
        else sessionStorage.removeItem(FIGMA_TOKEN_KEY);
    }, []);

    // ── Step 1: Connect → boot proxy → fetch file ─────────────────────────────
    const handleConnect = useCallback(async () => {
        if (!token.trim()) { setErrorMsg('Personal Access Token is required.'); return; }
        if (!fileUrl.trim()) { setErrorMsg('Figma file URL is required.'); return; }

        const fileKey = extractFileKey(fileUrl);
        if (!fileKey) {
            setErrorMsg('Could not extract file key from URL. Use the full Figma file URL.');
            return;
        }

        if (vfsStatus !== 'ready' || !instance) {
            setErrorMsg('WebContainer is not ready yet. Wait a moment and try again.');
            return;
        }

        setErrorMsg('');
        setImportLog([]);
        setStep('booting_proxy');

        try {
            log('Starting Figma CORS proxy in WebContainer...');
            await ensureProxy(instance);
            log('✅ Proxy running on port 3001');
        } catch (err) {
            setErrorMsg(`Proxy failed to start: ${(err as Error).message}`);
            setStep('error');
            return;
        }

        setStep('fetching');
        log(`Fetching Figma file: ${fileKey}...`);

        abortRef.current = new AbortController();

        try {
            const data = await figmaFetch<FigmaFileResponse>(
                `/v1/files/${fileKey}`,
                token,
                abortRef.current.signal,
            );

            setFileData(data);
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
                selected: !info.isComponent, // auto-select non-component frames
            })));
            setStep('pick');

        } catch (err) {
            if ((err as Error).name === 'AbortError') return;
            const msg = (err as Error).message;
            setErrorMsg(`Failed to fetch file: ${msg}`);
            log(`❌ ${msg}`);
            setStep('error');
        }
    }, [token, fileUrl, vfsStatus, instance, log]);

    // ── Frame selection controls ───────────────────────────────────────────────
    const toggleFrame = useCallback((id: string) => {
        setFrameSelections(prev => prev.map(fs =>
            fs.info.id === id ? { ...fs, selected: !fs.selected } : fs
        ));
    }, []);

    const toggleMode = useCallback((id: string) => {
        setFrameSelections(prev => prev.map(fs =>
            fs.info.id === id ? { ...fs, mode: fs.mode === 'page' ? 'component' : 'page' } : fs
        ));
    }, []);

    const selectAll = useCallback(() => setFrameSelections(prev => prev.map(fs => ({ ...fs, selected: true }))), []);
    const selectNone = useCallback(() => setFrameSelections(prev => prev.map(fs => ({ ...fs, selected: false }))), []);

    // ── Step 2: Import selected frames ────────────────────────────────────────
    const handleImport = useCallback(async () => {
        const selected = frameSelections.filter(fs => fs.selected);
        if (selected.length === 0) { setErrorMsg('Select at least one frame to import.'); return; }
        if (!fileData) return;

        setStep('importing');
        setErrorMsg('');
        transformResultsRef.current = new Map();
        abortRef.current = new AbortController();

        const fileKey = extractFileKey(fileUrl)!;

        setImportProgress(selected.map(fs => ({
            frameId: fs.info.id,
            frameName: fs.info.name,
            status: 'pending',
        })));

        const updateProgress = (frameId: string, status: ImportProgress['status'], message?: string) => {
            setImportProgress(prev =>
                prev.map(p => p.frameId === frameId ? { ...p, status, message } : p)
            );
        };

        // ── Transform + import each frame ────────────────────────────────────
        for (const fs of selected) {
            updateProgress(fs.info.id, 'running');
            log(`Processing "${fs.info.name}" (${fs.mode})...`);

            try {
                const rawNode = findNodeById(fileData, fs.info.id);
                if (!rawNode) throw new Error(`Frame "${fs.info.name}" not found in document`);

                const result = transformFigmaFrame(rawNode, fs.mode);
                transformResultsRef.current.set(fs.info.id, result);

                if (result.warnings.length > 0) {
                    result.warnings.forEach(w => log(`  ⚠️ ${w}`));
                }

                if (fs.mode === 'page') {
                    const slug = `/${fs.info.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
                    importPage(fs.info.name, slug, result.nodes, result.rootId);
                    log(`  ✅ Page "${fs.info.name}" created (${Object.keys(result.nodes).length} nodes)`);

                } else {
                    // Component mode — register in Insert panel
                    // FIG-FUTURE-1 [DEFERRED]: registerComponentWithNodes() staging API.
                    // For this sprint: stage nodes as a hidden page at /__figma/{compId}.
                    const compId = `figma_${fs.info.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    registerComponent(compId, {
                        icon: Box as any,
                        label: fs.info.name,
                        category: 'sections',
                        defaultProps: {},
                    });
                    importPage(
                        `__figma_comp__${fs.info.name}`,
                        `/__figma/${compId}`,
                        result.nodes,
                        result.rootId,
                    );
                    log(`  ✅ Component "${fs.info.name}" registered`);
                }

                updateProgress(fs.info.id, 'done');

            } catch (err) {
                const msg = (err as Error).message;
                updateProgress(fs.info.id, 'error', msg);
                log(`  ❌ "${fs.info.name}": ${msg}`);
            }
        }

        // ── Async: resolve image fills ────────────────────────────────────────
        const allImageFillNodeIds = [...transformResultsRef.current.values()]
            .flatMap(r => r.imageFillNodeIds);

        if (allImageFillNodeIds.length > 0) {
            log(`Resolving ${allImageFillNodeIds.length} image fill(s)...`);
            try {
                // Figma Images API accepts max 100 node IDs per request
                const BATCH_SIZE = 100;
                for (let i = 0; i < allImageFillNodeIds.length; i += BATCH_SIZE) {
                    const batch = allImageFillNodeIds.slice(i, i + BATCH_SIZE);
                    const idsParam = batch.join(',');

                    const imgData = await figmaFetch<FigmaImageResponse>(
                        `/v1/images/${fileKey}?ids=${idsParam}&format=png&scale=2`,
                        token,
                        abortRef.current.signal,
                    );

                    if (!imgData.err && imgData.images) {
                        for (const result of transformResultsRef.current.values()) {
                            if (result.imageFillNodeIds.length === 0) continue;
                            const patched = applyImageFills(result.nodes, result.imageFillMap, imgData.images);
                            // Patch nodes already committed to elements via setElements merger
                            window.dispatchEvent(new CustomEvent('vectra:figma-image-patch', {
                                detail: { nodes: patched },
                            }));
                        }
                        log(`✅ Image fills resolved`);
                    }
                }
            } catch (err) {
                if ((err as Error).name !== 'AbortError') {
                    log(`⚠️ Image fill resolution failed: ${(err as Error).message} (non-fatal)`);
                }
            }
        }

        log('Import complete.');
        setStep('done');
    }, [frameSelections, fileData, fileUrl, token, importPage, registerComponent, log]);

    // ── Reset ─────────────────────────────────────────────────────────────────
    const reset = useCallback(() => {
        abortRef.current?.abort();
        setStep('connect');
        setErrorMsg('');
        setImportLog([]);
        setFileData(null);
        setFrameSelections([]);
        setImportProgress([]);
        setFileName('');
        setFileUrl('');
        transformResultsRef.current = new Map();
    }, []);

    // ─── RENDER ───────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full bg-[#1a1a1c] text-[#cccccc] overflow-hidden">

            {/* Description strip */}
            <div className="px-4 pt-3 pb-2 border-b border-[#2c2c2e] shrink-0">
                {fileName ? (
                    <div className="flex items-center gap-2">
                        <Figma size={11} className="text-purple-400 shrink-0" />
                        <span className="text-[10px] text-[#aeaeb2] truncate font-medium">{fileName}</span>
                    </div>
                ) : (
                    <p className="text-[10px] text-[#48484a] leading-relaxed">
                        Import Figma frames as editable Vectra pages or component blocks.
                        Requires a{' '}
                        <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noreferrer"
                            className="text-purple-400 hover:underline">Personal Access Token</a>.
                    </p>
                )}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">

                {/* ── CONNECT / BOOTING / FETCHING ─────────────────────────── */}
                {['connect', 'booting_proxy', 'fetching'].includes(step) && (
                    <div className="space-y-3">

                        {/* PAT */}
                        <div>
                            <label className="flex items-center gap-1 text-[10px] text-[#636366] mb-1.5">
                                <Key size={9} /> Personal Access Token
                                <span className="ml-auto text-[9px] text-[#3a3a3c]">session only</span>
                            </label>
                            <div className="relative">
                                <input
                                    type={showToken ? 'text' : 'password'}
                                    value={token}
                                    onChange={e => handleTokenChange(e.target.value)}
                                    placeholder="figd_..."
                                    className="w-full bg-[#252526] border border-[#3f3f46] rounded-lg px-3 py-2 text-xs text-white placeholder-[#555] focus:outline-none focus:border-purple-500/60 pr-9 transition-colors"
                                />
                                <button
                                    onClick={() => setShowToken(p => !p)}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#48484a] hover:text-[#888] transition-colors"
                                    title={showToken ? 'Hide token' : 'Show token'}
                                >
                                    {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
                                </button>
                            </div>
                            <p className="text-[9px] text-[#3a3a3c] mt-1">
                                Figma → Settings → Account → Personal access tokens
                            </p>
                        </div>

                        {/* File URL */}
                        <div>
                            <label className="flex items-center gap-1 text-[10px] text-[#636366] mb-1.5">
                                <Link size={9} /> File URL
                            </label>
                            <input
                                type="text"
                                value={fileUrl}
                                onChange={e => setFileUrl(e.target.value)}
                                placeholder="https://www.figma.com/file/..."
                                className="w-full bg-[#252526] border border-[#3f3f46] rounded-lg px-3 py-2 text-xs text-white placeholder-[#555] focus:outline-none focus:border-purple-500/60 transition-colors"
                            />
                        </div>

                        {errorMsg && (
                            <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-3 flex items-start gap-2">
                                <XCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
                                <p className="text-[11px] text-red-400 leading-snug">{errorMsg}</p>
                            </div>
                        )}

                        <button
                            onClick={handleConnect}
                            disabled={step !== 'connect'}
                            className={cn(
                                'w-full px-3 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2',
                                step !== 'connect'
                                    ? 'bg-purple-600/40 text-purple-300/70 cursor-wait'
                                    : 'bg-purple-600 hover:bg-purple-500 text-white'
                            )}
                        >
                            {step === 'booting_proxy' && <><Loader2 size={12} className="animate-spin" /> Starting proxy…</>}
                            {step === 'fetching' && <><Loader2 size={12} className="animate-spin" /> Fetching file…</>}
                            {step === 'connect' && <><Figma size={12} /> Connect to Figma</>}
                        </button>

                        {/* Boot/fetch log */}
                        {importLog.length > 0 && (
                            <div className="bg-[#0d0d0f] border border-[#2c2c2e] rounded-xl p-2.5 max-h-24 overflow-y-auto font-mono custom-scrollbar">
                                {importLog.map((l, i) => (
                                    <div key={i} className="text-[9px] text-[#48484a] leading-relaxed">{l}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ── FRAME PICKER ─────────────────────────────────────────── */}
                {step === 'pick' && (
                    <div className="space-y-3">

                        {/* Controls bar */}
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[#636366]">
                                {frameSelections.filter(f => f.selected).length} / {frameSelections.length} selected
                            </span>
                            <div className="flex items-center gap-2">
                                <button onClick={selectAll} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">All</button>
                                <span className="text-[#2c2c2e]">·</span>
                                <button onClick={selectNone} className="text-[10px] text-[#636366] hover:text-[#aeaeb2] transition-colors">None</button>
                            </div>
                        </div>

                        {/* Frame list */}
                        <div className="space-y-1.5">
                            {frameSelections.map(fs => (
                                <div
                                    key={fs.info.id}
                                    onClick={() => toggleFrame(fs.info.id)}
                                    className={cn(
                                        'rounded-xl border p-3 cursor-pointer transition-all duration-150',
                                        fs.selected
                                            ? 'border-purple-500/40 bg-purple-500/5'
                                            : 'border-[#2c2c2e] bg-[#1c1c1e] opacity-60 hover:opacity-80'
                                    )}
                                >
                                    <div className="flex items-center gap-2.5">
                                        {/* Checkbox */}
                                        <div className={cn(
                                            'w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors',
                                            fs.selected ? 'bg-purple-500 border-purple-500' : 'border-[#48484a]'
                                        )}>
                                            {fs.selected && <CheckCircle2 size={10} className="text-white" />}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-semibold text-white truncate">{fs.info.name}</div>
                                            <div className="text-[10px] text-[#48484a] mt-0.5">
                                                {Math.round(fs.info.bounds.width)} × {Math.round(fs.info.bounds.height)} px
                                                {fs.info.canvasName !== 'Page 1' && (
                                                    <span className="ml-1.5 text-[#3a3a3c]">· {fs.info.canvasName}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Mode toggle */}
                                        {fs.selected && (
                                            <button
                                                onClick={e => { e.stopPropagation(); toggleMode(fs.info.id); }}
                                                className={cn(
                                                    'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors shrink-0',
                                                    fs.mode === 'page'
                                                        ? 'bg-blue-500/10 border-blue-500/25 text-blue-400 hover:bg-blue-500/15'
                                                        : 'bg-orange-500/10 border-orange-500/25 text-orange-400 hover:bg-orange-500/15'
                                                )}
                                            >
                                                {fs.mode === 'page'
                                                    ? <><Layout size={9} /> Page</>
                                                    : <><Box size={9} /> Component</>
                                                }
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {errorMsg && (
                            <p className="text-[11px] text-red-400">{errorMsg}</p>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                            <button onClick={reset}
                                className="px-3 py-2 rounded-lg text-xs border border-[#2c2c2e] text-[#636366] hover:text-[#aeaeb2] transition-colors">
                                Back
                            </button>
                            <button onClick={handleImport}
                                className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white transition-colors flex items-center justify-center gap-1.5">
                                <Figma size={12} />
                                Import {frameSelections.filter(f => f.selected).length} Frame(s)
                            </button>
                        </div>
                    </div>
                )}

                {/* ── IMPORT PROGRESS ──────────────────────────────────────── */}
                {(step === 'importing' || step === 'done') && (
                    <div className="space-y-3">

                        {/* Per-frame status */}
                        {importProgress.map(p => (
                            <div key={p.frameId} className={cn(
                                'flex items-center gap-3 p-2.5 rounded-xl border text-xs transition-colors',
                                p.status === 'done' ? 'border-emerald-500/20 bg-emerald-500/5' :
                                    p.status === 'error' ? 'border-red-500/20 bg-red-500/5' :
                                        p.status === 'running' ? 'border-purple-500/20 bg-purple-500/5' :
                                            'border-[#2c2c2e] bg-[#1c1c1e]'
                            )}>
                                {p.status === 'done' && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                                {p.status === 'error' && <XCircle size={14} className="text-red-400 shrink-0" />}
                                {p.status === 'running' && <Loader2 size={14} className="animate-spin text-purple-400 shrink-0" />}
                                {p.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-[#48484a] shrink-0" />}
                                <div className="min-w-0">
                                    <div className="font-semibold text-white truncate">{p.frameName}</div>
                                    {p.message && <div className="text-[10px] text-[#48484a] truncate">{p.message}</div>}
                                </div>
                            </div>
                        ))}

                        {/* Log panel */}
                        <div className="bg-[#0d0d0f] border border-[#2c2c2e] rounded-xl p-2.5 max-h-36 overflow-y-auto font-mono custom-scrollbar">
                            {importLog.map((l, i) => (
                                <div key={i} className="text-[9px] text-[#48484a] leading-relaxed">{l}</div>
                            ))}
                            {step === 'importing' && (
                                <div className="flex items-center gap-1.5 pt-1">
                                    <Loader2 size={9} className="animate-spin text-purple-400" />
                                    <span className="text-[9px] text-purple-400">importing…</span>
                                </div>
                            )}
                        </div>

                        {/* Done state */}
                        {step === 'done' && (
                            <div className="space-y-3">
                                <div className="flex flex-col items-center gap-2 py-4">
                                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                                        <CheckCircle2 size={24} className="text-emerald-400" />
                                    </div>
                                    <p className="text-sm font-bold text-white">Import complete</p>
                                    <p className="text-[11px] text-[#636366]">
                                        Page(s) created and now visible in Pages panel
                                    </p>
                                </div>
                                <button onClick={reset}
                                    className="w-full px-3 py-2 rounded-lg text-xs border border-[#2c2c2e] text-[#636366] hover:text-[#aeaeb2] transition-colors flex items-center justify-center gap-1.5">
                                    <RefreshCw size={11} /> Import More
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── ERROR ────────────────────────────────────────────────── */}
                {step === 'error' && (
                    <div className="space-y-3">
                        <div className="bg-red-500/8 border border-red-500/25 rounded-xl p-4 flex items-start gap-3">
                            <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-red-400 mb-1">Import Failed</p>
                                <p className="text-[11px] text-[#636366] leading-relaxed font-mono break-all">{errorMsg}</p>
                            </div>
                        </div>
                        <button onClick={reset}
                            className="w-full py-2 rounded-lg text-xs border border-[#2c2c2e] text-[#636366] hover:text-[#aeaeb2] transition-colors">
                            Try Again
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FigmaPanel;

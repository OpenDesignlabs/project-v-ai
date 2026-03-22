/**
 * --- STITCH PANEL -----------------------------------------------------------
 * Left-sidebar panel for the Stitch AI component generation workflow.
 * Uses the Stitch MCP server to generate, preview, and insert UI components
 * described in natural language into the active canvas artboard.[Tab UI — 'zip' | 'url' | 'ai']
 */


import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
    Upload, FileArchive, CheckCircle2, AlertTriangle,
    XCircle, Loader2, Layers, ImageIcon,
    ChevronRight, ChevronDown, Code2, Box,
    Edit2, RefreshCw, Link2, Wand2, Zap} from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { useContainer } from '../../context/ContainerContext';
import { parseZipToVectraPage, type ZipImportResult } from '../../utils/import/zipImporter';
import { AI_CONFIG } from '../../services/aiAgent';
import { cn } from '../../lib/utils';
import type { VectraNode } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type StitchTab   = 'zip' | 'url' | 'ai';
type ImportStep  = 'idle' | 'parsing' | 'preview' | 'importing' | 'done' | 'error';
type AIStep      = 'idle' | 'generating' | 'done' | 'error';

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
    container: 'bg-blue-500/40', text: 'bg-emerald-500/40', heading: 'bg-purple-500/40',
    image: 'bg-orange-500/40', button: 'bg-pink-500/40', section: 'bg-cyan-500/40', webpage: 'bg-zinc-500/40',
};
const TYPE_LABELS: Record<string, string> = {
    container: 'Container', text: 'Text', heading: 'Heading',
    image: 'Image', button: 'Button', section: 'Section', webpage: 'Webpage',
};

// ── AI component-generation system prompt ─────────────────────────────────────
const AI_SYSTEM_PROMPT = `You are a React component generator for Vectra, a visual web builder.

Output ONLY a single React functional component named "Component".
Requirements:
- Use Tailwind CSS classes for all styling (no inline styles, no CSS modules)
- No import statements
- No export statements  
- Component name must be exactly "Component"
- Self-contained, no props required
- Clean, production-quality UI
- No markdown, no explanation, no code fences

Example format:
function Component() {
  return (
    <div className="p-8 bg-white rounded-2xl shadow-lg">
      ...
    </div>
  );
}`;

/** Strips markdown fences and extracts the function body from LLM output. */
const extractComponentCode = (raw: string): string => {
    // Remove markdown code fences
    let code = raw
        .replace(/```(?:jsx?|tsx?|javascript|typescript)?\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

    // If it has a function/const Component declaration, extract it
    const fnMatch = code.match(/((?:function\s+Component|const\s+Component\s*=)[\s\S]+)/);
    if (fnMatch) code = fnMatch[1].trim();

    return code;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const StitchPanel: React.FC = () => {
    const {
        importPage, addAsset, framework,
        elements, pages, activePageId, pushHistory,
    } = useEditor();
    const { instance, status: vfsStatus } = useContainer();

    // ── Tab state ─────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<StitchTab>('zip');

    // ── ZIP import state (unchanged from original) ────────────────────────────
    const [step, setStep]           = useState<ImportStep>('idle');
    const [preview, setPreview]     = useState<ParsedPreview | null>(null);
    const [errorMsg, setErrorMsg]   = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [importLog, setImportLog] = useState<string[]>([]);
    const [pageName, setPageName]   = useState('');
    const [pageSlug, setPageSlug]   = useState('');
    const [slugManual, setSlugManual] = useState(false);
    const [cssOpen, setCssOpen]     = useState(false);
    const [warningsOpen, setWarningsOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── URL import state ──────────────────────────────────────────────────────
    const [urlInput, setUrlInput]     = useState('');
    const [urlLoading, setUrlLoading] = useState(false);
    const [urlError, setUrlError]     = useState('');

    // ── AI generate state ─────────────────────────────────────────────────────
    const [aiPrompt, setAiPrompt]     = useState('');
    const [aiStep, setAiStep]         = useState<AIStep>('idle');
    const [aiError, setAiError]       = useState('');
    const [aiLog, setAiLog]           = useState<string[]>([]);
    const [lastGenName, setLastGenName] = useState('');

    const log = useCallback((msg: string) => {
        setImportLog(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]);
    }, []);

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
                try { existing = await instance.fs.readFile(cssPath, 'utf-8'); } catch { /* ok */ }
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
            const nodeCount      = Object.keys(result.nodes).length;
            const topLevelCount  = result.nodes[result.rootId]?.children?.length ?? 0;
            const cssSize        = formatBytes(new Blob([result.css]).size);
            const typeCounts     = countTypes(result);

            log(`✅ ${nodeCount} nodes · ${topLevelCount} sections · ${result.imageAssets.length} images`);
            result.warnings.forEach(w => log(`⚠️ ${w}`));

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

    // ── Confirm ZIP import (STI-PAGE-1) ───────────────────────────────────────
    const confirmImport = useCallback(async () => {
        if (!preview) return;
        setStep('importing');
        const { result } = preview;
        const finalSlug = pageSlug.startsWith('/') ? pageSlug : `/${pageSlug}`;

        try {
            if (result.imageAssets.length > 0) {
                log(`Registering ${result.imageAssets.length} image asset(s)…`);
                for (const asset of result.imageAssets) addAsset(asset.file);
                log('✅ Assets registered');
            }
            if (result.css.trim()) {
                log(`Injecting CSS → ${cssPath}…`);
                await injectCSS(result.css);
            }
            log(`Importing page "${pageName}"…`);
            importPage({ nodes: result.nodes, rootId: result.rootId, pageName, slug: finalSlug });
            log('✅ Page imported and activated');
            setStep('done');
        } catch (err) {
            const msg = (err as Error).message;
            setErrorMsg(msg);
            log(`❌ ${msg}`);
            setStep('error');
        }
    }, [preview, pageName, pageSlug, addAsset, injectCSS, importPage, cssPath, log]);

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

    const cssPreviewLines = useMemo(() => {
        if (!preview?.result.css) return [];
        return preview.result.css.split('\n').filter(l => l.trim()).slice(0, 14);
    }, [preview]);

    // ── URL import ────────────────────────────────────────────────────────────
    const handleUrlImport = useCallback(async () => {
        const url = urlInput.trim();
        if (!url) return;
        setUrlError('');
        setUrlLoading(true);
        try {
            const res = await fetch(url, { mode: 'cors' });
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const blob = await res.blob();
            const fileName = url.split('/').pop()?.split('?')[0] || 'import.zip';
            const file = new File([blob], fileName.endsWith('.zip') ? fileName : `${fileName}.zip`, { type: 'application/zip' });
            setActiveTab('zip');
            await handleFile(file);
        } catch (err) {
            const msg = (err as Error).message;
            setUrlError(
                msg.includes('Failed to fetch') || msg.includes('CORS')
                    ? 'Could not fetch this URL (CORS blocked). Download the ZIP and drop it instead.'
                    : `Fetch failed: ${msg}`
            );
        } finally {
            setUrlLoading(false);
        }
    }, [urlInput, handleFile]);

    // ── AI Generate ───────────────────────────────────────────────────────────
    const handleAIGenerate = useCallback(async () => {
        if (!aiPrompt.trim()) return;

        if (!AI_CONFIG.primaryApiKey) {
            setAiError('AI key not set. Add VITE_AI_PRIMARY_KEY to your .env file.');
            setAiStep('error');
            return;
        }

        setAiStep('generating');
        setAiError('');
        setAiLog(['Generating component…']);

        try {
            const res = await fetch(AI_CONFIG.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AI_CONFIG.primaryApiKey}`,
                },
                body: JSON.stringify({
                    model: AI_CONFIG.primaryModel,
                    max_tokens: 2000,
                    messages: [
                        { role: 'system', content: AI_SYSTEM_PROMPT },
                        { role: 'user', content: aiPrompt.trim() },
                    ],
                }),
            });

            if (!res.ok) {
                const body = await res.text().catch(() => res.statusText);
                throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
            }

            const data = await res.json();
            const rawCode = data.choices?.[0]?.message?.content ?? '';
            if (!rawCode.trim()) throw new Error('AI returned empty response.');

            const componentCode = extractComponentCode(rawCode);
            if (!componentCode.includes('Component')) {
                throw new Error('Generated code does not contain a Component function.');
            }

            setAiLog(prev => [...prev, '✅ Code generated']);

            // Build node name from prompt (first 40 chars, title-cased)
            const name = aiPrompt.trim().slice(0, 40).replace(/\b\w/g, c => c.toUpperCase());

            // Find active page root — C-1 (spread clone), NS-1 (randomUUID), H-3 (pushHistory)
            const activePage = pages.find(p => p.id === activePageId);
            if (!activePage) throw new Error('No active page found.');
            const rootNode = elements[activePage.rootId];
            if (!rootNode) throw new Error('Page root node missing.');

            const nodeId = `ai-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const codeNode: VectraNode = {
                id: nodeId,
                type: 'container',
                name,
                code: componentCode,
                children: [],
                props: {
                    style: { position: 'relative', width: '100%' },
                },
            };

            // Spread-clone path — C-1 compliant
            const next = {
                ...elements,
                [nodeId]: codeNode,
                [activePage.rootId]: {
                    ...rootNode,
                    children: [...(rootNode.children ?? []), nodeId],
                },
            };
            pushHistory(next);

            setLastGenName(name);
            setAiLog(prev => [...prev, `✅ "${name}" added to canvas`]);
            setAiStep('done');

        } catch (err) {
            const msg = (err as Error).message;
            setAiError(msg);
            setAiLog(prev => [...prev, `❌ ${msg}`]);
            setAiStep('error');
        }
    }, [aiPrompt, elements, pages, activePageId, pushHistory]);

    const resetAI = useCallback(() => {
        setAiStep('idle');
        setAiError('');
        setAiLog([]);
        setAiPrompt('');
        setLastGenName('');
    }, []);

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full text-[#ccc] select-none">

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="px-3 pt-3 pb-0 border-b border-[#2c2c2e] shrink-0">
                <div className="flex items-center gap-2 mb-1.5">
                    <Layers size={13} className="text-blue-400" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">Stitch</span>
                    <span className="ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-blue-500/10 text-blue-400">
                        {(framework as string) === 'vite' ? 'Vite' : 'Next.js'}
                    </span>
                </div>

                {/* Tab switcher */}
                <div className="flex gap-0.5 mb-0">
                    {([
                        { id: 'zip', label: 'ZIP',    icon: FileArchive },
                        { id: 'url', label: 'URL',    icon: Link2 },
                        { id: 'ai',  label: 'AI Gen', icon: Wand2 },
                    ] as const).map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            className={cn(
                                'flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] font-bold rounded-t transition-all border-b-2',
                                activeTab === id
                                    ? 'text-white border-blue-500 bg-blue-500/8'
                                    : 'text-[#48484a] border-transparent hover:text-[#636366]'
                            )}
                        >
                            <Icon size={9} />{label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">

                {/* ══════════════════════════════════════════════════════════ */}
                {/* ZIP TAB                                                    */}
                {/* ══════════════════════════════════════════════════════════ */}
                {activeTab === 'zip' && (
                    <>
                        {(step === 'idle' || step === 'error') && (
                            <div className="p-3 space-y-3">
                                <p className="text-[9px] text-[#48484a] leading-relaxed">
                                    Drop a ZIP export (HTML + CSS + images) to import as a new page.
                                </p>
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

                        {step === 'preview' && preview && (
                            <div className="p-3 space-y-3">
                                {/* Stat pills */}
                                <div className="grid grid-cols-3 gap-1.5">
                                    {[
                                        { label: 'Nodes',    value: preview.nodeCount,     icon: Box },
                                        { label: 'Sections', value: preview.topLevelCount, icon: Layers },
                                        { label: 'Images',   value: preview.imageCount,    icon: ImageIcon },
                                    ].map(({ label, value, icon: Icon }) => (
                                        <div key={label} className="flex flex-col items-center gap-0.5 bg-[#1c1c1e] border border-[#2c2c2e] rounded-xl py-2">
                                            <Icon size={12} className="text-[#636366]" />
                                            <span className="text-[13px] font-bold text-white">{value}</span>
                                            <span className="text-[8px] text-[#48484a] uppercase tracking-wide">{label}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Node types */}
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
                                                        <span className="text-[9px] font-mono text-[#636366] w-16 truncate shrink-0">{TYPE_LABELS[type] ?? type}</span>
                                                        <div className="flex-1 h-1.5 bg-[#1c1c1e] rounded-full overflow-hidden">
                                                            <div className={cn('h-full rounded-full', TYPE_COLORS[type] ?? 'bg-zinc-500/40')} style={{ width: `${pct}%` }} />
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
                                            <span className="flex items-center gap-1.5"><AlertTriangle size={9} /> {preview.result.warnings.length} Warning{preview.result.warnings.length !== 1 ? 's' : ''}</span>
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

                                {/* Name / Slug editor */}
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

                                <p className="text-[8px] text-[#3a3a3c] leading-relaxed px-0.5">
                                    CSS will be appended (append-only) to <code className="text-[#48484a]">{cssPath}</code>
                                </p>

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

                        {step === 'importing' && (
                            <div className="flex flex-col items-center gap-3 py-12 px-4">
                                <Loader2 size={24} className="text-blue-400 animate-spin" />
                                <p className="text-[11px] font-semibold text-[#636366]">Importing…</p>
                                <div className="w-full space-y-0.5 max-h-32 overflow-y-auto">
                                    {importLog.map((l, i) => (
                                        <div key={i} className={cn('text-[9px] font-mono',
                                            l.includes('❌') ? 'text-red-400' : l.includes('✅') ? 'text-emerald-400'
                                            : l.includes('⚠️') ? 'text-yellow-400' : 'text-[#48484a]')}>{l}</div>
                                    ))}
                                </div>
                            </div>
                        )}

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
                                <div className="space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                                    {importLog.map((l, i) => (
                                        <div key={i} className={cn('text-[9px] font-mono', l.includes('✅') ? 'text-emerald-400' : 'text-[#48484a]')}>{l}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* ══════════════════════════════════════════════════════════ */}
                {/* URL TAB                                                    */}
                {/* ══════════════════════════════════════════════════════════ */}
                {activeTab === 'url' && (
                    <div className="p-3 space-y-3">
                        <p className="text-[9px] text-[#48484a] leading-relaxed">
                            Paste a direct link to a publicly hosted ZIP file. It will be fetched and imported just like a dropped file.
                        </p>

                        <div>
                            <label className="block text-[9px] font-bold text-[#636366] uppercase tracking-wider mb-1">ZIP URL</label>
                            <input
                                value={urlInput}
                                onChange={e => { setUrlInput(e.target.value); setUrlError(''); }}
                                onKeyDown={e => e.key === 'Enter' && !urlLoading && handleUrlImport()}
                                placeholder="https://example.com/design-export.zip"
                                className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-700 outline-none focus:border-blue-500/40"
                            />
                        </div>

                        {urlError && (
                            <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                                <XCircle size={10} className="text-red-400 shrink-0 mt-0.5" />
                                <span className="text-[10px] text-red-300 break-all">{urlError}</span>
                            </div>
                        )}

                        <button
                            onClick={handleUrlImport}
                            disabled={!urlInput.trim() || urlLoading}
                            className={cn(
                                'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-bold transition-all',
                                urlInput.trim() && !urlLoading
                                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                    : 'bg-[#2c2c2e] text-[#48484a] cursor-not-allowed'
                            )}
                        >
                            {urlLoading ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                            {urlLoading ? 'Fetching…' : 'Fetch & Import'}
                        </button>

                        <div className="border border-[#2c2c2e] rounded-xl p-2.5 space-y-1.5">
                            <p className="text-[9px] font-bold text-[#636366] uppercase tracking-wider">Works great with</p>
                            {[
                                'GitHub raw file URLs',
                                'Netlify / Vercel hosted ZIPs',
                                'Direct CDN download links',
                            ].map(tip => (
                                <div key={tip} className="flex items-center gap-1.5 text-[9px] text-[#48484a]">
                                    <CheckCircle2 size={8} className="text-blue-400 shrink-0" />
                                    {tip}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ══════════════════════════════════════════════════════════ */}
                {/* AI GENERATE TAB                                            */}
                {/* ══════════════════════════════════════════════════════════ */}
                {activeTab === 'ai' && (
                    <div className="p-3 space-y-3">
                        {(aiStep === 'idle' || aiStep === 'error') && (
                            <>
                                <div className="flex items-start gap-2 p-2.5 bg-blue-500/5 border border-blue-500/15 rounded-xl">
                                    <Zap size={10} className="text-blue-400 shrink-0 mt-0.5" />
                                    <p className="text-[9px] text-[#636366] leading-relaxed">
                                        Describe a UI component and it will be generated as live React code and inserted directly into your canvas.
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-[9px] font-bold text-[#636366] uppercase tracking-wider mb-1">
                                        Component Description
                                    </label>
                                    <textarea
                                        value={aiPrompt}
                                        onChange={e => setAiPrompt(e.target.value)}
                                        placeholder="A pricing card with three tiers: Free, Pro, and Enterprise. Dark background, gradient borders…"
                                        rows={4}
                                        className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] text-zinc-300 placeholder-zinc-700 outline-none focus:border-blue-500/40 resize-none leading-relaxed"
                                    />
                                </div>

                                {/* Example prompts */}
                                <div className="space-y-1">
                                    <p className="text-[9px] text-[#3a3a3c] font-bold uppercase tracking-wider">Examples</p>
                                    {[
                                        'A hero section with gradient headline and CTA buttons',
                                        'Testimonial card with avatar, quote, and star rating',
                                        'Stats row showing 3 key metrics with icons',
                                        'Feature grid with 6 items, icons, and descriptions',
                                    ].map(example => (
                                        <button
                                            key={example}
                                            onClick={() => setAiPrompt(example)}
                                            className="w-full text-left px-2 py-1.5 rounded-lg text-[9px] text-[#636366] hover:text-[#aeaeb2] hover:bg-[#1c1c1e] transition-all border border-transparent hover:border-[#2c2c2e] truncate"
                                        >
                                            → {example}
                                        </button>
                                    ))}
                                </div>

                                {aiStep === 'error' && aiError && (
                                    <div className="flex items-start gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                                        <XCircle size={10} className="text-red-400 shrink-0 mt-0.5" />
                                        <span className="text-[10px] text-red-300 break-all">{aiError}</span>
                                    </div>
                                )}

                                <button
                                    onClick={handleAIGenerate}
                                    disabled={!aiPrompt.trim()}
                                    className={cn(
                                        'w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-bold transition-all',
                                        aiPrompt.trim()
                                            ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-sm'
                                            : 'bg-[#2c2c2e] text-[#48484a] cursor-not-allowed'
                                    )}
                                >
                                    <Wand2 size={11} /> Generate Component
                                </button>

                                {!AI_CONFIG.primaryApiKey && (
                                    <p className="text-[8px] text-yellow-500/70 text-center leading-relaxed">
                                        ⚠ Set VITE_AI_PRIMARY_KEY in .env to enable AI generation
                                    </p>
                                )}
                            </>
                        )}

                        {aiStep === 'generating' && (
                            <div className="flex flex-col items-center gap-3 py-12 px-4">
                                <div className="relative">
                                    <Loader2 size={28} className="text-blue-400 animate-spin" />
                                    <Wand2 size={12} className="text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                </div>
                                <p className="text-[11px] font-semibold text-[#636366]">Generating…</p>
                                <div className="w-full space-y-0.5 max-h-16 overflow-y-auto">
                                    {aiLog.map((l, i) => (
                                        <div key={i} className={cn('text-[9px] font-mono',
                                            l.includes('✅') ? 'text-emerald-400' : l.includes('❌') ? 'text-red-400' : 'text-[#48484a]')}>{l}</div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {aiStep === 'done' && (
                            <div className="p-2 space-y-3">
                                <div className="flex flex-col items-center gap-2 py-6">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/20 flex items-center justify-center">
                                        <CheckCircle2 size={20} className="text-emerald-400" />
                                    </div>
                                    <p className="text-[13px] font-bold text-white">Component Added</p>
                                    <p className="text-[10px] text-[#636366] text-center">
                                        <span className="text-white font-semibold">{lastGenName}</span> was inserted into your canvas as a live component.
                                    </p>
                                </div>
                                <div className="space-y-0.5 max-h-16 overflow-y-auto">
                                    {aiLog.map((l, i) => (
                                        <div key={i} className={cn('text-[9px] font-mono', l.includes('✅') ? 'text-emerald-400' : 'text-[#48484a]')}>{l}</div>
                                    ))}
                                </div>
                                <button onClick={resetAI}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold bg-[#2c2c2e] hover:bg-[#3a3a3c] text-[#aeaeb2] transition-colors">
                                    <Wand2 size={10} /> Generate Another
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default StitchPanel;
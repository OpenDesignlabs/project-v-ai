/**
 * ─── DEPLOY PANEL v2 ──────────────────────────────────────────────────────────
 * DEP-1 — Real Vercel deployment via direct file upload API (Form B).
 *
 * Change Log v2:
 * ADDED: Deploy history — last 5 deploys, localStorage, revisit links
 * ADDED: Pre-deploy snapshot — file count + KB shown before deploying
 * ADDED: Auto-populate env from connected DataSources (DS-ENV-1 compliant)
 * ADDED: Phase step bar — UPLOAD → CREATE → BUILD → READY with live highlight
 * ADDED: Timestamped log lines with phase prefix badges
 * ADDED: Copy URL button on success banner
 * ADDED: Framework pill badge in panel header
 * PRESERVED: VERCEL-SEC-1, VERCEL-SEC-2, VERCEL-ABORT-1, VERCEL-FORM-B-1
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEditor } from '../context/EditorContext';
import {
    Rocket, CheckCircle2, XCircle, Plus, Trash2,
    Eye, EyeOff, ExternalLink, Loader2, ChevronDown,
    ChevronUp, Terminal, RefreshCw, Copy, Check,
    Clock, History, Zap, Database, AlertTriangle,
} from 'lucide-react';
import {
    generateNextProjectCode,
    generateProjectCode,
} from '../utils/codeGenerator';
import {
    deployToVercel,
    type VercelDeployConfig,
    type VercelDeployProgress,
    type VercelDeployResult,
    type VercelDeployPhase,
} from '../utils/vercelDeployer';
import { cn } from '../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeployStatus = 'idle' | 'building' | 'success' | 'error';

interface EnvVar {
    id: string;
    key: string;
    value: string;
    hidden: boolean;
    source?: string; // 'data-source' | undefined
}

interface DeployHistoryEntry {
    id: string;
    projectName: string;
    url: string;
    inspectorUrl: string;
    target: 'production' | 'preview';
    framework: string;
    deployedAt: number;
    fileCount: number;
}

interface LogLine {
    ts: string;
    phase: VercelDeployPhase | 'info';
    text: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VERCEL_TOKEN_KEY   = 'vectra_vercel_token';    // sessionStorage
const VERCEL_CONFIG_KEY  = 'vectra_vercel_config';   // localStorage
const VERCEL_HISTORY_KEY = 'vectra_deploy_history';  // localStorage
const MAX_HISTORY        = 5;

const PHASE_STEPS: Array<{ phase: VercelDeployPhase; label: string }> = [
    { phase: 'uploading', label: 'Upload' },
    { phase: 'creating',  label: 'Create' },
    { phase: 'building',  label: 'Build'  },
    { phase: 'ready',     label: 'Live'   },
];

const PHASE_BADGE: Record<string, string> = {
    uploading: 'UPLOAD',
    creating:  'CREATE',
    building:  'BUILD',
    ready:     'READY',
    error:     'ERROR',
    info:      'INFO',
};

const PHASE_COLOR: Record<string, string> = {
    uploading: 'text-blue-400',
    creating:  'text-yellow-400',
    building:  'text-orange-400',
    ready:     'text-emerald-400',
    error:     'text-red-400',
    info:      'text-zinc-500',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const loadHistory = (): DeployHistoryEntry[] => {
    try {
        return JSON.parse(localStorage.getItem(VERCEL_HISTORY_KEY) || '[]');
    } catch { return []; }
};

const saveHistory = (entries: DeployHistoryEntry[]) => {
    try {
        localStorage.setItem(VERCEL_HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
    } catch { /* storage unavailable */ }
};

const relTime = (ts: number): string => {
    const d = Date.now() - ts;
    if (d < 60_000) return 'just now';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return `${Math.floor(d / 86_400_000)}d ago`;
};

const fmtBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1_048_576).toFixed(1)} MB`;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const DeployPanel: React.FC = () => {
    const { elements, pages, dataSources, framework } = useEditor();

    // ── Persisted config ──────────────────────────────────────────────────────
    const savedConfig = useMemo(() => {
        try { return JSON.parse(localStorage.getItem(VERCEL_CONFIG_KEY) || '{}'); }
        catch { return {}; }
    }, []);

    const [token, setToken]           = useState<string>(() => sessionStorage.getItem(VERCEL_TOKEN_KEY) ?? '');
    const [showToken, setShowToken]   = useState(false);
    const [projectName, setProjectName] = useState<string>(savedConfig.projectName ?? 'my-vectra-app');
    const [target, setTarget]         = useState<'production' | 'preview'>(savedConfig.target ?? 'preview');

    // ── Env vars ──────────────────────────────────────────────────────────────
    const [envVars, setEnvVars]   = useState<EnvVar[]>([]);
    const [newKey, setNewKey]     = useState('');
    const [newValue, setNewValue] = useState('');

    // ── Deploy state ──────────────────────────────────────────────────────────
    const [status, setStatus]           = useState<DeployStatus>('idle');
    const [currentPhase, setCurrentPhase] = useState<VercelDeployPhase | null>(null);
    const [logLines, setLogLines]       = useState<LogLine[]>([]);
    const [deployResult, setDeployResult] = useState<VercelDeployResult | null>(null);
    const [deployError, setDeployError] = useState<string | null>(null);
    const [logOpen, setLogOpen]         = useState(true);
    const [copiedUrl, setCopiedUrl]     = useState(false);

    // ── History ───────────────────────────────────────────────────────────────
    const [history, setHistory]         = useState<DeployHistoryEntry[]>(loadHistory);
    const [historyOpen, setHistoryOpen] = useState(false);

    const logRef  = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // ── Pre-deploy snapshot ───────────────────────────────────────────────────
    const fileSnapshot = useMemo((): { count: number; sizeKb: string } | null => {
        try {
            const fw = framework as 'nextjs' | 'vite';
            const { files } = fw === 'nextjs'
                ? generateNextProjectCode(elements, pages)
                : generateProjectCode(elements, pages, dataSources ?? []);
            const bytes = Object.values(files).reduce((a, v) => a + v.length, 0);
            return { count: Object.keys(files).length, sizeKb: fmtBytes(bytes) };
        } catch { return null; }
    }, [elements, pages, framework]);

    // ── Persistence ───────────────────────────────────────────────────────────
    useEffect(() => {
        try { localStorage.setItem(VERCEL_CONFIG_KEY, JSON.stringify({ projectName, target })); }
        catch { /* ok */ }
    }, [projectName, target]);

    // VERCEL-SEC-1: token → sessionStorage only
    useEffect(() => {
        if (token) sessionStorage.setItem(VERCEL_TOKEN_KEY, token);
        else sessionStorage.removeItem(VERCEL_TOKEN_KEY);
    }, [token]);

    // Auto-scroll log
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logLines]);

    // VERCEL-ABORT-1: cancel on unmount
    useEffect(() => () => { abortRef.current?.abort(); }, []);

    // ── Auto-populate env from DataSources ────────────────────────────────────
    // DS-ENV-1 compliant: for Supabase the anon key is technically public (designed
    // for client-side use). PlanetScale password is left empty intentionally.
    const autoPopulateEnv = useCallback(() => {
        if (!dataSources?.length) return;
        const toAdd: EnvVar[] = [];

        dataSources.forEach(ds => {
            if (!ds.envVarMap) return;

            if (ds.kind === 'supabase') {
                const urlK  = ds.envVarMap.url  ?? 'NEXT_PUBLIC_SUPABASE_URL';
                const keyK  = ds.envVarMap.supabaseAnonKey ?? 'NEXT_PUBLIC_SUPABASE_ANON_KEY';
                if (!envVars.find(e => e.key === urlK) && ds.url) {
                    toAdd.push({ id: `ev-${crypto.randomUUID().slice(0,8)}`, key: urlK, value: ds.url, hidden: false, source: 'data-source' });
                }
                if (!envVars.find(e => e.key === keyK) && ds.supabaseAnonKey) {
                    toAdd.push({ id: `ev-${crypto.randomUUID().slice(0,8)}`, key: keyK, value: ds.supabaseAnonKey, hidden: true, source: 'data-source' });
                }
            } else if (ds.kind === 'planetscale') {
                const hostK = ds.envVarMap.psHost     ?? 'DATABASE_HOST';
                const userK = ds.envVarMap.psUsername ?? 'DATABASE_USERNAME';
                const passK = ds.envVarMap.psPassword ?? 'DATABASE_PASSWORD';
                const dbK   = ds.envVarMap.psDatabase ?? 'DATABASE_NAME';
                [
                    { k: hostK, v: ds.psHost ?? '',     hidden: false },
                    { k: userK, v: ds.psUsername ?? '',  hidden: false },
                    { k: passK, v: '',                   hidden: true  }, // NEVER pre-fill password
                    { k: dbK,   v: ds.psDatabase ?? '',  hidden: false },
                ].forEach(({ k, v, hidden }) => {
                    if (!envVars.find(e => e.key === k)) {
                        toAdd.push({ id: `ev-${crypto.randomUUID().slice(0,8)}`, key: k, value: v, hidden, source: 'data-source' });
                    }
                });
            }
        });

        if (toAdd.length > 0) setEnvVars(prev => [...prev, ...toAdd]);
    }, [dataSources, envVars]);

    // ── Env var actions ───────────────────────────────────────────────────────
    const addEnvVar = useCallback(() => {
        if (!newKey.trim()) return;
        setEnvVars(prev => [...prev, { id: `ev-${crypto.randomUUID().slice(0,8)}`, key: newKey.trim(), value: newValue, hidden: true }]);
        setNewKey(''); setNewValue('');
    }, [newKey, newValue]);

    const removeEnvVar  = useCallback((id: string) => setEnvVars(prev => prev.filter(e => e.id !== id)), []);
    const toggleHide    = useCallback((id: string) => setEnvVars(prev => prev.map(e => e.id === id ? { ...e, hidden: !e.hidden } : e)), []);

    // ── Log helper ────────────────────────────────────────────────────────────
    const appendLog = useCallback((phase: VercelDeployPhase | 'info', text: string) => {
        setLogLines(prev => [...prev, {
            ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            phase,
            text,
        }]);
    }, []);

    // ── Deploy ────────────────────────────────────────────────────────────────
    const handleDeploy = useCallback(async () => {
        if (!token.trim())       { setDeployError('Vercel API token is required.'); return; }
        if (!projectName.trim()) { setDeployError('Project name is required.');     return; }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setStatus('building');
        setCurrentPhase('uploading');
        setLogLines([]);
        setDeployResult(null);
        setDeployError(null);
        setLogOpen(true);

        let fileCount = 0;

        try {
            const fw = framework as 'nextjs' | 'vite';
            const { files } = fw === 'nextjs'
                ? generateNextProjectCode(elements, pages, dataSources ?? [])
                : generateProjectCode(elements, pages, dataSources ?? []);

            fileCount = Object.keys(files).length;
            appendLog('info', `Ready to deploy — ${fileCount} files (${fw})`);

            const envMap: Record<string, string> = {};
            for (const ev of envVars) {
                if (ev.key.trim()) envMap[ev.key.trim()] = ev.value;
            }

            const config: VercelDeployConfig = {
                token: token.trim(),
                projectName: projectName.trim(),
                target,
                env: envMap,
                framework: fw,
            };

            const onProgress = (p: VercelDeployProgress) => {
                setCurrentPhase(p.phase);
                if (p.logLine) appendLog(p.phase, p.logLine);
            };

            const result = await deployToVercel(files, config, onProgress, controller.signal);

            setDeployResult(result);
            setStatus('success');
            setCurrentPhase('ready');

            // Update history
            const entry: DeployHistoryEntry = {
                id: result.deploymentId,
                projectName: projectName.trim(),
                url: result.url,
                inspectorUrl: result.inspectorUrl,
                target: result.target,
                framework: fw,
                deployedAt: Date.now(),
                fileCount,
            };
            setHistory(prev => {
                const next = [entry, ...prev.filter(h => h.id !== entry.id)].slice(0, MAX_HISTORY);
                saveHistory(next);
                return next;
            });

        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            const msg = err instanceof Error ? err.message : String(err);
            setDeployError(msg);
            setStatus('error');
            setCurrentPhase(null);
            appendLog('error', `✖ ${msg}`);
        }
    }, [token, projectName, target, envVars, elements, pages, dataSources, framework, appendLog]);

    const handleCancel = useCallback(() => {
        abortRef.current?.abort();
        setStatus('idle');
        setCurrentPhase(null);
        appendLog('info', '● Deploy cancelled.');
    }, [appendLog]);

    const handleReset = useCallback(() => {
        abortRef.current?.abort();
        setStatus('idle');
        setCurrentPhase(null);
        setLogLines([]);
        setDeployResult(null);
        setDeployError(null);
    }, []);

    const copyUrl = useCallback(() => {
        if (!deployResult) return;
        navigator.clipboard.writeText(deployResult.url).then(() => {
            setCopiedUrl(true);
            setTimeout(() => setCopiedUrl(false), 2000);
        });
    }, [deployResult]);

    // ── Render helpers ────────────────────────────────────────────────────────
    const isBuilding   = status === 'building';
    const canDeploy    = !!token.trim() && !!projectName.trim() && !isBuilding;
    const hasSources   = (dataSources?.length ?? 0) > 0;
    const sourceEnvCount = dataSources?.reduce((n, ds) => n + Object.keys(ds.envVarMap ?? {}).length, 0) ?? 0;

    const currentPhaseIndex = PHASE_STEPS.findIndex(s => s.phase === currentPhase);

    return (
        <div className="flex flex-col h-full text-[#ccc] select-none overflow-y-auto custom-scrollbar">

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="px-3 pt-3 pb-2.5 border-b border-[#3f3f46] shrink-0">
                <div className="flex items-center gap-2 mb-1">
                    <Rocket size={13} className="text-[#a78bfa]" />
                    <span className="text-[10px] font-bold text-white tracking-wider uppercase">Deploy to Vercel</span>
                    <span className={cn(
                        'ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide',
                        framework === 'nextjs' ? 'bg-white/10 text-white' : 'bg-yellow-500/15 text-yellow-300'
                    )}>
                        {framework === 'nextjs' ? 'Next.js' : 'Vite'}
                    </span>
                </div>
                {/* Pre-deploy snapshot */}
                {fileSnapshot && (
                    <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-1 text-[9px] text-zinc-600">
                            <Zap size={9} className="text-zinc-700" />
                            <span>{fileSnapshot.count} files</span>
                            <span className="text-zinc-800">·</span>
                            <span>{fileSnapshot.sizeKb}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Credentials ───────────────────────────────────────────────── */}
            <div className="px-3 py-2.5 border-b border-[#3f3f46] space-y-2">
                <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                        API Token <span className="text-zinc-700 normal-case font-normal ml-1">(session only)</span>
                    </label>
                    <div className="relative">
                        <input
                            type={showToken ? 'text' : 'password'}
                            value={token}
                            onChange={e => setToken(e.target.value)}
                            placeholder="vercel_token_…"
                            className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 font-mono placeholder-zinc-700 outline-none focus:border-[#a78bfa]/60 pr-7"
                            autoComplete="off"
                        />
                        <button type="button" onClick={() => setShowToken(p => !p)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-700 hover:text-zinc-500">
                            {showToken ? <EyeOff size={10} /> : <Eye size={10} />}
                        </button>
                    </div>
                    <p className="text-[8px] text-zinc-700 mt-0.5">vercel.com/account/tokens · Deploy scope</p>
                </div>

                <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Project Name</label>
                    <input
                        type="text"
                        value={projectName}
                        onChange={e => setProjectName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                        placeholder="my-vectra-app"
                        className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 font-mono placeholder-zinc-700 outline-none focus:border-[#a78bfa]/60"
                    />
                </div>

                <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Target</label>
                    <div className="flex rounded overflow-hidden border border-[#3e3e42]">
                        {(['preview', 'production'] as const).map(t => (
                            <button key={t} onClick={() => setTarget(t)}
                                className={cn(
                                    'flex-1 py-1 text-[9px] font-bold capitalize transition-all',
                                    target === t
                                        ? t === 'production' ? 'bg-[#a78bfa]/20 text-[#a78bfa]' : 'bg-[#60a5fa]/15 text-[#60a5fa]'
                                        : 'text-zinc-600 hover:text-zinc-400'
                                )}>
                                {t}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Env Vars ──────────────────────────────────────────────────── */}
            <div className="px-3 py-2.5 border-b border-[#3f3f46]">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                        Environment Variables
                    </span>
                    <div className="flex items-center gap-1.5">
                        {hasSources && sourceEnvCount > 0 && (
                            <button
                                onClick={autoPopulateEnv}
                                title={`Auto-populate from ${dataSources?.length} data source(s)`}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold text-emerald-400/80 hover:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40 transition-all"
                            >
                                <Database size={8} /> Auto-fill from Sources
                            </button>
                        )}
                        <span className="text-[8px] text-zinc-700">{envVars.length} var{envVars.length !== 1 ? 's' : ''}</span>
                    </div>
                </div>

                {envVars.length > 0 && (
                    <div className="space-y-1 mb-2">
                        {envVars.map(ev => (
                            <div key={ev.id} className="flex items-center gap-1.5 group">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-1">
                                        <span className={cn(
                                            'text-[9px] font-mono truncate',
                                            ev.source === 'data-source' ? 'text-emerald-400/70' : 'text-zinc-400'
                                        )}>{ev.key}</span>
                                        {ev.source === 'data-source' && (
                                            <span className="text-[7px] text-emerald-500/50 shrink-0">auto</span>
                                        )}
                                    </div>
                                    <div className="text-[9px] font-mono text-zinc-700 truncate">
                                        {ev.hidden ? '••••••••' : ev.value || '(empty)'}
                                    </div>
                                </div>
                                <button onClick={() => toggleHide(ev.id)} className="p-1 text-zinc-600 hover:text-zinc-400 rounded">
                                    {ev.hidden ? <Eye size={10} /> : <EyeOff size={10} />}
                                </button>
                                <button onClick={() => removeEnvVar(ev.id)} className="p-1 text-zinc-700 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all">
                                    <Trash2 size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="space-y-1">
                    <input
                        type="text"
                        value={newKey}
                        onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                        onKeyDown={e => e.key === 'Enter' && addEnvVar()}
                        placeholder="KEY"
                        className="w-full bg-[#2a2a2a] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-600 font-mono outline-none focus:border-[#636366]"
                    />
                    <input
                        type="password"
                        value={newValue}
                        onChange={e => setNewValue(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addEnvVar()}
                        placeholder="value"
                        className="w-full bg-[#2a2a2a] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-600 font-mono outline-none focus:border-[#636366]"
                    />
                    <button
                        onClick={addEnvVar} disabled={!newKey.trim()}
                        className="w-full flex items-center justify-center gap-1.5 py-1 rounded text-[10px] text-zinc-400 hover:text-white hover:bg-[#3e3e42] border border-dashed border-[#3e3e42] hover:border-zinc-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <Plus size={10} /> Add Variable
                    </button>
                </div>
            </div>

            {/* ── Phase Step Bar ─────────────────────────────────────────────── */}
            {isBuilding && (
                <div className="px-3 py-2 border-b border-[#3f3f46] bg-[#1a1a1e]">
                    <div className="flex items-center gap-1">
                        {PHASE_STEPS.map((step, i) => {
                            const isDone    = currentPhaseIndex > i;
                            const isActive  = currentPhaseIndex === i;
                            return (
                                <React.Fragment key={step.phase}>
                                    <div className={cn(
                                        'flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all',
                                        isDone   ? 'text-emerald-400'
                                        : isActive ? 'text-white animate-pulse'
                                        : 'text-zinc-700'
                                    )}>
                                        {isDone    ? <CheckCircle2 size={9} /> :
                                         isActive  ? <Loader2 size={9} className="animate-spin" /> :
                                                     <div className="w-2 h-2 rounded-full border border-zinc-700" />}
                                        {step.label}
                                    </div>
                                    {i < PHASE_STEPS.length - 1 && (
                                        <div className={cn('flex-1 h-px', isDone ? 'bg-emerald-500/40' : 'bg-[#2c2c2e]')} />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Success Banner ────────────────────────────────────────────── */}
            {status === 'success' && deployResult && (
                <div className="mx-3 mt-2.5 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <div className="flex items-center gap-1.5 mb-1.5">
                        <CheckCircle2 size={11} className="text-emerald-400" />
                        <span className="text-[10px] font-bold text-emerald-300">
                            {deployResult.target === 'production' ? 'Production' : 'Preview'} Deployed
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <a href={deployResult.url} target="_blank" rel="noopener noreferrer"
                            className="text-[9px] font-mono text-emerald-400/80 hover:text-emerald-300 truncate flex-1 transition-colors">
                            {deployResult.url}
                        </a>
                        <button onClick={copyUrl} title="Copy URL"
                            className="shrink-0 text-zinc-500 hover:text-emerald-400 transition-colors">
                            {copiedUrl ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                        </button>
                        <a href={deployResult.inspectorUrl} target="_blank" rel="noopener noreferrer"
                            className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors" title="Vercel dashboard">
                            <ExternalLink size={10} />
                        </a>
                    </div>
                </div>
            )}

            {/* ── Error Banner ──────────────────────────────────────────────── */}
            {deployError && status === 'error' && (
                <div className="mx-3 mt-2.5 p-2.5 rounded-xl bg-red-500/8 border border-red-500/20 flex items-start gap-2">
                    <AlertTriangle size={11} className="text-red-400 mt-0.5 shrink-0" />
                    <span className="text-[10px] text-red-300 font-mono break-all">{deployError}</span>
                </div>
            )}

            {/* ── Log Terminal ──────────────────────────────────────────────── */}
            {logLines.length > 0 && (
                <div className="mx-3 mt-2.5 rounded-xl overflow-hidden border border-[#2a2a2a]">
                    <button
                        onClick={() => setLogOpen(p => !p)}
                        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#1a1a1e] text-[9px] font-bold text-zinc-500 hover:text-zinc-400 border-b border-[#2a2a2a] transition-colors"
                    >
                        <span className="flex items-center gap-1.5"><Terminal size={9} /> Build Log</span>
                        {logOpen ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                    </button>
                    {logOpen && (
                        <div ref={logRef} className="bg-[#0e0e10] px-2.5 py-2 space-y-0.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                            {logLines.map((line, i) => (
                                <div key={i} className="flex items-baseline gap-1.5 text-[9px] font-mono">
                                    <span className="text-zinc-800 shrink-0">{line.ts}</span>
                                    <span className={cn('shrink-0 font-bold text-[8px]', PHASE_COLOR[line.phase])}>
                                        [{PHASE_BADGE[line.phase]}]
                                    </span>
                                    <span className={cn(
                                        'leading-relaxed break-all',
                                        line.phase === 'error' ? 'text-red-400'
                                        : line.phase === 'ready' ? 'text-emerald-400'
                                        : line.text.startsWith('  ▶') ? 'text-zinc-700'
                                        : 'text-zinc-500'
                                    )}>
                                        {line.text}
                                    </span>
                                </div>
                            ))}
                            {isBuilding && <div className="text-[9px] font-mono text-zinc-700 animate-pulse">▌</div>}
                        </div>
                    )}
                </div>
            )}

            {/* ── Actions ───────────────────────────────────────────────────── */}
            <div className="px-3 py-2.5 space-y-2 mt-auto">
                {isBuilding ? (
                    <button onClick={handleCancel}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-bold bg-[#3f3f46] hover:bg-zinc-600 text-zinc-300 transition-all">
                        <XCircle size={12} /> Cancel Deploy
                    </button>
                ) : (
                    <div className="space-y-1.5">
                        <button onClick={handleDeploy} disabled={!canDeploy}
                            className={cn(
                                'w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all',
                                canDeploy
                                    ? 'bg-[#a78bfa] hover:bg-[#9061f9] text-white shadow-sm hover:shadow-[0_0_12px_rgba(139,92,246,0.35)]'
                                    : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                            )}>
                            <Rocket size={12} />
                            {status === 'success' ? 'Redeploy' : `Deploy to ${target === 'production' ? 'Production' : 'Preview'}`}
                        </button>
                        {status !== 'idle' && (
                            <button onClick={handleReset}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                                <RefreshCw size={10} /> Reset
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* ── Deploy History ────────────────────────────────────────────── */}
            {history.length > 0 && (
                <div className="border-t border-[#3f3f46] mt-1">
                    <button
                        onClick={() => setHistoryOpen(p => !p)}
                        className="w-full flex items-center justify-between px-3 py-2 text-[9px] font-bold text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                        <span className="flex items-center gap-1.5"><History size={9} /> Recent Deploys ({history.length})</span>
                        {historyOpen ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                    </button>
                    {historyOpen && (
                        <div className="px-3 pb-3 space-y-2">
                            {history.map(h => (
                                <div key={h.id} className="p-2 rounded-lg border border-[#2c2c2e] bg-[#1a1a1e] group">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[10px] font-semibold text-zinc-300 truncate">{h.projectName}</span>
                                        <div className="flex items-center gap-1.5">
                                            <span className={cn(
                                                'text-[7px] font-bold px-1 py-0.5 rounded uppercase',
                                                h.target === 'production' ? 'bg-[#a78bfa]/15 text-[#a78bfa]' : 'bg-blue-500/10 text-blue-400'
                                            )}>{h.target}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <Clock size={8} className="text-zinc-700 shrink-0" />
                                        <span className="text-[9px] text-zinc-600">{relTime(h.deployedAt)}</span>
                                        <span className="text-zinc-800">·</span>
                                        <span className="text-[9px] text-zinc-700">{h.fileCount} files</span>
                                        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <a href={h.url} target="_blank" rel="noopener noreferrer"
                                                className="text-zinc-600 hover:text-emerald-400 transition-colors" title="Open site">
                                                <ExternalLink size={9} />
                                            </a>
                                        </div>
                                    </div>
                                    <div className="mt-1 text-[8px] font-mono text-zinc-700 truncate">{h.url}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default DeployPanel;

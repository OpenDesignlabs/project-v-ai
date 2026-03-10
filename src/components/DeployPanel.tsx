/**
 * ─── DEPLOY PANEL ─────────────────────────────────────────────────────────────
 * DEP-1 — Real Vercel deployment via direct file upload API (Form B).
 *
 * Flow:
 *   1. User enters Vercel token + project name.
 *   2. User configures env vars (add/remove/hide).
 *   3. "Deploy" → generates fresh file map → uploads blobs → creates deployment
 *      → polls until READY → shows live URL.
 *
 * VERCEL-SEC-1 [PERMANENT]: token in sessionStorage only. Never localStorage.
 * VERCEL-SEC-2 [PERMANENT]: env var values never written to log or element tree.
 * VERCEL-ABORT-1 [PERMANENT]: all deploys are cancellable via AbortController.
 *
 * The simulated runDeploy that previously used setTimeout + fake log lines has
 * been fully replaced with the real deployToVercel() pipeline.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditor } from '../context/EditorContext';
import {
    Rocket, GitBranch, CheckCircle2, XCircle,
    Plus, Trash2, Eye, EyeOff, ExternalLink, Loader2,
    ChevronDown, ChevronUp, Terminal, RefreshCw,
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
} from '../utils/vercelDeployer';
import { cn } from '../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeployStatus = 'idle' | 'building' | 'success' | 'error';

interface EnvVar {
    id: string;
    key: string;
    value: string;
    hidden: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VERCEL_TOKEN_KEY = 'vectra_vercel_token';    // sessionStorage only
const VERCEL_CONFIG_KEY = 'vectra_vercel_config';   // localStorage (non-secret)

// ─── Component ────────────────────────────────────────────────────────────────

export const DeployPanel: React.FC = () => {
    const { elements, pages, dataSources, framework } = useEditor();

    // ── Credentials (persisted per VERCEL-SEC-1) ──────────────────────────────
    const savedConfig = (() => {
        try { return JSON.parse(localStorage.getItem(VERCEL_CONFIG_KEY) || '{}'); }
        catch { return {}; }
    })();

    const [token, setToken] = useState<string>(() =>
        sessionStorage.getItem(VERCEL_TOKEN_KEY) ?? ''
    );
    const [showToken, setShowToken] = useState(false);
    const [projectName, setProjectName] = useState<string>(savedConfig.projectName ?? 'my-vectra-app');
    const [target, setTarget] = useState<'production' | 'preview'>(
        savedConfig.target ?? 'preview'
    );

    // ── Env vars ─────────────────────────────────────────────────────────────
    const [envVars, setEnvVars] = useState<EnvVar[]>([
        { id: 'ev-1', key: 'NEXT_PUBLIC_API_URL', value: '', hidden: true },
    ]);
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');

    // ── Deploy state ─────────────────────────────────────────────────────────
    const [status, setStatus] = useState<DeployStatus>('idle');
    const [logLines, setLogLines] = useState<string[]>([]);
    const [deployResult, setDeployResult] = useState<VercelDeployResult | null>(null);
    const [deployError, setDeployError] = useState<string | null>(null);
    const [logOpen, setLogOpen] = useState(true);

    const logRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Persist non-secret config to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(VERCEL_CONFIG_KEY, JSON.stringify({ projectName, target }));
        } catch { /* storage unavailable */ }
    }, [projectName, target]);

    // VERCEL-SEC-1: token → sessionStorage only. Never localStorage.
    useEffect(() => {
        if (token) sessionStorage.setItem(VERCEL_TOKEN_KEY, token);
        else sessionStorage.removeItem(VERCEL_TOKEN_KEY);
    }, [token]);

    // Auto-scroll log to bottom as lines arrive
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logLines]);

    // VERCEL-ABORT-1: cancel in-flight deploy on unmount
    useEffect(() => () => { abortRef.current?.abort(); }, []);

    // ── Env var actions ───────────────────────────────────────────────────────
    const addEnvVar = useCallback(() => {
        if (!newKey.trim()) return;
        setEnvVars(prev => [...prev, {
            id: `ev-${crypto.randomUUID().slice(0, 8)}`,
            key: newKey.trim(),
            value: newValue,
            hidden: true,
        }]);
        setNewKey('');
        setNewValue('');
    }, [newKey, newValue]);

    const removeEnvVar = useCallback((id: string) => {
        setEnvVars(prev => prev.filter(e => e.id !== id));
    }, []);

    const toggleHide = useCallback((id: string) => {
        setEnvVars(prev => prev.map(e => e.id === id ? { ...e, hidden: !e.hidden } : e));
    }, []);

    // ── Deploy ────────────────────────────────────────────────────────────────
    const handleDeploy = useCallback(async () => {
        if (!token.trim()) { setDeployError('Vercel API token is required.'); return; }
        if (!projectName.trim()) { setDeployError('Project name is required.'); return; }

        // Cancel any in-flight deploy
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setStatus('building');
        setLogLines([]);
        setDeployResult(null);
        setDeployError(null);
        setLogOpen(true);

        try {
            // Generate fresh file map — same source as GitHub publish (Header.tsx)
            const fw = framework as 'nextjs' | 'vite';
            const { files } = fw === 'nextjs'
                ? generateNextProjectCode(elements, pages, dataSources ?? [])
                : generateProjectCode(elements, pages, dataSources ?? []);

            setLogLines(prev => [...prev, `Generated ${Object.keys(files).length} files (${fw})`]);

            // Build env map from UI — VERCEL-SEC-2: values sent to API, never logged
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
                if (p.logLine) setLogLines(prev => [...prev, p.logLine!]);
            };

            const result = await deployToVercel(files, config, onProgress, controller.signal);

            setDeployResult(result);
            setStatus('success');
        } catch (err: any) {
            if (err?.name === 'AbortError') return; // unmount or manual cancel — silent
            const msg = err instanceof Error ? err.message : String(err);
            setDeployError(msg);
            setStatus('error');
            setLogLines(prev => [...prev, `✖ ${msg}`]);
        }
    }, [token, projectName, target, envVars, elements, pages, dataSources, framework]);

    const handleCancel = useCallback(() => {
        abortRef.current?.abort();
        setStatus('idle');
        setLogLines(prev => [...prev, '● Deploy cancelled.']);
    }, []);

    const handleReset = useCallback(() => {
        abortRef.current?.abort();
        setStatus('idle');
        setLogLines([]);
        setDeployResult(null);
        setDeployError(null);
    }, []);

    // ── Render helpers ────────────────────────────────────────────────────────
    const isBuilding = status === 'building';
    const canDeploy = !!token.trim() && !!projectName.trim() && !isBuilding;

    return (
        <div className="flex flex-col h-full text-[#ccc] select-none">

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="px-3 pt-3 pb-2.5 border-b border-[#3f3f46]">
                <div className="flex items-center gap-2 mb-1">
                    <Rocket size={13} className="text-[#a78bfa]" />
                    <span className="text-[10px] font-bold text-white tracking-wider uppercase">Deploy to Vercel</span>
                </div>
                <p className="text-[9px] text-zinc-600 leading-relaxed">
                    Publish directly from your canvas. Files are uploaded without a Git repo.
                </p>
            </div>

            {/* ── Credentials ───────────────────────────────────────────────── */}
            <div className="px-3 py-2.5 border-b border-[#3f3f46] space-y-2">
                {/* Token */}
                <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                        API Token
                        <span className="ml-1 text-zinc-700 normal-case font-normal">(session only)</span>
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
                        <button
                            type="button"
                            onClick={() => setShowToken(p => !p)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-700 hover:text-zinc-500"
                        >
                            {showToken ? <EyeOff size={10} /> : <Eye size={10} />}
                        </button>
                    </div>
                    <p className="text-[8px] text-zinc-700 mt-0.5">
                        vercel.com/account/tokens · needs Deploy scope
                    </p>
                </div>

                {/* Project name */}
                <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                        Project Name
                    </label>
                    <input
                        type="text"
                        value={projectName}
                        onChange={e => setProjectName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                        placeholder="my-vectra-app"
                        className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 font-mono placeholder-zinc-700 outline-none focus:border-[#a78bfa]/60"
                    />
                </div>

                {/* Target toggle */}
                <div>
                    <label className="block text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                        Target
                    </label>
                    <div className="flex rounded overflow-hidden border border-[#3e3e42]">
                        {(['preview', 'production'] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTarget(t)}
                                className={cn(
                                    'flex-1 py-1 text-[9px] font-bold capitalize transition-all',
                                    target === t
                                        ? t === 'production'
                                            ? 'bg-[#a78bfa]/20 text-[#a78bfa]'
                                            : 'bg-[#60a5fa]/15 text-[#60a5fa]'
                                        : 'text-zinc-600 hover:text-zinc-400'
                                )}
                            >
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
                    <span className="text-[8px] text-zinc-700">{envVars.length} var{envVars.length !== 1 ? 's' : ''}</span>
                </div>

                {envVars.length > 0 && (
                    <div className="space-y-1 mb-2">
                        {envVars.map(ev => (
                            <div key={ev.id} className="flex items-center gap-1 group">
                                <div className="flex-1 min-w-0 bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1">
                                    <div className="text-[9px] text-zinc-400 font-mono truncate">{ev.key}</div>
                                    <div className="text-[9px] text-zinc-600 font-mono truncate">
                                        {ev.hidden ? '••••••••' : ev.value || '(empty)'}
                                    </div>
                                </div>
                                <button
                                    onClick={() => toggleHide(ev.id)}
                                    className="p-1 text-zinc-600 hover:text-zinc-400 rounded transition-colors"
                                >
                                    {ev.hidden ? <Eye size={10} /> : <EyeOff size={10} />}
                                </button>
                                <button
                                    onClick={() => removeEnvVar(ev.id)}
                                    className="p-1 text-zinc-700 hover:text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <Trash2 size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add new env var */}
                <div className="space-y-1">
                    <input
                        type="text"
                        value={newKey}
                        onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
                        onKeyDown={e => e.key === 'Enter' && addEnvVar()}
                        placeholder="KEY"
                        className="w-full bg-[#2a2a2a] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-600 font-mono outline-none focus:border-[#636366] transition-colors"
                    />
                    <input
                        type="password"
                        value={newValue}
                        onChange={e => setNewValue(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addEnvVar()}
                        placeholder="value"
                        className="w-full bg-[#2a2a2a] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-600 font-mono outline-none focus:border-[#636366] transition-colors"
                    />
                    <button
                        onClick={addEnvVar}
                        disabled={!newKey.trim()}
                        className="w-full flex items-center justify-center gap-1.5 py-1 rounded text-[10px] text-zinc-400 hover:text-white hover:bg-[#3e3e42] border border-dashed border-[#3e3e42] hover:border-zinc-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <Plus size={10} /> Add Variable
                    </button>
                </div>
            </div>

            {/* ── Result Banner ─────────────────────────────────────────────── */}
            {status === 'success' && deployResult && (
                <div className="mx-3 mt-2.5 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <div className="flex items-center gap-1.5 mb-1.5">
                        <CheckCircle2 size={11} className="text-emerald-400" />
                        <span className="text-[10px] font-bold text-emerald-300">
                            {deployResult.target === 'production' ? 'Live on Production' : 'Preview Deployed'}
                        </span>
                    </div>
                    <a
                        href={deployResult.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[10px] text-blue-400 hover:text-blue-300 font-mono truncate transition-colors mb-1"
                    >
                        <ExternalLink size={10} />
                        {deployResult.url.replace('https://', '')}
                    </a>
                    <a
                        href={deployResult.inspectorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-400 transition-colors"
                    >
                        <Rocket size={9} />
                        View in Vercel Dashboard
                    </a>
                </div>
            )}

            {status === 'error' && deployError && (
                <div className="mx-3 mt-2.5 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-1.5 mb-1">
                        <XCircle size={11} className="text-red-400" />
                        <span className="text-[10px] font-bold text-red-300">Deploy Failed</span>
                    </div>
                    <p className="text-[9px] text-red-300/80 font-mono break-words leading-relaxed">{deployError}</p>
                </div>
            )}

            {/* ── Build Log ─────────────────────────────────────────────────── */}
            {(logLines.length > 0 || isBuilding) && (
                <div className="border-b border-[#3f3f46] mt-1">
                    <button
                        onClick={() => setLogOpen(o => !o)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#2a2a2a] transition-colors"
                    >
                        <div className="flex items-center gap-1.5 text-[9px] text-zinc-500 font-bold uppercase">
                            <Terminal size={9} />
                            Build Log
                            {isBuilding && <Loader2 size={9} className="text-[#a78bfa] animate-spin ml-1" />}
                        </div>
                        {logOpen ? <ChevronUp size={10} className="text-zinc-600" /> : <ChevronDown size={10} className="text-zinc-600" />}
                    </button>
                    {logOpen && (
                        <div
                            ref={logRef}
                            className="px-3 pb-3 space-y-0.5 max-h-[180px] overflow-y-auto custom-scrollbar"
                        >
                            {logLines.map((line, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        'text-[9px] font-mono leading-relaxed',
                                        line.startsWith('✖') ? 'text-red-400'
                                            : line.startsWith('✓') || line.startsWith('●') ? 'text-emerald-400'
                                                : line.startsWith('  ▶') ? 'text-zinc-700'
                                                    : line.startsWith('  ●') ? 'text-[#a78bfa]'
                                                        : 'text-zinc-500'
                                    )}
                                >
                                    {line}
                                </div>
                            ))}
                            {isBuilding && (
                                <div className="text-[9px] font-mono text-zinc-700 animate-pulse">▌</div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Actions ───────────────────────────────────────────────────── */}
            <div className="px-3 py-2.5 space-y-2 mt-auto">
                {isBuilding ? (
                    <button
                        onClick={handleCancel}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-bold bg-[#3f3f46] hover:bg-zinc-600 text-zinc-300 transition-all"
                    >
                        <XCircle size={12} />
                        Cancel Deploy
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handleDeploy}
                            disabled={!canDeploy}
                            className={cn(
                                'w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all',
                                canDeploy
                                    ? 'bg-[#a78bfa] hover:bg-[#9061f9] text-white shadow-sm hover:shadow-[0_0_12px_rgba(139,92,246,0.4)]'
                                    : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                            )}
                        >
                            <><Rocket size={12} /> {status === 'success' ? 'Redeploy' : `Deploy to ${target === 'production' ? 'Production' : 'Preview'}`}</>
                        </button>

                        {(status === 'success' || status === 'error') && (
                            <button
                                onClick={handleReset}
                                className="w-full flex items-center justify-center gap-2 py-1.5 rounded text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                                <RefreshCw size={10} />
                                Reset
                            </button>
                        )}
                    </>
                )}

                {/* Framework badge */}
                <div className="flex items-center justify-center gap-1.5 pt-1 pb-1">
                    <GitBranch size={9} className="text-zinc-700" />
                    <span className="text-[8px] text-zinc-700 font-mono">
                        {framework === 'nextjs' ? 'Next.js 14' : 'Vite + React'} · {pages.length} page{pages.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default DeployPanel;

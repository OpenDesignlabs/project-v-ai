/**
 * ─── DEPLOY PANEL ─────────────────────────────────────────────────────────────
 * Direction B — Deployment surface inside the LeftSidebar.
 *
 * Responsibility:
 *   - Display the active project & target branch.
 *   - Manage a list of environment variables (key/value, add/remove).
 *   - Simulate a deploy build log with streaming output.
 *   - Show deploy status: idle → building → success / error.
 *   - Link to the live preview URL once deployed.
 *
 * State is entirely local — no ProjectContext writes. Nothing here affects
 * the canvas, the VFS, or any other panel.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditor } from '../context/EditorContext';
import { useContainer } from '../context/ContainerContext';
import {
    Rocket, GitBranch, RefreshCw, CheckCircle2, XCircle,
    Plus, Trash2, Eye, EyeOff, ExternalLink, Loader2,
    ChevronDown, ChevronUp, Terminal,
} from 'lucide-react';
import { cn } from '../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeployStatus = 'idle' | 'building' | 'success' | 'error';

interface EnvVar {
    id: string;
    key: string;
    value: string;
    hidden: boolean;
}

// ─── Simulated build log lines ────────────────────────────────────────────────
// In a real integration this would stream from the CI/CD API.
// For now we provide a realistic Vercel-style log that builds up over ~4 seconds.

const BUILD_LOG_LINES = [
    'Cloning repository…',
    'Installing dependencies (npm ci)…',
    'Running build command: next build',
    '▶ Compiling TypeScript…',
    '▶ Generating static pages (0/1)…',
    '▶ Generating static pages (1/1)…',
    '▶ Collecting build output…',
    '▶ Finalising…',
    '✓ Build complete in 4.21s',
    '✓ Uploading output…',
    '✓ Deployment ready.',
];

const ERROR_LOG_LINES = [
    'Cloning repository…',
    'Installing dependencies (npm ci)…',
    'Running build command: next build',
    '▶ Compiling TypeScript…',
    '✖ Type error in src/components/Header.tsx:12',
    '  TS2304: Cannot find name \'handleSubmit\'.',
    '✖ Build failed.',
];

// ─── Component ────────────────────────────────────────────────────────────────

export const DeployPanel: React.FC = () => {
    const { pages } = useEditor();
    const { url: containerUrl } = useContainer();

    // ── Project / branch ─────────────────────────────────────────────────────
    const projectName = 'my-vectra-app';
    const branch = 'main';

    // ── Env vars ─────────────────────────────────────────────────────────────
    const [envVars, setEnvVars] = useState<EnvVar[]>([
        { id: 'ev-1', key: 'NEXT_PUBLIC_API_URL', value: 'https://api.example.com', hidden: false },
    ]);
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');

    // ── Deploy state ─────────────────────────────────────────────────────────
    const [status, setStatus] = useState<DeployStatus>('idle');
    const [logLines, setLogLines] = useState<string[]>([]);
    const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
    const [logOpen, setLogOpen] = useState(true);
    const logRef = useRef<HTMLDivElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Auto-scroll log to bottom as lines arrive
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logLines]);

    // Cleanup timers on unmount
    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    // ── Actions ──────────────────────────────────────────────────────────────

    const addEnvVar = useCallback(() => {
        if (!newKey.trim()) return;
        setEnvVars(prev => [...prev, {
            id: `ev-${Date.now()}`,
            key: newKey.trim(),
            value: newValue,
            hidden: false,
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

    const runDeploy = useCallback((simulateError = false) => {
        if (status === 'building') return;
        setStatus('building');
        setLogLines([]);
        setDeployedUrl(null);
        setLogOpen(true);

        const lines = simulateError ? ERROR_LOG_LINES : BUILD_LOG_LINES;
        let i = 0;

        const tick = () => {
            if (i >= lines.length) {
                if (simulateError) {
                    setStatus('error');
                } else {
                    setStatus('success');
                    // Use the WebContainer URL when a dev server is running, otherwise fake
                    setDeployedUrl(containerUrl ?? 'https://my-vectra-app.vercel.app');
                }
                return;
            }
            setLogLines(prev => [...prev, lines[i]]);
            i++;
            timerRef.current = setTimeout(tick, 400 + Math.random() * 250);
        };

        timerRef.current = setTimeout(tick, 200);
    }, [status, containerUrl]);

    // ── Render helpers ────────────────────────────────────────────────────────

    const StatusBadge = () => {
        if (status === 'idle') return (
            <span className="text-[9px] text-zinc-500 font-bold uppercase">Ready to deploy</span>
        );
        if (status === 'building') return (
            <span className="flex items-center gap-1 text-[9px] text-amber-400 font-bold uppercase animate-pulse">
                <Loader2 size={9} className="animate-spin" /> Building…
            </span>
        );
        if (status === 'success') return (
            <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-bold uppercase">
                <CheckCircle2 size={9} /> Deployed
            </span>
        );
        return (
            <span className="flex items-center gap-1 text-[9px] text-red-400 font-bold uppercase">
                <XCircle size={9} /> Build failed
            </span>
        );
    };

    return (
        <div className="flex flex-col h-full text-[#ccc] select-none">

            {/* ── Project card ─────────────────────────────────────────────── */}
            <div className="p-3 border-b border-[#3f3f46] space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs font-semibold text-white">{projectName}</div>
                        <div className="flex items-center gap-1 text-[10px] text-zinc-500 mt-0.5">
                            <GitBranch size={9} />
                            <span>{branch}</span>
                            <span className="text-zinc-700">·</span>
                            <span>{pages.length} page{pages.length !== 1 ? 's' : ''}</span>
                        </div>
                    </div>
                    <StatusBadge />
                </div>

                {/* Deploy button row */}
                <div className="flex gap-2">
                    <button
                        onClick={() => runDeploy(false)}
                        disabled={status === 'building'}
                        className={cn(
                            'flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-bold transition-all',
                            status === 'building'
                                ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                                : 'bg-[#007acc] hover:bg-[#0066b3] text-white shadow-sm hover:shadow-[0_0_12px_rgba(0,122,204,0.4)]'
                        )}
                    >
                        {status === 'building'
                            ? <><Loader2 size={12} className="animate-spin" /> Deploying…</>
                            : <><Rocket size={12} /> Deploy</>}
                    </button>
                    {status !== 'idle' && (
                        <button
                            onClick={() => { setStatus('idle'); setLogLines([]); setDeployedUrl(null); }}
                            title="Reset"
                            className="p-2 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                            <RefreshCw size={12} />
                        </button>
                    )}
                </div>

                {/* Live URL pill */}
                {deployedUrl && (
                    <a
                        href={deployedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-[10px] text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 rounded-md px-2 py-1.5 border border-emerald-500/20 transition-colors group"
                    >
                        <CheckCircle2 size={10} className="shrink-0" />
                        <span className="truncate flex-1">{deployedUrl}</span>
                        <ExternalLink size={9} className="shrink-0 opacity-50 group-hover:opacity-100" />
                    </a>
                )}
            </div>

            {/* ── Build log ────────────────────────────────────────────────── */}
            {logLines.length > 0 && (
                <div className="border-b border-[#3f3f46]">
                    <button
                        onClick={() => setLogOpen(o => !o)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#2a2a2a] transition-colors"
                    >
                        <div className="flex items-center gap-1.5 text-[9px] text-zinc-500 font-bold uppercase">
                            <Terminal size={9} />
                            Build Log
                        </div>
                        {logOpen ? <ChevronUp size={10} className="text-zinc-600" /> : <ChevronDown size={10} className="text-zinc-600" />}
                    </button>
                    {logOpen && (
                        <div
                            ref={logRef}
                            className="px-3 pb-3 space-y-0.5 max-h-[160px] overflow-y-auto custom-scrollbar"
                        >
                            {logLines.map((line, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        'text-[9px] font-mono leading-relaxed',
                                        line.startsWith('✖') ? 'text-red-400'
                                            : line.startsWith('✓') ? 'text-emerald-400'
                                                : line.startsWith('▶') ? 'text-[#007acc]'
                                                    : 'text-zinc-500'
                                    )}
                                >
                                    {line}
                                </div>
                            ))}
                            {status === 'building' && (
                                <div className="text-[9px] font-mono text-zinc-700 animate-pulse">▌</div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Environment Variables ─────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="p-3 border-b border-[#3f3f46]">
                    <div className="text-[9px] text-zinc-500 font-bold uppercase mb-2">Environment Variables</div>

                    {/* Existing vars */}
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

                    {/* Add new var */}
                    <div className="space-y-1">
                        <input
                            type="text"
                            value={newKey}
                            onChange={e => setNewKey(e.target.value)}
                            placeholder="KEY"
                            className="w-full bg-[#2a2a2a] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-600 font-mono outline-none focus:border-[#007acc] transition-colors"
                        />
                        <input
                            type="text"
                            value={newValue}
                            onChange={e => setNewValue(e.target.value)}
                            placeholder="value"
                            onKeyDown={e => { if (e.key === 'Enter') addEnvVar(); }}
                            className="w-full bg-[#2a2a2a] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-600 font-mono outline-none focus:border-[#007acc] transition-colors"
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

                {/* ── Danger zone: simulate a build error ───────────────────── */}
                <div className="p-3">
                    <div className="text-[9px] text-zinc-600 font-bold uppercase mb-2">Debug</div>
                    <button
                        onClick={() => runDeploy(true)}
                        disabled={status === 'building'}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] text-red-600/70 hover:text-red-400 border border-dashed border-red-900/30 hover:border-red-800/50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <XCircle size={10} /> Simulate build error
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeployPanel;

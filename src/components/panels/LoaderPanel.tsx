/**
 * ─── LOADER PANEL ─────────────────────────────────────────────────────────────
 * The "Connect Codebase" panel — Phase B of the Code→Design bridge.
 *
 * Developer workflow:
 *   1. Install @vectra/loader in their project, add Vite/Next plugin
 *   2. Start their dev server (e.g. localhost:3000)
 *   3. Open this panel, enter http://localhost:3000, click Connect
 *   4. Their components appear in Vectra's canvas instantly
 *   5. Drag onto canvas → live preview via LiveComponent compiler
 *   6. Export/Publish → correct import paths via CIS-1 importMeta
 *
 * State persistence:
 *   - baseUrl saved to localStorage(LOADER_URL_KEY)
 *   - Auto-reconnects on panel open if URL was previously set
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useEditor } from '../../context/EditorContext';
import {
    Link2, Link2Off, RefreshCw, CheckCircle2, AlertCircle,
    Loader2, X, Package, ExternalLink, ChevronRight, Box,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
    fetchLoaderManifest,
    manifestEntryToConfig,
    LOADER_URL_KEY,
    type VectraLoaderEntry,
} from '../../utils/vectraLoaderBridge';

// ─── TYPES ────────────────────────────────────────────────────────────────────

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface LoadedComponent {
    id: string;
    entry: VectraLoaderEntry;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export const LoaderPanel: React.FC = () => {
    const { registerComponent, setDragData, setActivePanel } = useEditor();

    const [baseUrl, setBaseUrl] = useState<string>(() => {
        try { return localStorage.getItem(LOADER_URL_KEY) ?? 'http://localhost:3000'; }
        catch { return 'http://localhost:3000'; }
    });
    const [status, setStatus] = useState<ConnectionStatus>('idle');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [loadedComponents, setLoadedComponents] = useState<LoadedComponent[]>([]);

    // ── Connect ───────────────────────────────────────────────────────────────

    const handleConnect = useCallback(async (url?: string) => {
        const target = (url ?? baseUrl).trim();
        if (!target) return;

        setStatus('connecting');
        setErrorMsg('');

        const manifest = await fetchLoaderManifest(target);

        if (!manifest) {
            setStatus('error');
            setErrorMsg(
                `Could not reach ${target}${LOADER_URL_KEY.replace('vectra_loader_url', '')}.\n\n` +
                `Check that:\n` +
                `• Your dev server is running at ${target}\n` +
                `• @vectra/loader plugin is installed and configured\n` +
                `• The plugin sets Access-Control-Allow-Origin: *`
            );
            return;
        }

        // Register all components
        const registered: LoadedComponent[] = [];
        for (const entry of manifest.components) {
            const config = manifestEntryToConfig(entry);
            // Use stable entry.id as registry key so re-connects don't duplicate
            registerComponent(entry.id, config);
            registered.push({ id: entry.id, entry });
        }

        setLoadedComponents(registered);
        setStatus('connected');

        try { localStorage.setItem(LOADER_URL_KEY, target); } catch { /* quota */ }

        console.log(`[VectraLoader] Connected to ${target} — ${registered.length} components registered.`);
    }, [baseUrl, registerComponent]);

    // ── Disconnect ────────────────────────────────────────────────────────────

    const handleDisconnect = useCallback(() => {
        setStatus('idle');
        setLoadedComponents([]);
        setErrorMsg('');
    }, []);

    // ── Auto-reconnect on panel open (skips default placeholder URL) ──────────
    useEffect(() => {
        const saved = (() => { try { return localStorage.getItem(LOADER_URL_KEY); } catch { return null; } })();
        if (saved && saved !== 'http://localhost:3000') {
            handleConnect(saved);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── RENDER ───────────────────────────────────────────────────────────────

    return (
        <div className="absolute left-[60px] top-0 bottom-0 w-[360px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between shrink-0">
                <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                    <Link2 size={14} className="text-blue-400" />
                    Connect Codebase
                </h2>
                <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white transition-colors">
                    <X size={16} />
                </button>
            </div>

            {/* ── Explainer ─────────────────────────────────────────────────── */}
            <div className="px-4 pt-3 pb-1 shrink-0">
                <p className="text-[10px] text-[#888] leading-relaxed">
                    Connect your existing codebase to use real components directly on the canvas.
                    Install{' '}
                    <code className="text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded text-[9px]">
                        @vectra/loader
                    </code>{' '}
                    in your project to get started.
                </p>
                <a
                    href="https://github.com/vectra/loader"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                    <ExternalLink size={10} /> Setup guide
                </a>
            </div>

            {/* ── URL input + Connect/Disconnect button ─────────────────────── */}
            <div className="px-4 py-3 border-b border-[#3f3f46] shrink-0">
                <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-wider mb-1.5">
                    Dev Server URL
                </label>
                <div className="flex gap-2">
                    <input
                        type="url"
                        value={baseUrl}
                        onChange={e => setBaseUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && status !== 'connecting' && handleConnect()}
                        placeholder="http://localhost:3000"
                        disabled={status === 'connected'}
                        className="flex-1 bg-[#1e1e1e] border border-[#3e3e42] rounded px-2.5 py-1.5 text-xs text-white placeholder-[#555] focus:outline-none focus:border-blue-500/50 disabled:opacity-50 font-mono"
                    />
                    {status === 'connected' ? (
                        <button
                            onClick={handleDisconnect}
                            className="px-3 py-1.5 bg-[#3e3e42] hover:bg-red-500/20 border border-[#555] hover:border-red-500/40 rounded text-[10px] text-[#999] hover:text-red-400 transition-all font-bold flex items-center gap-1"
                        >
                            <Link2Off size={11} /> Disconnect
                        </button>
                    ) : (
                        <button
                            onClick={() => handleConnect()}
                            disabled={status === 'connecting' || !baseUrl.trim()}
                            className={cn(
                                'px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-1.5 transition-all',
                                status === 'connecting'
                                    ? 'bg-blue-600/40 text-blue-300 cursor-wait'
                                    : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed'
                            )}
                        >
                            {status === 'connecting' ? (
                                <><Loader2 size={11} className="animate-spin" /> Connecting…</>
                            ) : (
                                <><Link2 size={11} /> Connect</>
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* ── Status badge ──────────────────────────────────────────────── */}
            {status !== 'idle' && (
                <div className={cn(
                    'mx-4 mt-3 px-3 py-2 rounded-lg border text-[10px] flex items-start gap-2 shrink-0',
                    status === 'connected'
                        ? 'bg-green-500/8 border-green-500/20 text-green-400'
                        : status === 'error'
                            ? 'bg-red-500/8 border-red-500/20 text-red-400'
                            : 'bg-blue-500/8 border-blue-500/20 text-blue-400'
                )}>
                    {status === 'connected' && <CheckCircle2 size={12} className="shrink-0 mt-0.5" />}
                    {status === 'error' && <AlertCircle size={12} className="shrink-0 mt-0.5" />}
                    {status === 'connecting' && <Loader2 size={12} className="shrink-0 mt-0.5 animate-spin" />}
                    <div className="leading-relaxed whitespace-pre-line">
                        {status === 'connected' && (
                            <span>
                                Connected to <span className="font-mono text-green-300">{baseUrl}</span>
                                {' '}—{' '}
                                <strong>{loadedComponents.length}</strong>{' '}
                                component{loadedComponents.length !== 1 ? 's' : ''} registered
                            </span>
                        )}
                        {status === 'error' && errorMsg}
                        {status === 'connecting' && 'Connecting…'}
                    </div>
                </div>
            )}

            {/* ── Component list ────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
                {status === 'connected' && loadedComponents.length === 0 && (
                    <div className="text-center py-10 text-[#555] text-xs">
                        No components in manifest.
                    </div>
                )}

                {loadedComponents.length > 0 && (
                    <>
                        <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-2">
                            Registered Components
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {loadedComponents.map(({ id, entry }) => (
                                <div
                                    key={id}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('text/plain', entry.id);
                                        e.dataTransfer.effectAllowed = 'copy';
                                        setDragData({ type: 'NEW', payload: entry.id });
                                    }}
                                    className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#3f3f46] hover:border-blue-500/40 bg-[#2a2a2d] hover:bg-[#2d2d30] cursor-grab active:cursor-grabbing transition-all"
                                >
                                    {/* Icon */}
                                    <div className="w-7 h-7 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                                        <Box size={13} className="text-blue-400" />
                                    </div>

                                    {/* Label + import path */}
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-semibold text-[#cccccc] group-hover:text-white transition-colors truncate">
                                            {entry.label}
                                        </div>
                                        <div className="text-[9px] text-[#666] font-mono truncate mt-0.5">
                                            {entry.importMeta.packageName}
                                        </div>
                                    </div>

                                    {/* Drag indicator */}
                                    <ChevronRight size={11} className="text-[#555] group-hover:text-blue-400 transition-colors shrink-0" />
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {/* ── How it works (idle state) ─────────────────────────────── */}
                {status === 'idle' && (
                    <div className="mt-2">
                        <div className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-3">
                            How it works
                        </div>
                        <div className="flex flex-col gap-3">
                            {([
                                ['1', 'Install', 'npm install --save-dev @vectra/loader'],
                                ['2', 'Configure', 'Add vectraLoader() plugin to vite.config.ts'],
                                ['3', 'Register', 'Pass your components array to the plugin'],
                                ['4', 'Connect', 'Enter your dev server URL above and click Connect'],
                            ] as const).map(([num, title, desc]) => (
                                <div key={num} className="flex gap-3">
                                    <div className="w-5 h-5 rounded-full bg-[#3e3e42] text-[#888] flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                                        {num}
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-bold text-[#aaa]">{title}</div>
                                        <div className="text-[9px] text-[#666] font-mono mt-0.5 leading-relaxed">{desc}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Reference plugin snippet */}
                        <div className="mt-5 p-3 rounded-lg bg-[#1e1e1e] border border-[#333]">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Package size={11} className="text-purple-400" />
                                <span className="text-[10px] font-bold text-[#aaa]">Reference Vite plugin</span>
                            </div>
                            <pre className="text-[9px] text-[#888] font-mono leading-relaxed overflow-x-auto">{
                                `// vite.config.ts
import { vectraLoader } from '@vectra/loader/vite';

export default defineConfig({
  plugins: [
    react(),
    vectraLoader({
      components: [{
        id: 'hero',
        label: 'Hero Section',
        component: () => import('./src/Hero'),
        exportName: 'Hero',
        defaultProps: { title: 'Hello' },
      }],
    }),
  ],
});`}</pre>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Footer: Re-sync button (connected state only) ─────────────── */}
            {status === 'connected' && (
                <div className="px-4 py-3 border-t border-[#3f3f46] shrink-0">
                    <button
                        onClick={() => handleConnect()}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-[#3f3f46] hover:border-blue-500/30 text-[10px] text-[#888] hover:text-blue-400 transition-all"
                    >
                        <RefreshCw size={11} /> Re-sync from dev server
                    </button>
                </div>
            )}
        </div>
    );
};

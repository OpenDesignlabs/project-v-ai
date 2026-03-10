/**
 * ─── MCP PANEL ────────────────────────────────────────────────────────────────
 * MCP-1 + MCP-3 — Server control + IDE connector UI.
 *
 * MCP-WC-1 FIX: ensureMcpServer() returns the container-forwarded URL from
 * the server-ready event. We store it in `resolvedBaseUrl` and pass it to:
 *   - generateIdeConfig() so the IDE config has the correct SSE URL
 *   - EventSource() for the SSE write-back stream
 * localhost:3002 is never used directly from this file.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    Cpu, CheckCircle2, XCircle, Loader2,
    Copy, Check, ChevronDown, ChevronRight,
    Zap, Trash2, Terminal, FileCode, Server,
} from 'lucide-react';
import { useContainer } from '../../context/ContainerContext';
import {
    ensureMcpServer, stopMcpServer, checkMcpHealth,
    generateIdeConfig,
    type IdeConfigResult,
} from '../../utils/mcpServer';
import { cn } from '../../lib/utils';

// ─── TYPES ────────────────────────────────────────────────────────────────────

type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';
type IdeTarget = 'cursor' | 'vscode' | 'windsurf' | 'claude-desktop';

interface ActivityEntry {
    id: string;
    timestamp: string;
    tool: string;
    result: 'ok' | 'error' | 'mutation';
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const IDE_TABS: Array<{ id: IdeTarget; label: string }> = [
    { id: 'cursor', label: 'Cursor' },
    { id: 'vscode', label: 'VS Code' },
    { id: 'windsurf', label: 'Windsurf' },
    { id: 'claude-desktop', label: 'Claude' },
];

const MAX_ACTIVITY = 30;

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export const MCPPanel: React.FC = () => {
    const { instance, status: vfsStatus } = useContainer();

    // ── Server state ──────────────────────────────────────────────────────────
    const [serverStatus, setServerStatus] = useState<ServerStatus>('stopped');
    const [serverLog, setServerLog] = useState<string[]>([]);
    const [toolCount, setToolCount] = useState(0);
    const [resolvedBaseUrl, setResolvedBaseUrl] = useState<string | null>(null);
    const sseRef = useRef<EventSource | null>(null);

    // ── IDE connector state ───────────────────────────────────────────────────
    const [activeIde, setActiveIde] = useState<IdeTarget>('cursor');
    const [ideConfig, setIdeConfig] = useState<IdeConfigResult | null>(null);
    const [copied, setCopied] = useState(false);

    // ── Activity log ─────────────────────────────────────────────────────────
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const [showToolRef, setShowToolRef] = useState(false);

    const log = useCallback((msg: string) => {
        setServerLog(prev => {
            const next = [...prev, `${new Date().toLocaleTimeString()} — ${msg}`];
            return next.length > 50 ? next.slice(-50) : next;
        });
    }, []);

    // ── Generate IDE config whenever tab or resolved URL changes ──────────────
    useEffect(() => {
        setIdeConfig(generateIdeConfig(activeIde, resolvedBaseUrl ?? undefined));
    }, [activeIde, resolvedBaseUrl]);

    // ── SSE subscription (MCP-WRITE-1) ────────────────────────────────────────
    const connectSSE = useCallback((sseUrl: string) => {
        if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }

        const es = new EventSource(sseUrl);
        sseRef.current = es;

        es.onopen = () => {
            log('📡 SSE stream connected');
        };

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'endpoint') return;
                if (data.__vectra_mutation__) {
                    window.dispatchEvent(new CustomEvent('vectra:mcp-command', { detail: data }));
                    setActivity(prev => {
                        const entry: ActivityEntry = {
                            id: `act-${Date.now()}`,
                            timestamp: new Date().toLocaleTimeString(),
                            tool: String(data.op || 'mutation'),
                            result: 'mutation',
                        };
                        const next = [entry, ...prev];
                        return next.length > MAX_ACTIVITY ? next.slice(0, MAX_ACTIVITY) : next;
                    });
                    log(`⚡ ${data.op}`);
                }
            } catch { /* keepalive pings are not JSON */ }
        };

        es.onerror = () => { es.close(); sseRef.current = null; };
    }, [log]);

    useEffect(() => {
        return () => { sseRef.current?.close(); sseRef.current = null; };
    }, []);

    // ── Start server ──────────────────────────────────────────────────────────
    const handleStart = useCallback(async () => {
        if (vfsStatus !== 'ready' || !instance) {
            log('⚠️ VFS not ready — wait a moment.');
            return;
        }
        setServerStatus('starting');
        setServerLog([]);

        try {
            log('Starting Vectra MCP Server...');
            log('Waiting for WebContainer server-ready event on port 3002...');

            // ensureMcpServer returns the container-forwarded URL (MCP-WC-1)
            const baseUrl = await ensureMcpServer(instance);
            log(`✅ Server ready: ${baseUrl}`);

            setResolvedBaseUrl(baseUrl);

            const health = await checkMcpHealth();
            setToolCount(health?.tools ?? 10);
            setServerStatus('running');

            // Connect SSE using the actual container URL
            const sseUrl = `${baseUrl}/mcp/sse`;
            connectSSE(sseUrl);
        } catch (err) {
            log(`❌ ${(err as Error).message}`);
            setServerStatus('error');
        }
    }, [vfsStatus, instance, log, connectSSE]);

    // ── Stop server ───────────────────────────────────────────────────────────
    const handleStop = useCallback(() => {
        sseRef.current?.close();
        sseRef.current = null;
        stopMcpServer();
        setServerStatus('stopped');
        setResolvedBaseUrl(null);
        setActivity([]);
        log('Server stopped.');
    }, [log]);

    // ── Copy config ───────────────────────────────────────────────────────────
    const handleCopy = useCallback(() => {
        if (!ideConfig) return;
        navigator.clipboard.writeText(ideConfig.config).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [ideConfig]);

    // ─── RENDER ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full bg-[#1a1a1c] text-[#cccccc] overflow-hidden">

            {/* Header */}
            <div className="px-4 pt-3 pb-2 border-b border-[#2c2c2e] shrink-0">
                <div className="flex items-center gap-2 mb-1">
                    <Cpu size={12} className="text-green-400" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">MCP Server</span>
                    <div className={cn(
                        'ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold',
                        serverStatus === 'running' ? 'bg-green-500/15 text-green-400' :
                            serverStatus === 'starting' ? 'bg-yellow-500/15 text-yellow-400' :
                                serverStatus === 'error' ? 'bg-red-500/15 text-red-400' :
                                    'bg-[#2c2c2e] text-[#48484a]'
                    )}>
                        <span className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            serverStatus === 'running' ? 'bg-green-400 animate-pulse' :
                                serverStatus === 'starting' ? 'bg-yellow-400 animate-pulse' :
                                    serverStatus === 'error' ? 'bg-red-400' : 'bg-[#48484a]'
                        )} />
                        {serverStatus === 'running' ? `${toolCount} tools` :
                            serverStatus === 'starting' ? 'Starting...' :
                                serverStatus === 'error' ? 'Error' : 'Stopped'}
                    </div>
                </div>
                <p className="text-[10px] text-[#48484a] leading-snug">
                    Connect Cursor, Claude, VS Code to your Vectra canvas via MCP.
                </p>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">

                {/* ── SERVER CONTROL ───────────────────────────────────────── */}
                <div className="space-y-2">
                    {(serverStatus === 'stopped' || serverStatus === 'error') ? (
                        <button
                            onClick={handleStart}
                            disabled={vfsStatus !== 'ready'}
                            className={cn(
                                'w-full px-3 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2',
                                vfsStatus !== 'ready'
                                    ? 'bg-[#252526] border border-[#3f3f46] text-[#48484a] cursor-not-allowed'
                                    : 'bg-green-600 hover:bg-green-500 text-white'
                            )}
                        >
                            <Server size={12} />
                            {vfsStatus !== 'ready' ? 'Waiting for VFS...' : 'Start MCP Server'}
                        </button>
                    ) : serverStatus === 'starting' ? (
                        <button disabled className="w-full px-3 py-2.5 rounded-lg text-xs font-bold bg-[#252526] border border-[#3f3f46] text-yellow-400 flex items-center justify-center gap-2 cursor-wait">
                            <Loader2 size={12} className="animate-spin" /> Starting...
                        </button>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 p-2.5 bg-green-500/5 border border-green-500/20 rounded-xl">
                                <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-semibold text-green-400">MCP Server Active</div>
                                    <div className="text-[9px] text-[#48484a] font-mono truncate">
                                        {resolvedBaseUrl ?? 'localhost:3002'}
                                    </div>
                                </div>
                                <button
                                    onClick={handleStop}
                                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#48484a] hover:text-red-400 transition-colors"
                                    title="Stop server"
                                >
                                    <XCircle size={13} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Boot log */}
                    {serverLog.length > 0 && (
                        <div className="bg-[#0d0d0f] border border-[#2c2c2e] rounded-xl p-2.5 max-h-24 overflow-y-auto font-mono custom-scrollbar">
                            {serverLog.map((l, i) => (
                                <div key={i} className="text-[9px] text-[#48484a] leading-relaxed">{l}</div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── IDE CONNECTOR (MCP-3) ────────────────────────────────── */}
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-[#636366] uppercase tracking-wider flex items-center gap-1.5">
                        <FileCode size={10} /> IDE Connector
                    </div>

                    <div className="flex bg-[#252526] border border-[#2c2c2e] rounded-lg overflow-hidden">
                        {IDE_TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveIde(tab.id)}
                                className={cn(
                                    'flex-1 py-1.5 text-[10px] font-semibold transition-colors',
                                    activeIde === tab.id ? 'bg-[#3c3c3c] text-white' : 'text-[#48484a] hover:text-[#aeaeb2]'
                                )}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {ideConfig && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-[10px] text-[#48484a]">
                                <span className="font-mono bg-[#252526] border border-[#2c2c2e] px-1.5 py-0.5 rounded text-[9px] truncate">
                                    {ideConfig.filePath.split('\n')[0]}
                                </span>
                            </div>

                            <div className="relative">
                                <pre className="bg-[#0d0d0f] border border-[#2c2c2e] rounded-xl p-3 text-[9px] font-mono text-[#a5f3fc] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                    {ideConfig.config}
                                </pre>
                                <button
                                    onClick={handleCopy}
                                    className={cn(
                                        'absolute top-2 right-2 p-1.5 rounded-lg transition-all',
                                        copied ? 'bg-green-500/20 text-green-400' : 'bg-[#252526] border border-[#2c2c2e] text-[#48484a] hover:text-white'
                                    )}
                                    title="Copy config"
                                >
                                    {copied ? <Check size={11} /> : <Copy size={11} />}
                                </button>
                            </div>

                            <p className="text-[10px] text-[#3a3a3c] leading-snug">{ideConfig.note}</p>

                            {serverStatus !== 'running' && (
                                <div className="flex items-start gap-2 p-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-xl text-[10px] text-yellow-500/90">
                                    <span className="shrink-0">⚠</span>
                                    <span>Start the MCP server first — the IDE connects to the live container URL.</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── ACTIVITY LOG ─────────────────────────────────────────── */}
                {activity.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-[10px] font-bold text-[#636366] uppercase tracking-wider flex items-center justify-between">
                            <span className="flex items-center gap-1.5"><Terminal size={10} /> Activity</span>
                            <button onClick={() => setActivity([])} className="text-[#3a3a3c] hover:text-[#636366] transition-colors" title="Clear">
                                <Trash2 size={10} />
                            </button>
                        </div>
                        <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                            {activity.map(entry => (
                                <div key={entry.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] border bg-purple-500/5 border-purple-500/20">
                                    <span className="text-purple-400 text-[9px] shrink-0">⚡</span>
                                    <span className="font-mono text-[#aeaeb2] truncate flex-1">{entry.tool}</span>
                                    <span className="text-[#3a3a3c] shrink-0">{entry.timestamp}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── TOOL REFERENCE ───────────────────────────────────────── */}
                <div>
                    <button
                        onClick={() => setShowToolRef(p => !p)}
                        className="w-full flex items-center justify-between text-[10px] font-bold text-[#636366] uppercase tracking-wider py-1 hover:text-[#aeaeb2] transition-colors"
                    >
                        <span className="flex items-center gap-1.5"><Zap size={10} /> 10 Tools</span>
                        {showToolRef ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </button>

                    {showToolRef && (
                        <div className="mt-2 space-y-1">
                            {([
                                ['vectra_get_project', 'Read', 'Get pages, node count, theme'],
                                ['vectra_get_page', 'Read', 'Get all nodes on a page'],
                                ['vectra_get_element', 'Read', 'Get element by ID'],
                                ['vectra_find_elements', 'Read', 'Search by type or name'],
                                ['vectra_add_element', 'Write', 'Add node to canvas'],
                                ['vectra_update_element', 'Write', 'Update node props/style'],
                                ['vectra_delete_element', 'Write', 'Delete node + children'],
                                ['vectra_add_page', 'Write', 'Create a new page'],
                                ['vectra_run_ai', 'AI', 'Natural language generation'],
                                ['vectra_update_theme', 'Write', 'Update design tokens'],
                            ] as const).map(([name, badge, desc]) => (
                                <div key={name} className="flex items-start gap-2 p-2 bg-[#1c1c1e] rounded-lg border border-[#2c2c2e]">
                                    <span className={cn(
                                        'text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5',
                                        badge === 'Read' ? 'bg-blue-500/15 text-blue-400' :
                                            badge === 'AI' ? 'bg-purple-500/15 text-purple-400' :
                                                'bg-orange-500/15 text-orange-400'
                                    )}>
                                        {badge}
                                    </span>
                                    <div>
                                        <div className="text-[10px] font-mono text-[#cccccc]">{name}</div>
                                        <div className="text-[9px] text-[#48484a]">{desc}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MCPPanel;

/**
 * ─── MCP PANEL v2 ─────────────────────────────────────────────────────────────
 * MCP-1 + MCP-3 — Server control + IDE connector UI.
 *
 * Change Log v2:
 * ADDED: Built-in Tool Runner — pick tool, edit JSON args, execute, see raw response
 *   Uses POST /mcp/message → tools/call (existing endpoint, no server changes needed)
 * ADDED: SSE connection badge — dedicated status indicator, separate from server status
 * ADDED: Auto-reconnect SSE — exponential backoff (500→1000→2000ms), max 3 attempts
 * ADDED: Copy SSE URL button — one-click
 * ADDED: Auto-start toggle — starts server when VFS becomes ready (localStorage)
 * ADDED: Health pulse — /health ping every 30s while server is running
 * PRESERVED: MCP-PORT-1, MCP-READ-1, MCP-WRITE-1, MCP-SEC-1, MCP-IDLE-1, MCP-WC-1
 *
 * MCP-WC-1 FIX: resolvedBaseUrl stores the container-forwarded URL from server-ready.
 * localhost:3002 is NEVER used directly from this component.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    Cpu, CheckCircle2, XCircle, Loader2,
    Copy, Check, ChevronDown, ChevronRight,
    Zap, Trash2, Terminal, FileCode, Server,
    Play, AlertCircle, Radio, RefreshCw, Power,
    ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useContainer } from '../../context/ContainerContext';
import {
    ensureMcpServer, stopMcpServer, checkMcpHealth,
    generateIdeConfig, getMcpPostUrl,
    type IdeConfigResult,
} from '../../utils/mcpServer';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type ServerStatus  = 'stopped' | 'starting' | 'running' | 'error';
type SseStatus     = 'disconnected' | 'connecting' | 'connected' | 'error';
type IdeTarget     = 'cursor' | 'vscode' | 'windsurf' | 'claude-desktop';

interface ActivityEntry {
    id: string;
    timestamp: string;
    tool: string;
    result: 'ok' | 'error' | 'mutation';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IDE_TABS: Array<{ id: IdeTarget; label: string }> = [
    { id: 'cursor',         label: 'Cursor'    },
    { id: 'vscode',         label: 'VS Code'   },
    { id: 'windsurf',       label: 'Windsurf'  },
    { id: 'claude-desktop', label: 'Claude'    },
];

const MAX_ACTIVITY    = 30;
const AUTO_START_KEY  = 'vectra_mcp_autostart';
const SSE_BACKOFF_MS  = [500, 1000, 2000]; // exponential backoff delays
const HEALTH_INTERVAL = 30_000;

// ── Tool Runner config ────────────────────────────────────────────────────────

const TOOL_DEFS: Array<{
    name: string;
    badge: 'Read' | 'Write' | 'AI';
    desc: string;
    defaultArgs: string;
}> = [
    { name: 'vectra_get_project',    badge: 'Read',  desc: 'Get pages, node count, theme',           defaultArgs: '{}' },
    { name: 'vectra_get_page',       badge: 'Read',  desc: 'Get all nodes on a page',                defaultArgs: '{\n  "pageId": "page-home"\n}' },
    { name: 'vectra_get_element',    badge: 'Read',  desc: 'Get a single element by ID',             defaultArgs: '{\n  "elementId": ""\n}' },
    { name: 'vectra_find_elements',  badge: 'Read',  desc: 'Search elements by type or name',        defaultArgs: '{\n  "type": "heading"\n}' },
    { name: 'vectra_add_element',    badge: 'Write', desc: 'Add a node to the canvas',               defaultArgs: '{\n  "parentId": "",\n  "element": {\n    "type": "text",\n    "name": "New Text",\n    "content": "Hello",\n    "props": { "style": {} }\n  }\n}' },
    { name: 'vectra_update_element', badge: 'Write', desc: 'Update node props / style',              defaultArgs: '{\n  "elementId": "",\n  "content": "Updated"\n}' },
    { name: 'vectra_delete_element', badge: 'Write', desc: 'Delete a node and its children',         defaultArgs: '{\n  "elementId": ""\n}' },
    { name: 'vectra_add_page',       badge: 'Write', desc: 'Create a new page',                      defaultArgs: '{\n  "name": "New Page"\n}' },
    { name: 'vectra_run_ai',         badge: 'AI',    desc: 'Generate with natural language',          defaultArgs: '{\n  "prompt": "Add a hero section",\n  "pageId": "page-home"\n}' },
    { name: 'vectra_update_theme',   badge: 'Write', desc: 'Update design tokens',                   defaultArgs: '{\n  "primary": "#6d28d9"\n}' },
];

const BADGE_COLOR: Record<string, string> = {
    Read:  'bg-blue-500/15 text-blue-400',
    Write: 'bg-orange-500/15 text-orange-400',
    AI:    'bg-purple-500/15 text-purple-400',
};

// ─── Component ────────────────────────────────────────────────────────────────

export const MCPPanel: React.FC = () => {
    const { instance, status: vfsStatus } = useContainer();

    // ── Server state ──────────────────────────────────────────────────────────
    const [serverStatus, setServerStatus] = useState<ServerStatus>('stopped');
    const [serverLog, setServerLog]       = useState<string[]>([]);
    const [toolCount, setToolCount]       = useState(0);
    const [resolvedBaseUrl, setResolvedBaseUrl] = useState<string | null>(null);

    // ── SSE state ─────────────────────────────────────────────────────────────
    const [sseStatus, setSseStatus]   = useState<SseStatus>('disconnected');
    const [copiedSseUrl, setCopiedSseUrl] = useState(false);
    const sseRef                       = useRef<EventSource | null>(null);
    const sseReconnectRef              = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sseAttemptRef                = useRef(0);

    // ── IDE connector ─────────────────────────────────────────────────────────
    const [activeIde, setActiveIde]   = useState<IdeTarget>('cursor');
    const [ideConfig, setIdeConfig]   = useState<IdeConfigResult | null>(null);
    const [copied, setCopied]         = useState(false);

    // ── Activity log ──────────────────────────────────────────────────────────
    const [activity, setActivity]     = useState<ActivityEntry[]>([]);
    const [showToolRef, setShowToolRef] = useState(false);

    // ── Auto-start ────────────────────────────────────────────────────────────
    const [autoStart, setAutoStart]   = useState<boolean>(() => {
        try { return localStorage.getItem(AUTO_START_KEY) === 'true'; } catch { return false; }
    });

    // ── Tool Runner ───────────────────────────────────────────────────────────
    const [runnerOpen, setRunnerOpen]       = useState(false);
    const [selectedTool, setSelectedTool]   = useState(TOOL_DEFS[0].name);
    const [toolArgs, setToolArgs]           = useState(TOOL_DEFS[0].defaultArgs);
    const [toolRunning, setToolRunning]     = useState(false);
    const [toolResult, setToolResult]       = useState<string | null>(null);
    const [toolResultErr, setToolResultErr] = useState(false);

    // ── Health pulse timer ────────────────────────────────────────────────────
    const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const log = useCallback((msg: string) => {
        setServerLog(prev => {
            const next = [...prev, `${new Date().toLocaleTimeString()} — ${msg}`];
            return next.length > 50 ? next.slice(-50) : next;
        });
    }, []);

    // ── IDE config ────────────────────────────────────────────────────────────
    useEffect(() => {
        setIdeConfig(generateIdeConfig(activeIde, resolvedBaseUrl ?? undefined));
    }, [activeIde, resolvedBaseUrl]);

    // ── Auto-start persistence ────────────────────────────────────────────────
    useEffect(() => {
        try { localStorage.setItem(AUTO_START_KEY, String(autoStart)); } catch { /* ok */ }
    }, [autoStart]);

    // ── SSE with auto-reconnect ───────────────────────────────────────────────
    const connectSSE = useCallback((sseUrl: string) => {
        if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
        if (sseReconnectRef.current) { clearTimeout(sseReconnectRef.current); }

        setSseStatus('connecting');
        const es = new EventSource(sseUrl);
        sseRef.current = es;

        es.onopen = () => {
            sseAttemptRef.current = 0;
            setSseStatus('connected');
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
            } catch { /* keepalive pings */ }
        };

        es.onerror = () => {
            es.close();
            sseRef.current = null;
            setSseStatus('error');

            // Exponential backoff reconnect
            const attempt = sseAttemptRef.current;
            if (attempt < SSE_BACKOFF_MS.length && serverStatus === 'running') {
                const delay = SSE_BACKOFF_MS[attempt];
                sseAttemptRef.current += 1;
                log(`⚠️ SSE dropped — reconnecting in ${delay}ms (attempt ${attempt + 1}/${SSE_BACKOFF_MS.length})…`);
                sseReconnectRef.current = setTimeout(() => connectSSE(sseUrl), delay);
            } else {
                log('❌ SSE failed after max attempts.');
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [log, serverStatus]);

    useEffect(() => {
        return () => {
            sseRef.current?.close();
            sseRef.current = null;
            if (sseReconnectRef.current) clearTimeout(sseReconnectRef.current);
        };
    }, []);

    // ── Health pulse ──────────────────────────────────────────────────────────
    const startHealthPulse = useCallback(() => {
        if (healthTimerRef.current) clearInterval(healthTimerRef.current);
        healthTimerRef.current = setInterval(async () => {
            const health = await checkMcpHealth();
            if (!health) {
                log('⚠️ Health check failed — server may have exited.');
                setServerStatus('error');
                if (healthTimerRef.current) clearInterval(healthTimerRef.current);
            }
        }, HEALTH_INTERVAL);
    }, [log]);

    useEffect(() => {
        return () => { if (healthTimerRef.current) clearInterval(healthTimerRef.current); };
    }, []);

    // ── Auto-start trigger ────────────────────────────────────────────────────
    useEffect(() => {
        if (autoStart && vfsStatus === 'ready' && instance && serverStatus === 'stopped') {
            // slight delay so VFS fully stabilises before spawning
            const t = setTimeout(() => {
                if (serverStatus === 'stopped') handleStart();
            }, 1200);
            return () => clearTimeout(t);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoStart, vfsStatus, instance]);

    // ── Start server ──────────────────────────────────────────────────────────
    const handleStart = useCallback(async () => {
        if (vfsStatus !== 'ready' || !instance) { log('⚠️ VFS not ready.'); return; }

        setServerStatus('starting');
        setServerLog([]);

        try {
            log('Starting Vectra MCP Server…');
            log('Waiting for WebContainer server-ready event on port 3002…');

            const baseUrl = await ensureMcpServer(instance); // MCP-WC-1
            log(`✅ Server ready: ${baseUrl}`);
            setResolvedBaseUrl(baseUrl);

            const health = await checkMcpHealth();
            setToolCount(health?.tools ?? 10);
            setServerStatus('running');
            startHealthPulse();

            const sseUrl = `${baseUrl}/mcp/sse`;
            connectSSE(sseUrl);
        } catch (err) {
            log(`❌ ${(err as Error).message}`);
            setServerStatus('error');
        }
    }, [vfsStatus, instance, log, connectSSE, startHealthPulse]);

    // ── Stop server ───────────────────────────────────────────────────────────
    const handleStop = useCallback(() => {
        sseRef.current?.close();
        sseRef.current = null;
        if (sseReconnectRef.current) clearTimeout(sseReconnectRef.current);
        if (healthTimerRef.current)  clearInterval(healthTimerRef.current);
        stopMcpServer();
        setServerStatus('stopped');
        setSseStatus('disconnected');
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

    const copySseUrl = useCallback(() => {
        if (!resolvedBaseUrl) return;
        navigator.clipboard.writeText(`${resolvedBaseUrl}/mcp/sse`).then(() => {
            setCopiedSseUrl(true);
            setTimeout(() => setCopiedSseUrl(false), 2000);
        });
    }, [resolvedBaseUrl]);

    // ── Tool Runner ───────────────────────────────────────────────────────────
    const handleToolRun = useCallback(async () => {
        if (!resolvedBaseUrl || serverStatus !== 'running') return;
        setToolRunning(true);
        setToolResult(null);
        setToolResultErr(false);

        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(toolArgs || '{}');
        } catch {
            setToolResult('❌ Invalid JSON in arguments field.');
            setToolResultErr(true);
            setToolRunning(false);
            return;
        }

        try {
            const postUrl = getMcpPostUrl();
            const res = await fetch(postUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/call',
                    params: { name: selectedTool, arguments: args },
                }),
            });

            const json = await res.json();
            if (json.error) {
                setToolResult(JSON.stringify(json.error, null, 2));
                setToolResultErr(true);
            } else {
                // Extract text from content array
                const text = (json.result?.content ?? [])
                    .filter((c: { type: string; text?: string }) => c.type === 'text')
                    .map((c: { type: string; text?: string }) => c.text ?? '')
                    .join('\n');
                setToolResult(text || JSON.stringify(json.result, null, 2));
                setToolResultErr(false);

                // If it was a mutation, it already broadcasted via SSE — log it
                const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();
                if (parsed?.__vectra_mutation__) {
                    setActivity(prev => {
                        const entry: ActivityEntry = {
                            id: `act-${Date.now()}`,
                            timestamp: new Date().toLocaleTimeString(),
                            tool: `${selectedTool} (runner)`,
                            result: 'mutation',
                        };
                        return [entry, ...prev].slice(0, MAX_ACTIVITY);
                    });
                }
            }
        } catch (err) {
            setToolResult(`❌ Fetch error: ${(err as Error).message}`);
            setToolResultErr(true);
        } finally {
            setToolRunning(false);
        }
    }, [resolvedBaseUrl, serverStatus, selectedTool, toolArgs]);

    // ─── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full bg-[#1a1a1c] text-[#cccccc] overflow-y-auto custom-scrollbar">

            {/* ── Header ────────────────────────────────────────────────────── */}
            <div className="px-4 pt-3 pb-2 border-b border-[#2c2c2e] shrink-0">
                <div className="flex items-center gap-2 mb-1">
                    <Cpu size={12} className="text-green-400" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">MCP Server</span>

                    {/* Server status pill */}
                    <div className={cn(
                        'flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold',
                        serverStatus === 'running'  ? 'bg-green-500/15 text-green-400' :
                        serverStatus === 'starting' ? 'bg-yellow-500/15 text-yellow-400' :
                        serverStatus === 'error'    ? 'bg-red-500/15 text-red-400' :
                                                      'bg-[#2c2c2e] text-[#48484a]'
                    )}>
                        <span className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            serverStatus === 'running'  ? 'bg-green-400 animate-pulse' :
                            serverStatus === 'starting' ? 'bg-yellow-400 animate-pulse' :
                            serverStatus === 'error'    ? 'bg-red-400' : 'bg-[#48484a]'
                        )} />
                        {serverStatus}
                    </div>

                    {/* SSE connection badge */}
                    {serverStatus === 'running' && (
                        <div className={cn(
                            'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold border',
                            sseStatus === 'connected'    ? 'border-green-500/20 text-green-400/80' :
                            sseStatus === 'connecting'   ? 'border-yellow-500/20 text-yellow-400/80' :
                            sseStatus === 'error'        ? 'border-red-500/20 text-red-400/80' :
                                                          'border-[#2c2c2e] text-[#48484a]'
                        )}>
                            <Radio size={7} className={sseStatus === 'connected' ? 'animate-pulse' : ''} />
                            SSE
                        </div>
                    )}

                    {/* Auto-start toggle */}
                    <button
                        onClick={() => setAutoStart(p => !p)}
                        title={`Auto-start: ${autoStart ? 'ON' : 'OFF'}`}
                        className="ml-auto text-[#48484a] hover:text-[#aeaeb2] transition-colors"
                    >
                        {autoStart
                            ? <ToggleRight size={14} className="text-green-400" />
                            : <ToggleLeft  size={14} />}
                    </button>
                    {autoStart && (
                        <span className="text-[8px] text-green-400/60">auto</span>
                    )}
                </div>
            </div>

            <div className="flex-1 px-4 py-3 space-y-4">

                {/* ── Server control ────────────────────────────────────────── */}
                <div className="space-y-2">
                    {serverStatus === 'stopped' || serverStatus === 'error' ? (
                        <button onClick={handleStart} disabled={vfsStatus !== 'ready'}
                            className={cn(
                                'w-full flex items-center justify-center gap-2 py-2 rounded-xl text-[10px] font-bold transition-all',
                                vfsStatus === 'ready'
                                    ? 'bg-green-600 hover:bg-green-500 text-white shadow-sm hover:shadow-[0_0_12px_rgba(34,197,94,0.3)]'
                                    : 'bg-[#2c2c2e] text-[#48484a] cursor-not-allowed'
                            )}>
                            <Power size={11} />
                            {serverStatus === 'error' ? 'Retry Server' : 'Start MCP Server'}
                        </button>
                    ) : serverStatus === 'starting' ? (
                        <button disabled className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-[10px] font-bold bg-[#2c2c2e] text-[#48484a]">
                            <Loader2 size={11} className="animate-spin" /> Starting…
                        </button>
                    ) : (
                        /* Running — show URL bar + stop */
                        <div className="bg-[#1c1c1e] border border-[#2c2c2e] rounded-xl p-2.5 space-y-1.5">
                            <div className="flex items-center gap-1.5">
                                <Server size={10} className="text-green-400 shrink-0" />
                                <span className="text-[10px] text-green-400 font-semibold flex-1">
                                    {toolCount} tools active
                                </span>
                                <button onClick={handleStop} className="p-1 rounded hover:bg-red-500/10 text-[#48484a] hover:text-red-400 transition-colors" title="Stop server">
                                    <XCircle size={12} />
                                </button>
                            </div>
                            {/* SSE URL row */}
                            {resolvedBaseUrl && (
                                <div className="flex items-center gap-1.5 bg-[#111113] rounded-lg px-2 py-1">
                                    <span className="text-[8px] font-mono text-[#48484a] truncate flex-1">
                                        {resolvedBaseUrl}/mcp/sse
                                    </span>
                                    <button onClick={copySseUrl} className="shrink-0 text-[#48484a] hover:text-green-400 transition-colors" title="Copy SSE URL">
                                        {copiedSseUrl ? <Check size={9} className="text-green-400" /> : <Copy size={9} />}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Boot log */}
                    {serverLog.length > 0 && (
                        <div className="bg-[#0d0d0f] border border-[#2c2c2e] rounded-xl p-2.5 max-h-20 overflow-y-auto font-mono custom-scrollbar">
                            {serverLog.map((l, i) => (
                                <div key={i} className={cn('text-[9px] leading-relaxed', l.includes('✅') ? 'text-green-400/70' : l.includes('❌') ? 'text-red-400/70' : l.includes('⚠️') ? 'text-yellow-400/60' : 'text-[#48484a]')}>{l}</div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Tool Runner ───────────────────────────────────────────── */}
                <div className="space-y-2">
                    <button
                        onClick={() => setRunnerOpen(p => !p)}
                        className="w-full flex items-center justify-between text-[10px] font-bold text-[#636366] uppercase tracking-wider py-1 hover:text-[#aeaeb2] transition-colors"
                    >
                        <span className="flex items-center gap-1.5"><Play size={10} /> Tool Runner</span>
                        {runnerOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    </button>

                    {runnerOpen && (
                        <div className="space-y-2 bg-[#1c1c1e] border border-[#2c2c2e] rounded-xl p-2.5">
                            {serverStatus !== 'running' && (
                                <div className="flex items-start gap-2 p-2 bg-yellow-500/5 border border-yellow-500/20 rounded-lg text-[10px] text-yellow-500/80">
                                    <AlertCircle size={10} className="shrink-0 mt-0.5" />
                                    <span>Start the MCP server first.</span>
                                </div>
                            )}

                            {/* Tool selector */}
                            <div>
                                <label className="block text-[9px] text-[#48484a] mb-1 uppercase tracking-wide font-bold">Tool</label>
                                <select
                                    value={selectedTool}
                                    onChange={e => {
                                        setSelectedTool(e.target.value);
                                        const def = TOOL_DEFS.find(t => t.name === e.target.value);
                                        if (def) setToolArgs(def.defaultArgs);
                                        setToolResult(null);
                                    }}
                                    className="w-full bg-[#111113] border border-[#2c2c2e] rounded-lg px-2 py-1.5 text-[10px] font-mono text-zinc-300 outline-none"
                                >
                                    {TOOL_DEFS.map(t => (
                                        <option key={t.name} value={t.name}>{t.name}</option>
                                    ))}
                                </select>
                                {(() => {
                                    const def = TOOL_DEFS.find(t => t.name === selectedTool);
                                    return def ? (
                                        <p className="text-[8px] text-[#48484a] mt-0.5">{def.desc}</p>
                                    ) : null;
                                })()}
                            </div>

                            {/* Args editor */}
                            <div>
                                <label className="block text-[9px] text-[#48484a] mb-1 uppercase tracking-wide font-bold">Arguments (JSON)</label>
                                <textarea
                                    value={toolArgs}
                                    onChange={e => setToolArgs(e.target.value)}
                                    rows={5}
                                    spellCheck={false}
                                    className="w-full bg-[#111113] border border-[#2c2c2e] rounded-lg px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-700 outline-none resize-none focus:border-green-500/30"
                                />
                            </div>

                            {/* Run button */}
                            <button
                                onClick={handleToolRun}
                                disabled={toolRunning || serverStatus !== 'running'}
                                className={cn(
                                    'w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold transition-all',
                                    serverStatus === 'running' && !toolRunning
                                        ? 'bg-green-600 hover:bg-green-500 text-white'
                                        : 'bg-[#2c2c2e] text-[#48484a] cursor-not-allowed'
                                )}
                            >
                                {toolRunning
                                    ? <><Loader2 size={10} className="animate-spin" /> Running…</>
                                    : <><Play size={10} /> Run Tool</>}
                            </button>

                            {/* Result */}
                            {toolResult !== null && (
                                <div className={cn('rounded-lg overflow-hidden border', toolResultErr ? 'border-red-500/20' : 'border-green-500/20')}>
                                    <div className={cn('px-2 py-1 text-[8px] font-bold uppercase tracking-wide', toolResultErr ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400')}>
                                        {toolResultErr ? 'Error' : 'Result'}
                                    </div>
                                    <div className="bg-[#0d0d0f] px-2.5 py-2 max-h-40 overflow-y-auto custom-scrollbar">
                                        <pre className="text-[9px] font-mono text-[#aeaeb2] whitespace-pre-wrap break-all">{toolResult}</pre>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── IDE Connector ─────────────────────────────────────────── */}
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-[#636366] uppercase tracking-wider flex items-center gap-1.5">
                        <FileCode size={10} /> IDE Connector
                    </div>

                    <div className="flex bg-[#252526] border border-[#2c2c2e] rounded-xl overflow-hidden">
                        {IDE_TABS.map(tab => (
                            <button key={tab.id} onClick={() => setActiveIde(tab.id)}
                                className={cn(
                                    'flex-1 py-1.5 text-[10px] font-semibold transition-colors',
                                    activeIde === tab.id ? 'bg-[#1a1a1c] text-white' : 'text-[#48484a] hover:text-[#aeaeb2]'
                                )}>
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {ideConfig && (
                        <div className="space-y-2">
                            <div className="relative">
                                <pre className="bg-[#0d0d0f] border border-[#2c2c2e] rounded-xl p-2.5 text-[9px] font-mono text-[#aeaeb2] overflow-x-auto whitespace-pre custom-scrollbar max-h-28">
                                    {ideConfig.config}
                                </pre>
                                <button onClick={handleCopy}
                                    className={cn(
                                        'absolute top-2 right-2 p-1.5 rounded-lg text-[10px] transition-all',
                                        copied ? 'bg-green-500/20 text-green-400' : 'bg-[#252526] border border-[#2c2c2e] text-[#48484a] hover:text-white'
                                    )} title="Copy config">
                                    {copied ? <Check size={11} /> : <Copy size={11} />}
                                </button>
                            </div>
                            <p className="text-[9px] text-[#48484a] leading-snug">{ideConfig.note}</p>
                            <p className="text-[8px] text-[#3a3a3c] font-mono">{ideConfig.filePath}</p>
                            {serverStatus !== 'running' && (
                                <div className="flex items-start gap-2 p-2.5 bg-yellow-500/5 border border-yellow-500/20 rounded-xl text-[10px] text-yellow-500/80">
                                    <span className="shrink-0">⚠</span>
                                    <span>Start the MCP server first — IDE connects to the live container URL.</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Activity Log ──────────────────────────────────────────── */}
                {activity.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-[10px] font-bold text-[#636366] uppercase tracking-wider flex items-center justify-between">
                            <span className="flex items-center gap-1.5"><Terminal size={10} /> Activity</span>
                            <button onClick={() => setActivity([])} className="text-[#3a3a3c] hover:text-[#636366] transition-colors" title="Clear">
                                <Trash2 size={10} />
                            </button>
                        </div>
                        <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
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

                {/* ── Tool Reference ────────────────────────────────────────── */}
                <div>
                    <button
                        onClick={() => setShowToolRef(p => !p)}
                        className="w-full flex items-center justify-between text-[10px] font-bold text-[#636366] uppercase tracking-wider py-1 hover:text-[#aeaeb2] transition-colors"
                    >
                        <span className="flex items-center gap-1.5"><Zap size={10} /> {TOOL_DEFS.length} Tools</span>
                        {showToolRef ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </button>

                    {showToolRef && (
                        <div className="mt-2 space-y-1">
                            {TOOL_DEFS.map(({ name, badge, desc }) => (
                                <div key={name} className="flex items-start gap-2 p-2 bg-[#1c1c1e] rounded-xl border border-[#2c2c2e]">
                                    <span className={cn('text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5', BADGE_COLOR[badge])}>
                                        {badge}
                                    </span>
                                    <div>
                                        <div className="text-[10px] font-mono text-[#cccccc]">{name}</div>
                                        <div className="text-[9px] text-[#48484a]">{desc}</div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setSelectedTool(name);
                                            const def = TOOL_DEFS.find(t => t.name === name);
                                            if (def) setToolArgs(def.defaultArgs);
                                            setRunnerOpen(true);
                                            setToolResult(null);
                                        }}
                                        className="ml-auto shrink-0 text-[#3a3a3c] hover:text-green-400 transition-colors"
                                        title="Open in Tool Runner"
                                    >
                                        <Play size={9} />
                                    </button>
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

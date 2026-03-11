/**
 * ─── DATA PANEL v2 ────────────────────────────────────────────────────────────
 * DB-1 — Data Sources panel.
 *
 * Change Log v2:
 * ADDED: Auto-refresh polling per source — Off / 30s / 1m / 5m (useEffect interval)
 * ADDED: DataTable view — toggle for array responses showing first 8 rows
 * ADDED: Copy {{binding}} button on hover of each JsonTree leaf
 * ADDED: Row count badge in SourceCard header when data is an array
 * ADDED: Relative time display ("2m ago") from lastFetchedAt
 * ADDED: Schema search — filter JsonTree to matching field names
 * PRESERVED: DS-ENV-1, DS-FETCH-1, DS-SCHEMA-1 (unchanged)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    Database, Globe, Plus, Trash2, ChevronDown, ChevronRight,
    Loader2, CheckCircle2, XCircle, RefreshCw, Eye, EyeOff,
    Braces, Server, Zap, Link2, Copy, Check, Clock,
    Table2, LayoutList, Search, X,
} from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { cn } from '../../lib/utils';
import type { DataSource } from '../../context/ProjectContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const relTime = (iso: string): string => {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 10_000)  return 'just now';
    if (d < 60_000)  return `${Math.floor(d / 1000)}s ago`;
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return `${Math.floor(d / 86_400_000)}d ago`;
};

// ─── JsonTree ─────────────────────────────────────────────────────────────────

const JsonTree: React.FC<{
    data: unknown;
    parentKey?: string;
    setDragData: (d: unknown) => void;
    searchTerm?: string;
}> = ({ data, parentKey = '', setDragData, searchTerm = '' }) => {
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const copyBinding = (key: string) => {
        const binding = `{{${key}}}`;
        navigator.clipboard.writeText(binding).then(() => {
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 1500);
        });
    };

    if (typeof data !== 'object' || data === null) {
        const displayKey = parentKey.split('.').pop() ?? parentKey;

        // Filter by search term
        if (searchTerm && !displayKey.toLowerCase().includes(searchTerm.toLowerCase())) {
            return null;
        }

        return (
            <div
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', `{{${parentKey}}}`);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDragData({ type: 'DATA_BINDING', payload: parentKey, meta: { sample: String(data) } });
                }}
                className="flex items-center gap-1.5 py-0.5 pl-3 text-[10px] hover:bg-[#2a2a2c] cursor-grab group rounded"
            >
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500/70 shrink-0" />
                <span className="font-mono text-blue-300 flex-1 truncate">{displayKey}</span>
                <span className="text-[#444] truncate max-w-[80px] text-[9px]">
                    "{String(data).slice(0, 24)}"
                </span>
                <button
                    onClick={(e) => { e.stopPropagation(); copyBinding(parentKey); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-600 hover:text-blue-400 transition-all shrink-0"
                    title={`Copy {{${parentKey}}}`}
                >
                    {copiedKey === parentKey
                        ? <Check size={9} className="text-emerald-400" />
                        : <Copy size={9} />}
                </button>
            </div>
        );
    }

    return (
        <div className="pl-2 border-l border-[#2c2c2e] ml-1">
            {Object.entries(data as Record<string, unknown>).map(([key, value]) => {
                const fullKey = parentKey ? `${parentKey}.${key}` : key;
                if (typeof value === 'object' && value !== null) {
                    return (
                        <div key={key}>
                            <div className="py-0.5 text-[10px] text-[#636366] font-semibold pl-1">{key}</div>
                            <JsonTree data={value} parentKey={fullKey} setDragData={setDragData} searchTerm={searchTerm} />
                        </div>
                    );
                }
                return (
                    <JsonTree key={key} data={value} parentKey={fullKey} setDragData={setDragData} searchTerm={searchTerm} />
                );
            })}
        </div>
    );
};

// ─── DataTable ────────────────────────────────────────────────────────────────

const DataTable: React.FC<{ rows: Record<string, unknown>[] }> = ({ rows }) => {
    if (!rows.length) return null;
    const cols = Object.keys(rows[0]).slice(0, 6); // max 6 columns
    const preview = rows.slice(0, 8);

    return (
        <div className="overflow-x-auto custom-scrollbar rounded border border-[#2c2c2e]">
            <table className="w-full text-[9px] font-mono">
                <thead>
                    <tr className="bg-[#1c1c1e]">
                        {cols.map(col => (
                            <th key={col} className="px-2 py-1 text-left text-[#636366] font-bold uppercase tracking-wide border-b border-[#2c2c2e] whitespace-nowrap">
                                {col}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {preview.map((row, i) => (
                        <tr key={i} className="border-b border-[#1e1e1e] hover:bg-[#1c1c1e] transition-colors">
                            {cols.map(col => (
                                <td key={col} className="px-2 py-1 text-[#636366] max-w-[120px] truncate">
                                    {row[col] === null ? <span className="text-[#3a3a3c]">null</span>
                                        : row[col] === undefined ? <span className="text-[#3a3a3c]">—</span>
                                            : String(row[col]).slice(0, 40)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

// ─── Constants ────────────────────────────────────────────────────────────────

type DataSourceKind = 'rest' | 'supabase' | 'planetscale';

const KIND_TABS: { id: DataSourceKind; label: string; icon: React.FC<{ size?: number; className?: string }>; color: string }[] = [
    { id: 'rest',        label: 'REST',        icon: Globe as any,  color: 'text-blue-400'    },
    { id: 'supabase',    label: 'Supabase',    icon: Zap as any,    color: 'text-emerald-400' },
    { id: 'planetscale', label: 'PlanetScale', icon: Server as any, color: 'text-purple-400'  },
];

const POLL_OPTIONS: { label: string; ms: number | null }[] = [
    { label: 'Off',   ms: null    },
    { label: '30s',   ms: 30_000  },
    { label: '1m',    ms: 60_000  },
    { label: '5m',    ms: 300_000 },
];

// ─── StatusBadge ──────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status?: DataSource['status'] }> = ({ status = 'idle' }) => {
    const map: Record<string, { icon: any; cls: string; label: string }> = {
        idle:       { icon: null,          cls: 'text-[#636366]',  label: 'idle'       },
        connecting: { icon: Loader2,       cls: 'text-amber-400',  label: 'connecting' },
        connected:  { icon: CheckCircle2,  cls: 'text-emerald-400', label: 'live'      },
        error:      { icon: XCircle,       cls: 'text-red-400',    label: 'error'      },
    };
    const { icon: Icon, cls, label } = map[status] ?? map.idle;
    return (
        <span className={cn('flex items-center gap-1 text-[9px] font-mono', cls)}>
            {Icon && <Icon size={9} className={status === 'connecting' ? 'animate-spin' : ''} />}
            {label}
        </span>
    );
};

// ─── HeaderEditor ─────────────────────────────────────────────────────────────

const HeaderEditor: React.FC<{
    headers: Record<string, string>;
    onChange: (h: Record<string, string>) => void;
}> = ({ headers, onChange }) => {
    const [newK, setNewK] = useState('');
    const [newV, setNewV] = useState('');
    const [showValues, setShowValues] = useState(false);

    const add = () => {
        if (!newK.trim()) return;
        onChange({ ...headers, [newK.trim()]: newV });
        setNewK(''); setNewV('');
    };
    const remove = (k: string) => {
        const next = { ...headers };
        delete next[k];
        onChange(next);
    };

    return (
        <div className="mt-2">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-bold text-[#636366] uppercase tracking-wider">Headers</span>
                <button onClick={() => setShowValues(p => !p)} className="text-[#48484a] hover:text-[#aeaeb2]">
                    {showValues ? <EyeOff size={9} /> : <Eye size={9} />}
                </button>
            </div>
            {Object.entries(headers).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1 mb-1 group">
                    <span className="flex-1 font-mono text-[9px] text-[#aeaeb2] truncate">{k}</span>
                    <span className="text-[9px] font-mono text-[#48484a] truncate max-w-[80px]">
                        {showValues ? v : '••••'}
                    </span>
                    <button onClick={() => remove(k)} className="opacity-0 group-hover:opacity-100 text-[#48484a] hover:text-red-400 transition-all">
                        <X size={9} />
                    </button>
                </div>
            ))}
            <div className="flex gap-1 mt-1">
                <input value={newK} onChange={e => setNewK(e.target.value)} placeholder="Key"
                    className="flex-1 bg-[#1e1e1e] border border-[#2c2c2e] rounded px-1.5 py-0.5 text-[9px] font-mono text-zinc-300 placeholder-zinc-700 outline-none" />
                <input value={newV} onChange={e => setNewV(e.target.value)} placeholder="Value"
                    onKeyDown={e => e.key === 'Enter' && add()}
                    className="flex-1 bg-[#1e1e1e] border border-[#2c2c2e] rounded px-1.5 py-0.5 text-[9px] font-mono text-zinc-300 placeholder-zinc-700 outline-none" />
                <button onClick={add} disabled={!newK.trim()}
                    className="px-1.5 text-[9px] text-zinc-400 hover:text-white border border-[#3a3a3c] rounded disabled:opacity-30">+</button>
            </div>
        </div>
    );
};

// ─── SourceCard ───────────────────────────────────────────────────────────────

const SourceCard: React.FC<{
    ds: DataSource;
    onRemove: (id: string) => void;
    setDragData: (d: unknown) => void;
    onRefresh: (ds: DataSource) => Promise<void>;
}> = ({ ds, onRemove, setDragData, onRefresh }) => {
    const [expanded, setExpanded]         = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pollMs, setPollMs]             = useState<number | null>(null);
    const [viewMode, setViewMode]         = useState<'tree' | 'table'>('tree');
    const [schemaSearch, setSchemaSearch] = useState('');
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const kindInfo  = KIND_TABS.find(t => t.id === (ds.kind ?? 'rest'))!;
    const KindIcon  = kindInfo?.icon ?? Globe;
    const kindColor = kindInfo?.color ?? 'text-blue-400';
    const isArray   = Array.isArray(ds.data) && ds.data.length > 0;
    const canPoll   = (ds.kind ?? 'rest') !== 'planetscale';

    // ── Auto-refresh interval ─────────────────────────────────────────────────
    useEffect(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        if (!pollMs || !canPoll) return;
        pollRef.current = setInterval(async () => {
            if (isRefreshing) return;
            setIsRefreshing(true);
            await onRefresh(ds).catch(() => {});
            setIsRefreshing(false);
        }, pollMs);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pollMs, ds.id]);

    return (
        <div className="border border-[#2c2c2e] rounded-xl overflow-hidden mb-3">
            {/* Card header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[#1c1c1e]">
                <KindIcon size={11} className={kindColor} />
                <span className="text-[11px] font-semibold text-[#e5e5ea] flex-1 truncate">{ds.name}</span>
                <StatusBadge status={ds.status} />
                {isArray && (
                    <span className="text-[8px] text-[#48484a] bg-[#2c2c2e] px-1.5 py-0.5 rounded-full shrink-0">
                        {(ds.data as unknown[]).length} rows
                    </span>
                )}
                {canPoll && (
                    <button
                        onClick={async () => { setIsRefreshing(true); await onRefresh(ds); setIsRefreshing(false); }}
                        disabled={isRefreshing}
                        className="text-[#48484a] hover:text-[#aeaeb2] disabled:opacity-40 transition-colors"
                        title="Refresh now"
                    >
                        <RefreshCw size={10} className={isRefreshing ? 'animate-spin' : ''} />
                    </button>
                )}
                <button onClick={() => setExpanded(p => !p)} className="text-[#48484a] hover:text-[#aeaeb2]">
                    {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
                <button onClick={() => onRemove(ds.id)} className="text-[#48484a] hover:text-red-400 transition-colors">
                    <Trash2 size={10} />
                </button>
            </div>

            {/* Subtitle bar */}
            <div className="px-3 py-1 bg-[#161618] border-b border-[#2c2c2e] flex items-center gap-2">
                <span className="text-[9px] font-mono text-[#48484a] truncate flex-1">
                    {ds.kind === 'planetscale' ? ds.psHost : ds.url}
                </span>
                {ds.lastFetchedAt && (
                    <span className="flex items-center gap-1 text-[8px] text-[#3a3a3c] shrink-0">
                        <Clock size={8} /> {relTime(ds.lastFetchedAt)}
                    </span>
                )}
            </div>

            {expanded && (
                <div className="bg-[#111113]">
                    {ds.errorMessage ? (
                        <div className="flex items-start gap-1.5 p-3">
                            <XCircle size={10} className="text-red-400 shrink-0 mt-0.5" />
                            <span className="text-[10px] text-red-300 font-mono break-all">{ds.errorMessage}</span>
                        </div>
                    ) : ds.data ? (
                        <div className="p-2">
                            {/* Schema toolbar */}
                            <div className="flex items-center gap-1.5 mb-1.5 px-1">
                                <Braces size={9} className="text-[#48484a]" />
                                <span className="text-[9px] font-bold text-[#48484a] uppercase tracking-wider flex-1">
                                    Schema
                                </span>
                                {/* Search */}
                                <div className="relative">
                                    <Search size={8} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#48484a]" />
                                    <input
                                        value={schemaSearch}
                                        onChange={e => setSchemaSearch(e.target.value)}
                                        placeholder="filter"
                                        className="bg-[#1c1c1e] border border-[#2c2c2e] rounded px-1.5 pl-4 py-0.5 text-[9px] font-mono text-zinc-300 placeholder-zinc-700 outline-none w-20 focus:w-28 transition-all"
                                    />
                                </div>
                                {/* View toggle for arrays */}
                                {isArray && (
                                    <div className="flex rounded overflow-hidden border border-[#2c2c2e]">
                                        <button onClick={() => setViewMode('tree')}
                                            className={cn('p-1 transition-colors', viewMode === 'tree' ? 'bg-[#2c2c2e] text-white' : 'text-[#48484a] hover:text-zinc-400')}>
                                            <LayoutList size={9} />
                                        </button>
                                        <button onClick={() => setViewMode('table')}
                                            className={cn('p-1 transition-colors', viewMode === 'table' ? 'bg-[#2c2c2e] text-white' : 'text-[#48484a] hover:text-zinc-400')}>
                                            <Table2 size={9} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Data view */}
                            {isArray && viewMode === 'table'
                                ? <DataTable rows={ds.data as Record<string, unknown>[]} />
                                : <JsonTree
                                    data={isArray ? (ds.data as unknown[])[0] : ds.data}
                                    parentKey={ds.id}
                                    setDragData={setDragData}
                                    searchTerm={schemaSearch}
                                />
                            }

                            {/* Auto-refresh row */}
                            {canPoll && (
                                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[#1e1e1e] px-1">
                                    <span className="text-[9px] text-[#48484a]">Auto-refresh</span>
                                    <div className="flex gap-0.5 ml-auto">
                                        {POLL_OPTIONS.map(opt => (
                                            <button
                                                key={opt.label}
                                                onClick={() => setPollMs(opt.ms)}
                                                className={cn(
                                                    'px-1.5 py-0.5 rounded text-[8px] font-bold transition-all',
                                                    pollMs === opt.ms
                                                        ? 'bg-emerald-500/20 text-emerald-400'
                                                        : 'text-[#48484a] hover:text-zinc-400'
                                                )}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    {pollMs && (
                                        <span className="text-[8px] text-emerald-400/60 animate-pulse">●</span>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-[10px] text-[#48484a] px-3 py-2">No schema yet.</div>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── AddForm ──────────────────────────────────────────────────────────────────

const AddForm: React.FC<{
    onAdd: (ds: DataSource) => void;
    onCancel: () => void;
}> = ({ onAdd, onCancel }) => {
    const [kind, setKind]         = useState<DataSourceKind>('rest');
    const [name, setName]         = useState('');
    const [url, setUrl]           = useState('');
    const [method, setMethod]     = useState<'GET' | 'POST'>('GET');
    const [headers, setHeaders]   = useState<Record<string, string>>({});
    const [body, setBody]         = useState('');
    const [sbAnonKey, setSbAnonKey] = useState('');
    const [sbTable, setSbTable]   = useState('');
    const [psHost, setPsHost]     = useState('');
    const [psUser, setPsUser]     = useState('');
    const [psPass, setPsPass]     = useState('');
    const [psDb, setPsDb]         = useState('');
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState('');

    const isValid = (() => {
        if (kind === 'rest')        return !!url.trim();
        if (kind === 'supabase')    return !!url.trim() && !!sbAnonKey.trim() && !!sbTable.trim();
        if (kind === 'planetscale') return !!psHost.trim() && !!psUser.trim() && !!psDb.trim();
        return false;
    })();

    const handleConnect = useCallback(async () => {
        setFetchError('');
        setIsFetching(true);
        try {
            if (kind === 'rest') {
                const res = await fetch(url, {
                    method,
                    headers: { ...headers },
                    ...(method !== 'GET' && body ? { body } : {}),
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const json = await res.json();
                const sample = Array.isArray(json) ? json[0] : json;
                onAdd({
                    id: `ds-${crypto.randomUUID().slice(0, 8)}`,
                    name: name.trim() || url.split('/').pop() || 'API',
                    kind: 'rest', url, method, headers, body: body || undefined,
                    data: sample, status: 'connected',
                    lastFetchedAt: new Date().toISOString(),
                });
            } else if (kind === 'supabase') {
                const base = url.replace(/\/$/, '');
                const res = await fetch(`${base}/rest/v1/${sbTable}?limit=1`, {
                    headers: { apikey: sbAnonKey, Authorization: `Bearer ${sbAnonKey}` },
                });
                if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
                const json = await res.json();
                const sample = Array.isArray(json) ? json[0] : json;
                onAdd({
                    id: `ds-${crypto.randomUUID().slice(0, 8)}`,
                    name: name.trim() || sbTable, kind: 'supabase',
                    url, method: 'GET', supabaseAnonKey: sbAnonKey, supabaseTable: sbTable,
                    data: sample ?? { id: 'uuid', created_at: 'timestamp' },
                    status: 'connected', lastFetchedAt: new Date().toISOString(),
                    envVarMap: { url: 'NEXT_PUBLIC_SUPABASE_URL', supabaseAnonKey: 'NEXT_PUBLIC_SUPABASE_ANON_KEY' },
                });
            } else if (kind === 'planetscale') {
                onAdd({
                    id: `ds-${crypto.randomUUID().slice(0, 8)}`,
                    name: name.trim() || psDb, kind: 'planetscale',
                    url: psHost, method: 'GET',
                    psHost, psUsername: psUser, psPassword: psPass, psDatabase: psDb,
                    data: { note: 'PlanetScale is server-side only. Use env vars in API routes.' },
                    status: 'connected',
                    envVarMap: { psHost: 'DATABASE_HOST', psUsername: 'DATABASE_USERNAME', psPassword: 'DATABASE_PASSWORD', psDatabase: 'DATABASE_NAME' },
                });
            }
        } catch (e: unknown) {
            setFetchError((e as Error).message ?? 'Connection failed');
        } finally {
            setIsFetching(false);
        }
    }, [kind, name, url, method, headers, body, sbAnonKey, sbTable, psHost, psUser, psPass, psDb, onAdd]);

    return (
        <div className="mx-3 mb-3 border border-[#2c2c2e] rounded-xl overflow-hidden">
            {/* Kind tabs */}
            <div className="flex bg-[#1c1c1e] border-b border-[#2c2c2e]">
                {KIND_TABS.map(tab => (
                    <button key={tab.id} onClick={() => setKind(tab.id)}
                        className={cn(
                            'flex-1 py-1.5 text-[10px] font-bold flex items-center justify-center gap-1 transition-colors',
                            kind === tab.id ? `bg-[#252526] ${tab.color}` : 'text-[#48484a] hover:text-[#aeaeb2]'
                        )}>
                        <tab.icon size={9} /> {tab.label}
                    </button>
                ))}
            </div>

            <div className="p-3 space-y-2 bg-[#161618]">
                {/* Name */}
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Source name (optional)"
                    className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-[#48484a]" />

                {kind === 'rest' && (
                    <>
                        <div className="flex gap-1.5">
                            <select value={method} onChange={e => setMethod(e.target.value as 'GET' | 'POST')}
                                className="bg-[#1e1e1e] border border-[#2c2c2e] rounded px-1.5 py-1.5 text-[10px] text-zinc-300 outline-none">
                                <option>GET</option><option>POST</option>
                            </select>
                            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/data"
                                className="flex-1 bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-[#48484a]" />
                        </div>
                        <HeaderEditor headers={headers} onChange={setHeaders} />
                        {method === 'POST' && (
                            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder='{"key": "value"}' rows={3}
                                className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-600 outline-none resize-none" />
                        )}
                    </>
                )}

                {kind === 'supabase' && (
                    <>
                        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co"
                            className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-[#48484a]" />
                        <input value={sbAnonKey} onChange={e => setSbAnonKey(e.target.value)} placeholder="anon / public key" type="password"
                            className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-600 outline-none focus:border-[#48484a]" />
                        <input value={sbTable} onChange={e => setSbTable(e.target.value)} placeholder="table_name"
                            className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-600 outline-none focus:border-[#48484a]" />
                        <p className="text-[9px] text-[#48484a] leading-relaxed">
                            Fetches one row via <code className="text-[#636366]">/rest/v1/&#123;table&#125;?limit=1</code> for schema introspection.<br />
                            Credentials → <code className="text-[#636366]">.env.local</code> (DS-ENV-1).
                        </p>
                    </>
                )}

                {kind === 'planetscale' && (
                    <>
                        <input value={psHost} onChange={e => setPsHost(e.target.value)} placeholder="aws.connect.psdb.cloud"
                            className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-600 outline-none" />
                        <input value={psUser} onChange={e => setPsUser(e.target.value)} placeholder="username"
                            className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-600 outline-none" />
                        <input value={psPass} onChange={e => setPsPass(e.target.value)} placeholder="password" type="password"
                            className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-600 outline-none" />
                        <input value={psDb} onChange={e => setPsDb(e.target.value)} placeholder="database"
                            className="w-full bg-[#1e1e1e] border border-[#2c2c2e] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-600 outline-none" />
                        <p className="text-[9px] text-[#48484a]">
                            Server-side only. Credentials → <code className="text-[#636366]">.env.local</code> (DS-ENV-1).
                        </p>
                    </>
                )}

                {fetchError && (
                    <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <XCircle size={10} className="text-red-400 shrink-0 mt-0.5" />
                        <span className="text-[10px] text-red-300 font-mono break-all">{fetchError}</span>
                    </div>
                )}

                <div className="flex gap-2 pt-1">
                    <button onClick={onCancel}
                        className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-[#636366] hover:text-[#aeaeb2] border border-[#3a3a3c] transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleConnect} disabled={!isValid || isFetching}
                        className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold transition-all',
                            isValid && !isFetching
                                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                : 'bg-[#2c2c2e] text-[#48484a] cursor-not-allowed'
                        )}>
                        {isFetching
                            ? <><Loader2 size={10} className="animate-spin" /> Connecting…</>
                            : kind === 'planetscale'
                                ? <><Link2 size={10} /> Save & Inject Env</>
                                : <><Zap size={10} /> Connect & Fetch</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── DataPanel ────────────────────────────────────────────────────────────────

export const DataPanel: React.FC = () => {
    const { dataSources, addDataSource, removeDataSource, updateDataSource, setDragData } = useEditor();
    const [showAddForm, setShowAddForm] = useState(false);

    const handleRefresh = useCallback(async (ds: DataSource) => {
        const kind = ds.kind ?? 'rest';
        if (kind === 'supabase' && ds.supabaseAnonKey) {
            try {
                updateDataSource(ds.id, { status: 'connecting', errorMessage: undefined });
                const base = ds.url.replace(/\/$/, '');
                const res = await fetch(`${base}/rest/v1/${ds.supabaseTable}?limit=1`, {
                    headers: { apikey: ds.supabaseAnonKey, Authorization: `Bearer ${ds.supabaseAnonKey}` },
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const json = await res.json();
                const sample = Array.isArray(json) ? json[0] : json;
                updateDataSource(ds.id, { data: sample, status: 'connected', lastFetchedAt: new Date().toISOString(), errorMessage: undefined });
            } catch (e: unknown) {
                updateDataSource(ds.id, { status: 'error', errorMessage: (e as Error).message });
            }
        } else if (kind === 'rest') {
            try {
                updateDataSource(ds.id, { status: 'connecting', errorMessage: undefined });
                const res = await fetch(ds.url, {
                    method: ds.method,
                    headers: ds.headers,
                    ...(ds.method !== 'GET' && ds.body ? { body: ds.body } : {}),
                });
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const json = await res.json();
                const sample = Array.isArray(json) ? json[0] : json;
                updateDataSource(ds.id, { data: sample, status: 'connected', lastFetchedAt: new Date().toISOString(), errorMessage: undefined });
            } catch (e: unknown) {
                updateDataSource(ds.id, { status: 'error', errorMessage: (e as Error).message });
            }
        }
        // PlanetScale: no-op (server-side only) — DS-FETCH-1
    }, [updateDataSource]);

    return (
        <div className="flex flex-col h-full overflow-y-auto custom-scrollbar pb-16">
            {/* Header */}
            <div className="px-3 pt-3 pb-2.5 border-b border-[#2c2c2e] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <Database size={13} className="text-emerald-400" />
                    <span className="text-[11px] font-bold text-white uppercase tracking-wider">Data Sources</span>
                    {dataSources.length > 0 && (
                        <span className="text-[9px] text-[#48484a] bg-[#2c2c2e] px-1.5 py-0.5 rounded-full">
                            {dataSources.length}
                        </span>
                    )}
                </div>
                {!showAddForm && (
                    <button onClick={() => setShowAddForm(true)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#2c2c2e] hover:bg-[#3a3a3c] text-[10px] font-bold text-[#aeaeb2] transition-colors">
                        <Plus size={10} /> Add
                    </button>
                )}
            </div>

            {showAddForm && (
                <div className="pt-3">
                    <AddForm
                        onAdd={(ds) => { addDataSource(ds); setShowAddForm(false); }}
                        onCancel={() => setShowAddForm(false)}
                    />
                </div>
            )}

            <div className="flex-1 px-3 pt-3">
                {dataSources.length === 0 && !showAddForm ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                        <Database size={28} className="text-[#3a3a3c]" />
                        <p className="text-[11px] font-semibold text-[#636366] mb-1">No data sources yet</p>
                        <p className="text-[10px] text-[#48484a] leading-relaxed max-w-[200px]">
                            Connect REST APIs, Supabase, or PlanetScale.<br />
                            Drag fields onto elements to bind live data.
                        </p>
                        <button onClick={() => setShowAddForm(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2c2c2e] hover:bg-[#3a3a3c] rounded-lg text-[10px] font-bold text-[#aeaeb2] transition-colors border border-[#3a3a3c]">
                            <Plus size={11} /> Add your first source
                        </button>
                    </div>
                ) : (
                    dataSources.map(ds => (
                        <SourceCard key={ds.id} ds={ds} onRemove={removeDataSource} setDragData={setDragData} onRefresh={handleRefresh} />
                    ))
                )}
            </div>
        </div>
    );
};

export default DataPanel;

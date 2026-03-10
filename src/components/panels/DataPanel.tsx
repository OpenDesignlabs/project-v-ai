/**
 * ─── DATA PANEL ───────────────────────────────────────────────────────────────
 * DB-1 — Data Sources panel extracted from LeftSidebar.
 *
 * Three connection types:
 *   REST        — URL + method (GET/POST) + custom headers + optional body
 *   Supabase    — project URL + anon key + table → fetch via REST API v1
 *   PlanetScale — host + user + password + db → env var only (server-side)
 *
 * Architecture rules:
 *   DS-ENV-1 [PERMANENT]: Secret values (anon key, passwords, bearer tokens)
 *     MUST NOT be stored in ProjectContext state beyond initial entry.
 *     They travel through envVarMap → useFileSync → .env.local.
 *
 *   DS-FETCH-1 [PERMANENT]: Supabase table fetch uses /rest/v1/{table}?limit=1
 *     with apikey + Authorization headers — no supabase-js dependency in editor.
 *
 *   DS-SCHEMA-1 [PERMANENT]: JsonTree receives ds.data for drag-to-bind.
 *     Drag payload format: "{{dsId.fieldPath}}" — matches existing convention.
 */

import React, { useState, useCallback } from 'react';
import {
    Database, Globe, Plus, Trash2, ChevronDown, ChevronRight,
    Loader2, CheckCircle2, XCircle, RefreshCw, Eye, EyeOff,
    Braces, Server, Zap, Link2, X,
} from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { cn } from '../../lib/utils';
import type { DataSource } from '../../context/ProjectContext';

// ─── JsonTree ─────────────────────────────────────────────────────────────────

const JsonTree = ({ data, parentKey = '', setDragData }: any) => {
    if (typeof data !== 'object' || data === null) {
        const displayKey = parentKey.split('.').pop();
        return (
            <div
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', `{{${parentKey}}}`);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDragData({ type: 'DATA_BINDING', payload: parentKey, meta: { sample: String(data) } });
                }}
                className="flex items-center gap-2 py-0.5 pl-3 text-[10px] text-[#999] hover:bg-[#2a2a2c] hover:text-white cursor-grab group rounded"
            >
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500/70 shrink-0" />
                <span className="font-mono text-blue-300">{displayKey}</span>
                <span className="text-[#555] truncate max-w-[90px]">"{String(data)}"</span>
            </div>
        );
    }
    return (
        <div className="pl-2 border-l border-[#2c2c2e] ml-1">
            {Object.entries(data).map(([key, value]) => (
                <div key={key}>
                    {typeof value === 'object' && value !== null ? (
                        <>
                            <div className="py-0.5 text-[10px] text-[#636366] font-semibold pl-1">{key}</div>
                            <JsonTree data={value} parentKey={parentKey ? `${parentKey}.${key}` : key} setDragData={setDragData} />
                        </>
                    ) : (
                        <JsonTree data={value} parentKey={parentKey ? `${parentKey}.${key}` : key} setDragData={setDragData} />
                    )}
                </div>
            ))}
        </div>
    );
};

// ─── Constants ────────────────────────────────────────────────────────────────

type DataSourceKind = 'rest' | 'supabase' | 'planetscale';

const KIND_TABS: { id: DataSourceKind; label: string; icon: any; color: string }[] = [
    { id: 'rest', label: 'REST', icon: Globe, color: 'text-blue-400' },
    { id: 'supabase', label: 'Supabase', icon: Zap, color: 'text-emerald-400' },
    { id: 'planetscale', label: 'PlanetScale', icon: Server, color: 'text-purple-400' },
];

const METHOD_OPTIONS = ['GET', 'POST'] as const;

// ─── StatusBadge ──────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status?: DataSource['status'] }> = ({ status = 'idle' }) => {
    const map: Record<string, { icon: any; cls: string; label: string }> = {
        idle: { icon: null, cls: 'text-[#636366]', label: 'idle' },
        connecting: { icon: Loader2, cls: 'text-amber-400', label: 'connecting' },
        connected: { icon: CheckCircle2, cls: 'text-emerald-400', label: 'connected' },
        error: { icon: XCircle, cls: 'text-red-400', label: 'error' },
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
                    {showValues ? <EyeOff size={10} /> : <Eye size={10} />}
                </button>
            </div>
            {Object.entries(headers).map(([k, v]) => (
                <div key={k} className="flex items-center gap-1.5 mb-1 group">
                    <span className="text-[10px] font-mono text-[#e5e5ea] flex-1 truncate">{k}</span>
                    <span className="text-[10px] font-mono text-[#636366] w-20 truncate">
                        {showValues ? v : (v ? '••••' : '(empty)')}
                    </span>
                    <button onClick={() => remove(k)} className="text-[#48484a] hover:text-red-400 opacity-0 group-hover:opacity-100">
                        <X size={10} />
                    </button>
                </div>
            ))}
            <div className="flex gap-1 mt-1.5">
                <input value={newK} onChange={e => setNewK(e.target.value)} placeholder="Header-Name"
                    onKeyDown={e => e.key === 'Enter' && add()}
                    className="flex-1 bg-[#1c1c1e] border border-[#3a3a3c] rounded px-2 py-1 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                <input value={newV} onChange={e => setNewV(e.target.value)} placeholder="value" type="password"
                    onKeyDown={e => e.key === 'Enter' && add()}
                    className="flex-1 bg-[#1c1c1e] border border-[#3a3a3c] rounded px-2 py-1 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                <button onClick={add} disabled={!newK.trim()}
                    className="p-1.5 bg-[#2c2c2e] hover:bg-[#3a3a3c] rounded disabled:opacity-40 text-[#aeaeb2]">
                    <Plus size={10} />
                </button>
            </div>
        </div>
    );
};

// ─── AddForm ──────────────────────────────────────────────────────────────────

const AddForm: React.FC<{
    onAdd: (ds: DataSource) => void;
    onCancel: () => void;
}> = ({ onAdd, onCancel }) => {
    const [kind, setKind] = useState<DataSourceKind>('rest');
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [method, setMethod] = useState<'GET' | 'POST'>('GET');
    const [headers, setHeaders] = useState<Record<string, string>>({});
    const [body, setBody] = useState('');
    const [sbAnonKey, setSbAnonKey] = useState('');
    const [sbTable, setSbTable] = useState('');
    const [psHost, setPsHost] = useState('');
    const [psUser, setPsUser] = useState('');
    const [psPass, setPsPass] = useState('');
    const [psDb, setPsDb] = useState('');
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState('');

    const isValid = (() => {
        if (!name.trim()) return false;
        if (kind === 'rest') return !!url.trim();
        if (kind === 'supabase') return !!url.trim() && !!sbAnonKey.trim() && !!sbTable.trim();
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
        } catch (e: any) {
            setFetchError(e.message ?? 'Connection failed');
        } finally {
            setIsFetching(false);
        }
    }, [kind, name, url, method, headers, body, sbAnonKey, sbTable, psHost, psUser, psPass, psDb, onAdd]);

    return (
        <div className="border border-[#3a3a3c] rounded-xl overflow-hidden mx-3 mb-3">
            {/* Kind tabs */}
            <div className="flex border-b border-[#3a3a3c]">
                {KIND_TABS.map(t => (
                    <button key={t.id} onClick={() => setKind(t.id)}
                        className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold transition-all',
                            kind === t.id ? `bg-[#1c1c1e] ${t.color}` : 'text-[#48484a] hover:text-[#636366]'
                        )}>
                        <t.icon size={10} />
                        {t.label}
                    </button>
                ))}
            </div>
            <div className="p-3 flex flex-col gap-2.5 bg-[#161618]">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Source name"
                    className="w-full bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />

                {kind === 'rest' && (
                    <>
                        <div className="flex gap-1.5">
                            <select value={method} onChange={e => setMethod(e.target.value as any)}
                                className="bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2 py-1.5 text-[10px] text-[#aeaeb2] focus:outline-none focus:border-[#636366]">
                                {METHOD_OPTIONS.map(m => <option key={m}>{m}</option>)}
                            </select>
                            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/data"
                                className="flex-1 bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                        </div>
                        <HeaderEditor headers={headers} onChange={setHeaders} />
                        {method !== 'GET' && (
                            <textarea value={body} onChange={e => setBody(e.target.value)}
                                placeholder='{"key": "value"}' rows={3}
                                className="w-full bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366] resize-none" />
                        )}
                    </>
                )}
                {kind === 'supabase' && (
                    <>
                        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co"
                            className="w-full bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                        <input value={sbAnonKey} onChange={e => setSbAnonKey(e.target.value)} type="password" placeholder="anon / public key"
                            className="w-full bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                        <input value={sbTable} onChange={e => setSbTable(e.target.value)} placeholder="table name (e.g. products)"
                            className="w-full bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                        <p className="text-[9px] text-[#48484a] leading-relaxed">
                            Anon key → <code className="text-emerald-400/80">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code className="text-[#636366]">.env.local</code>.
                        </p>
                    </>
                )}
                {kind === 'planetscale' && (
                    <>
                        <input value={psHost} onChange={e => setPsHost(e.target.value)} placeholder="aws.connect.psdb.cloud"
                            className="w-full bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                        <div className="flex gap-1.5">
                            <input value={psUser} onChange={e => setPsUser(e.target.value)} placeholder="username"
                                className="flex-1 bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                            <input value={psPass} onChange={e => setPsPass(e.target.value)} type="password" placeholder="password"
                                className="flex-1 bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                        </div>
                        <input value={psDb} onChange={e => setPsDb(e.target.value)} placeholder="database name"
                            className="w-full bg-[#1c1c1e] border border-[#3a3a3c] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-white placeholder-[#48484a] focus:outline-none focus:border-[#636366]" />
                        <p className="text-[9px] text-[#48484a] leading-relaxed">
                            Credentials → <code className="text-purple-400/80">DATABASE_*</code> vars in <code className="text-[#636366]">.env.local</code>. Server-side only.
                        </p>
                    </>
                )}
                {fetchError && (
                    <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                        <XCircle size={11} className="text-red-400 shrink-0 mt-0.5" />
                        <span className="text-[10px] text-red-300 font-mono break-all">{fetchError}</span>
                    </div>
                )}
                <div className="flex gap-2 pt-1">
                    <button onClick={onCancel}
                        className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-[#636366] hover:text-[#aeaeb2] transition-colors border border-[#3a3a3c]">
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

// ─── SourceCard ───────────────────────────────────────────────────────────────

const SourceCard: React.FC<{
    ds: DataSource;
    onRemove: (id: string) => void;
    setDragData: (d: any) => void;
    onRefresh: (ds: DataSource) => Promise<void>;
}> = ({ ds, onRemove, setDragData, onRefresh }) => {
    const [expanded, setExpanded] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const kindInfo = KIND_TABS.find(t => t.id === (ds.kind ?? 'rest'))!;
    const KindIcon = kindInfo?.icon ?? Globe;
    const kindColor = kindInfo?.color ?? 'text-blue-400';

    return (
        <div className="border border-[#2c2c2e] rounded-xl overflow-hidden mb-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-[#1c1c1e]">
                <KindIcon size={11} className={kindColor} />
                <span className="text-[11px] font-semibold text-[#e5e5ea] flex-1 truncate">{ds.name}</span>
                <StatusBadge status={ds.status} />
                {(ds.kind ?? 'rest') !== 'planetscale' && (
                    <button
                        onClick={async () => { setIsRefreshing(true); await onRefresh(ds); setIsRefreshing(false); }}
                        disabled={isRefreshing}
                        className="text-[#48484a] hover:text-[#aeaeb2] disabled:opacity-40 transition-colors ml-1"
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
            <div className="px-3 py-1 bg-[#161618] border-b border-[#2c2c2e]">
                <span className="text-[9px] font-mono text-[#48484a] truncate block">
                    {ds.kind === 'planetscale' ? ds.psHost : ds.url}
                </span>
            </div>
            {expanded && (
                <div className="px-2 py-2 bg-[#111113]">
                    {ds.errorMessage ? (
                        <div className="flex items-start gap-1.5 p-2">
                            <XCircle size={10} className="text-red-400 shrink-0 mt-0.5" />
                            <span className="text-[10px] text-red-300 font-mono break-all">{ds.errorMessage}</span>
                        </div>
                    ) : ds.data ? (
                        <>
                            <div className="flex items-center gap-1 mb-1.5 px-1">
                                <Braces size={9} className="text-[#48484a]" />
                                <span className="text-[9px] font-bold text-[#48484a] uppercase tracking-wider">Schema</span>
                                {ds.lastFetchedAt && (
                                    <span className="text-[8px] text-[#3a3a3c] ml-auto">
                                        {new Date(ds.lastFetchedAt).toLocaleTimeString()}
                                    </span>
                                )}
                            </div>
                            <JsonTree data={ds.data} parentKey={ds.id} setDragData={setDragData} />
                        </>
                    ) : (
                        <div className="text-[10px] text-[#48484a] px-2 py-1">No schema yet.</div>
                    )}
                </div>
            )}
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
            } catch (e: any) {
                updateDataSource(ds.id, { status: 'error', errorMessage: e.message });
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
            } catch (e: any) {
                updateDataSource(ds.id, { status: 'error', errorMessage: e.message });
            }
        }
        // PlanetScale: no-op (server-side only)
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

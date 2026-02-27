import React, { useRef, useState, lazy, Suspense, useEffect, useCallback } from 'react';
import { useEditor } from '../context/EditorContext';
import { useContainer } from '../context/ContainerContext';
import {
    Plus, Layers, File, Image as ImageIcon,
    Search, X, Type, Layout, FormInput, Puzzle, Upload,
    ChevronRight, ChevronDown, Folder, Code2, Box, DownloadCloud, Loader2,
    Trash2, Hexagon, Palette, Wand2, Database, Globe, Braces,
    Server, Zap, CheckCircle2,
    Send, TerminalSquare, ChevronUp,
    Copy as CopyIcon, RotateCcw as RefreshCw, FlaskConical,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { processImportedCode, generateComponentId } from '../utils/importHelpers';
import { TEMPLATES, type TemplateConfig } from '../data/templates';
import { ICON_NAMES, getIconComponent } from '../data/iconRegistry';
import { Store, ShoppingBag as ShoppingBagIcon } from 'lucide-react';
import { InsertDrawer } from './InsertDrawer';
import type { ApiRoute, HttpMethod } from '../types';

const MARKETPLACE_ITEMS = [
    {
        id: 'hero_saas',
        title: 'SaaS Hero',
        category: 'Hero',
        image: 'https://cdn.dribbble.com/users/26642/screenshots/15935398/media/64b22c77607739506727276332766624.png?resize=400x300&vertical=center',
        templateKey: 'hero_saas'
    },
    {
        id: 'pricing_tables',
        title: 'SaaS Pricing',
        category: 'Pricing',
        image: 'https://cdn.dribbble.com/users/1615584/screenshots/15710288/media/78627376722329759368f3a3915220c3.jpg?resize=400x300&vertical=center',
        templateKey: 'pricing_tables'
    },
    {
        id: 'features_grid',
        title: 'Feature Grid',
        category: 'Features',
        image: 'https://cdn.dribbble.com/users/5031392/screenshots/15467520/media/c873099955d5d883b27b872da0c02dc2.png?resize=400x300&vertical=center',
        templateKey: 'features_grid'
    },
    {
        id: 'portfolio_hero',
        title: 'Creative Hero',
        category: 'Portfolio',
        image: 'https://cdn.dribbble.com/users/1256429/screenshots/15536437/media/e57973715c00b73c4d720c224206c649.png?resize=400x300&vertical=center',
        templateKey: 'portfolio_hero'
    }
];

const LayersPanel = lazy(() => import('./panels/LayersPanel').then(m => ({ default: m.LayersPanel })));

type DrawerTab = 'recent' | 'basic' | 'layout' | 'forms' | 'media' | 'templates';

const CATEGORIES: { id: DrawerTab; label: string; icon: any }[] = [
    { id: 'basic', label: 'Basic', icon: Type },
    { id: 'layout', label: 'Layout', icon: Layout },
    { id: 'forms', label: 'Forms', icon: FormInput },
    { id: 'media', label: 'Media', icon: ImageIcon },
    { id: 'templates', label: 'Templates', icon: Puzzle },
];

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
                className="flex items-center gap-2 py-1 pl-4 text-[10px] text-[#999] hover:bg-[#333] hover:text-white cursor-grab group"
            >
                <div className="w-1 h-1 rounded-full bg-blue-500" />
                <span className="font-mono text-blue-300">{displayKey}</span>
                <span className="text-[#555] truncate max-w-[80px]">"{String(data)}"</span>
            </div>
        );
    }

    return (
        <div className="pl-2 border-l border-[#333] ml-1">
            {Object.entries(data).map(([key, value]) => (
                <div key={key}>
                    {typeof value === 'object' && value !== null ? (
                        <>
                            <div className="py-1 text-[10px] text-[#777] font-bold">{key}</div>
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

const FileTreeNode = ({ name, node, depth = 0 }: { name: string, node: any, depth?: number }) => {
    const [expanded, setExpanded] = useState(false);
    const isDir = node.type === 'folder';
    const paddingLeft = `${depth * 12 + 12}px`;

    if (!isDir) {
        return (
            <div className="flex items-center gap-2 py-1 text-[10px] text-[#ccc] hover:bg-[#2a2d2e] cursor-default" style={{ paddingLeft }}>
                <Code2 size={10} className="text-blue-400" /> {name}
            </div>
        );
    }

    return (
        <div>
            <div
                className="flex items-center gap-2 py-1 text-[10px] text-[#ccc] font-bold hover:bg-[#2a2d2e] cursor-pointer select-none"
                style={{ paddingLeft }}
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <Folder size={10} className="text-yellow-500" /> {name}
            </div>
            {expanded && node.children && (
                <div>
                    {Object.entries(node.children).map(([childName, childNode]) => (
                        <FileTreeNode key={childName} name={childName} node={childNode} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

const ColorField = ({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) => (
    <div className="flex items-center justify-between">
        <label className="text-xs text-[#ccc]">{label}</label>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#666] font-mono">{value}</span>
            <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-6 h-6 rounded bg-transparent border-none p-0 cursor-pointer"
            />
        </div>
    </div>
);

// ─── ROUTE TEST PANEL ─────────────────────────────────────────────────────────────────────
// Phase G: Inline API route testing UI — request builder + response viewer.
//   Data flow:
//     1. User clicks "Test" tab → handleBootAndTest() → startDevServer() if needed
//     2. containerUrl becomes non-null when WebContainer emits 'server-ready'
//     3. User fills request, clicks Send → fetch(containerUrl + /api/route.path)
//     4. Response displayed with status badge, latency, formatted body

interface RouteTestPanelProps {
    route: ApiRoute;
    containerUrl: string | null;
    isServerBooting: boolean;
    terminalLines: string[];
    testMethod: HttpMethod;
    setTestMethod: (m: HttpMethod) => void;
    testBody: string;
    setTestBody: (b: string) => void;
    testHeaders: Array<{ id: string; key: string; value: string; enabled: boolean }>;
    setTestHeaders: React.Dispatch<React.SetStateAction<Array<{ id: string; key: string; value: string; enabled: boolean }>>>;
    testResponse: {
        status: number; statusText: string; body: string;
        formattedBody: string; latency: number; ok: boolean;
        responseHeaders: Record<string, string>;
    } | null;
    isSending: boolean;
    testError: string | null;
    showResponseHeaders: boolean;
    setShowResponseHeaders: (v: boolean) => void;
    onSend: () => void;
}

const HTTP_METHOD_COLORS: Record<HttpMethod, { active: string; idle: string }> = {
    GET: { active: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400', idle: 'bg-transparent border-[#333] text-[#444] hover:text-[#666]' },
    POST: { active: 'bg-blue-500/20 border-blue-500/50 text-blue-400', idle: 'bg-transparent border-[#333] text-[#444] hover:text-[#666]' },
    PUT: { active: 'bg-amber-500/20 border-amber-500/50 text-amber-400', idle: 'bg-transparent border-[#333] text-[#444] hover:text-[#666]' },
    PATCH: { active: 'bg-orange-500/20 border-orange-500/50 text-orange-400', idle: 'bg-transparent border-[#333] text-[#444] hover:text-[#666]' },
    DELETE: { active: 'bg-red-500/20 border-red-500/50 text-red-400', idle: 'bg-transparent border-[#333] text-[#444] hover:text-[#666]' },
};

const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (status >= 300 && status < 400) return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    if (status >= 400 && status < 500) return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    if (status >= 500) return 'bg-red-500/20 text-red-400 border-red-500/30';
    return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
};

const RouteTestPanel: React.FC<RouteTestPanelProps> = ({
    route, containerUrl, isServerBooting, terminalLines,
    testMethod, setTestMethod, testBody, setTestBody,
    testHeaders, setTestHeaders, testResponse, isSending,
    testError, showResponseHeaders, setShowResponseHeaders, onSend,
}) => {
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(testMethod);
    const fullUrl = containerUrl ? `${containerUrl}/api/${route.path}` : `/api/${route.path}`;

    const copyUrl = () => navigator.clipboard.writeText(fullUrl).catch(() => { });
    const addHeader = () =>
        setTestHeaders(prev => [...prev, { id: `h-${Date.now()}`, key: '', value: '', enabled: true }]);
    const removeHeader = (id: string) =>
        setTestHeaders(prev => prev.filter(h => h.id !== id));
    const updateHeader = (id: string, field: 'key' | 'value' | 'enabled', val: string | boolean) =>
        setTestHeaders(prev => prev.map(h => h.id === id ? { ...h, [field]: val } : h));

    // ── SERVER BOOT STATE ────────────────────────────────────────────────────
    if (!containerUrl) {
        const recentLines = terminalLines.slice(-10);
        return (
            <div className="mt-1 mb-2 mx-2 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#252526] border-b border-[#3e3e42] flex items-center gap-2">
                    <TerminalSquare size={12} className="text-emerald-400" />
                    <span className="text-[10px] font-mono text-[#888]">
                        {isServerBooting ? 'Starting dev server...' : 'Dev server not running'}
                    </span>
                    {isServerBooting && (
                        <div className="ml-auto flex gap-1">
                            {[0, 1, 2].map(i => (
                                <div key={i} className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce"
                                    style={{ animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                    )}
                </div>
                {isServerBooting && recentLines.length > 0 && (
                    <div className="p-3 bg-[#111] font-mono text-[9px] text-[#556] space-y-0.5 max-h-[120px] overflow-y-auto">
                        {recentLines.map((line, i) => (
                            <div key={i} className="text-[#66ee88] leading-relaxed break-all whitespace-pre-wrap">{line}</div>
                        ))}
                    </div>
                )}
                {!isServerBooting && (
                    <div className="p-4 text-center">
                        <FlaskConical size={20} className="mx-auto mb-2 text-[#444]" />
                        <p className="text-[10px] text-[#555] mb-3 leading-relaxed">
                            The dev server needs to start before you can test routes.
                            This runs <span className="text-[#666] font-mono">pnpm install</span> +{' '}
                            <span className="text-[#666] font-mono">next dev</span> and may take up to 90s on first boot.
                        </p>
                        <p className="text-[9px] text-[#444]">The server stays running for the rest of this session.</p>
                    </div>
                )}
                {isServerBooting && (
                    <div className="px-3 py-2 border-t border-[#2a2a2a] bg-[#1a1a1a]">
                        <p className="text-[9px] text-[#444] text-center">Installing packages → starting server → ready to test</p>
                    </div>
                )}
            </div>
        );
    }

    // ── FULL REQUEST BUILDER ─────────────────────────────────────────────────
    return (
        <div className="mt-1 mb-2 mx-2 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg overflow-hidden">
            {/* URL bar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[#252526] border-b border-[#3e3e42]">
                <div className="flex items-center gap-1 flex-1 min-w-0 bg-[#1a1a1a] border border-[#333] rounded px-2 py-1">
                    <span className={cn('text-[9px] font-bold font-mono shrink-0 px-1 py-0.5 rounded', HTTP_METHOD_COLORS[testMethod].active)}>
                        {testMethod}
                    </span>
                    <span className="text-[9px] font-mono text-[#555] truncate">{fullUrl}</span>
                </div>
                <button onClick={copyUrl} className="p-1.5 hover:bg-[#333] rounded text-[#555] hover:text-[#aaa] transition-colors shrink-0" title="Copy URL">
                    <CopyIcon size={10} />
                </button>
            </div>

            {/* Method selector */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#2a2a2a] bg-[#1a1a1a]">
                <span className="text-[9px] text-[#555] mr-1 shrink-0">Method:</span>
                <div className="flex gap-1 flex-wrap">
                    {route.methods.map(method => (
                        <button key={method} onClick={() => setTestMethod(method)}
                            className={cn('px-2 py-0.5 rounded text-[8px] font-bold border transition-all',
                                testMethod === method ? HTTP_METHOD_COLORS[method].active : HTTP_METHOD_COLORS[method].idle
                            )}>
                            {method}
                        </button>
                    ))}
                </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#3e3e42] scrollbar-track-transparent">
                {/* Headers */}
                <div className="border-b border-[#222]">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1a1a]">
                        <span className="text-[9px] text-[#555] font-bold uppercase tracking-wide">Headers</span>
                        <button onClick={addHeader} className="text-[9px] text-[#444] hover:text-[#888] flex items-center gap-1 transition-colors">
                            <Plus size={9} /> Add
                        </button>
                    </div>
                    <div className="px-2 pb-2 space-y-1">
                        {testHeaders.map(header => (
                            <div key={header.id} className="flex items-center gap-1.5">
                                <input type="checkbox" checked={header.enabled}
                                    onChange={e => updateHeader(header.id, 'enabled', e.target.checked)}
                                    className="w-3 h-3 rounded accent-blue-500 shrink-0" />
                                <input value={header.key} onChange={e => updateHeader(header.id, 'key', e.target.value)}
                                    placeholder="Key" className="flex-1 min-w-0 bg-[#2a2a2a] border border-[#333] rounded px-2 py-0.5 text-[9px] font-mono text-[#ccc] placeholder-[#444] outline-none focus:border-[#555]" />
                                <input value={header.value} onChange={e => updateHeader(header.id, 'value', e.target.value)}
                                    placeholder="Value" className="flex-1 min-w-0 bg-[#2a2a2a] border border-[#333] rounded px-2 py-0.5 text-[9px] font-mono text-[#ccc] placeholder-[#444] outline-none focus:border-[#555]" />
                                <button onClick={() => removeHeader(header.id)} className="p-0.5 hover:text-red-400 text-[#444] transition-colors shrink-0">
                                    <X size={9} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Request body — only for POST / PUT / PATCH */}
                {hasBody && (
                    <div className="border-b border-[#222]">
                        <div className="px-3 py-1.5 bg-[#1a1a1a] flex items-center justify-between">
                            <span className="text-[9px] text-[#555] font-bold uppercase tracking-wide">Body (JSON)</span>
                            <button onClick={() => setTestBody('{\n  \n}')} className="text-[9px] text-[#444] hover:text-[#888] transition-colors" title="Reset body">
                                <RefreshCw size={9} />
                            </button>
                        </div>
                        <textarea value={testBody} onChange={e => setTestBody(e.target.value)} spellCheck={false}
                            className="w-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-[10px] p-3 resize-none outline-none leading-relaxed selection:bg-[#264f78]"
                            style={{ minHeight: '80px', maxHeight: '160px', caretColor: '#007acc' }}
                            placeholder='{ "key": "value" }' />
                    </div>
                )}

                {/* Send button */}
                <div className="px-3 py-2 bg-[#1a1a1a]">
                    <button onClick={onSend} disabled={isSending}
                        className={cn('w-full flex items-center justify-center gap-2 px-4 py-2 rounded text-xs font-bold transition-all border',
                            isSending
                                ? 'bg-[#252526] border-[#3e3e42] text-[#555] cursor-wait'
                                : 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-600/30 hover:border-emerald-500/60'
                        )}>
                        {isSending ? (
                            <><div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />Sending...</>
                        ) : (
                            <><Send size={11} />Send Request</>
                        )}
                    </button>
                </div>

                {/* Response */}
                {(testResponse || testError) && (
                    <div className="border-t border-[#222]">
                        {testResponse && (
                            <div className="flex items-center gap-3 px-3 py-2 bg-[#161616] border-b border-[#222]">
                                <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold border font-mono', getStatusColor(testResponse.status))}>
                                    {testResponse.status || 'ERR'} {testResponse.statusText}
                                </span>
                                <span className="text-[9px] text-[#555] font-mono">{testResponse.latency}ms</span>
                                <button onClick={() => setShowResponseHeaders(!showResponseHeaders)}
                                    className="ml-auto flex items-center gap-1 text-[9px] text-[#444] hover:text-[#777] transition-colors">
                                    Headers {showResponseHeaders ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                                </button>
                            </div>
                        )}
                        {testResponse && showResponseHeaders && (
                            <div className="px-3 py-2 bg-[#111] border-b border-[#222] space-y-0.5 max-h-[100px] overflow-y-auto">
                                {Object.entries(testResponse.responseHeaders).map(([k, v]) => (
                                    <div key={k} className="flex gap-2 text-[9px] font-mono">
                                        <span className="text-[#555] shrink-0 min-w-[100px]">{k}:</span>
                                        <span className="text-[#777] break-all">{v}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {testResponse && testResponse.formattedBody && (
                            <div className="relative">
                                <div className="absolute top-2 right-2 z-10">
                                    <button onClick={() => navigator.clipboard.writeText(testResponse.formattedBody)}
                                        className="p-1 bg-[#252526] hover:bg-[#333] border border-[#3e3e42] rounded text-[#555] hover:text-[#aaa] transition-colors" title="Copy response body">
                                        <CopyIcon size={9} />
                                    </button>
                                </div>
                                <pre className="p-3 bg-[#111] text-[9px] font-mono text-[#9cdcfe] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                                    {testResponse.formattedBody}
                                </pre>
                            </div>
                        )}
                        {testError && (
                            <div className="p-3 bg-red-500/5 border-t border-red-500/20">
                                <p className="text-[9px] font-mono text-red-400 leading-relaxed">{testError}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── API ROUTE EDITOR ─────────────────────────────────────────────────────────
// Inline code editor for a single API route handler.
// Uses a styled <textarea> — zero-dependency, works in WebContainer context.
// Tab key inserts 2 spaces. Cmd/Ctrl+S triggers blur (debounced save via useFileSync).

interface ApiRouteEditorProps {
    route: ApiRoute;
    onUpdate: (patch: Partial<Omit<ApiRoute, 'id'>>) => void;
}

const METHOD_COLORS_EDITOR: Record<HttpMethod, string> = {
    GET: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400',
    POST: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
    PUT: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
    PATCH: 'bg-orange-500/20 border-orange-500/50 text-orange-400',
    DELETE: 'bg-red-500/20 border-red-500/50 text-red-400',
};

const ALL_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const ApiRouteEditor: React.FC<ApiRouteEditorProps> = ({ route, onUpdate }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const newCode =
                route.handlerCode.substring(0, start) +
                '  ' +
                route.handlerCode.substring(end);
            onUpdate({ handlerCode: newCode });
            requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = start + 2;
            });
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            textareaRef.current?.blur();
        }
    }, [route.handlerCode, onUpdate]);

    const vfsPath = `app/api/${route.path}/route.ts`;

    return (
        <div className="mt-1 mb-2 mx-2 bg-[#1e1e1e] border border-[#3e3e42] rounded-lg overflow-hidden">
            {/* Editor header */}
            <div className="flex items-center justify-between px-3 py-2 bg-[#252526] border-b border-[#3e3e42]">
                <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                    </div>
                    <span className="text-[9px] font-mono text-[#555]">{vfsPath}</span>
                </div>
                <div className="text-[9px] text-[#444]">TypeScript</div>
            </div>

            {/* Method toggles */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#2a2a2a] bg-[#1a1a1a]">
                <span className="text-[9px] text-[#555] mr-1">Methods:</span>
                {ALL_METHODS.map(method => {
                    const isActive = route.methods.includes(method);
                    return (
                        <button
                            key={method}
                            onClick={() => {
                                const next = isActive
                                    ? route.methods.filter(m => m !== method)
                                    : [...route.methods, method];
                                if (next.length === 0) return;
                                onUpdate({ methods: next });
                            }}
                            className={cn(
                                'px-1.5 py-0.5 rounded text-[8px] font-bold border transition-all',
                                isActive
                                    ? METHOD_COLORS_EDITOR[method]
                                    : 'bg-transparent border-[#333] text-[#444] hover:text-[#666]'
                            )}
                            title={isActive ? `Remove ${method}` : `Add ${method} handler`}
                        >
                            {method}
                        </button>
                    );
                })}
            </div>

            {/* Code editor textarea */}
            <textarea
                ref={textareaRef}
                value={route.handlerCode}
                onChange={(e) => onUpdate({ handlerCode: e.target.value })}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                className={cn(
                    'w-full bg-[#1e1e1e] text-[#d4d4d4] font-mono resize-none outline-none',
                    'text-[11px] leading-[1.6] p-3',
                    'selection:bg-[#264f78]'
                )}
                style={{
                    minHeight: '280px',
                    maxHeight: '480px',
                    caretColor: '#007acc',
                    tabSize: 2,
                }}
                placeholder="// Your Next.js route handler code..."
            />

            {/* Footer: path display + last saved */}
            <div className="px-3 py-1.5 border-t border-[#2a2a2a] bg-[#1a1a1a] flex items-center justify-between">
                <span className="text-[9px] font-mono text-[#444]">
                    /api/{route.path}
                </span>
                <span className="text-[9px] text-[#3a3a3a]">
                    Saved {new Date(route.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        </div>
    );
};

// ─── LEFT SIDEBAR ─────────────────────────────────────────────────────────────

export const LeftSidebar = () => {
    const {
        activePanel, setActivePanel, setDragData, previewMode,
        componentRegistry, registerComponent, recentComponents, addRecentComponent,
        pages, addPage, switchPage, deletePage, realPageId,
        theme, updateTheme, selectedId, elements, setElements,
        dataSources, addDataSource, removeDataSource,
        apiRoutes, addApiRoute, updateApiRoute, deleteApiRoute,
        isInsertDrawerOpen, toggleInsertDrawer,
        framework,
    } = useEditor();

    const {
        fileTree, installPackage, terminalOutput, status,
        url: containerUrl,
        startDevServer,
    } = useContainer();

    const [activeCat, setActiveCat] = useState<DrawerTab>('basic');
    const [search, setSearch] = useState('');
    const [pkgName, setPkgName] = useState('');
    const [isInstalling, setIsInstalling] = useState(false);
    const [iconSearch, setIconSearch] = useState('');
    const [assetSearch, setAssetSearch] = useState('');
    const [unsplashImages, setUnsplashImages] = useState<{ id: number; url: string }[]>([]);
    const [loadingAssets, setLoadingAssets] = useState(false);
    const [newApiUrl, setNewApiUrl] = useState('');
    const [isFetchingApi, setIsFetchingApi] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Phase D: Backend panel local state
    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
    const [isAddingRoute, setIsAddingRoute] = useState(false);
    const [newRouteName, setNewRouteName] = useState('');
    const [newRoutePath, setNewRoutePath] = useState('');
    const [newRouteMethods, setNewRouteMethods] = useState<HttpMethod[]>(['GET']);
    const [routeAddError, setRouteAddError] = useState('');

    // ── Phase G: Route Tester state ───────────────────────────────────────────
    const [activeRouteTab, setActiveRouteTab] = useState<'code' | 'test'>('code');
    const [isServerBooting, setIsServerBooting] = useState(false);
    const [testMethod, setTestMethod] = useState<HttpMethod>('GET');
    const [testBody, setTestBody] = useState('{\n  \n}');
    const [testHeaders, setTestHeaders] = useState<
        Array<{ id: string; key: string; value: string; enabled: boolean }>
    >([
        { id: 'h-default', key: 'Content-Type', value: 'application/json', enabled: true },
    ]);
    const [testResponse, setTestResponse] = useState<{
        status: number; statusText: string; body: string;
        formattedBody: string; latency: number; ok: boolean;
        responseHeaders: Record<string, string>;
    } | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [testError, setTestError] = useState<string | null>(null);
    const [showResponseHeaders, setShowResponseHeaders] = useState(false);

    // Reset tester state when selected route changes
    useEffect(() => {
        setTestResponse(null);
        setTestError(null);
        setIsSending(false);
        setActiveRouteTab('code');
    }, [selectedRouteId]);

    // When containerUrl becomes available (server-ready), clear booting flag
    useEffect(() => {
        if (containerUrl) setIsServerBooting(false);
    }, [containerUrl]);

    // Triggers dev server boot, then switches to test tab.
    const handleBootAndTest = useCallback(async () => {
        if (containerUrl) {
            setActiveRouteTab('test');
            return;
        }
        setActiveRouteTab('test');
        setIsServerBooting(true);
        try {
            await startDevServer();
        } catch (err) {
            console.error('[RouteTest] startDevServer error:', err);
            setIsServerBooting(false);
        }
    }, [containerUrl, startDevServer]);

    // Sends the HTTP request to the running WebContainer server
    const sendRequest = useCallback(async (route: ApiRoute) => {
        if (!containerUrl || isSending) return;
        setIsSending(true);
        setTestResponse(null);
        setTestError(null);

        const targetUrl = `${containerUrl}/api/${route.path}`;
        const enabledHeaders = testHeaders
            .filter(h => h.enabled && h.key.trim())
            .reduce((acc, h) => ({ ...acc, [h.key.trim()]: h.value }), {} as Record<string, string>);
        const hasBody = ['POST', 'PUT', 'PATCH'].includes(testMethod);

        if (hasBody && testBody.trim()) {
            try { JSON.parse(testBody); }
            catch {
                setTestError(`Invalid JSON body: ${testBody.slice(0, 80)}...`);
                setIsSending(false);
                return;
            }
        }

        const start = performance.now();
        try {
            const res = await fetch(targetUrl, {
                method: testMethod,
                headers: enabledHeaders,
                body: hasBody && testBody.trim() ? testBody : undefined,
            });
            const latency = Math.round(performance.now() - start);
            const rawText = await res.text();
            let formattedBody = rawText;
            try { formattedBody = JSON.stringify(JSON.parse(rawText), null, 2); } catch { /* not JSON */ }
            const responseHeaders: Record<string, string> = {};
            res.headers.forEach((value, key) => { responseHeaders[key] = value; });
            setTestResponse({ status: res.status, statusText: res.statusText, body: rawText, formattedBody, latency, ok: res.ok, responseHeaders });
        } catch (err) {
            const latency = Math.round(performance.now() - start);
            const msg = err instanceof Error ? err.message : String(err);
            setTestError(`Network error \u2014 could not reach ${targetUrl}.\n\nThis usually means the dev server hasn't finished starting yet.\n\nRaw error: ${msg}`);
            setTestResponse({ status: 0, statusText: 'Network Error', body: '', formattedBody: '', latency, ok: false, responseHeaders: {} });
        } finally {
            setIsSending(false);
        }
    }, [containerUrl, testMethod, testBody, testHeaders, isSending]);

    const searchUnsplash = useCallback(async (query: string) => {
        setLoadingAssets(true);
        // Simulate API delay
        await new Promise(r => setTimeout(r, 600));

        const reliableImages = [
            { id: 1, url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80' },
            { id: 2, url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=400&q=80' },
            { id: 3, url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=400&q=80' },
            { id: 4, url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=400&q=80' },
            { id: 5, url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=400&q=80' },
            { id: 6, url: 'https://images.unsplash.com/photo-1555099962-4199c345e5dd?auto=format&fit=crop&w=400&q=80' },
            { id: 7, url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=400&q=80' },
            { id: 8, url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80' },
        ];

        if (query.trim()) {
            setUnsplashImages([...reliableImages].sort(() => 0.5 - Math.random()));
        } else {
            setUnsplashImages(reliableImages);
        }
        setLoadingAssets(false);
    }, []);

    // --- CRITICAL FIX: MOVE EFFECT BEFORE CONDITIONAL RETURN ---
    useEffect(() => {
        if (activePanel === 'assets' && unsplashImages.length === 0) {
            searchUnsplash('');
        }
    }, [activePanel, unsplashImages.length, searchUnsplash]);

    // --- NOW IT IS SAFE TO RETURN NULL ---
    if (previewMode) return null;

    const togglePanel = (panel: typeof activePanel) => {
        setActivePanel((prev: typeof activePanel) => prev === panel ? null : panel);
    };

    const handleInstall = async () => {
        if (!pkgName) return;
        setIsInstalling(true);
        await installPackage(pkgName);
        setIsInstalling(false);
        setPkgName('');
    };

    const filteredComponents = activeCat === 'recent'
        ? recentComponents.map(id => [id, componentRegistry[id]]).filter(x => x[1]) as [string, any][]
        : activeCat !== 'templates'
            ? Object.entries(componentRegistry)
                .filter(([_type, config]) => {
                    const matchesSearch = config.label.toLowerCase().includes(search.toLowerCase());
                    const matchesCategory = search ? true : config.category === activeCat;
                    return matchesSearch && matchesCategory;
                })
            : [];

    const filteredTemplates = activeCat === 'templates' || search
        ? Object.entries(TEMPLATES)
            .filter(([, tpl]) => {
                if (!search) return activeCat === 'templates';
                return tpl.name.toLowerCase().includes(search.toLowerCase());
            })
        : [];

    const templateGroups = filteredTemplates.reduce((acc, [key, tpl]) => {
        const cat = tpl.category || 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push({ key, ...tpl });
        return acc;
    }, {} as Record<string, (TemplateConfig & { key: string })[]>);

    const sortedCategories = Object.keys(templateGroups).sort();
    const filteredIcons = ICON_NAMES.filter(name => name.toLowerCase().includes(iconSearch.toLowerCase()));

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            const config = processImportedCode(content, file.name);
            const newId = generateComponentId(config.label);
            registerComponent(newId, config);
        };
        reader.readAsText(file);
    };

    const NavButton = ({ icon: Icon, active, onClick, tooltip }: { icon: any; active: boolean; onClick: () => void; tooltip: string }) => (
        <button onClick={onClick} className={cn("w-10 h-10 rounded flex items-center justify-center transition-all duration-100 relative group", active ? "text-white opacity-100 border-l-2 border-[#007acc] bg-[#252526]" : "text-[#999999] opacity-70 hover:opacity-100 hover:text-white")}>
            <Icon size={22} strokeWidth={1.5} />
            {tooltip && <span className="absolute left-full ml-3 px-2 py-1 bg-[#252526] text-white text-[10px] rounded border border-[#3f3f46] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[60] shadow-md">{tooltip}</span>}
        </button>
    );

    return (
        <div className="w-[60px] h-full flex flex-col border-r border-[#3f3f46] bg-[#333333] relative z-50">
            {/* MAIN RAIL */}
            <div className="flex flex-col items-center py-4 gap-4 h-full bg-[#333333] z-50 relative">
                <NavButton icon={Plus} active={isInsertDrawerOpen} onClick={() => { if (activePanel) setActivePanel(null); toggleInsertDrawer(); }} tooltip="Insert" />
                <div className="w-8 h-[1px] bg-[#4f4f4f] my-1" />
                <NavButton icon={Folder} active={activePanel === 'files'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('files'); }} tooltip="Explorer" />
                <NavButton icon={Box} active={activePanel === 'npm'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('npm'); }} tooltip="NPM Packages" />
                <NavButton icon={File} active={activePanel === 'pages'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('pages'); }} tooltip="Pages" />
                <div className="w-8 h-[1px] bg-[#4f4f4f] my-1" />
                <NavButton icon={Hexagon} active={activePanel === 'icons'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('icons'); }} tooltip="Icons" />
                <NavButton icon={Palette} active={activePanel === 'theme'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('theme'); }} tooltip="Global Theme" />
                <NavButton icon={Database} active={activePanel === 'data'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('data'); }} tooltip="Data Sources" />
                {framework === 'nextjs' && (
                    <NavButton icon={Server} active={activePanel === 'backend'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('backend'); }} tooltip="Backend (API Routes)" />
                )}
                <div className="w-8 h-[1px] bg-[#4f4f4f] my-1" />
                <NavButton icon={Store} active={activePanel === 'marketplace'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('marketplace'); }} tooltip="Marketplace" />
                <NavButton icon={Layers} active={activePanel === 'layers'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('layers'); }} tooltip="Layers" />
                <NavButton icon={ImageIcon} active={activePanel === 'assets'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('assets'); }} tooltip="Assets" />
            </div>

            {/* --- PANELS --- */}
            {activePanel === 'add' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[420px] bg-[#252526] border-r border-[#3f3f46] shadow-2xl z-40 flex text-[#cccccc]">
                    <div className="w-16 bg-[#2d2d2d] border-r border-[#3f3f46] flex flex-col items-center py-4 gap-1 overflow-y-auto no-scrollbar">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => { setActiveCat(cat.id); setSearch(''); }}
                                className={cn(
                                    "p-2 rounded-lg transition-all flex flex-col items-center gap-1 w-14 group",
                                    activeCat === cat.id ? "bg-[#37373d] text-white border border-[#3e3e42] shadow-sm" : "text-[#999999] hover:text-white hover:bg-[#333333]"
                                )}
                            >
                                <cat.icon size={18} strokeWidth={activeCat === cat.id ? 2 : 1.5} />
                                <span className="text-[9px] font-semibold leading-tight text-center">{cat.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex-1 flex flex-col min-w-0 bg-[#252526]">
                        <div className="px-4 py-3 border-b border-[#3f3f46] bg-[#2d2d2d]">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-2.5 text-[#999999]" />
                                <input
                                    type="text" placeholder="Search..."
                                    className="w-full pl-9 pr-3 py-2 bg-[#3c3c3c] border border-transparent rounded text-xs text-white placeholder-[#999999] outline-none focus:ring-1 focus:ring-[#007acc]"
                                    value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {activeCat !== 'templates' && filteredComponents.length > 0 && (
                                <div className="grid grid-cols-2 gap-3 mb-6">
                                    {filteredComponents.map(([type, config]) => (
                                        <div
                                            key={type}
                                            draggable
                                            onDragStart={(e) => {
                                                e.dataTransfer.setData('text/plain', type);
                                                e.dataTransfer.effectAllowed = 'copy';
                                                setDragData({ type: 'NEW', payload: type });
                                                addRecentComponent(type);
                                            }}
                                            className="group flex flex-col items-center justify-center p-3 bg-[#2d2d2d] border border-[#3e3e42] rounded-lg cursor-grab hover:border-[#007acc] hover:bg-[#323236] text-center shadow-sm"
                                        >
                                            <div className="w-9 h-9 flex items-center justify-center bg-[#38383e] border border-[#45454a] rounded mb-2 text-[#cccccc] group-hover:text-white">
                                                {config.icon && <config.icon size={18} strokeWidth={1.5} />}
                                            </div>
                                            <span className="text-[11px] font-medium text-[#bbbbbb] group-hover:text-white">{config.label}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {activeCat === 'templates' && (
                                <div className="flex flex-col gap-6">
                                    {sortedCategories.map(cat => (
                                        <div key={cat} className="animate-in slide-in-from-left-2 duration-300">
                                            <h3 className="text-[11px] font-bold text-[#666] uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
                                                <span className="w-1 h-1 rounded-full bg-[#007acc]" />
                                                {cat}
                                            </h3>
                                            <div className="flex flex-col gap-2">
                                                {templateGroups[cat].map((tpl) => (
                                                    <div key={tpl.key} className="group/item relative">
                                                        <div
                                                            draggable
                                                            onDragStart={(e) => {
                                                                e.dataTransfer.setData('text/plain', tpl.key);
                                                                e.dataTransfer.effectAllowed = 'copy';
                                                                setDragData({ type: 'TEMPLATE', payload: tpl.key });
                                                            }}
                                                            className="flex items-center gap-3 p-3 bg-[#2d2d2d] border border-[#3e3e42] rounded-lg cursor-grab hover:border-[#007acc] hover:bg-[#323236] transition-all"
                                                        >
                                                            <div className="w-10 h-10 rounded bg-[#38383e] flex items-center justify-center text-[#cccccc]">
                                                                {tpl.icon && <tpl.icon size={18} />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-semibold text-[#cccccc]">{tpl.name}</div>
                                                            </div>
                                                            <ChevronRight size={16} className="text-[#666] opacity-0 group-hover/item:opacity-100" />
                                                        </div>
                                                        <div className="absolute left-[105%] top-0 w-[240px] bg-[#252526] border border-[#3f3f46] rounded-xl shadow-2xl p-3 z-50 opacity-0 group-hover/item:opacity-100 pointer-events-none transition-opacity duration-200">
                                                            <div className="w-full aspect-video bg-[#1e1e1e] rounded-md mb-2 flex items-center justify-center text-[#444] border border-[#333]">
                                                                {tpl.icon && <tpl.icon size={48} strokeWidth={1} />}
                                                            </div>
                                                            <div className="text-xs font-bold text-white mb-1">{tpl.name}</div>
                                                            <div className="text-[10px] text-[#888] leading-tight">Drag to add pre-configured {tpl.name.toLowerCase()}.</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-3 border-t border-[#3f3f46] bg-[#222222]">
                            <label className="flex items-center justify-center gap-2 text-xs text-[#007acc] cursor-pointer hover:bg-[#007acc]/10 rounded py-2 border border-dashed border-[#007acc]/30">
                                <Upload size={14} /> <span>Import Component</span>
                                <input ref={fileInputRef} type="file" accept=".tsx,.jsx,.js" className="hidden" onChange={handleFileUpload} />
                            </label>
                        </div>
                    </div>
                </div>
            )}

            {activePanel === 'files' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Folder size={14} className="text-blue-400" /> File Explorer
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 custom-scrollbar font-mono">
                        {status !== 'ready' ? (
                            <div className="p-8 text-center text-[#666] flex flex-col items-center gap-3">
                                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs">Booting File System...</span>
                            </div>
                        ) : Object.entries(fileTree).length === 0 ? (
                            <div className="text-center text-[#666] text-xs mt-10">Initializing VFS...</div>
                        ) : (
                            Object.entries(fileTree).map(([name, node]) => (
                                <FileTreeNode key={name} name={name} node={node} />
                            ))
                        )}
                    </div>
                </div>
            )}

            {activePanel === 'npm' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Box size={14} className="text-orange-400" /> NPM Packages
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="p-4 flex flex-col gap-4">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={pkgName}
                                onChange={(e) => setPkgName(e.target.value)}
                                placeholder="package-name"
                                className="flex-1 bg-[#333] border border-[#444] rounded px-3 py-2 text-xs text-white outline-none focus:border-[#007acc]"
                            />
                            <button
                                onClick={handleInstall}
                                disabled={isInstalling || !pkgName}
                                className="bg-[#007acc] hover:bg-[#0063a5] disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-bold transition-colors flex items-center gap-2"
                            >
                                {isInstalling ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
                                Install
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#1e1e1e] font-mono text-[10px] text-[#888]">
                        <div className="mb-2 text-[#aaa]">Terminal Output:</div>
                        {terminalOutput.map((line, i) => (
                            <div key={i} className="whitespace-pre-wrap mb-1">{line}</div>
                        ))}
                    </div>
                </div>
            )}

            {activePanel === 'pages' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <File size={14} className="text-purple-400" /> Pages
                        </h2>
                        <button onClick={() => addPage('New Page')} className="p-1 hover:bg-[#333] rounded text-[#007acc]"><Plus size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 custom-scrollbar">
                        {pages.map((page) => (
                            <div
                                key={page.id}
                                onClick={() => switchPage(page.id)}
                                className={cn(
                                    "group flex items-center justify-between p-2 rounded cursor-pointer transition-colors",
                                    realPageId === page.id ? "bg-[#37373d] text-white" : "text-[#999] hover:bg-[#2a2d2e] hover:text-[#ccc]"
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <File size={12} className={realPageId === page.id ? "text-[#007acc]" : "text-[#666]"} />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-medium">{page.name}</span>
                                        <span className="text-[9px] opacity-50 font-mono">{page.slug}</span>
                                    </div>
                                </div>
                                {pages.length > 1 && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deletePage(page.id); }}
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activePanel === 'icons' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[420px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between bg-[#2d2d2d]">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Hexagon size={14} className="text-cyan-400" /> Icons
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="p-3 border-b border-[#3f3f46]">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-2.5 text-[#999]" />
                            <input
                                value={iconSearch}
                                onChange={(e) => setIconSearch(e.target.value)}
                                placeholder="Search icons (e.g. User, Settings)..."
                                className="w-full bg-[#333] border border-[#444] rounded pl-8 pr-2 py-2 text-xs text-white outline-none focus:border-[#007acc]"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <div className="grid grid-cols-4 gap-2">
                            {filteredIcons.slice(0, 100).map((name) => {
                                const IconComp = getIconComponent(name);
                                return (
                                    <div
                                        key={name}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('text/plain', 'icon');
                                            setDragData({ type: 'ICON', payload: 'icon', meta: { iconName: name } });
                                        }}
                                        className="flex flex-col items-center justify-center aspect-square bg-[#2d2d2d] border border-[#3e3e42] rounded hover:border-[#007acc] hover:bg-[#323236] cursor-grab transition-all group"
                                        title={name}
                                    >
                                        <IconComp size={20} className="text-[#aaa] group-hover:text-white" />
                                        <span className="text-[8px] text-[#666] mt-1 truncate w-full text-center px-1">{name}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {activePanel === 'assets' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <ImageIcon size={14} className="text-green-400" /> Assets
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="p-3 bg-[#2d2d2d] border-b border-[#3f3f46]">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-2.5 text-[#999]" />
                            <input
                                value={assetSearch}
                                onChange={(e) => setAssetSearch(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && searchUnsplash(assetSearch)}
                                placeholder="Search images..."
                                className="w-full bg-[#333] border border-[#444] rounded pl-8 pr-2 py-2 text-xs text-white outline-none focus:border-[#007acc]"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                        {loadingAssets ? (
                            <div className="text-center p-4 text-[#666] text-xs flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={14} /> Fetching...</div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {unsplashImages.map((img) => (
                                    <div
                                        key={img.id}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('text/plain', img.url);
                                            e.dataTransfer.effectAllowed = 'copy';
                                            setDragData({ type: 'ASSET_IMAGE', payload: img.url });
                                        }}
                                        className="aspect-square bg-[#111] rounded overflow-hidden cursor-grab hover:ring-2 hover:ring-[#007acc] relative group"
                                    >
                                        <img src={img.url} alt="asset" className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activePanel === 'theme' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Palette size={14} className="text-cyan-400" /> Global Theme
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="p-4 flex flex-col gap-6 overflow-y-auto">
                        {selectedId && elements[selectedId] && (
                            <div className="p-3 bg-[#333] border border-[#444] rounded flex items-center justify-between">
                                <span className="text-[10px] text-[#999]">Apply to Selected:</span>
                                <button
                                    onClick={() => {
                                        const el = elements[selectedId];
                                        const cls = el.props?.className || '';
                                        const newCls = cls.includes('bg-primary')
                                            ? cls.replace('bg-primary', '').replace('text-white', '').trim()
                                            : `${cls} bg-primary text-white`.trim();
                                        setElements(prev => ({
                                            ...prev,
                                            [selectedId]: { ...prev[selectedId], props: { ...prev[selectedId].props, className: newCls } }
                                        }));
                                    }}
                                    className="text-[10px] bg-[#007acc] text-white px-2 py-1 rounded hover:bg-[#0063a5] flex items-center gap-1"
                                >
                                    <Wand2 size={10} /> bg-primary
                                </button>
                            </div>
                        )}
                        <div className="space-y-3">
                            <ColorField label="Primary" value={theme.primary} onChange={(v) => updateTheme({ primary: v })} />
                            <ColorField label="Secondary" value={theme.secondary} onChange={(v) => updateTheme({ secondary: v })} />
                            <ColorField label="Accent" value={theme.accent} onChange={(v) => updateTheme({ accent: v })} />
                        </div>
                    </div>
                </div>
            )}

            {activePanel === 'data' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Database size={14} className="text-emerald-400" /> Data Sources
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>

                    <div className="p-3 bg-[#2d2d2d] border-b border-[#3f3f46]">
                        <div className="flex gap-2">
                            <input
                                value={newApiUrl}
                                onChange={(e) => setNewApiUrl(e.target.value)}
                                placeholder="https://api.example.com/data"
                                className="flex-1 bg-[#333] border border-[#444] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#007acc]"
                            />
                            <button
                                onClick={async () => {
                                    if (!newApiUrl) return;
                                    setIsFetchingApi(true);
                                    try {
                                        const res = await fetch(newApiUrl);
                                        const d = await res.json();
                                        const sample = Array.isArray(d) ? d[0] : d;
                                        addDataSource({
                                            id: `ds-${Date.now()}`,
                                            name: newApiUrl.split('/').pop() || 'API',
                                            url: newApiUrl,
                                            method: 'GET',
                                            data: sample
                                        });
                                        setNewApiUrl('');
                                    } catch (e) {
                                        alert("CORS or Network Error: Connection to external API failed.");
                                    } finally {
                                        setIsFetchingApi(false);
                                    }
                                }}
                                disabled={isFetchingApi || !newApiUrl}
                                className="bg-[#333] hover:bg-[#444] text-white p-1.5 rounded border border-[#444]"
                            >
                                {isFetchingApi ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {dataSources.map(ds => (
                            <div key={ds.id} className="mb-4 bg-[#2d2d2d] rounded border border-[#3f3f46] overflow-hidden">
                                <div className="p-2 bg-[#333] flex items-center justify-between border-b border-[#3f3f46]">
                                    <div className="flex items-center gap-2 text-xs font-bold text-[#ccc]">
                                        <Globe size={12} className="text-[#007acc]" />
                                        {ds.name}
                                    </div>
                                    <button onClick={() => removeDataSource(ds.id)} className="text-[#666] hover:text-red-400"><Trash2 size={10} /></button>
                                </div>
                                <div className="p-2">
                                    <div className="text-[9px] text-[#666] mb-2 uppercase font-bold flex items-center gap-1">
                                        <Braces size={9} /> Response Schema
                                    </div>
                                    <JsonTree data={ds.data} setDragData={setDragData} />
                                </div>
                            </div>
                        ))}
                        {dataSources.length === 0 && (
                            <div className="text-center text-[#666] text-xs mt-4 px-4 leading-relaxed">
                                Connect external REST APIs to bind live data to your components.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activePanel === 'marketplace' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[420px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between bg-[#2d2d2d]">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <ShoppingBagIcon size={14} className="text-purple-400" /> Component Marketplace
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white transition-colors"><X size={16} /></button>
                    </div>

                    <div className="p-4 flex-1 overflow-y-auto custom-scrollbar bg-[#1e1e1e]/30">
                        <div className="mb-6 text-[11px] text-[#888] bg-[#2d2d2d] p-3 rounded-lg border border-[#333] leading-relaxed">
                            <span className="text-purple-400 font-bold">Pro Tip:</span> Drag these high-end sections onto your canvas. They are fully responsive and pre-optimized.
                        </div>

                        <div className="grid grid-cols-1 gap-5">
                            {MARKETPLACE_ITEMS.map(item => (
                                <div
                                    key={item.id}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('text/plain', item.templateKey);
                                        e.dataTransfer.effectAllowed = 'copy';
                                        setDragData({ type: 'TEMPLATE', payload: item.templateKey });
                                    }}
                                    className="group bg-[#2a2a2d] border border-[#3e3e42] rounded-xl overflow-hidden cursor-grab hover:border-[#3b82f6] hover:shadow-lg transition-all"
                                >
                                    <div className="h-40 bg-[#111] relative overflow-hidden">
                                        <img src={item.image} alt={item.title} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" />
                                        <div className="absolute top-3 right-3 bg-black/80 text-white text-[10px] px-2 py-1 rounded-md backdrop-blur-md border border-white/10 font-bold tracking-wide">
                                            {item.category}
                                        </div>
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                    <div className="p-4 bg-[#2a2a2d]">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-xs font-bold text-white group-hover:text-[#3b82f6] transition-colors">{item.title}</div>
                                            <div className="text-[9px] text-[#3b82f6] bg-[#3b82f6]/10 px-2 py-0.5 rounded font-bold">SMART</div>
                                        </div>
                                        <div className="flex items-center gap-2 text-[9px] text-[#666]">
                                            <span className="flex items-center gap-1"><Wand2 size={10} /> Auto-Style</span>
                                            <span className="w-1 h-1 rounded-full bg-[#444]" />
                                            <span className="flex items-center gap-1"><Layout size={10} /> Full Layout</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── BACKEND (API Routes) PANEL ─────────────────────────────────── */}
            {activePanel === 'backend' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[380px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">

                    {/* HEADER */}
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between bg-[#2d2d2d] shrink-0">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Server size={14} className="text-emerald-400" />
                            Backend — API Routes
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white transition-colors">
                            <X size={16} />
                        </button>
                    </div>

                    {/* FRAMEWORK BADGE */}
                    <div className="px-4 py-2 border-b border-[#3f3f46] bg-[#1e1e1e] shrink-0">
                        <div className="flex items-center gap-2 text-[10px] text-[#666]">
                            <Zap size={10} className="text-emerald-400" />
                            <span>Next.js 14 App Router</span>
                            <span className="mx-1">·</span>
                            <span className="font-mono text-[#555]">app/api/</span>
                            <span className="ml-auto text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 size={10} /> Routes sync to VFS live
                            </span>
                        </div>
                    </div>

                    {/* ADD ROUTE FORM / BUTTON */}
                    {isAddingRoute ? (
                        <div className="p-4 border-b border-[#3f3f46] bg-[#1a1a1a] shrink-0">
                            <div className="text-[10px] text-[#888] uppercase tracking-wide mb-3 font-bold flex items-center gap-2">
                                <Plus size={10} /> New API Route
                            </div>

                            <div className="mb-2">
                                <label className="text-[10px] text-[#666] block mb-1">Display Name</label>
                                <input
                                    value={newRouteName}
                                    onChange={(e) => setNewRouteName(e.target.value)}
                                    placeholder="e.g. Get Users"
                                    className="w-full bg-[#2d2d2d] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white outline-none focus:border-[#007acc] transition-colors"
                                />
                            </div>

                            <div className="mb-3">
                                <label className="text-[10px] text-[#666] block mb-1">
                                    Path <span className="text-[#444]">(relative to /api/)</span>
                                </label>
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-[#555] font-mono shrink-0">/api/</span>
                                    <input
                                        value={newRoutePath}
                                        onChange={(e) => {
                                            setNewRoutePath(e.target.value.replace(/^\/+/, ''));
                                            setRouteAddError('');
                                        }}
                                        placeholder="users  or  users/[id]  or  auth/login"
                                        className="flex-1 bg-[#2d2d2d] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white font-mono outline-none focus:border-[#007acc] transition-colors"
                                    />
                                </div>
                                <div className="text-[9px] text-[#555] mt-1 font-mono">
                                    → app/api/{newRoutePath || 'path'}/route.ts
                                </div>
                            </div>

                            <div className="mb-3">
                                <label className="text-[10px] text-[#666] block mb-2">HTTP Methods</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map(method => {
                                        const isSelected = newRouteMethods.includes(method);
                                        const mc: Record<string, string> = {
                                            GET: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400',
                                            POST: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
                                            PUT: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
                                            PATCH: 'bg-orange-500/20 border-orange-500/50 text-orange-400',
                                            DELETE: 'bg-red-500/20 border-red-500/50 text-red-400',
                                        };
                                        return (
                                            <button
                                                key={method}
                                                onClick={() => {
                                                    setNewRouteMethods(prev =>
                                                        isSelected
                                                            ? prev.filter(m => m !== method)
                                                            : [...prev, method]
                                                    );
                                                }}
                                                className={cn(
                                                    'px-2.5 py-1 rounded text-[10px] font-bold border transition-all',
                                                    isSelected
                                                        ? mc[method]
                                                        : 'bg-[#2d2d2d] border-[#3e3e42] text-[#555] hover:text-[#888]'
                                                )}
                                            >
                                                {method}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {routeAddError && (
                                <div className="text-[10px] text-red-400 flex items-center gap-1.5 mb-2">
                                    <X size={10} /> {routeAddError}
                                </div>
                            )}

                            <div className="flex gap-2 mt-3">
                                <button
                                    onClick={() => {
                                        if (!newRoutePath.trim()) {
                                            setRouteAddError('Path is required.');
                                            return;
                                        }
                                        if (newRouteMethods.length === 0) {
                                            setRouteAddError('Select at least one HTTP method.');
                                            return;
                                        }
                                        const duplicate = apiRoutes.find(r => r.path === newRoutePath.trim());
                                        if (duplicate) {
                                            setRouteAddError(`Path "${newRoutePath}" already exists.`);
                                            return;
                                        }
                                        addApiRoute(
                                            newRouteName || newRoutePath,
                                            newRoutePath.trim(),
                                            newRouteMethods
                                        );
                                        setNewRouteName('');
                                        setNewRoutePath('');
                                        setNewRouteMethods(['GET']);
                                        setRouteAddError('');
                                        setIsAddingRoute(false);
                                    }}
                                    className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded transition-colors"
                                >
                                    Create Route
                                </button>
                                <button
                                    onClick={() => {
                                        setIsAddingRoute(false);
                                        setNewRouteName('');
                                        setNewRoutePath('');
                                        setNewRouteMethods(['GET']);
                                        setRouteAddError('');
                                    }}
                                    className="px-3 py-1.5 bg-[#2d2d2d] hover:bg-[#333] border border-[#3e3e42] text-[#888] hover:text-white text-xs rounded transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="p-3 border-b border-[#3f3f46] shrink-0">
                            <button
                                onClick={() => setIsAddingRoute(true)}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#2d2d2d] hover:bg-emerald-600/20 border border-dashed border-[#3e3e42] hover:border-emerald-500/50 text-[#666] hover:text-emerald-400 text-xs rounded transition-all"
                            >
                                <Plus size={12} /> Add API Route
                            </button>
                        </div>
                    )}

                    {/* ROUTE LIST */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {apiRoutes.length === 0 ? (
                            <div className="p-8 text-center text-[#555] flex flex-col items-center gap-3">
                                <Server size={28} className="opacity-20" />
                                <div className="text-xs font-medium text-[#666]">No API routes yet</div>
                                <div className="text-[10px] text-[#444] max-w-[220px] leading-relaxed">
                                    Create routes to add backend functionality. Each route becomes a
                                    <span className="font-mono text-[#555]"> route.ts</span> file
                                    in your downloaded project.
                                </div>
                            </div>
                        ) : (
                            <div className="p-2 flex flex-col gap-1">
                                {apiRoutes.map((route) => {
                                    const isSelected = selectedRouteId === route.id;
                                    const mc2: Record<string, string> = {
                                        GET: 'bg-emerald-500/20 text-emerald-400',
                                        POST: 'bg-blue-500/20 text-blue-400',
                                        PUT: 'bg-amber-500/20 text-amber-400',
                                        PATCH: 'bg-orange-500/20 text-orange-400',
                                        DELETE: 'bg-red-500/20 text-red-400',
                                    };

                                    return (
                                        <div key={route.id} className="flex flex-col">
                                            <div
                                                onClick={() => setSelectedRouteId(isSelected ? null : route.id)}
                                                className={cn(
                                                    'group flex items-center justify-between p-2.5 rounded cursor-pointer transition-colors',
                                                    isSelected
                                                        ? 'bg-[#2a2d2e] border border-[#3e3e42]'
                                                        : 'hover:bg-[#2a2d2e] border border-transparent'
                                                )}
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs font-medium text-[#ccc] truncate">
                                                            {route.name}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[9px] font-mono text-[#555]">/api/</span>
                                                        <span className="text-[9px] font-mono text-[#888]">{route.path}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                                        {route.methods.map(m => (
                                                            <span
                                                                key={m}
                                                                className={cn(
                                                                    'px-1.5 py-0.5 rounded text-[8px] font-bold',
                                                                    mc2[m] || 'bg-zinc-700 text-zinc-400'
                                                                )}
                                                            >
                                                                {m}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (confirm(`Delete route "${route.name}"?\nThis will remove app/api/${route.path}/route.ts from the VFS.`)) {
                                                                if (selectedRouteId === route.id) setSelectedRouteId(null);
                                                                deleteApiRoute(route.id);
                                                            }
                                                        }}
                                                        className="p-1 hover:text-red-400 text-[#666] rounded transition-colors"
                                                        title="Delete route"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </div>

                                            {isSelected && (
                                                <div>
                                                    {/* ── Code | Test tab bar ────────────────────────── */}
                                                    <div className="flex mx-2 mt-1 bg-[#1a1a1a] border border-[#3e3e42] rounded-t-lg overflow-hidden border-b-0">
                                                        <button
                                                            onClick={() => setActiveRouteTab('code')}
                                                            className={cn(
                                                                'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[9px] font-bold uppercase tracking-wide transition-colors',
                                                                activeRouteTab === 'code' ? 'bg-[#252526] text-[#ccc]' : 'text-[#555] hover:text-[#888]'
                                                            )}>
                                                            <TerminalSquare size={10} /> Code
                                                        </button>
                                                        <div className="w-px bg-[#3e3e42]" />
                                                        <button
                                                            onClick={() => { setActiveRouteTab('test'); handleBootAndTest(); }}
                                                            className={cn(
                                                                'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[9px] font-bold uppercase tracking-wide transition-colors',
                                                                activeRouteTab === 'test' ? 'bg-[#252526] text-emerald-400' : 'text-[#555] hover:text-[#888]'
                                                            )}>
                                                            <FlaskConical size={10} /> Test
                                                            {containerUrl && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ml-0.5" />}
                                                        </button>
                                                    </div>

                                                    {/* Tab content */}
                                                    {activeRouteTab === 'code' && (
                                                        <ApiRouteEditor
                                                            route={route}
                                                            onUpdate={(patch) => updateApiRoute(route.id, patch)}
                                                        />
                                                    )}
                                                    {activeRouteTab === 'test' && (
                                                        <RouteTestPanel
                                                            route={route}
                                                            containerUrl={containerUrl}
                                                            isServerBooting={isServerBooting}
                                                            terminalLines={terminalOutput}
                                                            testMethod={testMethod}
                                                            setTestMethod={setTestMethod}
                                                            testBody={testBody}
                                                            setTestBody={setTestBody}
                                                            testHeaders={testHeaders}
                                                            setTestHeaders={setTestHeaders}
                                                            testResponse={testResponse}
                                                            isSending={isSending}
                                                            testError={testError}
                                                            showResponseHeaders={showResponseHeaders}
                                                            setShowResponseHeaders={setShowResponseHeaders}
                                                            onSend={() => sendRequest(route)}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* FOOTER: VFS path hint */}
                    {apiRoutes.length > 0 && (
                        <div className="p-3 border-t border-[#3f3f46] bg-[#1e1e1e] shrink-0">
                            <div className="flex items-center justify-between">
                                <div className="text-[9px] text-[#444] font-mono flex items-center gap-2">
                                    <CheckCircle2 size={9} className="text-emerald-500" />
                                    {apiRoutes.length} route{apiRoutes.length !== 1 ? 's' : ''} · app/api/
                                </div>
                                <div className={cn(
                                    'flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-bold',
                                    containerUrl
                                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                        : isServerBooting
                                            ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                            : 'bg-zinc-800 border-zinc-700 text-zinc-600'
                                )}>
                                    <span className={cn(
                                        'w-1.5 h-1.5 rounded-full',
                                        containerUrl ? 'bg-emerald-500'
                                            : isServerBooting ? 'bg-amber-500 animate-pulse'
                                                : 'bg-zinc-600'
                                    )} />
                                    {containerUrl ? 'Server ready'
                                        : isServerBooting ? 'Starting...'
                                            : 'Server off'}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activePanel === 'layers' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <Suspense fallback={<div className="p-8 text-center"><Loader2 className="animate-spin mx-auto mb-2 text-[#007acc]" /> Loading Layers...</div>}>
                        <LayersPanel />
                    </Suspense>
                </div>
            )}

            {/* Insert Drawer (Overlay) */}
            <InsertDrawer />
        </div>
    );
};

/**
 * --- DASHBOARD --------------------------------------------------------------
 * Full-screen project management view shown before entering the editor.
 * Lists all saved projects with thumbnails, name, framework badge, and date.
 * Provides actions to: create new project, open, rename, duplicate, or delete.
 * Also renders the onboarding template picker for first-time users.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditor } from '../../context/EditorContext';
import type { ProjectMeta } from '../../types';
import {
    Plus, Layout, Github, Code2, Cpu, Search, ArrowLeft,
    Zap, Globe, Server, Box, CheckCircle2, Star, ChevronRight,
    Copy, Trash2, Pencil, Clock, MoreHorizontal, X, FolderOpen,
    Upload, FileDown, Sparkles, Monitor, LayoutTemplate,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Converts a Unix timestamp (ms) into a human-readable relative string. */
const formatRelativeTime = (ts: number): string => {
    if (!ts) return 'unknown';
    const delta = Date.now() - ts;
    const s = Math.floor(delta / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d / 7)}w ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** Framework display metadata — maps the stored `framework` key to UI tokens. */
const FW_META: Record<string, { label: string; badgeCls: string; iconEl: React.ReactNode }> = {
    nextjs: {
        label: 'Next.js 14',
        badgeCls: 'bg-white/5 text-zinc-400 border-white/8',
        iconEl: <Cpu size={9} />,
    },
    vite: {
        label: 'Vite + React',
        badgeCls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        iconEl: <Code2 size={9} />,
    },
};

// ─── .vectra FILE FORMAT ──────────────────────────────────────────────
// version MUST be 2. Importer MUST reject version !== 2.
interface VectraFile {
    version: 2;
    framework: string;
    elements: Record<string, any>;
    pages: any[];
    theme: Record<string, string>;
    exportedAt: number;
    name: string;
}

// ─── DESIGN TEMPLATES ───────────────────────────────────────────────── Template selection stores AI prompt in sessionStorage key 'vectra_initial_prompt'. Key MUST be cleared by runAI after first use

// Static SVG wireframe previews — one per template. Pure data constants; no live element data involved. thumbnails MUST NOT use html2canvas — these are
const TEMPLATE_PREVIEW_SVGS: Record<string, string> = {
    blank: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 130" width="280" height="130">
  <rect width="280" height="130" fill="#0a0a0b"/>
  <line x1="0" y1="65" x2="280" y2="65" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>
  <line x1="140" y1="0" x2="140" y2="130" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>
  <rect x="90" y="48" width="100" height="8" rx="2" fill="#27272a" opacity="0.8"/>
  <rect x="110" y="62" width="60" height="5" rx="1" fill="#1d1d20" opacity="0.8"/>
  <rect x="120" y="75" width="40" height="12" rx="3" fill="#3f3f46" opacity="0.6"/>
</svg>`,
    landing: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 130" width="280" height="130">
  <rect width="280" height="130" fill="#0a0a0b"/>
  <rect x="0" y="0" width="280" height="14" fill="#1d1d20"/>
  <rect x="8" y="4" width="28" height="6" rx="1" fill="#3f3f46"/>
  <rect x="200" y="4" width="16" height="6" rx="1" fill="#27272a"/>
  <rect x="222" y="4" width="16" height="6" rx="1" fill="#27272a"/>
  <rect x="244" y="4" width="16" height="6" rx="1" fill="#3b82f6" opacity="0.7"/>
  <rect x="60" y="22" width="160" height="10" rx="2" fill="#7c3aed" opacity="0.7"/>
  <rect x="80" y="36" width="120" height="6" rx="1" fill="#3f3f46"/>
  <rect x="100" y="46" width="80" height="6" rx="1" fill="#27272a"/>
  <rect x="108" y="57" width="64" height="12" rx="3" fill="#6d28d9" opacity="0.8"/>
  <rect x="8" y="78" width="80" height="32" rx="3" fill="#1d1d20" stroke="#27272a" stroke-width="1"/>
  <rect x="100" y="78" width="80" height="32" rx="3" fill="#1d1d20" stroke="#27272a" stroke-width="1"/>
  <rect x="192" y="78" width="80" height="32" rx="3" fill="#1d1d20" stroke="#27272a" stroke-width="1"/>
  <rect x="16" y="86" width="20" height="5" rx="1" fill="#4f46e5" opacity="0.6"/>
  <rect x="16" y="95" width="56" height="4" rx="1" fill="#27272a"/>
  <rect x="108" y="86" width="20" height="5" rx="1" fill="#4f46e5" opacity="0.6"/>
  <rect x="108" y="95" width="56" height="4" rx="1" fill="#27272a"/>
  <rect x="200" y="86" width="20" height="5" rx="1" fill="#4f46e5" opacity="0.6"/>
  <rect x="200" y="95" width="56" height="4" rx="1" fill="#27272a"/>
  <rect x="0" y="117" width="280" height="13" fill="#18181b"/>
</svg>`,
    dashboard: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 130" width="280" height="130">
  <rect width="280" height="130" fill="#0a0a0b"/>
  <rect x="0" y="0" width="280" height="14" fill="#18181b"/>
  <rect x="8" y="4" width="20" height="6" rx="1" fill="#3f3f46"/>
  <rect x="200" y="3" width="70" height="8" rx="2" fill="#27272a"/>
  <rect x="0" y="14" width="48" height="116" fill="#111113"/>
  <rect x="8" y="22" width="32" height="6" rx="1" fill="#27272a"/>
  <rect x="8" y="34" width="32" height="6" rx="1" fill="#3b82f6" opacity="0.5"/>
  <rect x="8" y="46" width="32" height="6" rx="1" fill="#27272a"/>
  <rect x="8" y="58" width="32" height="6" rx="1" fill="#27272a"/>
  <rect x="8" y="70" width="32" height="6" rx="1" fill="#27272a"/>
  <rect x="56" y="20" width="52" height="28" rx="3" fill="#18181b" stroke="#27272a" stroke-width="1"/>
  <rect x="62" y="26" width="20" height="5" rx="1" fill="#4f46e5" opacity="0.6"/>
  <rect x="62" y="35" width="36" height="6" rx="1" fill="#3f3f46"/>
  <rect x="116" y="20" width="52" height="28" rx="3" fill="#18181b" stroke="#27272a" stroke-width="1"/>
  <rect x="122" y="26" width="20" height="5" rx="1" fill="#0891b2" opacity="0.6"/>
  <rect x="122" y="35" width="36" height="6" rx="1" fill="#3f3f46"/>
  <rect x="176" y="20" width="52" height="28" rx="3" fill="#18181b" stroke="#27272a" stroke-width="1"/>
  <rect x="182" y="26" width="20" height="5" rx="1" fill="#059669" opacity="0.6"/>
  <rect x="182" y="35" width="36" height="6" rx="1" fill="#3f3f46"/>
  <rect x="56" y="56" width="172" height="52" rx="3" fill="#111113" stroke="#27272a" stroke-width="1"/>
  <rect x="64" y="62" width="40" height="4" rx="1" fill="#3f3f46"/>
  <polyline points="64,100 84,80 104,88 124,72 144,78 164,65 184,70 204,62 220,68" stroke="#3b82f6" stroke-width="2" fill="none" opacity="0.7" stroke-linecap="round"/>
  <rect x="236" y="14" width="36" height="94" rx="3" fill="#111113" stroke="#27272a" stroke-width="1"/>
  <rect x="240" y="20" width="28" height="4" rx="1" fill="#3f3f46"/>
  <rect x="240" y="30" width="28" height="6" rx="1" fill="#27272a"/>
  <rect x="240" y="40" width="28" height="6" rx="1" fill="#27272a"/>
  <rect x="240" y="50" width="28" height="6" rx="1" fill="#27272a"/>
</svg>`,
    portfolio: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 130" width="280" height="130">
  <rect width="280" height="130" fill="#0a0a0b"/>
  <rect x="0" y="0" width="280" height="12" fill="#18181b"/>
  <rect x="8" y="3" width="24" height="6" rx="1" fill="#3f3f46"/>
  <rect x="220" y="3" width="14" height="6" rx="1" fill="#27272a"/>
  <rect x="238" y="3" width="14" height="6" rx="1" fill="#27272a"/>
  <rect x="256" y="3" width="16" height="6" rx="2" fill="#10b981" opacity="0.5"/>
  <rect x="40" y="18" width="200" height="11" rx="2" fill="#7c3aed" opacity="0.6"/>
  <rect x="70" y="33" width="140" height="6" rx="1" fill="#3f3f46"/>
  <rect x="90" y="43" width="100" height="6" rx="1" fill="#27272a"/>
  <rect x="8" y="58" width="82" height="34" rx="3" fill="#1d1d20" stroke="#3f3f46" stroke-width="1"/>
  <rect x="99" y="58" width="82" height="34" rx="3" fill="#1d1d20" stroke="#3f3f46" stroke-width="1"/>
  <rect x="190" y="58" width="82" height="34" rx="3" fill="#1d1d20" stroke="#3f3f46" stroke-width="1"/>
  <rect x="8" y="98" width="82" height="26" rx="3" fill="#1a1a1d" stroke="#27272a" stroke-width="1"/>
  <rect x="99" y="98" width="82" height="26" rx="3" fill="#1a1a1d" stroke="#27272a" stroke-width="1"/>
  <rect x="190" y="98" width="82" height="26" rx="3" fill="#1a1a1d" stroke="#27272a" stroke-width="1"/>
  <rect x="14" y="63" width="70" height="18" rx="2" fill="#10b981" opacity="0.2"/>
  <rect x="105" y="63" width="70" height="18" rx="2" fill="#3b82f6" opacity="0.2"/>
  <rect x="196" y="63" width="70" height="18" rx="2" fill="#a855f7" opacity="0.2"/>
  <rect x="14" y="103" width="50" height="4" rx="1" fill="#3f3f46"/>
  <rect x="105" y="103" width="50" height="4" rx="1" fill="#3f3f46"/>
  <rect x="196" y="103" width="50" height="4" rx="1" fill="#3f3f46"/>
</svg>`,
    saas: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 130" width="280" height="130">
  <rect width="280" height="130" fill="#0a0a0b"/>
  <rect x="0" y="0" width="280" height="13" fill="#18181b"/>
  <rect x="8" y="3.5" width="22" height="6" rx="1" fill="#3f3f46"/>
  <rect x="90" y="3.5" width="14" height="6" rx="1" fill="#27272a"/>
  <rect x="110" y="3.5" width="14" height="6" rx="1" fill="#27272a"/>
  <rect x="130" y="3.5" width="14" height="6" rx="1" fill="#27272a"/>
  <rect x="248" y="2" width="24" height="9" rx="2" fill="#f59e0b" opacity="0.7"/>
  <rect x="50" y="20" width="180" height="10" rx="2" fill="#d97706" opacity="0.6"/>
  <rect x="70" y="34" width="140" height="5" rx="1" fill="#3f3f46"/>
  <rect x="85" y="43" width="110" height="5" rx="1" fill="#27272a"/>
  <rect x="96" y="53" width="88" height="10" rx="3" fill="#b45309" opacity="0.8"/>
  <rect x="6" y="72" width="82" height="50" rx="3" fill="#1d1d20" stroke="#3f3f46" stroke-width="1"/>
  <rect x="99" y="68" width="82" height="56" rx="3" fill="#1a1a2e" stroke="#6d28d9" stroke-width="1.5"/>
  <rect x="192" y="72" width="82" height="50" rx="3" fill="#1d1d20" stroke="#3f3f46" stroke-width="1"/>
  <rect x="110" y="64" width="60" height="8" rx="2" fill="#7c3aed" opacity="0.9"/>
  <rect x="118" y="66.5" width="44" height="3" rx="1" fill="white" opacity="0.8"/>
  <rect x="12" y="80" width="40" height="7" rx="1" fill="#3f3f46"/>
  <rect x="12" y="92" width="60" height="3" rx="1" fill="#27272a"/>
  <rect x="12" y="99" width="60" height="3" rx="1" fill="#27272a"/>
  <rect x="12" y="106" width="60" height="3" rx="1" fill="#27272a"/>
  <rect x="105" y="78" width="40" height="7" rx="1" fill="#a78bfa"/>
  <rect x="105" y="90" width="68" height="3" rx="1" fill="#27272a"/>
  <rect x="105" y="97" width="68" height="3" rx="1" fill="#27272a"/>
  <rect x="105" y="104" width="68" height="3" rx="1" fill="#27272a"/>
  <rect x="105" y="113" width="68" height="8" rx="2" fill="#7c3aed" opacity="0.7"/>
  <rect x="198" y="80" width="40" height="7" rx="1" fill="#3f3f46"/>
  <rect x="198" y="92" width="60" height="3" rx="1" fill="#27272a"/>
  <rect x="198" y="99" width="60" height="3" rx="1" fill="#27272a"/>
  <rect x="198" y="106" width="60" height="3" rx="1" fill="#27272a"/>
</svg>`,
    blog: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 130" width="280" height="130">
  <rect width="280" height="130" fill="#0a0a0b"/>
  <rect x="0" y="0" width="280" height="13" fill="#18181b"/>
  <rect x="8" y="3.5" width="28" height="6" rx="1" fill="#3f3f46"/>
  <rect x="180" y="3.5" width="16" height="6" rx="1" fill="#27272a"/>
  <rect x="200" y="3.5" width="16" height="6" rx="1" fill="#27272a"/>
  <rect x="220" y="3.5" width="16" height="6" rx="1" fill="#27272a"/>
  <rect x="6" y="18" width="172" height="40" rx="3" fill="#ec4899" opacity="0.15" stroke="#ec4899" stroke-opacity="0.2" stroke-width="1"/>
  <rect x="12" y="23" width="100" height="7" rx="1" fill="#db2777" opacity="0.6"/>
  <rect x="12" y="34" width="140" height="4" rx="1" fill="#3f3f46"/>
  <rect x="12" y="42" width="110" height="4" rx="1" fill="#27272a"/>
  <rect x="12" y="50" width="60" height="4" rx="1" fill="#27272a"/>
  <rect x="6" y="64" width="172" height="26" rx="2" fill="#1a1a1d" stroke="#27272a" stroke-width="1"/>
  <rect x="12" y="69" width="90" height="5" rx="1" fill="#3f3f46"/>
  <rect x="12" y="78" width="130" height="4" rx="1" fill="#27272a"/>
  <rect x="12" y="85" width="100" height="4" rx="1" fill="#27272a"/>
  <rect x="6" y="96" width="172" height="26" rx="2" fill="#1a1a1d" stroke="#27272a" stroke-width="1"/>
  <rect x="12" y="101" width="80" height="5" rx="1" fill="#3f3f46"/>
  <rect x="12" y="110" width="130" height="4" rx="1" fill="#27272a"/>
  <rect x="12" y="117" width="90" height="4" rx="1" fill="#27272a"/>
  <rect x="185" y="18" width="89" height="104" rx="3" fill="#111113" stroke="#27272a" stroke-width="1"/>
  <rect x="191" y="24" width="52" height="5" rx="1" fill="#3f3f46"/>
  <rect x="191" y="34" width="72" height="6" rx="1" fill="#1d1d20" stroke="#27272a" stroke-width="1"/>
  <rect x="191" y="44" width="72" height="6" rx="1" fill="#1d1d20" stroke="#27272a" stroke-width="1"/>
  <rect x="191" y="54" width="72" height="6" rx="1" fill="#1d1d20" stroke="#27272a" stroke-width="1"/>
  <rect x="191" y="68" width="52" height="5" rx="1" fill="#3f3f46"/>
  <rect x="191" y="78" width="36" height="4" rx="1" fill="#27272a"/>
  <rect x="191" y="86" width="52" height="4" rx="1" fill="#27272a"/>
  <rect x="191" y="94" width="44" height="4" rx="1" fill="#27272a"/>
  <rect x="191" y="102" width="48" height="4" rx="1" fill="#27272a"/>
</svg>`,
};

interface DesignTemplate {
    id: string;
    label: string;
    description: string;
    icon: React.ReactNode;
    accent: string;
    // inline SVG wireframe preview
    svgPreview: string;
}
const DESIGN_TEMPLATES: DesignTemplate[] = [
    { id: 'blank',     label: 'Blank Canvas',  description: 'Start from scratch with an empty artboard',          icon: <Box size={16} />,           accent: 'border-zinc-700 bg-zinc-900/30',          svgPreview: TEMPLATE_PREVIEW_SVGS.blank     },
    { id: 'landing',   label: 'Landing Page',  description: 'Hero + features + CTA sections ready to edit',       icon: <LayoutTemplate size={16} />, accent: 'border-purple-500/30 bg-purple-900/10',   svgPreview: TEMPLATE_PREVIEW_SVGS.landing   },
    { id: 'dashboard', label: 'Dashboard',     description: 'Sidebar nav + stat cards + content area',            icon: <Monitor size={16} />,        accent: 'border-blue-500/30 bg-blue-900/10',       svgPreview: TEMPLATE_PREVIEW_SVGS.dashboard },
    { id: 'portfolio', label: 'Portfolio',     description: 'Clean hero + project grid + contact section',        icon: <Star size={16} />,           accent: 'border-emerald-500/30 bg-emerald-900/10', svgPreview: TEMPLATE_PREVIEW_SVGS.portfolio },
    { id: 'saas',      label: 'SaaS',          description: 'Pricing + features + testimonials layout',            icon: <Zap size={16} />,            accent: 'border-amber-500/30 bg-amber-900/10',     svgPreview: TEMPLATE_PREVIEW_SVGS.saas      },
    { id: 'blog',      label: 'Blog',          description: 'Article list + post header + sidebar',               icon: <Sparkles size={16} />,       accent: 'border-pink-500/30 bg-pink-900/10',       svgPreview: TEMPLATE_PREVIEW_SVGS.blog      },
];

// ─── FRAMEWORK METADATA (Phase E — preserved exactly) —————————————————
const FRAMEWORKS = [
    {
        id: 'nextjs',
        name: 'Next.js 14',
        subtitle: 'App Router',
        description: 'Full-stack React with server components, API routes, and instant Vercel deployment.',
        icon: <Cpu size={28} className="text-white" />,
        gradient: 'from-white/10 to-zinc-800/10',
        borderActive: 'border-white/30',
        borderIdle: 'border-white/10',
        badge: { label: 'Recommended', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
        features: [
            { icon: <Server size={11} />, label: 'API Routes built-in' },
            { icon: <Globe size={11} />, label: 'SSR + SEO ready' },
            { icon: <Zap size={11} />, label: 'Deploy to Vercel in 1 click' },
            { icon: <Box size={11} />, label: 'Multi-page routing' },
        ],
        deploy: 'Vercel · Netlify · Railway',
        command: 'npm run dev',
        disabled: false,
    },
    {
        id: 'vite-react',
        name: 'React + Vite',
        subtitle: 'SPA',
        description: 'Blazing-fast single-page app with React Router. Perfect for dashboards and client-only apps.',
        icon: <Code2 size={28} className="text-blue-400" />,
        gradient: 'from-blue-500/10 to-cyan-500/10',
        borderActive: 'border-blue-500/40',
        borderIdle: 'border-white/10',
        badge: null,
        features: [
            { icon: <Zap size={11} />, label: 'HMR under 50ms' },
            { icon: <Box size={11} />, label: 'React Router v6' },
            { icon: <Code2 size={11} />, label: 'SWC compiler' },
            { icon: <Globe size={11} />, label: 'Static export' },
        ],
        deploy: 'Vercel · Netlify · GitHub Pages',
        command: 'npm run dev',
        disabled: false,
    },
] as const;

// ─── SPRINT 2: UNDO TOAST ─────────────────────────────────────────────────────
// Soft-delete confirmation with 5-second countdown progress bar.
// The host (Dashboard) owns the timer — this component is pure display.

interface UndoToastProps {
    projectName: string;
    durationMs: number;
    onUndo: () => void;
    onDismiss: () => void;
}

const UndoToast: React.FC<UndoToastProps> = ({ projectName, durationMs, onUndo, onDismiss }) => (
    <div
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-4 px-5 py-3 bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl text-sm min-w-[320px]"
        style={{ animation: 'slideUpFadeIn 0.2s ease-out' }}
        role="status"
        aria-live="polite"
    >
        <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
            <Trash2 size={13} className="text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
            <p className="text-zinc-300 font-medium truncate">
                <span className="text-zinc-500 font-normal">Deleted </span>
                {projectName}
            </p>
            <div className="mt-1.5 h-0.5 bg-white/10 rounded-full overflow-hidden">
                <div
                    className="h-full bg-red-500/60 rounded-full"
                    style={{ animation: `shrinkWidth ${durationMs}ms linear forwards`, width: '100%' }}
                />
            </div>
        </div>
        <button
            onClick={e => { e.stopPropagation(); onUndo(); }}
            className="shrink-0 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-lg text-xs font-bold text-zinc-300 hover:text-white transition-all"
        >
            Undo
        </button>
        <button
            onClick={onDismiss}
            className="shrink-0 p-1 hover:bg-white/5 rounded text-zinc-600 hover:text-zinc-400 transition-colors"
        >
            <X size={12} />
        </button>
        <style>{`
            @keyframes slideUpFadeIn {
                from { opacity: 0; transform: translate(-50%, 12px); }
                to   { opacity: 1; transform: translate(-50%, 0); }
            }
            @keyframes shrinkWidth {
                from { width: 100%; }
                to   { width: 0%; }
            }
        `}</style>
    </div>
);

// ─── PROJECT CARD ─────────────────────────────────────────────────────────────

interface ProjectCardProps {
    meta: ProjectMeta;
    isActive: boolean;
    onOpen: () => void;
    onRename: (newName: string) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onExport: () => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({
    meta, isActive, onOpen, onRename, onDuplicate, onDelete, onExport,
}) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(meta.name);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const renameInputRef = useRef<HTMLInputElement>(null);

    // Focus input when rename mode activates
    useEffect(() => {
        if (isRenaming) renameInputRef.current?.select();
    }, [isRenaming]);

    // ── Wireframe thumbnail ───────────────────────────────────────────────
    const [thumbSvg, setThumbSvg] = useState<string | null>(null);
    useEffect(() => {
        try {
            const stored = localStorage.getItem(`vectra_thumb_${meta.id}`);
            if (stored) setThumbSvg(stored);
        } catch { /* storage unavailable */ }
    }, [meta.id]);

    const fw = FW_META[meta.framework] ?? FW_META['nextjs'];

    const startRename = () => {
        setRenameValue(meta.name);
        setIsRenaming(true);
        setIsMenuOpen(false);
    };

    const commitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== meta.name) onRename(trimmed);
        setIsRenaming(false);
    };

    const cancelRename = () => {
        setIsRenaming(false);
        setRenameValue(meta.name);
    };

    return (
        <div
            className={cn(
                'group relative flex flex-col p-5 rounded-xl border transition-all duration-200',
                isActive
                    ? 'border-[#007acc]/40 bg-[#141b24] shadow-lg shadow-[#007acc]/5'
                    : 'border-white/5 bg-[#121214] hover:border-white/10 hover:bg-[#141414]',
            )}
        >
            {/* Active indicator */}
            {isActive && (
                <div className="absolute top-3 left-3 z-10 w-1.5 h-1.5 rounded-full bg-[#007acc] shadow-[0_0_6px_#007acc80]" />
            )}

            {/* ── Wireframe Thumbnail ─────────────────────────────────────── */}
            <div className="w-full h-[140px] rounded-lg overflow-hidden mb-4 bg-[#0a0a0b] border border-white/5 flex items-center justify-center shrink-0 relative">
                {thumbSvg ? (
                    <img
                        src={`data:image/svg+xml,${encodeURIComponent(thumbSvg)}`}
                        alt={`${meta.name} layout preview`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        draggable={false}
                    />
                ) : (
                    // Placeholder — project has never been exited after creation
                    <div className="flex flex-col items-center gap-2 text-zinc-800 pointer-events-none select-none">
                        <div className="grid grid-cols-3 gap-1 w-24 opacity-60">
                            <div className="h-2 bg-current rounded-sm col-span-3 opacity-40" />
                            <div className="h-8 bg-current rounded-sm col-span-2" />
                            <div className="h-8 bg-current rounded-sm" />
                            <div className="h-1.5 bg-current rounded-sm col-span-3 opacity-30" />
                        </div>
                    </div>
                )}
                {/* Bottom fade gradient — blends thumbnail into card background */}
                <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#121214] to-transparent pointer-events-none" />
            </div>

            {/* Card top row */}
            <div className="flex items-start justify-between mb-4">
                {/* Framework icon */}
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10 flex items-center justify-center border border-white/5 shrink-0 ml-3">
                    {meta.framework === 'vite' ? (
                        <Code2 size={18} className="text-blue-400" />
                    ) : (
                        <Cpu size={18} className="text-zinc-400" />
                    )}
                </div>

                {/* Right cluster: badge + menu */}
                <div className="flex items-center gap-2">
                    <span className={cn(
                        'flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-bold',
                        fw.badgeCls,
                    )}>
                        {fw.iconEl} {fw.label}
                    </span>

                    {/* 3-dot dropdown menu */}
                    <div className="relative">
                        <button
                            id={`card-menu-${meta.id}`}
                            onClick={e => { e.stopPropagation(); setIsMenuOpen(p => !p); }}
                            className="p-1 rounded text-zinc-700 hover:text-zinc-400 hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                            aria-label="Project options"
                        >
                            <MoreHorizontal size={14} />
                        </button>

                        {isMenuOpen && (
                            <>
                                {/* Backdrop */}
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setIsMenuOpen(false)}
                                />
                                {/* Dropdown */}
                                <div className="absolute right-0 top-7 z-50 w-40 bg-[#1c1c1e] border border-white/10 rounded-lg shadow-2xl shadow-black/50 overflow-hidden py-1">
                                    <button
                                        onClick={startRename}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors text-left"
                                    >
                                        <Pencil size={12} className="shrink-0" /> Rename
                                    </button>
                                    <button
                                        onClick={() => { setIsMenuOpen(false); onDuplicate(); }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors text-left"
                                    >
                                        <Copy size={12} className="shrink-0" /> Duplicate
                                    </button>
                                    <button
                                        onClick={() => { setIsMenuOpen(false); onExport(); }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors text-left"
                                    >
                                        <FileDown size={12} className="shrink-0" /> Export .vectra
                                    </button>
                                    <div className="h-px bg-white/5 my-1" />
                                    <button
                                        onClick={() => { setIsMenuOpen(false); setIsConfirmingDelete(true); }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-colors text-left"
                                    >
                                        <Trash2 size={12} className="shrink-0" /> Delete
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Project name — double-click or menu to rename */}
            {isRenaming ? (
                <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') cancelRename();
                    }}
                    onClick={e => e.stopPropagation()}
                    className="w-full bg-[#252729] border border-[#007acc]/50 rounded-md px-2.5 py-1 text-sm font-bold text-white outline-none mb-1 focus:border-[#007acc] transition-colors"
                    aria-label="Rename project"
                />
            ) : (
                <h3
                    className="font-bold text-zinc-200 mb-1 truncate cursor-pointer select-none"
                    onDoubleClick={startRename}
                    title={`${meta.name} — double-click to rename`}
                >
                    {meta.name}
                </h3>
            )}

            {/* Metadata row */}
            <div className="flex items-center gap-3 text-[10px] text-zinc-600 mb-4 flex-1">
                <span className="flex items-center gap-1">
                    <Clock size={9} />
                    {formatRelativeTime(meta.lastEditedAt)}
                </span>
                <span className="text-zinc-700">·</span>
                <span>{meta.pageCount} page{meta.pageCount !== 1 ? 's' : ''}</span>
                {isActive && (
                    <>
                        <span className="text-zinc-700">·</span>
                        <span className="text-[#007acc] font-medium">open</span>
                    </>
                )}
            </div>

            {/* Delete confirm overlay — replaces "Open" button */}
            {isConfirmingDelete ? (
                <div className="flex items-center gap-2 mt-auto">
                    <span className="text-[10px] text-red-400 flex-1 leading-tight">
                        Delete permanently?
                    </span>
                    <button
                        id={`confirm-delete-${meta.id}`}
                        onClick={e => { e.stopPropagation(); onDelete(); }}
                        className="px-2.5 py-1 bg-red-500/20 border border-red-500/30 rounded-md text-[10px] text-red-400 hover:bg-red-500/30 font-bold transition-colors"
                    >
                        Delete
                    </button>
                    <button
                        onClick={e => { e.stopPropagation(); setIsConfirmingDelete(false); }}
                        className="p-1.5 text-zinc-600 hover:text-zinc-400 transition-colors rounded"
                        aria-label="Cancel delete"
                    >
                        <X size={12} />
                    </button>
                </div>
            ) : (
                <button
                    id={`open-project-${meta.id}`}
                    onClick={onOpen}
                    className={cn(
                        'mt-auto w-full flex items-center justify-center gap-2 text-[10px] p-2 rounded border transition-all',
                        isActive
                            ? 'bg-[#007acc]/10 border-[#007acc]/30 text-[#007acc] hover:bg-[#007acc]/20'
                            : 'text-zinc-600 bg-black/20 hover:bg-[#007acc]/10 hover:text-[#007acc] border-white/5 hover:border-[#007acc]/30',
                    )}
                >
                    <span className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        isActive ? 'bg-[#007acc]' : 'bg-green-500',
                    )} />
                    <span>{isActive ? 'Continue Editing' : 'Open in Editor'}</span>
                    <ChevronRight size={10} className="ml-auto" />
                </button>
            )}
        </div>
    );
};

// ─── CREATE NEW CARD ──────────────────────────────────────────────────────────

const CreateNewCard: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        id="create-new-project-card"
        onClick={onClick}
        className="group p-5 rounded-xl border border-dashed border-white/8 hover:border-white/18 bg-transparent hover:bg-white/[0.015] transition-all text-left"
    >
        <div className="flex items-center justify-center w-full min-h-[180px] flex-col gap-3 text-zinc-700 group-hover:text-zinc-500 transition-colors">
            <div className="w-10 h-10 rounded-lg border border-dashed border-current flex items-center justify-center transition-transform group-hover:scale-110">
                <Plus size={20} />
            </div>
            <span className="text-sm font-medium">New Project</span>
        </div>
    </button>
);

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

const EmptyState: React.FC<{ onCreateClick: () => void }> = ({ onCreateClick }) => (
    <div className="flex flex-col items-center justify-center py-28 text-center">
        <div className="relative mb-8">
            <div className="w-20 h-20 rounded-2xl bg-[#141414] border border-white/5 flex items-center justify-center">
                <FolderOpen size={32} className="text-zinc-700" />
            </div>
            {/* Decoration rings */}
            <div className="absolute inset-0 rounded-2xl border border-white/3 scale-110" />
            <div className="absolute inset-0 rounded-2xl border border-white/[0.015] scale-125" />
        </div>
        <h2 className="text-xl font-bold text-zinc-400 mb-2">No projects yet</h2>
        <p className="text-zinc-600 text-sm mb-10 max-w-xs leading-relaxed">
            Create your first project to get started. Choose between
            Next.js for full-stack apps or Vite for a lightning-fast SPA.
        </p>
        <button
            id="empty-state-create-btn"
            onClick={onCreateClick}
            className="flex items-center gap-2 px-6 py-3 bg-white text-black text-sm font-bold rounded-xl hover:bg-zinc-100 transition-all shadow-lg shadow-black/30"
        >
            <Plus size={16} /> Create your first project
        </button>
    </div>
);

// ─── MAIN DASHBOARD COMPONENT ─────────────────────────────────────────────────

export const Dashboard = () => {
    const {
        createNewProject,
        loadProject,
        renameProject,
        duplicateProject,
        deleteProject: _deleteProject,   // legacy fallback — Dashboard uses handleSoftDelete

        removeProjectFromIndex, // Sprint 2 — stage 1
        purgeProjectData,       // Sprint 2 — stage 3
        restoreProjectToIndex,  // Sprint 2 — undo
        projectIndex,
        projectId: activeProjectId,
    } = useEditor();

    const [view, setView] = useState<'home' | 'templates'>('home');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFramework, setSelectedFramework] = useState<string>('nextjs');
    const [selectedTemplate, setSelectedTemplate] = useState<string>('blank');
    const [isCreating, setIsCreating] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const importFileRef = useRef<HTMLInputElement>(null);

    // project list sort mode. 'recent'    — descending lastEditedAt (existing default — no change for current users) 'name'      — ascending alpha by project name
    const [sortMode, setSortMode] = useState<'recent' | 'name' | 'framework'>('recent');

    // ── Sprint 2: soft-delete state + handlers ─────────────────────────────
    const UNDO_WINDOW_MS = 5000;

    interface PendingDelete {
        meta: ProjectMeta;
        timerId: ReturnType<typeof setTimeout>;
    }
    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

    // Stage 1: hide immediately, schedule purge after UNDO_WINDOW_MS
    // async — awaits purgeProjectData() when a prior pending delete is
    // replaced. purgeProjectData() is async (IDB); calling fire-and-forget risks a
    // dangling Promise and silent failure on congested IndexedDB.
    const handleSoftDelete = async (meta: ProjectMeta) => {
        // If another delete is pending, purge it immediately before starting new timer
        if (pendingDelete) {
            clearTimeout(pendingDelete.timerId);
            await purgeProjectData(pendingDelete.meta.id);
        }
        removeProjectFromIndex(meta.id);
        const timerId = setTimeout(() => {
            purgeProjectData(meta.id);
            setPendingDelete(null);
        }, UNDO_WINDOW_MS);
        setPendingDelete({ meta, timerId });
    };

    // Undo: restore to index, cancel pending purge
    const handleUndoDelete = () => {
        if (!pendingDelete) return;
        clearTimeout(pendingDelete.timerId);
        restoreProjectToIndex(pendingDelete.meta);
        setPendingDelete(null);
    };

    // Dismiss toast cosmetically — timer still runs, purge still fires
    const handleDismissToast = () => setPendingDelete(null);

    /** Creates a new project and switches to the editor. */
    const handleCreate = async () => {
        if (isCreating) return;
        setIsCreating(true);
        await new Promise(r => setTimeout(r, 120));
        // non-blank templates store an AI prompt hint in sessionStorage.
        // ProjectContext.runAI reads 'vectra_initial_prompt' once on first open, then clears it.
        if (selectedTemplate !== 'blank') {
            const tpl = DESIGN_TEMPLATES.find(t => t.id === selectedTemplate);
            if (tpl) {
                try {
                    sessionStorage.setItem(
                        'vectra_initial_prompt',
                        `Build a complete, stunning ${tpl.label} website with multiple polished sections. Dark theme, modern design, smooth animations.`
                    );
                } catch { /* storage unavailable */ }
            }
        }
        createNewProject(selectedFramework);
    };

    // ── Export project as .vectra ────────────────────────────────────── version MUST be 2. Export uses createObjectURL + anchor click — no server involved. Dashboard-level export is a metadata stub;
    const handleExportProject = useCallback((meta: ProjectMeta) => {
        const payload: VectraFile = {
            version: 2,
            framework: meta.framework,
            name: meta.name,
            elements: {},
            pages: [],
            theme: {},
            exportedAt: Date.now(),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${meta.name.replace(/\s+/g, '-').toLowerCase()}.vectra`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    // ── Import .vectra file ──────────────────────────────────────────── MUST call restoreProjectToIndex() THEN loadProject() in that order. Never call loadProject() on an orphan not in the index
    const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportError(null);
        setIsImporting(true);
        try {
            const text = await file.text();
            const parsed: VectraFile = JSON.parse(text);
            if (parsed.version !== 2) throw new Error('Unsupported .vectra version. Re-export from Vectra v2+.');
            if (!parsed.framework) throw new Error('Missing framework field in .vectra file.');
            const newMeta: ProjectMeta = {
                id: `proj_${crypto.randomUUID().replace(/-/g, '')}`,
                name: parsed.name || file.name.replace('.vectra', ''),
                framework: parsed.framework as 'nextjs' | 'vite',
                createdAt: parsed.exportedAt || Date.now(),
                lastEditedAt: Date.now(),
                pageCount: parsed.pages?.length || 1,
            };
            await restoreProjectToIndex(newMeta);
            if (parsed.elements && Object.keys(parsed.elements).length > 0) {
                await loadProject(newMeta);
                window.dispatchEvent(new CustomEvent('vectra:open-project'));
            }
        } catch (err) {
            setImportError(err instanceof Error ? err.message : 'Invalid .vectra file.');
        } finally {
            setIsImporting(false);
            if (importFileRef.current) importFileRef.current.value = '';
        }
    }, [restoreProjectToIndex, loadProject]);

    /**
     * Opens an existing project from the Dashboard.
     * Loads state into ProjectContext, then dispatches 'vectra:open-project'
     * so UIContext switches to the editor view.
     */
    const handleOpen = async (meta: ProjectMeta) => {
        await loadProject(meta);
        window.dispatchEvent(new CustomEvent('vectra:open-project'));
    };

    // Sort projects according to active sort mode.
    // Default 'recent' preserves existing behaviour (no observable change for current users).
    const sortedProjects = [...projectIndex].sort((a, b) => {
        if (sortMode === 'name') {
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }
        if (sortMode === 'framework') {
            const fwCmp = a.framework.localeCompare(b.framework);
            return fwCmp !== 0 ? fwCmp : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }
        // 'recent': descending lastEditedAt — pre-existing default
        return b.lastEditedAt - a.lastEditedAt;
    });

    const filteredProjects = searchQuery.trim()
        ? sortedProjects.filter(p =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase()),
        )
        : sortedProjects;

    // ─── VIEW 1: PROJECT LIST ──────────────────────────────────────────────────
    if (view === 'home') {
        return (
            <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-blue-500/30 flex flex-col">

                {/* Ambient background gradient */}
                <div className="fixed inset-0 pointer-events-none overflow-hidden">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-purple-700/5 rounded-full blur-3xl" />
                </div>

                {/* ── Sticky header ── */}
                <header className="relative border-b border-white/5 px-8 py-4 flex items-center justify-between bg-[#09090b]/90 backdrop-blur-sm sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-purple-500/20">
                            <Layout size={18} className="text-white" />
                        </div>
                        <span className="font-bold text-lg tracking-tight">Vectra</span>
                        <span className="px-2 py-0.5 bg-purple-600/20 text-purple-400 text-[10px] font-bold rounded-full border border-purple-500/20">
                            BETA
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <a
                            href="https://github.com"
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-400 hover:text-white"
                            aria-label="GitHub"
                        >
                            <Github size={20} />
                        </a>
                        <div className="flex items-center gap-2">
                            {/* Import .vectra file */}
                            <label
                                title="Import .vectra project"
                                className={cn(
                                    'flex items-center gap-2 px-3 py-2 border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 text-sm font-medium rounded-lg transition-all cursor-pointer select-none',
                                    isImporting && 'opacity-50 cursor-wait'
                                )}
                            >
                                {isImporting
                                    ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                    : <Upload size={15} />}
                                <span className="hidden sm:inline">Import</span>
                                <input
                                    ref={importFileRef}
                                    type="file"
                                    accept=".vectra,application/json"
                                    className="sr-only"
                                    onChange={handleImportFile}
                                    disabled={isImporting}
                                />
                            </label>

                            <button
                                id="header-new-project-btn"
                                onClick={() => setView('templates')}
                                className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-bold rounded-lg hover:bg-zinc-100 transition-all shadow-sm active:scale-95"
                            >
                                <Plus size={16} /> New Project
                            </button>
                        </div>

                        {/* Import error toast */}
                        {importError && (
                            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-3 px-4 py-3 bg-red-950 border border-red-500/30 rounded-xl shadow-2xl text-sm text-red-300 max-w-sm">
                                <span className="text-red-400">⚠</span>
                                <span className="flex-1">{importError}</span>
                                <button onClick={() => setImportError(null)} className="text-red-500 hover:text-red-300 text-xs">✕</button>
                            </div>
                        )}
                    </div>
                </header>

                {/* ── Main content ── */}
                <main className="relative flex-1 max-w-6xl mx-auto w-full p-8">

                    {/* Page heading */}
                    <div className="flex items-end justify-between mb-8">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">Your Projects</h1>
                            <p className="text-zinc-500 text-sm mt-1">
                                {projectIndex.length > 0
                                    ? `${projectIndex.length} project${projectIndex.length !== 1 ? 's' : ''} — saved locally in your browser`
                                    : 'Projects are saved locally in your browser'}
                            </p>
                        </div>
                    </div>

                    {/* Search bar + sort toggle — SPRINT-D-FIX-20 */}
                    {projectIndex.length > 0 && (
                        <div className="flex items-center gap-3 mb-8 flex-wrap">
                            {/* Search */}
                            <div className="relative max-w-sm w-full flex-1 min-w-[160px]">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                                <input
                                    id="project-search"
                                    type="text"
                                    placeholder="Search projects…"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full bg-[#18181b] border border-white/8 rounded-lg pl-9 pr-4 py-2.5 text-sm text-zinc-300 outline-none focus:border-[#007acc]/50 transition-colors placeholder:text-zinc-600"
                                />
                            </div>

                            {/* Sort mode pills */}
                            <div className="flex items-center gap-1 bg-[#111113] border border-white/5 rounded-lg p-0.5 shrink-0">
                                {([
                                    { id: 'recent'    as const, label: 'Recent' },
                                    { id: 'name'      as const, label: 'A–Z'    },
                                    { id: 'framework' as const, label: 'Stack'  },
                                ] as const).map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => setSortMode(opt.id)}
                                        className={cn(
                                            'px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all',
                                            sortMode === opt.id
                                                ? 'bg-white/8 text-zinc-200 shadow-sm'
                                                : 'text-zinc-600 hover:text-zinc-400',
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Empty state */}
                    {projectIndex.length === 0 ? (
                        <EmptyState onCreateClick={() => setView('templates')} />
                    ) : filteredProjects.length === 0 ? (
                        /* No search results */
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <Search size={28} className="text-zinc-700 mb-4" />
                            <p className="text-zinc-500 text-sm">
                                No projects match <span className="text-zinc-300 font-medium">"{searchQuery}"</span>
                            </p>
                            <button
                                onClick={() => setSearchQuery('')}
                                className="mt-4 text-xs text-zinc-600 hover:text-zinc-400 underline transition-colors"
                            >
                                Clear search
                            </button>
                        </div>
                    ) : (
                        /* Project grid */
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredProjects.map(meta => (
                                <ProjectCard
                                    key={meta.id}
                                    meta={meta}
                                    isActive={meta.id === activeProjectId}
                                    onOpen={() => handleOpen(meta)}
                                    onRename={name => renameProject(meta.id, name)}
                                    onDuplicate={() => duplicateProject(meta)}
                                    onDelete={() => handleSoftDelete(meta)}
                                    onExport={() => handleExportProject(meta)}
                                />
                            ))}

                            {/* Create new placeholder card */}
                            {!searchQuery && (
                                <CreateNewCard onClick={() => setView('templates')} />
                            )}
                        </div>
                    )}
                </main>

                {/* Footer */}
                <footer className="relative border-t border-white/5 px-8 py-4 text-center text-zinc-700 text-xs">
                    Vectra — Visual Builder for Next.js &amp; React · Local Edition
                </footer>

                {/* Sprint 2: Soft-delete undo toast */}
                {pendingDelete && (
                    <UndoToast
                        projectName={pendingDelete.meta.name}
                        durationMs={UNDO_WINDOW_MS}
                        onUndo={handleUndoDelete}
                        onDismiss={handleDismissToast}
                    />
                )}
            </div>
        );
    }

    // ─── VIEW 2: FRAMEWORK SELECTOR (preserved from Phase E) ──────────────────
    return (
        <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-4 font-sans">

            {/* Background gradient */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-purple-600/5 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-3xl">

                {/* Back link */}
                <button
                    onClick={() => { setView('home'); setIsCreating(false); }}
                    className="flex items-center gap-2 text-zinc-500 hover:text-white mb-10 transition-colors text-sm font-medium"
                >
                    <ArrowLeft size={16} /> Back to Projects
                </button>

                {/* Heading */}
                <div className="mb-10 text-center">
                    <h1 className="text-4xl font-bold mb-3 tracking-tight">Choose your framework</h1>
                    <p className="text-zinc-400 text-base">
                        Your downloaded project will be production-ready for the framework you choose.
                    </p>
                </div>

                {/* Framework cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    {FRAMEWORKS.map(fw => {
                        const isSelected = selectedFramework === fw.id;
                        return (
                            <button
                                key={fw.id}
                                onClick={() => setSelectedFramework(fw.id)}
                                className={cn(
                                    'relative p-6 rounded-2xl border text-left transition-all duration-200 bg-gradient-to-br',
                                    fw.gradient,
                                    isSelected
                                        ? `${fw.borderActive} shadow-lg shadow-black/30 scale-[1.01]`
                                        : `${fw.borderIdle} hover:border-white/20`,
                                )}
                            >
                                {/* Recommended badge */}
                                {fw.badge && !isSelected && (
                                    <div className={cn(
                                        'absolute top-4 right-4 px-2 py-0.5 rounded-full border text-[10px] font-bold flex items-center gap-1',
                                        fw.badge.color,
                                    )}>
                                        <Star size={9} fill="currentColor" /> {fw.badge.label}
                                    </div>
                                )}

                                {/* Selected checkmark */}
                                {isSelected && (
                                    <div className="absolute top-4 right-4">
                                        <CheckCircle2 size={18} className="text-white" />
                                    </div>
                                )}

                                {/* Icon + title */}
                                <div className="flex items-start gap-4 mb-4">
                                    <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                        {fw.icon}
                                    </div>
                                    <div>
                                        <div className="font-bold text-white text-lg leading-tight">{fw.name}</div>
                                        <div className="text-zinc-400 text-xs mt-0.5">{fw.subtitle}</div>
                                    </div>
                                </div>

                                {/* Description */}
                                <p className="text-zinc-400 text-sm leading-relaxed mb-5">{fw.description}</p>

                                {/* Feature bullets */}
                                <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 mb-5">
                                    {fw.features.map((f, i) => (
                                        <div key={i} className="flex items-center gap-1.5 text-zinc-500 text-[11px]">
                                            <span className="text-zinc-600">{f.icon}</span>{f.label}
                                        </div>
                                    ))}
                                </div>

                                {/* Deploy targets */}
                                <div className="text-[10px] text-zinc-600 font-mono border-t border-white/5 pt-3">
                                    Deploy → {fw.deploy}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Design Template Picker ──────────────────────────────── */}
                <div className="mb-8">
                    <h2 className="text-lg font-bold text-white mb-1">Choose a starter template</h2>
                    <p className="text-zinc-500 text-sm mb-5">Start blank or pick a layout — all templates are fully editable.</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {DESIGN_TEMPLATES.map(tpl => {
                            const isSel = selectedTemplate === tpl.id;
                            return (
                                // SVG wireframe preview + compact card body
                                <button
                                    key={tpl.id}
                                    onClick={() => setSelectedTemplate(tpl.id)}
                                    className={cn(
                                        'relative flex flex-col items-start rounded-xl border text-left transition-all duration-150 overflow-hidden',
                                        tpl.accent,
                                        isSel
                                            ? 'ring-2 ring-white/30 scale-[1.01] shadow-lg shadow-black/40'
                                            : 'hover:scale-[1.005] hover:brightness-110 opacity-80 hover:opacity-100'
                                    )}
                                >
                                    {/* SVG wireframe preview */}
                                    <div className="w-full overflow-hidden rounded-t-xl bg-[#060608] border-b border-white/5 relative">
                                        <img
                                            src={`data:image/svg+xml,${encodeURIComponent(tpl.svgPreview)}`}
                                            alt={`${tpl.label} layout preview`}
                                            className="w-full object-cover"
                                            draggable={false}
                                        />
                                        {/* Fade gradient blends preview into card body */}
                                        <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                                    </div>
                                    {/* Card body */}
                                    <div className="p-3 flex items-start gap-2.5 w-full">
                                        <div className="text-zinc-400 shrink-0 mt-0.5">{tpl.icon}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-white leading-tight">{tpl.label}</div>
                                            <div className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{tpl.description}</div>
                                        </div>
                                        {isSel && (
                                            <CheckCircle2 size={14} className="text-white shrink-0 mt-0.5" />
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Selected framework summary bar */}
                <div className="bg-[#121214] border border-white/5 rounded-xl p-4 mb-6 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                        {FRAMEWORKS.find(f => f.id === selectedFramework)?.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white">
                            {FRAMEWORKS.find(f => f.id === selectedFramework)?.name}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-600 mt-0.5">
                            {selectedFramework === 'nextjs'
                                ? 'npm install && npm run dev → localhost:3000'
                                : 'npm install && npm run dev → localhost:5173'}
                        </div>
                    </div>
                    <div className="text-[9px] text-zinc-600 flex items-center gap-1 shrink-0">
                        <CheckCircle2 size={11} className="text-emerald-500" /> Production ready
                    </div>
                </div>

                {/* CTA button */}
                <button
                    id="create-project-btn"
                    onClick={handleCreate}
                    disabled={isCreating}
                    className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white text-black text-base font-bold rounded-xl hover:bg-zinc-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-black/20 active:scale-[0.99]"
                >
                    {isCreating ? (
                        <>
                            <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                            Initializing project…
                        </>
                    ) : (
                        <>
                            <Plus size={18} />
                            Create Project with {FRAMEWORKS.find(f => f.id === selectedFramework)?.name}
                            <ChevronRight size={16} className="ml-auto" />
                        </>
                    )}
                </button>

                <p className="text-center text-zinc-600 text-xs mt-4">
                    Framework is locked per project. Create a new project to switch.
                </p>
            </div>
        </div>
    );
};

/**
 * --- PUBLISH MODAL ----------------------------------------------------------
 * Full-screen modal for deploying the current project.
 * Supports three publish targets: GitHub Pages, Vercel, and Netlify.
 * Each target has its own form (token input, repo/site config) and a live
 * progress log that streams deployment status messages.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
    X, ChevronLeft, Github, Rocket, Download, PackageCheck,
    ExternalLink, Eye, EyeOff, Loader2, Check, Copy,
    CheckCircle2, XCircle, RefreshCw, Lock, Zap,
} from 'lucide-react';
import { useEditor } from '../../context/EditorContext';
import { useContainer } from '../../context/ContainerContext';
import {
    generateNextProjectCode, generateProjectCode,
} from '../../utils/codegen/codeGenerator';
import {
    publishToGitHub,
    type GitHubPublishConfig, type GitHubPublishResult, type GitHubPublishProgress,
} from '../../utils/deploy/githubPublisher';
import {
    deployToVercel,
    type VercelDeployConfig, type VercelDeployProgress, type VercelDeployResult,
} from '../../utils/deploy/vercelDeployer';
import {
    deployToNetlify,
    type NetlifyDeployConfig, type NetlifyDeployProgress, type NetlifyDeployResult,
} from '../../utils/deploy/netlifyDeployer';
import { cn } from '../../lib/utils';

type View = 'selector' | 'github' | 'vercel' | 'netlify' | 'zip';

interface PublishModalProps {
    onClose: () => void;
}

// ─── Shared micro-components ──────────────────────────────────────────────────

const ProgressBar = ({ percent, color = 'blue' }: { percent: number; color?: string }) => (
    <div className="w-full bg-[#2a2a2c] rounded-full h-1.5 overflow-hidden">
        <div
            className={cn(
                'h-full rounded-full transition-all duration-700 ease-out',
                color === 'purple' ? 'bg-gradient-to-r from-purple-500 to-violet-400'
                    : color === 'teal'   ? 'bg-gradient-to-r from-teal-500 to-emerald-400'
                    : 'bg-gradient-to-r from-blue-500 to-indigo-400'
            )}
            style={{ width: `${percent}%` }}
        />
    </div>
);

const TokenField = ({
    label, value, onChange, helpUrl, placeholder, sessionKey,
}: {
    label: string; value: string; onChange: (v: string) => void;
    helpUrl: string; placeholder: string; sessionKey: string;
}) => {
    const [show, setShow] = useState(false);
    // Restore from session on mount
    useEffect(() => {
        try { const s = sessionStorage.getItem(sessionKey); if (s) onChange(s); } catch { /* ok */ }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const save = (v: string) => {
        onChange(v);
        try { if (v) sessionStorage.setItem(sessionKey, v); else sessionStorage.removeItem(sessionKey); } catch { /* quota */ }
    };
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold text-[#858585] uppercase tracking-wider flex items-center gap-1">
                    <Lock size={9} className="text-[#555]" /> {label}
                </label>
                <a href={helpUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors">
                    Get your token <ExternalLink size={9} />
                </a>
            </div>
            <div className="relative">
                <input
                    type={show ? 'text' : 'password'}
                    value={value}
                    onChange={e => save(e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-[#444] focus:outline-none focus:border-[#555] transition-colors font-mono"
                />
                <button type="button" onClick={() => setShow(p => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888] transition-colors">
                    {show ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
            </div>
            <p className="text-[10px] text-[#444] mt-1">
                Saved for this session only — cleared when you close this tab.
            </p>
        </div>
    );
};

const SuccessCard = ({
    url, label, onClose, dashLabel, dashUrl,
}: {
    url: string; label: string; onClose: () => void;
    onViewDash?: () => void; dashLabel?: string; dashUrl?: string;
}) => {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    };
    return (
        <div className="flex flex-col items-center gap-4 py-4 px-2 text-center animate-fadeIn">
            <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center">
                <CheckCircle2 size={30} className="text-green-400" />
            </div>
            <div>
                <h3 className="text-base font-bold text-white mb-1">{label}</h3>
                <p className="text-xs text-[#777]">Share this link with anyone in the world</p>
            </div>
            <div className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded-lg px-3 py-2.5 flex items-center gap-2">
                <span className="flex-1 text-xs text-blue-400 truncate">{url}</span>
                <button onClick={copy}
                    className={cn('flex items-center gap-1 text-[10px] font-bold transition-all px-2 py-1 rounded',
                        copied ? 'text-green-400 bg-green-500/10' : 'text-[#666] hover:text-white hover:bg-white/5')}>
                    {copied ? <><Check size={10} />Copied!</> : <><Copy size={10} />Copy</>}
                </button>
            </div>
            <div className="flex gap-2 w-full">
                <a href={url} target="_blank" rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded-lg transition-colors">
                    <ExternalLink size={12} /> Open Site
                </a>
                {dashUrl && (
                    <a href={dashUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-[#252526] border border-[#3e3e42] text-[#888] hover:text-white text-xs font-medium rounded-lg transition-colors">
                        <ExternalLink size={11} /> {dashLabel}
                    </a>
                )}
            </div>
            <button onClick={onClose} className="text-[11px] text-[#555] hover:text-[#888] transition-colors">
                Close
            </button>
        </div>
    );
};

const ErrorCard = ({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) => (
    <div className="flex flex-col items-center gap-3 py-4 px-2 text-center animate-fadeIn">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <XCircle size={26} className="text-red-400" />
        </div>
        <div>
            <h3 className="text-sm font-bold text-white mb-1">Something went wrong</h3>
            <p className="text-[11px] text-[#666] leading-relaxed max-w-[300px]">{message}</p>
        </div>
        <div className="flex gap-2">
            <button onClick={onRetry}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#252526] border border-[#3e3e42] text-[#ccc] hover:text-white text-xs font-bold rounded-lg transition-colors">
                <RefreshCw size={11} /> Try Again
            </button>
            <button onClick={onBack}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#252526] border border-[#3e3e42] text-[#888] hover:text-white text-xs font-medium rounded-lg transition-colors">
                <ChevronLeft size={11} /> Back
            </button>
        </div>
    </div>
);

// ─── Platform selector ────────────────────────────────────────────────────────

const PLATFORM_CARDS = [
    {
        id: 'github' as View,
        label: 'GitHub',
        tagline: 'Save your code',
        desc: 'Push your project to a GitHub repository for version control and collaboration.',
        icon: Github,
        iconColor: 'text-white',
        accent: 'border-purple-500/40 hover:border-purple-400/60',
        badge: null,
        bg: 'hover:bg-purple-600/[0.08]',
    },
    {
        id: 'vercel' as View,
        label: 'Vercel',
        tagline: 'Go live instantly',
        desc: 'Deploy your Next.js or React app to a live URL in under 60 seconds.',
        icon: Zap,
        iconColor: 'text-white',
        accent: 'border-white/20 hover:border-white/40',
        badge: 'Recommended',
        bg: 'hover:bg-white/5',
    },
    {
        id: 'netlify' as View,
        label: 'Netlify',
        tagline: 'Simple hosting',
        desc: 'Upload your project directly to Netlify. No CLI or Git setup needed.',
        icon: Rocket,
        iconColor: 'text-teal-400',
        accent: 'border-teal-500/30 hover:border-teal-400/50',
        badge: null,
        bg: 'hover:bg-teal-600/5',
    },
    {
        id: 'zip' as View,
        label: 'Download ZIP',
        tagline: 'Get source files',
        desc: 'Download a production-ready ZIP with all your code, ready to run anywhere.',
        icon: Download,
        iconColor: 'text-blue-400',
        accent: 'border-blue-500/30 hover:border-blue-400/50',
        badge: null,
        bg: 'hover:bg-blue-600/5',
    },
];

const PlatformSelector = ({ onSelect }: { onSelect: (v: View) => void }) => (
    <div className="p-5">
        <div className="mb-5">
            <h2 className="text-base font-bold text-white mb-1">Publish Your Project</h2>
            <p className="text-xs text-[#666]">Choose how you'd like to share or deploy your work</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
            {PLATFORM_CARDS.map(card => {
                const Icon = card.icon;
                return (
                    <button
                        key={card.id}
                        onClick={() => onSelect(card.id)}
                        className={cn(
                            'relative text-left p-4 rounded-xl border bg-[#1a1a1c] transition-all duration-150',
                            'group active:scale-[0.97]',
                            card.accent, card.bg
                        )}
                    >
                        {card.badge && (
                            <span className="absolute top-2.5 right-2.5 text-[8px] font-bold px-1.5 py-0.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-full uppercase tracking-wide">
                                {card.badge}
                            </span>
                        )}
                        <Icon size={20} className={cn('mb-2.5', card.iconColor)} />
                        <div className="text-xs font-bold text-white mb-0.5">{card.label}</div>
                        <div className="text-[10px] text-[#888] font-medium mb-1.5">{card.tagline}</div>
                        <div className="text-[10px] text-[#555] leading-relaxed">{card.desc}</div>
                    </button>
                );
            })}
        </div>
    </div>
);

// ─── GitHub flow ──────────────────────────────────────────────────────────────

const GitHubFlow = ({ onBack }: { onBack: () => void }) => {
    const { elements, pages, framework } = useEditor();

    const [token, setToken]     = useState('');
    const [repoUrl, setRepoUrl] = useState('');
    const [branch, setBranch]   = useState('vectra-publish');
    const [message, setMessage] = useState('Publish from Vectra');

    // Parse owner/repo from GitHub URL or shorthand
    const [owner, repo] = (() => {
        try {
            const trimmed = repoUrl.trim();
            if (!trimmed) return ['', ''];
            const fullUrl = trimmed.includes('github.com') ? trimmed : `https://github.com/${trimmed}`;
            const u = new URL(fullUrl);
            const parts = u.pathname.split('/').filter(Boolean);
            return [parts[0] ?? '', parts[1]?.replace(/\.git$/, '') ?? ''];
        } catch { return ['', '']; }
    })();

    type Phase = 'idle' | 'working' | 'success' | 'error';
    const [phase, setPhase]       = useState<Phase>('idle');
    const [progress, setProgress] = useState(0);
    const [statusMsg, setStatusMsg] = useState('');
    const [result, setResult]     = useState<GitHubPublishResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');

    const canPush = !!token && !!owner && !!repo && phase === 'idle';

    const handlePush = useCallback(async () => {
        if (!canPush) return;
        setPhase('working'); setProgress(10); setStatusMsg('Generating your project files…');
        try {
            let fileMap: Record<string, string>;
            if (framework === 'nextjs') {
                const r = generateNextProjectCode(elements, pages, []);
                fileMap = typeof r === 'object' && 'files' in r ? (r as any).files : (r as Record<string, string>);
            } else {
                fileMap = generateProjectCode(elements, pages, []) as unknown as Record<string, string>;
            }
            setProgress(30); setStatusMsg('Connecting to GitHub…');
            const config: GitHubPublishConfig = {
                pat: token, owner, repo, branch, commitMessage: message,
            };
            const onGhProgress = (p: GitHubPublishProgress) => {
                if (p.phase === 'blobs') { setProgress(50); setStatusMsg(`Uploading files… (${p.blobsDone ?? 0}/${p.blobsTotal ?? '?'})`); }
                if (p.phase === 'tree')  { setProgress(70); setStatusMsg('Building file tree…'); }
                if (p.phase === 'commit') { setProgress(85); setStatusMsg('Creating commit…'); }
                if (p.phase === 'ref')   { setProgress(95); setStatusMsg('Updating branch…'); }
            };
            // publishToGitHub signature: (files, config, onProgress)
            const res = await publishToGitHub(fileMap, config, onGhProgress);
            setResult(res); setProgress(100); setPhase('success');
        } catch (e: any) {
            setErrorMsg(e?.message ?? 'Push failed. Check your token and repository name.');
            setPhase('error');
        }
    }, [canPush, token, owner, repo, branch, message, elements, pages, framework]);

    return (
        <div className="p-5 flex flex-col gap-4">
            <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-[#555] hover:text-[#888] transition-colors self-start">
                <ChevronLeft size={13} /> All options
            </button>

            <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/20 flex items-center justify-center">
                    <Github size={16} className="text-purple-400" />
                </div>
                <div>
                    <div className="text-sm font-bold text-white">Push to GitHub</div>
                    <div className="text-[10px] text-[#555]">Save your code to a repository</div>
                </div>
            </div>

            {phase === 'success' && result && (
                <SuccessCard
                    url={result.commitUrl}
                    label="Code pushed to GitHub ✓"
                    onClose={onBack}
                    dashUrl={result.repoUrl}
                    dashLabel="View repo"
                />
            )}

            {phase === 'error' && (
                <ErrorCard
                    message={errorMsg}
                    onRetry={() => { setPhase('idle'); setProgress(0); }}
                    onBack={onBack}
                />
            )}

            {(phase === 'idle' || phase === 'working') && (
                <>
                    <TokenField
                        label="GitHub Token"
                        value={token}
                        onChange={setToken}
                        helpUrl="https://github.com/settings/tokens/new?scopes=repo&description=Vectra+Visual+Builder"
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        sessionKey="vectra_gh_token"
                    />

                    <div>
                        <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-wider mb-1.5">
                            Repository URL or name
                        </label>
                        <input
                            value={repoUrl}
                            onChange={e => setRepoUrl(e.target.value)}
                            placeholder="https://github.com/you/your-repo  or  you/repo"
                            disabled={phase === 'working'}
                            className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded-lg px-3 py-2 text-xs text-white placeholder-[#444] focus:outline-none focus:border-[#555] transition-colors disabled:opacity-50"
                        />
                        {owner && repo && (
                            <p className="text-[10px] text-green-400 mt-1 flex items-center gap-1">
                                <Check size={9} /> {owner}/{repo}
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-wider mb-1.5">Branch</label>
                            <input value={branch} onChange={e => setBranch(e.target.value)} disabled={phase === 'working'}
                                className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#555] transition-colors disabled:opacity-50" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-wider mb-1.5">Commit message</label>
                            <input value={message} onChange={e => setMessage(e.target.value)} disabled={phase === 'working'}
                                className="w-full bg-[#1a1a1c] border border-[#3e3e42] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#555] transition-colors disabled:opacity-50" />
                        </div>
                    </div>

                    {phase === 'working' && (
                        <div className="space-y-2">
                            <ProgressBar percent={progress} color="purple" />
                            <p className="text-[10px] text-[#666] flex items-center gap-1.5">
                                <Loader2 size={9} className="animate-spin" /> {statusMsg}
                            </p>
                        </div>
                    )}

                    <button
                        onClick={handlePush}
                        disabled={!canPush}
                        className={cn(
                            'flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-xs font-bold transition-all',
                            canPush
                                ? 'bg-purple-600 hover:bg-purple-500 text-white active:scale-[0.98]'
                                : 'bg-[#252526] border border-[#3e3e42] text-[#555] cursor-not-allowed'
                        )}
                    >
                        {phase === 'working'
                            ? <><Loader2 size={12} className="animate-spin" />Pushing…</>
                            : <><Github size={12} />Push to GitHub</>
                        }
                    </button>
                </>
            )}
        </div>
    );
};

// ─── Vercel flow ──────────────────────────────────────────────────────────────

const VercelFlow = ({ onBack }: { onBack: () => void }) => {
    const { elements, pages, framework } = useEditor();

    const [token, setToken]           = useState('');
    const [projectName, setProjectName] = useState('my-vectra-app');
    const [target, setTarget]         = useState<'production' | 'preview'>('production');

    type Phase = 'idle' | 'working' | 'success' | 'error';
    const [phase, setPhase]       = useState<Phase>('idle');
    const [progress, setProgress] = useState(0);
    const [statusMsg, setStatusMsg] = useState('');
    const [result, setResult]     = useState<VercelDeployResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [showLog, setShowLog]   = useState(false);
    const [logLines, setLogLines] = useState<string[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => () => { abortRef.current?.abort(); }, []);

    const canDeploy = !!token && !!projectName && phase === 'idle';

    const handleDeploy = useCallback(async () => {
        if (!canDeploy) return;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setPhase('working'); setProgress(5); setStatusMsg('Generating your project…'); setLogLines([]);

        try {
            const fw = framework as 'nextjs' | 'vite';
            const raw = fw === 'nextjs'
                ? generateNextProjectCode(elements, pages, [])
                : generateProjectCode(elements, pages, []);
            const files: Record<string, string> = typeof raw === 'object' && 'files' in raw ? (raw as any).files : raw as Record<string, string>;

            const config: VercelDeployConfig = { token, projectName, target, env: {}, framework: fw };

            const friendlyPct: Record<string, number> = {
                uploading: 30, creating: 50, building: 75, ready: 95,
            };
            const friendlyMsg: Record<string, string> = {
                uploading: 'Uploading your files…',
                creating:  'Creating deployment…',
                building:  'Building your site on Vercel…',
                ready:     'Almost live…',
            };

            const res = await deployToVercel(files, config, (p: VercelDeployProgress) => {
                if (p.logLine) setLogLines(prev => [...prev, p.logLine!]);
                setProgress(friendlyPct[p.phase] ?? 60);
                setStatusMsg(friendlyMsg[p.phase] ?? 'Deploying…');
            }, ctrl.signal);

            setResult(res);
            setProgress(100);
            setPhase('success');
        } catch (e: any) {
            if (e?.name === 'AbortError') return;
            setErrorMsg(e?.message ?? 'Deploy failed. Check your token and try again.');
            setPhase('error');
        }
    }, [canDeploy, token, projectName, target, elements, pages, framework]);

    return (
        <div className="p-5 flex flex-col gap-4">
            <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-[#555] hover:text-[#888] transition-colors self-start">
                <ChevronLeft size={13} /> All options
            </button>

            <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center">
                    <Zap size={16} className="text-white" />
                </div>
                <div>
                    <div className="text-sm font-bold text-white">Deploy to Vercel</div>
                    <div className="text-[10px] text-[#555]">Your site will be live at {projectName || 'your-app'}.vercel.app</div>
                </div>
            </div>

            {phase === 'success' && result && (
                <SuccessCard
                    url={result.url}
                    label="Your site is live! 🎉"
                    onClose={onBack}
                    dashUrl={result.inspectorUrl}
                    dashLabel="Deployment"
                />
            )}

            {phase === 'error' && (
                <ErrorCard
                    message={errorMsg}
                    onRetry={() => { setPhase('idle'); setProgress(0); setLogLines([]); }}
                    onBack={onBack}
                />
            )}

            {(phase === 'idle' || phase === 'working') && (
                <>
                    <TokenField
                        label="Vercel Access Token"
                        value={token}
                        onChange={setToken}
                        helpUrl="https://vercel.com/account/tokens"
                        placeholder="xxxxxxxxxxxxxxxxxxxx"
                        sessionKey="vectra_vercel_token"
                    />

                    <div>
                        <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-wider mb-1.5">
                            Site name
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                value={projectName}
                                onChange={e => setProjectName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                                disabled={phase === 'working'}
                                className="flex-1 bg-[#1a1a1c] border border-[#3e3e42] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#555] transition-colors disabled:opacity-50"
                            />
                            <span className="text-[10px] text-[#444] shrink-0">.vercel.app</span>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-wider mb-1.5">
                            Publish as
                        </label>
                        <div className="flex gap-2">
                            {(['production', 'preview'] as const).map(t => (
                                <button key={t} type="button"
                                    onClick={() => setTarget(t)}
                                    disabled={phase === 'working'}
                                    className={cn(
                                        'flex-1 py-2 rounded-lg text-xs font-bold transition-all border',
                                        target === t
                                            ? 'bg-white/10 border-white/30 text-white'
                                            : 'bg-[#1a1a1c] border-[#2a2a2c] text-[#555] hover:text-[#888] hover:border-[#3e3e42]'
                                    )}>
                                    {t === 'production' ? '🌐 Live site' : '🔬 Preview'}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-[#444] mt-1">
                            {target === 'production'
                                ? 'Published to your main domain — shared with the world.'
                                : 'A private preview link — safe for testing before going live.'}
                        </p>
                    </div>

                    {phase === 'working' && (
                        <div className="space-y-2">
                            <ProgressBar percent={progress} color="blue" />
                            <div className="flex items-center justify-between">
                                <p className="text-[10px] text-[#666] flex items-center gap-1.5">
                                    <Loader2 size={9} className="animate-spin" /> {statusMsg}
                                </p>
                                <button type="button" onClick={() => setShowLog(p => !p)}
                                    className="text-[9px] text-[#444] hover:text-[#666] transition-colors">
                                    {showLog ? 'Hide' : 'Show'} log
                                </button>
                            </div>
                            {showLog && logLines.length > 0 && (
                                <div className="bg-[#0d0d0d] rounded-lg p-2 max-h-28 overflow-y-auto border border-[#1e1e1e]">
                                    {logLines.map((l, i) => (
                                        <div key={i} className="text-[9px] font-mono text-[#555] leading-relaxed">{l}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        onClick={handleDeploy}
                        disabled={!canDeploy}
                        className={cn(
                            'flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-xs font-bold transition-all',
                            canDeploy
                                ? 'bg-white text-black hover:bg-zinc-100 active:scale-[0.98]'
                                : 'bg-[#252526] border border-[#3e3e42] text-[#555] cursor-not-allowed'
                        )}
                    >
                        {phase === 'working'
                            ? <><Loader2 size={12} className="animate-spin" />Deploying…</>
                            : <><Zap size={12} />Deploy to Vercel</>
                        }
                    </button>

                    {phase === 'working' && (
                        <button type="button"
                            onClick={() => { abortRef.current?.abort(); setPhase('idle'); setProgress(0); }}
                            className="text-[11px] text-[#555] hover:text-[#888] transition-colors text-center">
                            Cancel deploy
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

// ─── Netlify flow ─────────────────────────────────────────────────────────────

const NetlifyFlow = ({ onBack }: { onBack: () => void }) => {
    const { elements, pages, framework } = useEditor();

    const [token, setToken]       = useState('');
    const [siteName, setSiteName] = useState('my-vectra-site');

    type Phase = 'idle' | 'working' | 'success' | 'error';
    const [phase, setPhase]       = useState<Phase>('idle');
    const [progress, setProgress] = useState(0);
    const [statusMsg, setStatusMsg] = useState('');
    const [result, setResult]     = useState<NetlifyDeployResult | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => () => { abortRef.current?.abort(); }, []);

    const canDeploy = !!token && !!siteName && phase === 'idle';

    const handleDeploy = useCallback(async () => {
        if (!canDeploy) return;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setPhase('working'); setProgress(5); setStatusMsg('Generating your project…');

        try {
            const fw = framework as 'nextjs' | 'vite';
            const raw = fw === 'nextjs'
                ? generateNextProjectCode(elements, pages, [])
                : generateProjectCode(elements, pages, []);
            const files: Record<string, string> = typeof raw === 'object' && 'files' in raw ? (raw as any).files : raw as Record<string, string>;

            const config: NetlifyDeployConfig = { token, siteName };

            const res = await deployToNetlify(files, config, (p: NetlifyDeployProgress) => {
                setProgress(p.percent);
                setStatusMsg(p.message);
            }, ctrl.signal);

            setResult(res);
            setProgress(100);
            setPhase('success');
        } catch (e: any) {
            if (e?.name === 'AbortError') return;
            setErrorMsg(e?.message ?? 'Deploy failed. Check your token and try again.');
            setPhase('error');
        }
    }, [canDeploy, token, siteName, elements, pages, framework]);

    return (
        <div className="p-5 flex flex-col gap-4">
            <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-[#555] hover:text-[#888] transition-colors self-start">
                <ChevronLeft size={13} /> All options
            </button>

            <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-500/15 border border-teal-500/20 flex items-center justify-center">
                    <Rocket size={16} className="text-teal-400" />
                </div>
                <div>
                    <div className="text-sm font-bold text-white">Deploy to Netlify</div>
                    <div className="text-[10px] text-[#555]">Your site will be at {siteName || 'your-site'}.netlify.app</div>
                </div>
            </div>

            {phase === 'success' && result && (
                <SuccessCard
                    url={result.url}
                    label="Your site is live on Netlify! 🎉"
                    onClose={onBack}
                    dashUrl={`https://app.netlify.com/sites/${result.siteName}`}
                    dashLabel="Dashboard"
                />
            )}

            {phase === 'error' && (
                <ErrorCard
                    message={errorMsg}
                    onRetry={() => { setPhase('idle'); setProgress(0); }}
                    onBack={onBack}
                />
            )}

            {(phase === 'idle' || phase === 'working') && (
                <>
                    <TokenField
                        label="Netlify Access Token"
                        value={token}
                        onChange={setToken}
                        helpUrl="https://app.netlify.com/user/applications#personal-access-tokens"
                        placeholder="nfp_xxxxxxxxxxxxxxxxxxxx"
                        sessionKey="vectra_netlify_token"
                    />

                    <div>
                        <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-wider mb-1.5">
                            Site name
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                value={siteName}
                                onChange={e => setSiteName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                                disabled={phase === 'working'}
                                className="flex-1 bg-[#1a1a1c] border border-[#3e3e42] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#555] transition-colors disabled:opacity-50"
                            />
                            <span className="text-[10px] text-[#444] shrink-0">.netlify.app</span>
                        </div>
                        <p className="text-[10px] text-[#444] mt-1">
                            Deploying again? Use the same name to update your existing site.
                        </p>
                    </div>

                    {phase === 'working' && (
                        <div className="space-y-2">
                            <ProgressBar percent={progress} color="teal" />
                            <p className="text-[10px] text-[#666] flex items-center gap-1.5">
                                <Loader2 size={9} className="animate-spin" /> {statusMsg}
                            </p>
                        </div>
                    )}

                    <button
                        onClick={handleDeploy}
                        disabled={!canDeploy}
                        className={cn(
                            'flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-xs font-bold transition-all',
                            canDeploy
                                ? 'bg-teal-600 hover:bg-teal-500 text-white active:scale-[0.98]'
                                : 'bg-[#252526] border border-[#3e3e42] text-[#555] cursor-not-allowed'
                        )}
                    >
                        {phase === 'working'
                            ? <><Loader2 size={12} className="animate-spin" />Deploying…</>
                            : <><Rocket size={12} />Deploy to Netlify</>
                        }
                    </button>

                    {phase === 'working' && (
                        <button type="button"
                            onClick={() => { abortRef.current?.abort(); setPhase('idle'); setProgress(0); }}
                            className="text-[11px] text-[#555] hover:text-[#888] transition-colors text-center">
                            Cancel deploy
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

// ─── ZIP flow ─────────────────────────────────────────────────────────────────

const ZipFlow = ({ onBack }: { onBack: () => void }) => {
    const { elements, pages, framework } = useEditor();
    const { instance, status } = useContainer();
    const [isExporting, setIsExporting] = useState(false);
    const [done, setDone] = useState(false);

    const handleDownload = useCallback(async () => {
        if (isExporting) return;
        setIsExporting(true);
        try {
            const JSZip = (await import('jszip')).default;
            const { saveAs } = await import('file-saver');
            const zipName = framework === 'nextjs' ? 'vectra-nextjs' : 'vectra-vite';

            // Prefer VFS if ready (has compiled output), fall back to codegen
            if (instance && status === 'ready') {
                const zip = new JSZip();
                const addDir = async (dir: string, folder: InstanceType<typeof JSZip>) => {
                    const entries = await instance.fs.readdir(dir, { withFileTypes: true });
                    for (const e of entries) {
                        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
                        const full = dir === '/' ? `/${e.name}` : `${dir}/${e.name}`;
                        if (e.isDirectory()) { await addDir(full, folder.folder(e.name)!); }
                        else { folder.file(e.name, await instance.fs.readFile(full, 'utf-8')); }
                    }
                };
                await addDir('/', zip);
                const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
                saveAs(blob, `${zipName}-project.zip`);
            } else {
                // Codegen fallback (VFS not ready)
                const fw = framework as 'nextjs' | 'vite';
                const raw = fw === 'nextjs'
                    ? generateNextProjectCode(elements, pages, [])
                    : generateProjectCode(elements, pages, []);
                const files: Record<string, string> = typeof raw === 'object' && 'files' in raw ? (raw as any).files : raw as Record<string, string>;

                const zip = new JSZip();
                for (const [p, c] of Object.entries(files)) {
                    zip.file(p.startsWith('/') ? p.slice(1) : p, c);
                }
                const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
                saveAs(blob, `${zipName}-project.zip`);
            }
            setDone(true);
        } catch (e: any) {
            alert(`Export failed: ${e?.message}`);
        } finally {
            setIsExporting(false);
        }
    }, [isExporting, instance, status, elements, pages, framework]);

    return (
        <div className="p-5 flex flex-col gap-4">
            <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-[#555] hover:text-[#888] transition-colors self-start">
                <ChevronLeft size={13} /> All options
            </button>

            <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                    <Download size={16} className="text-blue-400" />
                </div>
                <div>
                    <div className="text-sm font-bold text-white">Download Project ZIP</div>
                    <div className="text-[10px] text-[#555]">Everything you need to run your project locally</div>
                </div>
            </div>

            {done ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center animate-fadeIn">
                    <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/25 flex items-center justify-center">
                        <PackageCheck size={26} className="text-green-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-white mb-1">ZIP downloaded!</h3>
                        <p className="text-[11px] text-[#666]">Check your downloads folder. Run <code className="text-blue-400 bg-blue-500/10 px-1 rounded">npm install && npm run dev</code> to start.</p>
                    </div>
                    <button onClick={onBack} className="text-[11px] text-[#555] hover:text-[#888] transition-colors">Back to options</button>
                </div>
            ) : (
                <>
                    <div className="bg-[#1a1a1c] border border-[#2a2a2c] rounded-xl p-4 space-y-2.5">
                        <p className="text-[10px] font-bold text-[#666] uppercase tracking-wider mb-2">What's included</p>
                        {[
                            ['All your pages', `${pages.length} page${pages.length !== 1 ? 's' : ''} ready to run`],
                            ['Components', 'All AI-generated sections and components'],
                            [framework === 'nextjs' ? 'Next.js 14 App Router' : 'Vite + React SPA', 'Production-ready framework config'],
                            ['Tailwind CSS', 'Utility classes + your custom theme'],
                            ['package.json', 'All dependencies pinned and ready'],
                            ['README.md', 'Quick-start instructions included'],
                        ].map(([label, sub]) => (
                            <div key={label} className="flex items-start gap-2">
                                <Check size={11} className="text-green-400 shrink-0 mt-0.5" />
                                <div>
                                    <div className="text-[11px] text-[#cccccc] font-medium">{label}</div>
                                    <div className="text-[10px] text-[#555]">{sub}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="bg-blue-500/[0.08] border border-blue-500/20 rounded-lg px-3 py-2.5 text-[10px] text-[#888] leading-relaxed">
                        After downloading, open a terminal in the folder and run{' '}
                        <code className="text-blue-400 bg-blue-500/10 px-1 rounded">npm install</code>{' '}
                        then{' '}
                        <code className="text-blue-400 bg-blue-500/10 px-1 rounded">npm run dev</code>.
                        Your site opens at localhost:3000.
                    </div>

                    <button
                        onClick={handleDownload}
                        disabled={isExporting}
                        className={cn(
                            'flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-xs font-bold transition-all',
                            !isExporting
                                ? 'bg-blue-600 hover:bg-blue-500 text-white active:scale-[0.98]'
                                : 'bg-[#252526] border border-[#3e3e42] text-[#555] cursor-wait'
                        )}
                    >
                        {isExporting
                            ? <><Loader2 size={12} className="animate-spin" />Zipping…</>
                            : <><Download size={12} />Download ZIP</>
                        }
                    </button>
                </>
            )}
        </div>
    );
};

// ─── Main modal ───────────────────────────────────────────────────────────────

export const PublishModal = ({ onClose }: PublishModalProps) => {
    const [view, setView] = useState<View>('selector');

    const titles: Record<View, string> = {
        selector: 'Publish',
        github:   'GitHub',
        vercel:   'Vercel',
        netlify:  'Netlify',
        zip:      'Download ZIP',
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                onClick={onClose}
                className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            />

            {/* Modal */}
            <div
                className="relative w-full max-w-[480px] bg-[#141416] border border-[#2a2a2c] rounded-2xl shadow-2xl overflow-hidden animate-modalIn"
                onClick={e => e.stopPropagation()}
            >
                {/* Header strip */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1e1e20]">
                    <div className="flex items-center gap-2">
                        {view !== 'selector' && (
                            <button onClick={() => setView('selector')}
                                className="p-1 -ml-1 rounded hover:bg-white/5 text-[#555] hover:text-white transition-colors">
                                <ChevronLeft size={14} />
                            </button>
                        )}
                        <span className="text-xs font-bold text-white">{titles[view]}</span>
                    </div>
                    <button onClick={onClose}
                        className="p-1 rounded hover:bg-white/5 text-[#555] hover:text-white transition-colors">
                        <X size={14} />
                    </button>
                </div>

                {/* Content */}
                <div>
                    {view === 'selector' && <PlatformSelector onSelect={setView} />}
                    {view === 'github'   && <GitHubFlow   onBack={() => setView('selector')} />}
                    {view === 'vercel'   && <VercelFlow   onBack={() => setView('selector')} />}
                    {view === 'netlify'  && <NetlifyFlow  onBack={() => setView('selector')} />}
                    {view === 'zip'      && <ZipFlow      onBack={() => setView('selector')} />}
                </div>
            </div>

            {/* Inline keyframes for animations — no framer-motion needed */}
            <style>{`
                @keyframes modalIn {
                    from { opacity: 0; transform: scale(0.96) translateY(8px); }
                    to   { opacity: 1; transform: scale(1) translateY(0); }
                }
                .animate-modalIn { animation: modalIn 0.15s ease-out; }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
            `}</style>
        </div>
    );
};

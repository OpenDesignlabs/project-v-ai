import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useEditor } from '../../context/EditorContext';
import {
    Sparkles, ArrowRight, Loader2, CheckCircle2, XCircle, Zap,
    CheckCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const FALLBACK_HINTS = [
    'Build a full landing page',
    'Create a SaaS hero section',
    'Design a portfolio homepage',
];

const HISTORY_KEY = 'vectra_prompt_history';
const MAX_HISTORY = 12;

// ─── TYPES ────────────────────────────────────────────────────────────────────

type StageId = 'analyze' | 'sending' | 'parsing' | 'injecting';
type StageStatus = 'pending' | 'active' | 'done';

interface GenerationStage {
    id: StageId;
    label: string;
    status: StageStatus;
    ms?: number;
    model?: string;
    sections?: string[];
    count?: number;
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

const SectionChip: React.FC<{ name: string }> = ({ name }) => (
    <span
        style={{
            background: 'rgba(109,40,217,0.2)',
            border: '1px solid rgba(109,40,217,0.4)',
            color: '#a78bfa',
            fontSize: '9px',
            fontFamily: 'monospace',
            padding: '1px 5px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
        }}
    >
        {name}
    </span>
);

const StageRow: React.FC<{ stage: GenerationStage; streamChars?: number }> = ({ stage, streamChars }) => {
    const isDone    = stage.status === 'done';
    const isActive  = stage.status === 'active';
    const isPending = stage.status === 'pending';

    return (
        <motion.div
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: isPending ? 0.35 : 1, x: 0 }}
            className="flex items-center gap-2.5 min-h-[28px]"
        >
            {/* Status icon */}
            <div className="shrink-0 w-[18px] h-[18px] flex items-center justify-center">
                {isDone && (
                    <div className="w-[18px] h-[18px] rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                        <CheckCircle size={10} className="text-emerald-400" />
                    </div>
                )}
                {isActive && (
                    <div className="w-[18px] h-[18px] rounded-full border-2 border-blue-500 flex items-center justify-center">
                        <div className="w-[6px] h-[6px] rounded-full bg-blue-500 animate-pulse" />
                    </div>
                )}
                {isPending && (
                    <div className="w-[18px] h-[18px] rounded-full border border-zinc-700" />
                )}
            </div>

            {/* Label */}
            <span
                className="text-[11px] font-medium"
                style={{ color: isDone ? '#52525b' : isActive ? '#e4e4e7' : '#3f3f46' }}
            >
                {stage.label}
            </span>

            {/* Active-stage extras */}
            {isActive && stage.id === 'sending' && !!streamChars && streamChars > 0 && (
                <span className="text-[9px] font-mono text-zinc-600 ml-auto">
                    {streamChars.toLocaleString()} chars
                </span>
            )}
            {isActive && stage.id === 'parsing' && (
                <span className="text-[9px] text-zinc-600 ml-auto animate-pulse">extracting…</span>
            )}
            {isActive && stage.id === 'injecting' && (
                <span className="text-[9px] text-zinc-600 ml-auto animate-pulse">updating canvas…</span>
            )}

            {/* Done-stage extras */}
            {isDone && stage.id === 'parsing' && stage.sections && stage.sections.length > 0 && (
                <div className="flex items-center gap-1 ml-auto flex-wrap">
                    {stage.sections.slice(0, 4).map(s => <SectionChip key={s} name={s} />)}
                    {stage.sections.length > 4 && (
                        <span className="text-[9px] text-zinc-600">+{stage.sections.length - 4}</span>
                    )}
                </div>
            )}
            {isDone && stage.id === 'injecting' && stage.count !== undefined && (
                <span className="text-[9px] font-mono text-emerald-600 ml-auto">
                    {stage.count} section{stage.count !== 1 ? 's' : ''}
                </span>
            )}
            {isDone && stage.ms !== undefined && (
                <span className="text-[9px] font-mono text-zinc-700 ml-1 tabular-nums">
                    {stage.ms}ms
                </span>
            )}
        </motion.div>
    );
};

const GenerationPipeline: React.FC<{
    stages: GenerationStage[];
    streamChars: number;
    model: string;
}> = ({ stages, streamChars, model }) => (
    <div className="px-4 py-3 border-t border-white/5">
        {/* Model badge */}
        <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[9px] font-mono text-zinc-600 truncate">
                {model.split('/').pop() ?? model}
            </span>
        </div>
        {/* Stage rows */}
        <div className="flex flex-col gap-1">
            {stages.map(stage => (
                <StageRow key={stage.id} stage={stage} streamChars={streamChars} />
            ))}
        </div>
    </div>
);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const loadHistory = (): string[] => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); }
    catch { return []; }
};

const saveHistory = (prompt: string) => {
    try {
        const prev = loadHistory().filter(p => p !== prompt);
        localStorage.setItem(HISTORY_KEY, JSON.stringify([prompt, ...prev].slice(0, MAX_HISTORY)));
    } catch { /* storage unavailable */ }
};

const makeInitialStages = (): GenerationStage[] => [
    { id: 'analyze',   label: 'Analyzed prompt',      status: 'pending' },
    { id: 'sending',   label: 'Calling AI model',     status: 'pending' },
    { id: 'parsing',   label: 'Extracted sections',   status: 'pending' },
    { id: 'injecting', label: 'Injected into canvas', status: 'pending' },
];

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export const MagicBar = () => {
    const {
        isMagicBarOpen, setMagicBarOpen, runAI,
        elements, pages, activePageId,
    } = useEditor();

    const [input, setInput]   = useState('');
    const [status, setStatus] = useState<'idle' | 'thinking' | 'generating' | 'done' | 'error'>('idle');
    const [feedback, setFeedback]         = useState('');
    const [streamCharCount, setStreamCharCount] = useState(0);
    // Stage pipeline state
    const [stages, setStages]       = useState<GenerationStage[]>(makeInitialStages);
    const [activeModel, setActiveModel] = useState('');
    // Prompt history navigation
    const [promptHistory]   = useState<string[]>(loadHistory);
    const [historyIdx, setHistoryIdx] = useState(-1);
    // Per-stage timing
    const stageStartRef = useRef<number>(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus / reset on open/close
    useEffect(() => {
        if (isMagicBarOpen && inputRef.current) inputRef.current.focus();
        if (!isMagicBarOpen) {
            setStatus('idle');
            setFeedback('');
            setStreamCharCount(0);
            setStages(makeInitialStages());
            setHistoryIdx(-1);
        }
    }, [isMagicBarOpen]);

    // Contextual hints (unchanged canvas-aware logic)
    const contextualHints = useMemo((): string[] => {
        if (!isMagicBarOpen) return FALLBACK_HINTS;
        const pageMeta = pages.find(p => p.id === activePageId);
        if (!pageMeta) return FALLBACK_HINTS;
        const pageNode = elements[pageMeta.rootId];
        const artboardId = pageNode?.children?.find((cid: string) => {
            const t = elements[cid]?.type;
            return t === 'webpage' || t === 'artboard' || t === 'canvas';
        });
        if (!artboardId) return FALLBACK_HINTS;
        const artboard = elements[artboardId];
        const artboardChildren: string[] = artboard?.children ?? [];
        if (artboardChildren.length === 0) return FALLBACK_HINTS;
        const childTypes = new Set<string>();
        const childNames = new Set<string>();
        artboardChildren.forEach((cid: string) => {
            const el = elements[cid];
            if (!el) return;
            childTypes.add(el.type);
            if (el.name) childNames.add(el.name.toLowerCase());
        });
        const has = (t: string, n: string) =>
            childTypes.has(t) || [...childNames].some(name => name.includes(n));
        const suggestions: string[] = [];
        if (!has('navbar', 'nav'))              suggestions.push('Add a sticky navigation bar');
        if (!has('hero', 'hero'))               suggestions.push('Add a hero section with gradient CTA');
        if (!has('features_section', 'feature') && has('hero', 'hero')) suggestions.push('Add a features bento grid');
        if (!has('pricing', 'pric'))            suggestions.push('Add a pricing comparison table');
        if (!has('', 'testimonial'))            suggestions.push('Add a testimonials carousel');
        if (!has('', 'contact') && !has('', 'cta')) suggestions.push('Add a contact / CTA section');
        if (!has('', 'footer'))                 suggestions.push('Add a footer with links');
        if (!has('', 'faq'))                    suggestions.push('Add a FAQ accordion');
        const extras = [
            'Add animated stats counter section', 'Add a team members grid',
            'Redesign page with glassmorphism style', 'Add a dark-mode hero with particle effects',
            'Add a comparison section with checkmarks',
        ];
        for (const e of extras) {
            if (suggestions.length >= 5) break;
            if (!suggestions.includes(e)) suggestions.push(e);
        }
        return suggestions.slice(0, 5);
    }, [isMagicBarOpen, elements, pages, activePageId]);

    // ── Stage event listener — attached only during 'generating' (zero cost at idle)
    useEffect(() => {
        if (status !== 'generating') return;

        const handleStage = (e: Event) => {
            const detail = (e as CustomEvent).detail as {
                stage: 'sending' | 'parsing' | 'injecting';
                model?: string;
                sections?: string[];
                count?: number;
            };
            const now     = Date.now();
            const elapsed = now - stageStartRef.current;
            stageStartRef.current = now;

            setStages(prev => prev.map(s => {
                // Mark the just-completed predecessor as done
                if (detail.stage === 'sending'   && s.id === 'analyze')   return { ...s, status: 'done', ms: elapsed };
                if (detail.stage === 'parsing'   && s.id === 'sending')   return { ...s, status: 'done', ms: elapsed };
                if (detail.stage === 'injecting' && s.id === 'parsing')   return { ...s, status: 'done', ms: elapsed, sections: detail.sections };
                // Mark the current stage as active
                if (s.id === detail.stage) {
                    if (detail.stage === 'sending')   { setActiveModel(detail.model ?? ''); return { ...s, status: 'active' }; }
                    if (detail.stage === 'parsing')   return { ...s, status: 'active' };
                    if (detail.stage === 'injecting') return { ...s, status: 'active', count: detail.count };
                }
                return s;
            }));
        };

        window.addEventListener('vectra:ai-stage', handleStage);
        return () => window.removeEventListener('vectra:ai-stage', handleStage);
    }, [status]);

    // ── Stream chunk listener (char count)
    useEffect(() => {
        if (status !== 'generating') { setStreamCharCount(0); return; }
        const handleChunk = (e: Event) => {
            const { accumulated } = (e as CustomEvent<{ text: string; accumulated: string }>).detail;
            setStreamCharCount(accumulated.length);
        };
        window.addEventListener('vectra:ai-stream-chunk', handleChunk);
        return () => window.removeEventListener('vectra:ai-stream-chunk', handleChunk);
    }, [status]);

    // STRICT-MODE-DOUBLE-INVOKE [PERMANENT]: isRunning ref — never setTimeout
    const isRunning = useRef(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        if (isRunning.current) return;
        isRunning.current = true;

        try {
            setStatus('thinking');
            await new Promise(r => setTimeout(r, 120));

            // Reset pipeline + mark analyze as instantly done + record start time
            const freshStages = makeInitialStages();
            freshStages[0] = { ...freshStages[0], status: 'done', ms: 120 };
            setStages(freshStages);
            stageStartRef.current = Date.now();
            setStreamCharCount(0);
            setStatus('generating');

            const resultMessage = await runAI(input);

            // Mark any still-active stages as done
            setStages(prev => prev.map(s =>
                s.status === 'active' ? { ...s, status: 'done' } : s
            ));

            saveHistory(input);
            setStatus('done');
            setFeedback(resultMessage || 'Done');

            setTimeout(() => {
                setMagicBarOpen(false);
                setInput('');
                isRunning.current = false;
            }, 1200);
        } catch (err: any) {
            const msg = err?.message ?? 'Something went wrong. Please try again.';
            setFeedback(msg);
            setStatus('error');
            setTimeout(() => {
                setStatus('idle');
                setFeedback('');
                setStages(makeInitialStages());
                isRunning.current = false;
            }, 3500);
        }
    };

    // ── Prompt history keyboard navigation (↑ / ↓)
    const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (status !== 'idle') return;
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const nextIdx = Math.min(historyIdx + 1, promptHistory.length - 1);
            setHistoryIdx(nextIdx);
            if (promptHistory[nextIdx]) setInput(promptHistory[nextIdx]);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIdx = Math.max(historyIdx - 1, -1);
            setHistoryIdx(nextIdx);
            setInput(nextIdx === -1 ? '' : (promptHistory[nextIdx] ?? ''));
        }
    }, [status, historyIdx, promptHistory]);

    if (!isMagicBarOpen) return null;

    const streamProgress = Math.min(100, Math.round((streamCharCount / 4000) * 100));

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={() => { if (status === 'idle') setMagicBarOpen(false); }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="relative w-full max-w-2xl bg-[#09090b] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
                >
                    {/* Progress bar */}
                    {status === 'generating' && (
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-zinc-800/80 overflow-hidden">
                            <motion.div
                                className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
                                initial={{ width: '0%' }}
                                animate={{ width: `${streamProgress}%` }}
                                transition={{ duration: 0.3, ease: 'easeOut' }}
                            />
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="relative">
                        {/* Header */}
                        <div className="absolute top-4 left-4 flex items-center gap-2 text-blue-400 select-none pointer-events-none">
                            <Sparkles
                                size={16}
                                className={status === 'thinking' || status === 'generating' ? 'animate-spin' : ''}
                            />
                            <span className="text-xs font-bold tracking-wider uppercase">
                                {status === 'idle'       && 'Vectra AI'}
                                {status === 'thinking'   && 'Analyzing…'}
                                {status === 'generating' && 'Generating…'}
                                {status === 'done'       && 'Done'}
                                {status === 'error'      && 'Failed'}
                            </span>
                            {/* History hint */}
                            {status === 'idle' && promptHistory.length > 0 && !input && (
                                <span className="text-[9px] text-zinc-700 font-mono">↑ history</span>
                            )}
                        </div>

                        {/* Input */}
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={e => { setInput(e.target.value); setHistoryIdx(-1); }}
                            onKeyDown={handleInputKeyDown}
                            placeholder="Describe what to build or add…"
                            className="w-full bg-transparent text-lg text-white placeholder-zinc-500 px-4 pt-12 pb-16 outline-none"
                            disabled={status !== 'idle'}
                        />

                        {/* Done / error overlay */}
                        {(status === 'done' || status === 'error') && (
                            <div className={`absolute inset-0 bg-[#09090b]/90 flex items-center justify-center gap-2 font-medium px-6 text-center ${
                                status === 'error' ? 'text-red-400' : 'text-green-400'
                            }`}>
                                {status === 'error'
                                    ? <XCircle size={20} className="shrink-0" />
                                    : <CheckCircle2 size={20} className="shrink-0" />}
                                <span className="text-sm">{feedback}</span>
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="absolute bottom-3 right-3 flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setMagicBarOpen(false)}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={status !== 'idle' || !input.trim()}
                                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold text-white transition-all ${
                                    status !== 'idle' || !input.trim()
                                        ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20'
                                }`}
                            >
                                {status === 'idle'
                                    ? <><span>Generate</span><ArrowRight size={14} /></>
                                    : <><Loader2 size={14} className="animate-spin" /><span>Working…</span></>
                                }
                            </button>
                        </div>
                    </form>

                    {/* Live stage pipeline — shown during generation */}
                    {(status === 'generating' || status === 'thinking') && (
                        <GenerationPipeline
                            stages={stages}
                            streamChars={streamCharCount}
                            model={activeModel}
                        />
                    )}

                    {/* Hint chips — idle + empty only */}
                    {!input && status === 'idle' && (
                        <div className="px-4 pb-4 flex flex-wrap gap-2">
                            {contextualHints.map(hint => (
                                <button
                                    key={hint}
                                    onClick={() => setInput(hint)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-[10px] text-zinc-400 hover:text-white hover:border-white/10 transition-all"
                                >
                                    <Zap size={9} className="text-violet-400 shrink-0" />
                                    {hint}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Recent prompts — idle + empty + history exists */}
                    {!input && status === 'idle' && promptHistory.length > 0 && (
                        <div className="px-4 pb-3 border-t border-white/[0.04]">
                            <p className="text-[9px] text-zinc-700 uppercase tracking-wider mb-1.5 mt-2">Recent</p>
                            <div className="flex flex-wrap gap-1.5">
                                {promptHistory.slice(0, 4).map((p, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setInput(p)}
                                        className="text-[10px] text-zinc-600 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 px-2 py-0.5 rounded transition-all truncate max-w-[200px]"
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useEditor } from '../../context/EditorContext';
import { Sparkles, ArrowRight, Loader2, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── STATIC FALLBACK HINTS ────────────────────────────────────────────────────
// Used when the canvas is empty or activePageId can't be resolved.
const FALLBACK_HINTS = [
    'Build a full landing page',
    'Create a SaaS hero section',
    'Design a portfolio homepage',
];

export const MagicBar = () => {
    // elements/pages/activePageId added for contextual hint derivation. MagicBar was already subscribed to ProjectContext via useEditor(). Adding these to the destructure is zero extra re-render cost —
    const {
        isMagicBarOpen, setMagicBarOpen, runAI,
        elements, pages, activePageId,
    } = useEditor();

    const [input, setInput] = useState('');
    const [status, setStatus] = useState<'idle' | 'thinking' | 'generating' | 'done' | 'error'>('idle');
    const [feedback, setFeedback] = useState('');
    // streaming state — updated by vectra:ai-stream-chunk events
    const [streamCharCount, setStreamCharCount] = useState(0);
    const [currentSection, setCurrentSection] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isMagicBarOpen && inputRef.current) inputRef.current.focus();
        if (!isMagicBarOpen) {
            setStatus('idle');
            setFeedback('');
            setStreamCharCount(0);
            setCurrentSection('');
        }
    }, [isMagicBarOpen]);

    // ── Contextual hints ────────────────────────────────────── Re-derived whenever the bar opens (isMagicBarOpen flips to true). Scans the active artboard's existing children to detect which sections
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

        // Build a set of what already exists on this artboard
        const childTypes = new Set<string>();
        const childNames = new Set<string>();
        artboardChildren.forEach((cid: string) => {
            const el = elements[cid];
            if (!el) return;
            childTypes.add(el.type);
            if (el.name) childNames.add(el.name.toLowerCase());
        });

        const has = (typeMatch: string, nameFragment: string) =>
            childTypes.has(typeMatch) ||
            [...childNames].some(n => n.includes(nameFragment));

        const hasNavbar      = has('navbar', 'nav');
        const hasHero        = has('hero', 'hero');
        const hasFeatures    = has('features_section', 'feature');
        const hasPricing     = has('pricing', 'pric');
        const hasFooter      = has('', 'footer');
        const hasTestimonials = has('', 'testimonial');
        const hasContact     = has('', 'contact') || has('', 'cta');
        const hasFaq         = has('', 'faq');

        // Build ordered suggestion list of what's absent
        const suggestions: string[] = [];
        if (!hasNavbar)       suggestions.push('Add a sticky navigation bar');
        if (!hasHero)         suggestions.push('Add a hero section with gradient CTA');
        if (!hasFeatures && hasHero) suggestions.push('Add a features bento grid');
        if (!hasPricing)      suggestions.push('Add a pricing comparison table');
        if (!hasTestimonials) suggestions.push('Add a testimonials carousel');
        if (!hasContact)      suggestions.push('Add a contact / CTA section');
        if (!hasFooter)       suggestions.push('Add a footer with links');
        if (!hasFaq)          suggestions.push('Add a FAQ accordion');

        // Pad with creative extras so we always show at least 3
        const extras = [
            'Add animated stats counter section',
            'Add a team members grid',
            'Redesign page with glassmorphism style',
            'Add a dark-mode hero with particle effects',
            'Add a comparison section with checkmarks',
        ];
        for (const extra of extras) {
            if (suggestions.length >= 5) break;
            if (!suggestions.includes(extra)) suggestions.push(extra);
        }

        return suggestions.slice(0, 5);
    }, [isMagicBarOpen, elements, pages, activePageId]);
    // ── End SPRINT-B-FIX-1 ────────────────────────────────────────────────────

    // ── Streaming event listener ────────────────────────────── Attached only during 'generating' status — zero cost at idle. callDirectAPIWithStreaming in aiAgent.ts dispatches 'vectra:ai-stream-chunk'
    useEffect(() => {
        if (status !== 'generating') {
            setStreamCharCount(0);
            setCurrentSection('');
            return;
        }
        const handleChunk = (e: Event) => {
            const { accumulated } = (e as CustomEvent<{ text: string; accumulated: string }>).detail;
            setStreamCharCount(accumulated.length);
            // Extract last "// SECTION: Name" marker as it's written
            const matches = [...accumulated.matchAll(/\/\/\s*SECTION:\s*([^\n\r]+)/g)];
            if (matches.length > 0) {
                setCurrentSection(matches[matches.length - 1][1].trim());
            }
        };
        window.addEventListener('vectra:ai-stream-chunk', handleChunk);
        return () => window.removeEventListener('vectra:ai-stream-chunk', handleChunk);
    }, [status]);
    // ── End SPRINT-B-FIX-4 ───────────────────────────────────────────────────

    // isRunning ref prevents concurrent double-submission from StrictMode re-invoke, rapid double-click, or keyboard Enter race. A ref (not state) avoids a re-render on guard check
    const isRunning = useRef(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        if (isRunning.current) return;
        isRunning.current = true;

        try {
            setStatus('thinking');
            // 120ms micro-yield: flushes 'thinking' paint without creating a
            // double-invoke window the way a bare setTimeout(fn, 800) does.
            await new Promise(r => setTimeout(r, 120));
            setStatus('generating');

            const resultMessage = await runAI(input);

            setStatus('done');
            setFeedback(resultMessage || 'Done');

            setTimeout(() => {
                setMagicBarOpen(false);
                setInput('');
                isRunning.current = false;
            }, 1500);
        } catch (err: any) {
            // Never silently swallow AI errors.
            const msg = err?.message ?? 'Something went wrong. Please try again.';
            setFeedback(msg);
            setStatus('error');
            setTimeout(() => {
                setStatus('idle');
                setFeedback('');
                isRunning.current = false;
            }, 3000);
        }
    };

    if (!isMagicBarOpen) return null;

    // Streaming progress — estimated 0–100% based on typical 4000-char response
    const streamProgress = Math.min(100, Math.round((streamCharCount / 4000) * 100));

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={() => setMagicBarOpen(false)}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="relative w-full max-w-2xl bg-[#09090b] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
                >
                    {/* SPRINT-B-FIX-4: Streaming progress bar
                        Only visible during 'generating'. Grows from 0→100% as tokens arrive.
                        Height 2px — subtle, never distracts from the input. */}
                    {status === 'generating' && (
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-zinc-800 overflow-hidden">
                            <motion.div
                                className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
                                initial={{ width: '0%' }}
                                animate={{ width: `${streamProgress}%` }}
                                transition={{ duration: 0.3, ease: 'easeOut' }}
                            />
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="relative">
                        {/* Header bar */}
                        <div className="absolute top-4 left-4 flex items-center gap-2 text-blue-400 select-none pointer-events-none">
                            <Sparkles
                                size={16}
                                className={status === 'thinking' || status === 'generating' ? 'animate-spin' : ''}
                            />
                            <span className="text-xs font-bold tracking-wider uppercase">
                                {status === 'idle'       && 'Vectra AI Agent'}
                                {status === 'thinking'   && 'Analyzing Prompt...'}
                                {status === 'generating' && 'Writing Code...'}
                                {status === 'done'       && 'Completed'}
                                {status === 'error'      && 'Generation Failed'}
                            </span>

                            {/* SPRINT-B-FIX-4: Section ticker — appears as sections are detected */}
                            {status === 'generating' && currentSection && (
                                <span className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
                                    <span className="text-zinc-700">›</span>
                                    <motion.span
                                        key={currentSection}
                                        initial={{ opacity: 0, x: 4 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className="text-violet-400"
                                    >
                                        {currentSection}
                                    </motion.span>
                                </span>
                            )}
                            {status === 'generating' && streamCharCount > 0 && (
                                <span className="text-[9px] text-zinc-700 font-mono ml-1">
                                    {streamCharCount.toLocaleString()} chars
                                </span>
                            )}
                        </div>

                        {/* Text input */}
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Describe what to build or add..."
                            className="w-full bg-transparent text-lg text-white placeholder-zinc-500 px-4 pt-12 pb-16 outline-none"
                            disabled={status !== 'idle'}
                        />

                        {/* Status feedback overlay — success (green) or error (red) */}
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
                                className={`
                                    flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold text-white transition-all
                                    ${status !== 'idle' || !input.trim()
                                        ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/20'}
                                `}
                            >
                                {status === 'idle' ? (
                                    <><span>Generate</span><ArrowRight size={14} /></>
                                ) : (
                                    <><Loader2 size={14} className="animate-spin" /><span>Processing...</span></>
                                )}
                            </button>
                        </div>
                    </form>

                    {/* SPRINT-B-FIX-1: Contextual hint chips
                        Shown only when input is empty and bar is idle.
                        Content is canvas-aware (derived from live elements above).
                        Static chips remain as fallback on empty canvas. */}
                    {!input && status === 'idle' && (
                        <div className="px-4 pb-4 flex flex-wrap gap-2">
                            {contextualHints.map((hint) => (
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
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

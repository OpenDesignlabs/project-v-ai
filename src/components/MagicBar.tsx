import React, { useState, useRef, useEffect } from 'react';
import { useEditor } from '../context/EditorContext';
import { Sparkles, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const MagicBar = () => {
    const { isMagicBarOpen, setMagicBarOpen, runAI } = useEditor();
    const [input, setInput] = useState('');
    const [status, setStatus] = useState<'idle' | 'thinking' | 'generating' | 'done'>('idle');
    const [feedback, setFeedback] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isMagicBarOpen && inputRef.current) inputRef.current.focus();
        if (!isMagicBarOpen) {
            setStatus('idle'); // Reset on close
            setFeedback('');
        }
    }, [isMagicBarOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        // 1. UI: Thinking State
        setStatus('thinking');

        // 2. Simulate "Parsing" delay for realism
        setTimeout(async () => {
            setStatus('generating');

            // 3. Call Actual AI Service
            const resultMessage = await runAI(input);

            // 4. UI: Done State
            setStatus('done');
            setFeedback(resultMessage || "Done");

            // 5. Auto Close after success
            setTimeout(() => {
                setMagicBarOpen(false);
                setInput('');
            }, 1500);

        }, 800);
    };

    if (!isMagicBarOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
                    <form onSubmit={handleSubmit} className="relative">
                        <div className="absolute top-4 left-4 flex items-center gap-2 text-blue-400 select-none pointer-events-none">
                            <Sparkles size={16} className={status === 'thinking' || status === 'generating' ? "animate-spin" : ""} />
                            <span className="text-xs font-bold tracking-wider uppercase">
                                {status === 'idle' && "Vectra AI Agent"}
                                {status === 'thinking' && "Analyzing Prompt..."}
                                {status === 'generating' && "Writing Code..."}
                                {status === 'done' && "Completed"}
                            </span>
                        </div>

                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Describe the website you want to build..."
                            className="w-full bg-transparent text-lg text-white placeholder-zinc-500 px-4 pt-12 pb-16 outline-none"
                            disabled={status !== 'idle'}
                        />

                        {/* Status Feedback Overlay */}
                        {status === 'done' && (
                            <div className="absolute inset-0 bg-[#09090b]/90 flex items-center justify-center gap-2 text-green-400 font-medium">
                                <CheckCircle2 size={20} />
                                <span>{feedback}</span>
                            </div>
                        )}

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

                    {/* Hints / Suggestions (Optional) */}
                    {!input && status === 'idle' && (
                        <div className="px-4 pb-4 flex flex-wrap gap-2">
                            {['Build a hero section', 'Add pricing table', 'Create landing page'].map((hint) => (
                                <button
                                    key={hint}
                                    onClick={() => setInput(hint)}
                                    className="px-3 py-1.5 rounded-full bg-white/5 border border-white/5 text-[10px] text-zinc-400 hover:text-white hover:border-white/10 transition-all"
                                >
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

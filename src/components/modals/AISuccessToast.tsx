import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Undo2, X, Sparkles } from 'lucide-react';
import { useEditor } from '../../context/EditorContext';

const TOAST_DURATION_MS = 8000;

export const AISuccessToast: React.FC = () => {
    const { undo } = useEditor();
    const [visible, setVisible] = useState(false);
    const [sectionCount, setSectionCount] = useState(0);
    const [sectionNames, setSectionNames] = useState<string[]>([]);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const dismiss = useCallback(() => {
        setVisible(false);
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const handleUndo = useCallback(() => { undo(); dismiss(); }, [undo, dismiss]);

    useEffect(() => {
        const onDone = (e: Event) => {
            const { sectionCount: count, sectionNames: names = [] } =
                (e as CustomEvent<{ sectionCount: number; sectionNames?: string[] }>).detail;
            setSectionCount(count);
            setSectionNames(names);
            setVisible(true);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(dismiss, TOAST_DURATION_MS);
        };
        window.addEventListener('vectra:ai-done', onDone);
        return () => {
            window.removeEventListener('vectra:ai-done', onDone);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [dismiss]);

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: 24, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.97 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="fixed bottom-5 left-1/2 z-300"
                    style={{ transform: 'translateX(-50%)' }}
                >
                    <div className="relative bg-[#1a1a1c] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
                         style={{ minWidth: 280 }}>
                        {/* Main row */}
                        <div className="flex items-center gap-3 px-4 py-3">
                            <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                                <Sparkles size={13} className="text-violet-400" />
                            </div>
                            <span className="text-sm text-white font-medium">
                                Generated{' '}
                                <span className="text-violet-400 font-bold">
                                    {sectionCount} section{sectionCount !== 1 ? 's' : ''}
                                </span>
                            </span>
                            <div className="w-px h-4 bg-white/10 mx-1" />
                            <button
                                onClick={handleUndo}
                                className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                            >
                                <Undo2 size={12} />
                                Undo
                            </button>
                            <button onClick={dismiss} className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors rounded ml-auto">
                                <X size={12} />
                            </button>
                        </div>

                        {/* Section name chips — shown only when names are available */}
                        {sectionNames.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap px-4 pb-3 -mt-1">
                                {sectionNames.map(name => (
                                    <span key={name}
                                        className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                                        style={{
                                            background: 'rgba(109,40,217,0.18)',
                                            border: '1px solid rgba(109,40,217,0.35)',
                                            color: '#a78bfa',
                                            letterSpacing: '0.04em',
                                        }}
                                    >
                                        {name}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Progress bar */}
                        <motion.div
                            className="absolute bottom-0 left-0 h-[2px] bg-violet-500/40"
                            style={{ right: 0 }}
                            initial={{ scaleX: 1, transformOrigin: 'left' }}
                            animate={{ scaleX: 0, transformOrigin: 'left' }}
                            transition={{ duration: TOAST_DURATION_MS / 1000, ease: 'linear' }}
                        />
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

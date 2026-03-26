import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Shortcut groups rendered in the 2×2 grid layout.
const SHORTCUT_GROUPS = [
    { group: 'Canvas', items: [
        ['Space + drag',    'Pan canvas'],
        ['Ctrl/⌘ + scroll', 'Zoom in/out'],
        ['⌘0 / Ctrl+0',    'Zoom to fit'],
        ['Arrow keys',      'Nudge 1px'],
        ['Shift + Arrow',   'Nudge 10px'],
        ['Click empty',     'Deselect all'],
    ]},
    { group: 'Selection', items: [
        ['Click',                'Select element'],
        ['Shift + click',        'Add to multi-select'],
        ['Drag to box-select',   'Select multiple'],
        ['Escape',               'Deselect'],
        ['Delete / Backspace',   'Delete selected'],
        ['Right-click',          'Context menu'],
    ]},
    { group: 'Edit', items: [
        ['⌘D / Ctrl+D',    'Duplicate'],
        ['⌘G / Ctrl+G',    'Group into container'],
        ['⌘C / Ctrl+C',    'Copy'],
        ['⌘V / Ctrl+V',    'Paste (cross-page)'],
        ['⌘Z / Ctrl+Z',    'Undo'],
        ['⌘⇧Z / Ctrl+Y',  'Redo'],
        ['Double-click',   'Edit text inline'],
    ]},
    { group: 'AI & View', items: [
        ['⌘K / Ctrl+K',    'Open AI magic bar'],
        ['↑/↓ in AI bar',  'Navigate prompt history'],
        ['I',              'Toggle insert drawer'],
        ['⌘I / Ctrl+I',   'Import component'],
        ['?',              'This shortcut list'],
        ['Escape',         'Close panels / dialogs'],
    ]},
] as const;

// Keyboard chip shown on the right side of each shortcut row.
const KeyChip = ({ children }: { children: React.ReactNode }) => (
    <kbd className="text-[10px] font-mono bg-[#2a2a2d] border border-[#3e3e42] text-[#ccc] px-2 py-0.5 rounded shrink-0">
        {children}
    </kbd>
);

interface ShortcutsOverlayProps {
    open: boolean;
    onClose: () => void;
}

export const ShortcutsOverlay = ({ open, onClose }: ShortcutsOverlayProps) => {
    // Close on Escape key
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="shortcuts-backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="fixed inset-0 z-200 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
                    onClick={onClose}
                >
                    <motion.div
                        key="shortcuts-panel"
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="bg-[#1e1e1e] border border-[#3f3f46] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2c]">
                            <h2 className="text-sm font-bold text-white flex items-center gap-2">
                                <span className="text-[#007acc]">⌨</span> Keyboard Shortcuts
                            </h2>
                            <button
                                onClick={onClose}
                                className="text-[#555] hover:text-[#ccc] transition-colors text-xs w-6 h-6 flex items-center justify-center rounded hover:bg-[#3e3e42]"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Group grid */}
                        <div className="p-6 grid grid-cols-2 gap-8">
                            {SHORTCUT_GROUPS.map(({ group, items }) => (
                                <div key={group}>
                                    <div className="text-[10px] font-bold text-[#007acc] uppercase tracking-widest mb-3">
                                        {group}
                                    </div>
                                    <div className="space-y-2">
                                        {items.map(([key, desc]) => (
                                            <div key={key} className="flex items-center justify-between gap-4">
                                                <span className="text-[11px] text-[#888]">{desc}</span>
                                                <KeyChip>{key}</KeyChip>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Footer hint */}
                        <div className="px-6 py-3 border-t border-[#2a2a2c] text-[10px] text-[#444] text-center">
                            Press <KeyChip>?</KeyChip> to toggle · <KeyChip>Esc</KeyChip> to close
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

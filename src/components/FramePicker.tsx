import React, { useState, useRef, useEffect } from 'react';
import { Monitor, Tablet, Smartphone, Plus, X, ChevronRight } from 'lucide-react';
import { PRESET_BY_CATEGORY, type FramePreset } from '../data/framePresets';
import { cn } from '../lib/utils';

interface FramePickerProps {
    onAddFrame: (preset: FramePreset) => void;
}

type Tab = 'desktop' | 'tablet' | 'mobile';

const TAB_CONFIG: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'desktop', label: 'Desktop', icon: Monitor },
    { id: 'tablet', label: 'Tablet', icon: Tablet },
    { id: 'mobile', label: 'Mobile', icon: Smartphone },
];

// Dimension badge colour per category
const DIM_COLOR: Record<Tab, string> = {
    desktop: 'text-blue-400 bg-blue-500/10',
    tablet: 'text-purple-400 bg-purple-500/10',
    mobile: 'text-emerald-400 bg-emerald-500/10',
};

export const FramePicker: React.FC<FramePickerProps> = ({ onAddFrame }) => {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<Tab>('desktop');
    const panelRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleAdd = (preset: FramePreset) => {
        onAddFrame(preset);
        setOpen(false);
    };

    return (
        // Fixed to bottom-left of the editor canvas viewport
        <div
            ref={panelRef}
            style={{
                position: 'fixed',
                bottom: '24px',
                left: '80px', // offset for LeftSidebar width
                zIndex: 100,
            }}
        >
            {/* ── Picker Panel ──────────────────────────────────── */}
            {open && (
                <div
                    className="mb-2 w-72 bg-[#1c1c1e] border border-[#3a3a3c] rounded-2xl shadow-2xl overflow-hidden"
                    style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[#2c2c2e]">
                        <span className="text-xs font-bold text-white tracking-wide uppercase">Add Frame</span>
                        <button onClick={() => setOpen(false)} className="text-[#636366] hover:text-white transition-colors">
                            <X size={14} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-[#2c2c2e]">
                        {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => setTab(id)}
                                className={cn(
                                    'flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-all',
                                    tab === id
                                        ? 'text-white border-b-2 border-blue-500'
                                        : 'text-[#636366] hover:text-[#aeaeb2]'
                                )}
                            >
                                <Icon size={14} />
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Preset list */}
                    <div className="py-1 max-h-72 overflow-y-auto custom-scrollbar">
                        {PRESET_BY_CATEGORY[tab].map(preset => (
                            <button
                                key={preset.id}
                                onClick={() => handleAdd(preset)}
                                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#2c2c2e] transition-colors group"
                            >
                                <span className="text-xs text-[#e5e5ea] font-medium group-hover:text-white transition-colors text-left">
                                    {preset.label}
                                </span>
                                <div className="flex items-center gap-2">
                                    <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded font-bold', DIM_COLOR[tab])}>
                                        {preset.width}×{preset.height}
                                    </span>
                                    <ChevronRight size={12} className="text-[#48484a] group-hover:text-[#636366]" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Trigger Button ────────────────────────────────── */}
            <button
                onClick={() => setOpen(p => !p)}
                className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-lg',
                    'border backdrop-blur-sm',
                    open
                        ? 'bg-blue-500 border-blue-400 text-white shadow-blue-500/30'
                        : 'bg-[#1c1c1e]/90 border-[#3a3a3c] text-[#aeaeb2] hover:text-white hover:border-[#636366]'
                )}
                title="Add Frame"
            >
                <Plus size={14} className={open ? 'rotate-45 transition-transform' : 'transition-transform'} />
                <span>Frame</span>
            </button>
        </div>
    );
};

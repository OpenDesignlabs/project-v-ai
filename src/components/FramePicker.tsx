// ─── FRAME PICKER — CF-1 ─────────────────────────────────────────────────────
// Floating "+ Frame" button fixed to canvas viewport bottom-left.
// Spawns a mirror frame at the chosen device dimensions on the canvas.
// Mirror frames sync content from the source frame and apply width-aware
// CSS stacking — user designs in them as real canvas artboards.

import React, { useState, useRef, useEffect } from 'react';
import { Monitor, Tablet, Smartphone, Plus, X, ChevronRight } from 'lucide-react';
import { PRESETS_BY_CATEGORY, type FramePreset } from '../data/framePresets';
import { cn } from '../lib/utils';

interface FramePickerProps {
    onAddFrame: (preset: FramePreset) => void;
}

type Tab = 'desktop' | 'tablet' | 'mobile';

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: 'desktop', label: 'Desktop', Icon: Monitor },
    { id: 'tablet', label: 'Tablet', Icon: Tablet },
    { id: 'mobile', label: 'Mobile', Icon: Smartphone },
];

const DIM_STYLE: Record<Tab, string> = {
    desktop: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    tablet: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    mobile: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
};

// Category description shown in the picker header area
const CAT_LABEL: Record<Tab, string> = {
    desktop: 'Full desktop design surface',
    tablet: 'Tablet-width mirror — lg: rules collapse',
    mobile: 'Mobile-width mirror — md: + lg: rules collapse',
};

export const FramePicker: React.FC<FramePickerProps> = ({ onAddFrame }) => {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<Tab>('desktop');
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        // Defer to next tick so the button click that opened the panel
        // doesn't immediately trigger the outside-click handler.
        const tid = setTimeout(() => {
            const handler = (e: MouseEvent) => {
                if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                    setOpen(false);
                }
            };
            document.addEventListener('mousedown', handler);
            return () => document.removeEventListener('mousedown', handler);
        }, 0);
        return () => clearTimeout(tid);
    }, [open]);

    const handleAdd = (preset: FramePreset) => {
        onAddFrame(preset);
        setOpen(false);
    };

    return (
        // Fixed to browser viewport — does NOT scroll with canvas transform.
        // left:84px clears the LeftSidebar icon rail (60px) + margin (24px).
        <div
            ref={panelRef}
            style={{ position: 'fixed', bottom: '24px', left: '84px', zIndex: 200 }}
        >
            {open && (
                <div
                    style={{
                        width: '280px',
                        marginBottom: '8px',
                        background: '#1c1c1e',
                        borderRadius: '16px',
                        border: '1px solid rgba(255,255,255,0.08)',
                        boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 24px 64px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.3)',
                        overflow: 'hidden',
                    }}
                >
                    {/* Header */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px 10px',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            Add Frame
                        </span>
                        <button
                            onClick={() => setOpen(false)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#636366', padding: '2px', display: 'flex', alignItems: 'center' }}
                        >
                            <X size={13} />
                        </button>
                    </div>

                    {/* Category description */}
                    <div style={{ padding: '8px 16px 4px' }}>
                        <p style={{ fontSize: '10px', color: '#636366', margin: 0, lineHeight: 1.4 }}>
                            {CAT_LABEL[tab]}
                        </p>
                    </div>

                    {/* Tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', marginTop: '4px' }}>
                        {TABS.map(({ id, label, Icon }) => (
                            <button
                                key={id}
                                onClick={() => setTab(id)}
                                style={{
                                    flex: 1,
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                                    padding: '8px 4px',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: '10px', fontWeight: 600,
                                    color: tab === id ? '#fff' : '#636366',
                                    borderBottom: tab === id ? '2px solid #3b82f6' : '2px solid transparent',
                                    transition: 'color 0.15s',
                                }}
                            >
                                <Icon size={13} strokeWidth={tab === id ? 2 : 1.5} />
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Preset list */}
                    <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                        {PRESETS_BY_CATEGORY[tab].map(preset => (
                            <button
                                key={preset.id}
                                onClick={() => handleAdd(preset)}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 16px',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    transition: 'background 0.1s',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                            >
                                <span style={{ fontSize: '12px', fontWeight: 500, color: '#e5e5ea', textAlign: 'left' }}>
                                    {preset.label}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span className={cn('text-[9px] font-mono px-1.5 py-0.5 rounded border font-bold', DIM_STYLE[tab])}>
                                        {preset.width}×{preset.height}
                                    </span>
                                    <ChevronRight size={11} color="#48484a" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Trigger button */}
            <button
                onClick={() => setOpen(p => !p)}
                style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '7px 12px', borderRadius: '10px',
                    background: open ? '#3b82f6' : 'rgba(28,28,30,0.95)',
                    border: `1px solid ${open ? '#60a5fa' : 'rgba(255,255,255,0.1)'}`,
                    color: open ? '#fff' : '#aeaeb2',
                    fontSize: '11px', fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: open ? '0 4px 16px rgba(59,130,246,0.3)' : '0 2px 8px rgba(0,0,0,0.4)',
                    transition: 'all 0.15s',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                }}
                title="Add device frame"
            >
                <Plus
                    size={13}
                    strokeWidth={2.5}
                    style={{ transition: 'transform 0.15s', transform: open ? 'rotate(45deg)' : 'none' }}
                />
                Frame
            </button>
        </div>
    );
};

/**
 * ─── HOVER CONTEXT ────────────────────────────────────────────────────────────
 * Isolated context for canvas element hover state.
 *
 * WHY SEPARATE FROM UIContext
 * ────────────────────────────
 * hoveredId changes at pointer-move frequency (up to 60fps) as the user moves
 * the mouse across the canvas. When hoveredId lived in UIContext, every UIContext
 * subscriber (all 200 RenderNode instances on a full canvas) re-rendered on every
 * pointer-move frame — 200 × 60 = 12,000 wasted renders/sec.
 *
 * By isolating hoveredId here, only the two nodes that change their hover state
 * re-render on each pointer-move: the node losing the hover ring and the node
 * gaining it. All other RenderNodes stay idle during pointer moves.
 *
 * EXPECTED WIN:
 *   Before: ~12,000 RenderNode.render() calls/sec during canvas mouse movement
 *   After:  ~120 RenderNode.render() calls/sec (only gaining + losing node × 60fps)
 *   ≈ 99% reduction in wasted render work during hover.
 *
 * CONSUMER PATTERN
 * ─────────────────
 * RenderNode calls useHover() for hover ring logic (isHovered, setHoveredId).
 * All other components that don't need hoveredId never subscribe here.
 *
 * PROVIDER PLACEMENT
 * ───────────────────
 * HoverProvider is placed inside UIProvider in App.tsx.
 * HoverContext does not depend on UIContext — mount order is flexible,
 * but wrapping UIProvider's children is the cleanest placement.
 */

import React, { createContext, useContext, useState, type ReactNode } from 'react';

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface HoverContextType {
    hoveredId: string | null;
    setHoveredId: (id: string | null) => void;
}

// ─── CONTEXT ─────────────────────────────────────────────────────────────────

const HoverContext = createContext<HoverContextType | null>(null);

// ─── PROVIDER ────────────────────────────────────────────────────────────────

export const HoverProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    return (
        <HoverContext.Provider value={{ hoveredId, setHoveredId }}>
            {children}
        </HoverContext.Provider>
    );
};

// ─── HOOK ─────────────────────────────────────────────────────────────────────

export const useHover = (): HoverContextType => {
    const ctx = useContext(HoverContext);
    if (!ctx) throw new Error('useHover must be used within HoverProvider');
    return ctx;
};

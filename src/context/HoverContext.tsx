/**
 * --- HOVER CONTEXT ----------------------------------------------------------
 * Isolated React context for canvas element hover state (hoveredId).
 *
 * Kept separate from UIContext so that pointer-move events (up to 60fps)
 * only cause the two nodes changing hover state to re-render, not all
 * RenderNode instances. Components that don't need hover state never subscribe.
 *
 * Usage: call useHover() in any component that renders hover rings.
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

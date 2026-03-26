// Resizer subscribes directly to ProjectContext and UIContext (not the full EditorContext bridge)
// to keep its re-render scope minimal during 60fps resize interactions.
import React, { useRef } from 'react';
import { useProject } from '../../context/ProjectContext';
import { useUI } from '../../context/UIContext';

interface ResizerProps {
    elementId: string;
}

export const Resizer: React.FC<ResizerProps> = ({ elementId }) => {
    const { elements, updateProject, pushHistory, elementsRef } = useProject();
    // zoomRef (not zoom state) — reading zoom in a pointer handler avoids 60fps re-renders during wheel zoom.
    const { setInteraction, zoomRef, device } = useUI();
    const element = elements[elementId];

    // corner-radius drag state. Same ref pattern as ArtboardResizeHandle — avoids closure over stale React state. skipHistory:true at 60fps, pushHistory ONCE on pointerUp
    const radiusDrag = useRef<{ startX: number; startRadius: number } | null>(null);

    if (!element) return null;

    // --- SMART CONSTRAINT ANALYSIS ---
    const classes = element.props.className || '';

    // Check horizontal constraints (Width locked = no horizontal resize)
    const isWidthLocked = classes.includes('w-full') || classes.includes('w-fit') || classes.includes('w-screen') || classes.includes('flex-1');

    // Check vertical constraints (Height locked = no vertical resize)
    const isHeightLocked = classes.includes('h-full') || classes.includes('h-fit') || classes.includes('h-screen');

    const startResize = (e: React.PointerEvent, handle: string) => {
        e.stopPropagation();
        e.preventDefault();

        e.currentTarget.setPointerCapture(e.pointerId);

        const parent = e.currentTarget.parentElement;
        if (!parent) return;

        const domRect = parent.getBoundingClientRect();

        // Read merged style (base + active breakpoint) so resize starts from the element's visual position, not its base position.
        const baseStyle = element.props.style || {};
        const bpOverride = device !== 'desktop'
            ? (element.props.breakpoints?.[device as 'mobile' | 'tablet'] || {})
            : {};
        const rect = {
            left: parseFloat(String(bpOverride.left ?? baseStyle.left ?? '0')),
            top: parseFloat(String(bpOverride.top ?? baseStyle.top ?? '0')),
            width: domRect.width / zoomRef.current,
            height: domRect.height / zoomRef.current,
        };

        setInteraction({
            type: 'RESIZE',
            itemId: elementId,
            startX: e.clientX,
            startY: e.clientY,
            startRect: rect,
            handle
        });
    };

    // VISUAL STYLE FOR HANDLES
    // Increased size from w-2.5 (10px) to w-4 (16px) for better clickability
    const handleStyle = "absolute w-4 h-4 bg-white border-2 border-blue-600 rounded-full z-50 shadow-md hover:scale-125 transition-transform hover:bg-blue-50";

    // only show radius handle for non-artboard, non-text nodes.
    // Text nodes rarely need border-radius and it clutters the editing experience.
    const isArtboard = element.type === 'canvas' || element.type === 'webpage';
    const isTextNode = ['text', 'heading', 'link'].includes(element.type);
    const showRadiusHandle = !isArtboard && !isTextNode;

    const startRadiusDrag = (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const style = element.props.style || {};
        const currentRadius = parseFloat(String(style.borderRadius ?? '0')) || 0;
        radiusDrag.current = { startX: e.clientX, startRadius: currentRadius };
    };

    const onRadiusPointerMove = (e: React.PointerEvent) => {
        if (!radiusDrag.current) return;
        // Drag right → larger radius, drag left → smaller. Divide by zoom.
        const delta = (e.clientX - radiusDrag.current.startX) / zoomRef.current;
        const newRadius = Math.max(0, Math.min(
            Math.round(radiusDrag.current.startRadius + delta),
            999
        ));
        // C-1/spread-clone at every level
        updateProject({
            ...elementsRef.current,
            [elementId]: {
                ...element,
                props: {
                    ...element.props,
                    style: { ...element.props.style, borderRadius: `${newRadius}px` },
                },
            },
        }, { skipHistory: true }); // no history during motion
    };

    const onRadiusPointerUp = (e: React.PointerEvent) => {
        if (!radiusDrag.current) return;
        radiusDrag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        // commit ONE history entry on release — reads live ref (H-4)
        pushHistory(elementsRef.current);
    };

    // Adjusted offsets from -1.5 (6px) to -2 (8px) to keep the larger handles centered
    return (
        <>
            {/* --- CORNERS (Only if BOTH dimensions are free) --- */}
            {!isWidthLocked && !isHeightLocked && (
                <>
                    <div className={`${handleStyle} -bottom-2 -right-2 cursor-nwse-resize`} onPointerDown={(e) => startResize(e, 'se')} />
                    <div className={`${handleStyle} -bottom-2 -left-2 cursor-nesw-resize`} onPointerDown={(e) => startResize(e, 'sw')} />
                    <div className={`${handleStyle} -top-2 -right-2 cursor-nesw-resize`} onPointerDown={(e) => startResize(e, 'ne')} />
                    <div className={`${handleStyle} -top-2 -left-2 cursor-nwse-resize`} onPointerDown={(e) => startResize(e, 'nw')} />
                </>
            )}

            {/* --- EDGES (Conditional) --- */}

            {/* Width Handles (Only if width is NOT locked) */}
            {!isWidthLocked && (
                <>
                    <div className={`${handleStyle} top-1/2 -right-2 -translate-y-1/2 cursor-ew-resize`} onPointerDown={(e) => startResize(e, 'e')} />
                    <div className={`${handleStyle} top-1/2 -left-2 -translate-y-1/2 cursor-ew-resize`} onPointerDown={(e) => startResize(e, 'w')} />
                </>
            )}

            {/* Height Handles (Only if height is NOT locked) */}
            {!isHeightLocked && (
                <>
                    <div className={`${handleStyle} -bottom-2 left-1/2 -translate-x-1/2 cursor-ns-resize`} onPointerDown={(e) => startResize(e, 's')} />
                    <div className={`${handleStyle} -top-2 left-1/2 -translate-x-1/2 cursor-n-resize`} onPointerDown={(e) => startResize(e, 'n')} />
                </>
            )}

            {/* Amber corner-radius handle at top-right. Drag left/right to adjust borderRadius. */}
            {showRadiusHandle && (
                <div
                    title={`Border radius: ${parseFloat(String(element.props.style?.borderRadius ?? '0')) || 0}px — drag to adjust`}
                    className="absolute z-60 w-3.5 h-3.5 bg-amber-400 border-2 border-amber-600 rounded-full shadow-md cursor-ew-resize hover:scale-125 transition-transform hover:bg-amber-300 pointer-events-auto"
                    style={{ top: '-10px', right: '-30px' }}
                    onPointerDown={startRadiusDrag}
                    onPointerMove={onRadiusPointerMove}
                    onPointerUp={onRadiusPointerUp}
                >
                    {/* Tiny arc icon suggesting a rounded corner */}
                    <svg
                        viewBox="0 0 8 8"
                        className="absolute inset-0.5 w-2.5 h-2.5 opacity-60 pointer-events-none"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                    >
                        <path d="M1 6 Q1 1 6 1" className="text-amber-900" />
                    </svg>
                </div>
            )}
        </>
    );
};

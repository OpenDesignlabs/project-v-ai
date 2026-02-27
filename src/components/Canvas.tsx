import React, { useEffect, useState, useRef } from 'react';
import { useProject } from '../context/ProjectContext';
import { useUI } from '../context/UIContext';
import { useEditor } from '../context/EditorContext'; // for handleInteractionMove + componentRegistry (assembled bridge)
import { RenderNode } from './RenderNode';
import { ContainerPreview } from './ContainerPreview';
import { TEMPLATES } from '../data/templates';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';

/**
 * ─── CANVAS ────────────────────────────────────────────────────────────────────
 * Split into three context subscriptions to minimise re-renders:
 *
 *  useProject()  → elements, updateProject, activePageId, instantiateTemplate
 *                  Only re-renders when the document tree mutates.
 *
 *  useUI()       → zoom, pan, isPanning, guides, drag, selection, panels
 *                  Re-renders on every wheel / pointer-move event, but these
 *                  are now isolated to Canvas — Sidebar/Header stay idle.
 *
 *  useEditor()   → handleInteractionMove, componentRegistry
 *                  Assembled bridge that combines both — read-only bridge values.
 */
export const Canvas = () => {
    // ── Slow-changing project data ─────────────────────────────────────────────
    const {
        elements, updateProject, activePageId, instantiateTemplate, history,
    } = useProject();

    // ── High-frequency viewport + UI state ────────────────────────────────────
    // These values update 60 fps during pan/zoom. Isolating them here means
    // Sidebar, Header and PropertyPanel never re-render on pointer move.
    const {
        zoom, setZoom,
        pan, setPan,
        isPanning, setIsPanning,
        guides,
        previewMode,
        dragData, setDragData,
        selectedId: _sid, setSelectedId,
        interaction, setInteraction: _si,
        isInsertDrawerOpen, toggleInsertDrawer,
        savePageViewport,
        restorePageViewport,
    } = useUI();

    // ── Assembled bridge values (componentRegistry merges static + dynamic) ───
    const { handleInteractionMove, handleInteractionEnd, componentRegistry } = useEditor();

    const canvasRef = useRef<HTMLDivElement>(null);
    const [spacePressed, setSpacePressed] = useState(false);

    // ── 1. WHEEL — zoom & pan ─────────────────────────────────────────────────
    // Isolated to Canvas. Only Canvas re-renders on wheel events.
    useEffect(() => {
        const onWheel = (e: WheelEvent) => {
            if (previewMode) return;
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const newZoom = Math.min(Math.max(zoom + -e.deltaY * 0.002, 0.1), 3);
                setZoom(newZoom);
            } else {
                setPan(prev => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
            }
        };
        const el = canvasRef.current;
        if (el) el.addEventListener('wheel', onWheel, { passive: false });
        return () => el?.removeEventListener('wheel', onWheel);
    }, [zoom, previewMode, setZoom, setPan]);

    // ── Direction 3: Per-page viewport save/restore ───────────────────────────
    // Listens for the 'vectra:page-switching' CustomEvent dispatched by
    // ProjectContext.switchPage() just BEFORE activePageId changes.
    //
    // TIMING GUARANTEE
    // ────────────────
    // The event fires synchronously in switchPage() before setActivePageId().
    // React batches the setActivePageId() state update for the next render.
    // This means when our handler runs, selectedId/pan/zoom still hold the
    // DEPARTING page's values — exactly what we want to save.
    //
    // After saving, we immediately restore the incoming page's viewport so
    // that when React re-renders (after setActivePageId flushes), the canvas
    // starts at the correct position/zoom for the new page.
    useEffect(() => {
        const handler = (e: Event) => {
            const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail;
            if (from === to) return; // guard: switching to same page is a no-op

            // Save departing page viewport
            savePageViewport(from);

            // Restore arriving page viewport (or clean slate if first visit)
            restorePageViewport(to);
        };

        window.addEventListener('vectra:page-switching', handler);
        return () => window.removeEventListener('vectra:page-switching', handler);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // savePageViewport and restorePageViewport are stable ([] dep in UIContext).
    // This effect attaches exactly once on mount and detaches on unmount.
    // Zero listener churn during 60fps pan/zoom. (Item 0 fix)
    // ── End Direction 3 ───────────────────────────────────────────────────────

    // ── 2. KEYBOARD — spacebar panning ────────────────────────────────────────
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !e.repeat && !previewMode) { setSpacePressed(true); setIsPanning(true); }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') { setSpacePressed(false); setIsPanning(false); }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [previewMode, setIsPanning]);

    // ── 3. POINTER — drag, pan, resize/move interactions ─────────────────────
    // handleInteractionMove reads elements + zoom from respective contexts
    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (isPanning && !previewMode) setPan(p => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
            if (interaction) handleInteractionMove(e);
        };
        const onUp = () => {
            if (interaction) {
                // Commit one history entry for the whole drag, then clear state
                handleInteractionEnd();
            }
            if (!spacePressed) setIsPanning(false);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [isPanning, interaction, handleInteractionMove, handleInteractionEnd, setPan, setIsPanning, spacePressed, previewMode]);

    // ── 4. DROP — element creation from sidebar drag ──────────────────────────
    const handleGlobalDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (!dragData || previewMode) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const worldX = (e.clientX - rect.left - pan.x) / zoom;
        const worldY = (e.clientY - rect.top - pan.y) / zoom;

        // ── Data binding drop ───────────────────────────────────────────────
        if (dragData.type === 'DATA_BINDING') {
            const candidates = Object.values(elements)
                .filter(el => {
                    const style = el.props.style;
                    if (!style || !style.left || !style.top) return false;
                    const x = parseFloat(String(style.left));
                    const y = parseFloat(String(style.top));
                    const w = parseFloat(String(style.width)) || 100;
                    const h = parseFloat(String(style.height)) || 50;
                    return worldX >= x && worldX <= x + w && worldY >= y && worldY <= y + h;
                })
                .sort((a, b) => (Number(b.props.style?.zIndex) || 0) - (Number(a.props.style?.zIndex) || 0));

            if (candidates.length > 0) {
                const targetId = candidates[0].id;
                const newProject = { ...elements };
                newProject[targetId] = { ...newProject[targetId], content: `{{${dragData.payload}}}` };
                updateProject(newProject);
                setDragData(null);
                setSelectedId(targetId);
                return;
            }
        }

        let newNodes: Record<string, any> = {};
        let newRootId = '';
        let w = 0, h = 0;

        if (dragData.type === 'TEMPLATE') {
            const tpl = TEMPLATES[dragData.payload];
            if (!tpl) return;
            const res = instantiateTemplate(tpl.rootId, tpl.nodes);
            newNodes = res.newNodes; newRootId = res.rootId;
            w = parseFloat(String(newNodes[newRootId].props.style?.width || 0));
            h = parseFloat(String(newNodes[newRootId].props.style?.height || 0));
        } else if (dragData.type === 'ICON') {
            newRootId = `icon-${Date.now()}`;
            w = 48; h = 48;
            newNodes[newRootId] = {
                id: newRootId, type: 'icon', name: 'Icon', children: [],
                props: { iconName: dragData.meta?.iconName, style: { width: '48px', height: '48px' }, className: 'text-blue-500' }
            };
        } else if (dragData.type === 'ASSET_IMAGE' || (dragData.type === 'NEW' && dragData.payload === 'image')) {
            newRootId = `img-${Date.now()}`;
            w = 300; h = 200;
            const src = dragData.type === 'ASSET_IMAGE'
                ? dragData.payload
                : (componentRegistry['image']?.src || 'https://via.placeholder.com/400x300');
            newNodes[newRootId] = {
                id: newRootId, type: 'image', name: 'Image', children: [],
                props: { style: { width: '300px', height: '200px', borderRadius: '8px' }, className: 'object-cover' },
                src
            };
        } else if (dragData.type === 'NEW') {
            const conf = componentRegistry[dragData.payload];
            if (!conf) return;
            newRootId = `el-${Date.now()}`;
            w = dragData.payload === 'webpage' ? 1440 : 200;
            h = dragData.payload === 'webpage' ? 1080 : 100;
            newNodes[newRootId] = {
                id: newRootId, type: dragData.payload, name: conf.label, children: [],
                props: {
                    ...conf.defaultProps,
                    style: {
                        ...conf.defaultProps?.style,
                        width: `${w}px`,
                        height: dragData.payload === 'webpage' ? 'auto' : `${h}px`,
                        ...(dragData.payload === 'webpage' ? { minHeight: `${h}px` } : {}),
                    }
                },
                content: conf.defaultContent, src: conf.src
            };
        }

        if (newNodes[newRootId]) {
            newNodes[newRootId].props.style = {
                ...newNodes[newRootId].props.style,
                position: 'absolute',
                left: `${Math.round(worldX - w / 2)}px`,
                top: `${Math.round(worldY - h / 2)}px`,
            };

            const newProject = { ...elements, ...newNodes };
            if (newProject[activePageId]) {
                newProject[activePageId].children = [...(newProject[activePageId].children || []), newRootId];
            }
            updateProject(newProject);
            setSelectedId(newRootId);
        }

        setDragData(null);
    };

    // ── 5. RENDER ─────────────────────────────────────────────────────────────
    return (
        <div
            ref={canvasRef}
            className="flex-1 bg-[#1e1e1e] relative overflow-hidden cursor-default select-none"
            style={{ cursor: isPanning || spacePressed ? 'grab' : 'default' }}
            onMouseDown={() => {
                setSelectedId(null);
                // Auto-collapse Insert Drawer when clicking canvas background
                if (isInsertDrawerOpen) toggleInsertDrawer();
            }}
            onDrop={handleGlobalDrop}
            onDragOver={(e) => e.preventDefault()}
        >
            {previewMode ? (
                // ── Full-screen preview overlay ───────────────────────────────
                <div className="absolute inset-0 z-[100] bg-black">
                    <ContainerPreview />
                </div>
            ) : (
                // ── Transformed canvas world ──────────────────────────────────
                <div
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: 'top left',
                        width: '100%',
                        minHeight: '100%',
                        display: 'flex',
                        justifyContent: 'center',
                        paddingTop: '40px',
                        paddingBottom: '400px',
                    }}
                >
                    {/* Artboard — grows with content */}
                    <CanvasErrorBoundary onUndo={history.undo}>
                        <div style={{ width: '100%', maxWidth: '1440px', minHeight: '100vh', height: 'auto', display: 'flex', flexDirection: 'column' }}>
                            <RenderNode elementId={activePageId} key={`editor-${activePageId}`} />
                        </div>
                    </CanvasErrorBoundary>

                    {/* Smart snap guides */}
                    {guides.map((g, i) => (
                        <div key={i} className="absolute bg-red-500 z-[9999]" style={{
                            left: g.orientation === 'vertical' ? g.pos : g.start,
                            top: g.orientation === 'vertical' ? g.start : g.pos,
                            width: g.orientation === 'vertical' ? '1px' : (g.end - g.start),
                            height: g.orientation === 'vertical' ? (g.end - g.start) : '1px',
                        }} />
                    ))}
                </div>
            )}
        </div>
    );
};

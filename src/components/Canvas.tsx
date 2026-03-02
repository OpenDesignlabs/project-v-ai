import React, { useEffect, useState, useRef } from 'react';
import { useProject } from '../context/ProjectContext';
import { useUI } from '../context/UIContext';
import { useEditor } from '../context/EditorContext';
import { RenderNode } from './RenderNode';
import { ContainerPreview } from './ContainerPreview';
import { TEMPLATES } from '../data/templates';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';

// ── Item 3: ArtboardResizeHandle ─────────────────────────────────────────────────────────
// An 8px invisible hit-target at the bottom edge of each artboard frame.
// Dragging it live-updates height + minHeight and commits one history entry on release.
// Lives in the canvas world coordinate space — no coordinate transform needed.
// M-2 FIX: React.memo — ArtboardResizeHandle re-rendered on every Canvas state change
// (pan, zoom, box-select rect). On a 3-artboard project: 3×60 = 180 wasted renders/sec
// during wheel gestures. Memoize — only re-render when frameId or zoom changes.
const ArtboardResizeHandle = React.memo<{ frameId: string; zoom: number }>(({ frameId, zoom }) => {
    const { elements, updateProject, pushHistory, elementsRef } = useProject();
    const frame = elements[frameId];
    if (!frame) return null;

    const s = (frame.props?.style || {}) as Record<string, any>;
    const frameLeft = parseFloat(String(s.left ?? '0'));
    const frameTop = parseFloat(String(s.top ?? '0'));
    const frameWidth = parseFloat(String(s.width ?? '1440'));
    const frameHeight = parseFloat(String(s.height ?? s.minHeight ?? '900'));

    const dragState = useRef<{ startY: number; startH: number } | null>(null);

    const onPointerDown = (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragState.current = { startY: e.clientY, startH: frameHeight };
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragState.current) return;
        const delta = (e.clientY - dragState.current.startY) / zoom;
        const newH = Math.max(200, Math.round(dragState.current.startH + delta));
        updateProject({
            ...elements,
            [frameId]: {
                ...frame,
                props: { ...frame.props, style: { ...frame.props.style, height: `${newH}px`, minHeight: `${newH}px` } },
            },
        }, true); // skipHistory=true at 60fps
    };
    const onPointerUp = (e: React.PointerEvent) => {
        if (!dragState.current) return;
        dragState.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        // NM-3 FIX: read elementsRef.current, not the closed-over elements state.
        // onPointerUp fires in the same event flush as the last onPointerMove —
        // elements in the closure is the render snapshot from BEFORE pointerUp,
        // which may be one frame behind the committed drag state.
        setTimeout(() => pushHistory(elementsRef.current), 0);
    };

    return (
        <div
            title="Drag to resize artboard height"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
                position: 'absolute',
                left: `${frameLeft}px`,
                top: `${frameTop + frameHeight - 4}px`,
                width: `${frameWidth}px`,
                height: '8px',
                cursor: 'ns-resize',
                zIndex: 9998,
            }}
            className="group"
        >
            <div className="absolute inset-x-0 top-[3px] h-[2px] bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity rounded-full" />
        </div>
    );
});

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
        // Item 2 — multi-select
        clearSelection, addToSelection,
    } = useUI();

    // ── Assembled bridge values (componentRegistry merges static + dynamic) ───
    const { handleInteractionMove, handleInteractionEnd, componentRegistry } = useEditor();

    const canvasRef = useRef<HTMLDivElement>(null);
    const [spacePressed, setSpacePressed] = useState(false);
    // NH-1 FIX: mirror zoom into a ref so the wheel handler reads the current value
    // without having zoom in its dep array. zoom in deps → listener torn down + re-attached
    // on every setZoom call → 60fps teardown → one-frame gap where e.preventDefault() drops
    // → browser scrolls page body instead of zooming canvas (especially bad on Safari).
    const zoomRef = useRef(zoom);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);
    // Item 2 — box-select state
    const boxSelectRef = useRef<{ active: boolean; startX: number; startY: number; worldStartX: number; worldStartY: number } | null>(null);
    const [boxSelectRect, setBoxSelectRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

    // ── 1. WHEEL — zoom & pan ─────────────────────────────────────────────────
    // Isolated to Canvas. Only Canvas re-renders on wheel events.
    useEffect(() => {
        const onWheel = (e: WheelEvent) => {
            if (previewMode) return;
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                // NH-1 FIX: read from zoomRef — never from closed-over zoom state.
                const newZoom = Math.min(Math.max(zoomRef.current + -e.deltaY * 0.002, 0.1), 3);
                setZoom(newZoom);
            } else {
                setPan(prev => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
            }
        };
        const el = canvasRef.current;
        if (el) el.addEventListener('wheel', onWheel, { passive: false });
        return () => el?.removeEventListener('wheel', onWheel);
    }, [previewMode, setZoom, setPan]); // zoom removed — read via zoomRef.current

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

    // ── ITEM B: Zoom to Fit (⌘0 / Ctrl+0) + CustomEvent ───────────────────────
    useEffect(() => {
        const handleZoomToFit = () => {
            if (previewMode) return;
            const pageRoot = elements[activePageId];
            if (!pageRoot || !pageRoot.children) return;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let hasWebpage = false;

            pageRoot.children.forEach(cid => {
                const child = elements[cid];
                if (child?.type === 'webpage') {
                    hasWebpage = true;
                    const s = (child.props?.style || {}) as Record<string, string>;
                    const x = parseFloat(s.left || '0');
                    const y = parseFloat(s.top || '0');
                    const w = parseFloat(s.width || '1440');
                    const h = parseFloat(s.height || '900');
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x + w > maxX) maxX = x + w;
                    if (y + h > maxY) maxY = y + h;
                }
            });

            if (!hasWebpage) return;

            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            const targetW = maxX - minX;
            const targetH = maxY - minY;
            const padding = 80;

            const scaleX = (rect.width - padding * 2) / Math.max(targetW, 1);
            const scaleY = (rect.height - padding * 2) / Math.max(targetH, 1);
            const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 3);

            const centerX = minX + targetW / 2;
            const centerY = minY + targetH / 2;

            setZoom(newZoom);
            setPan({
                x: rect.width / 2 - centerX * newZoom,
                y: rect.height / 2 - centerY * newZoom
            });
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                e.preventDefault();
                handleZoomToFit();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('vectra:zoom-to-fit', handleZoomToFit);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('vectra:zoom-to-fit', handleZoomToFit);
        };
    }, [elements, activePageId, previewMode, setZoom, setPan]);

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
            // C-3 FIX: scope candidate search to active-page descendants only.
            // Object.values(elements) spans ALL pages — elements from other pages
            // share the same world coordinate space (same left/top values) and
            // produce false-positive hits, silently writing {{binding}} to an
            // off-page element the user cannot see.
            const pageDescendants = new Set<string>();
            const walkForBinding = (id: string) => {
                if (pageDescendants.has(id)) return; // cycle-guard
                pageDescendants.add(id);
                (elements[id]?.children || []).forEach(walkForBinding);
            };
            walkForBinding(activePageId);

            const candidates = Object.values(elements)
                .filter(el => {
                    if (!pageDescendants.has(el.id)) return false; // active page only
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
            // NM-6 FIX: crypto.randomUUID() — Date.now() collides on same-ms drops
            newRootId = `icon-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            w = 48; h = 48;
            newNodes[newRootId] = {
                id: newRootId, type: 'icon', name: 'Icon', children: [],
                props: { iconName: dragData.meta?.iconName, style: { width: '48px', height: '48px' }, className: 'text-blue-500' }
            };
        } else if (dragData.type === 'ASSET_IMAGE' || (dragData.type === 'NEW' && dragData.payload === 'image')) {
            newRootId = `img-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
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
            newRootId = `el-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
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
                // NS-2 FIX: newProject[activePageId] is the same object reference as
                // elements[activePageId] when activePageId was NOT modified in newNodes.
                // Writing .children directly mutates live React state — C-1 class bug.
                // Clone the node immutably before appending the new child.
                newProject[activePageId] = {
                    ...newProject[activePageId],
                    children: [...(newProject[activePageId].children || []), newRootId],
                };
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
            onMouseDown={(e) => {
                // Middle-button / space-pan — pass through to existing pan logic
                if (isPanning || spacePressed || e.button !== 0) {
                    setSelectedId(null);
                    if (isInsertDrawerOpen) toggleInsertDrawer();
                    return;
                }
                if (isInsertDrawerOpen) toggleInsertDrawer();
                // Start box-select
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) { setSelectedId(null); return; }
                const worldX = (e.clientX - rect.left - pan.x) / zoom;
                const worldY = (e.clientY - rect.top - pan.y) / zoom;
                boxSelectRef.current = { active: true, startX: e.clientX, startY: e.clientY, worldStartX: worldX, worldStartY: worldY };
                clearSelection();
                setBoxSelectRect(null);
            }}
            onMouseMove={(e) => {
                if (!boxSelectRef.current?.active) return;
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return;
                const rawX = Math.min(e.clientX, boxSelectRef.current.startX) - rect.left;
                const rawY = Math.min(e.clientY, boxSelectRef.current.startY) - rect.top;
                const rawW = Math.abs(e.clientX - boxSelectRef.current.startX);
                const rawH = Math.abs(e.clientY - boxSelectRef.current.startY);
                // Only show after 5px movement — avoids ghost rect on plain clicks
                if (rawW < 5 && rawH < 5) return;
                setBoxSelectRect({ x: rawX, y: rawY, w: rawW, h: rawH });
            }}
            onMouseUp={(e) => {
                if (!boxSelectRef.current?.active) return;
                const bs = boxSelectRef.current;
                boxSelectRef.current = null;
                if (!boxSelectRect) { setBoxSelectRect(null); return; }
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) { setBoxSelectRect(null); return; }
                const worldEndX = (e.clientX - rect.left - pan.x) / zoom;
                const worldEndY = (e.clientY - rect.top - pan.y) / zoom;
                const selMinX = Math.min(bs.worldStartX, worldEndX);
                const selMaxX = Math.max(bs.worldStartX, worldEndX);
                const selMinY = Math.min(bs.worldStartY, worldEndY);
                const selMaxY = Math.max(bs.worldStartY, worldEndY);
                // M-4 FIX: walk the entire visible subtree — not just top-level children.
                // The original flat filter missed absolutely-positioned nodes inside containers.
                const collectAbsoluteNodes = (ids: string[]): string[] => {
                    const result: string[] = [];
                    for (const id of ids) {
                        const node = elements[id];
                        if (!node) continue;
                        if (node.props?.style && (node.props.style as any).position === 'absolute') {
                            result.push(id);
                        }
                        if (node.children?.length) result.push(...collectAbsoluteNodes(node.children));
                    }
                    return result;
                };
                const pageRoot = elements[activePageId];
                const allCandidates = collectAbsoluteNodes(pageRoot?.children || []);
                const hits = allCandidates.filter(cid => {
                    const el = elements[cid];
                    const st = el?.props?.style as Record<string, any> | undefined;
                    if (!st) return false;
                    const l = parseFloat(String(st.left ?? '0'));
                    const t = parseFloat(String(st.top ?? '0'));
                    const w = parseFloat(String(st.width ?? '0'));
                    const h = parseFloat(String(st.height ?? '0'));
                    return l < selMaxX && l + w > selMinX && t < selMaxY && t + h > selMinY;
                });
                if (hits.length > 0) { hits.forEach(id => addToSelection(id)); }
                setBoxSelectRect(null);
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
                        <div style={{ width: '100%', maxWidth: '1440px', minHeight: '100vh', height: 'auto', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                            <RenderNode elementId={activePageId} key={`editor-${activePageId}`} />
                            {/* Item 3: per-frame resize handles */}
                            {(elements[activePageId]?.children || []).map(cid => {
                                const t = elements[cid]?.type;
                                if (t !== 'webpage' && t !== 'canvas') return null;
                                return <ArtboardResizeHandle key={`arh-${cid}`} frameId={cid} zoom={zoom} />;
                            })}
                        </div>
                    </CanvasErrorBoundary>

                    {/* Snap guides */}
                    {guides.map((g, i) => (
                        <div key={i} className="absolute bg-red-500 z-[9999]" style={{
                            left: g.orientation === 'vertical' ? g.pos : g.start,
                            top: g.orientation === 'vertical' ? g.start : g.pos,
                            width: g.orientation === 'vertical' ? '1px' : (g.end - g.start),
                            height: g.orientation === 'vertical' ? (g.end - g.start) : '1px',
                        }} />
                    ))}
                    {/* Item 2: Box-select rectangle */}
                    {boxSelectRect && (
                        <div
                            className="absolute pointer-events-none z-[9999] border border-blue-500 bg-blue-500/10"
                            style={{ left: boxSelectRect.x, top: boxSelectRect.y, width: boxSelectRect.w, height: boxSelectRect.h }}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

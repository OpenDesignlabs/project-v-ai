import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useProject } from '../../context/ProjectContext';
import { useUI } from '../../context/UIContext';
import { useEditor } from '../../context/EditorContext';
import { RenderNode } from './RenderNode';
import { ContainerPreview } from './ContainerPreview';
import { FramePicker } from './FramePicker';
import { TEMPLATES } from '../../data/templates';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import { Copy, Trash2 } from 'lucide-react';

// Invisible 8px drag handle at the bottom of each artboard frame. Memoized — only re-renders when frameId or zoom changes.
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
        // Read from elementsRef (not closed-over state) — pointerUp fires in same flush as last pointermove, closure may be one frame stale.
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

// ─── FLOATING SELECTION TOOLBAR ──────────────────────────────────────────────
// TOOLBAR-1 [PERMANENT]: Fixed position — OUTSIDE the world transform div so it
// never scales with zoom. Position derived from getBoundingClientRect().
// Hidden: during interaction (drag/resize), in previewMode, for artboards, nothing selected.

const TOOLBAR_H = 36;
const TOOLBAR_GAP = 8;

const SingleNodeToolbar: React.FC<{
    elementId: string;
    nodeEl: HTMLElement | null;
}> = ({ elementId, nodeEl }) => {
    const { deleteElement, duplicateElement } = useEditor();
    const { clearSelection } = useUI();
    // Artboard-type guard — we need elements for this check
    const { elements } = useProject();
    const element = elements[elementId];

    if (!nodeEl || !element) return null;
    // Never show toolbar on artboard root nodes
    if (element.type === 'canvas' || element.type === 'webpage' || element.type === 'artboard') return null;
    const rect = nodeEl.getBoundingClientRect();
    const toolbarY = rect.top - TOOLBAR_H - TOOLBAR_GAP;
    if (toolbarY < 4) return null; // would clip above viewport

    const Divider = () => <div className="w-px h-4 bg-white/10 shrink-0 mx-0.5" />;

    return (
        <div
            className="fixed z-[10001] pointer-events-auto"
            style={{ left: Math.max(8, rect.left), top: toolbarY }}
        >
            <div className="flex items-center gap-0.5 bg-[#1a1a1c]/95 border border-white/[0.09] rounded-xl px-1.5 py-1 shadow-2xl shadow-black/60 backdrop-blur-sm">
                {/* Duplicate */}
                <button
                    title="Duplicate (Cmd+D)"
                    onClick={() => duplicateElement(elementId)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-all select-none"
                >
                    <Copy size={12} /><span>Duplicate</span>
                </button>
                <Divider />
                {/* Delete */}
                <button
                    title="Delete"
                    onClick={() => { deleteElement(elementId); clearSelection(); }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-all select-none"
                >
                    <Trash2 size={12} /><span>Delete</span>
                </button>
            </div>
        </div>
    );
};

// Multi-select align + distribute bar (shown when 2+ nodes selected)
const AlignDistributeBar: React.FC<{
    selectedIds: Set<string>;
    bboxEl: HTMLElement | null;
}> = ({ selectedIds, bboxEl }) => {
    const { elements, updateProject, pushHistory, elementsRef } = useProject();

    if (!bboxEl || selectedIds.size < 2) return null;
    const rect = bboxEl.getBoundingClientRect();
    const toolbarY = rect.top - TOOLBAR_H - TOOLBAR_GAP;
    if (toolbarY < 4) return null;

    const getBBox = () => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selectedIds.forEach(id => {
            const el = elements[id];
            if (!el?.props?.style) return;
            const s = el.props.style as Record<string, any>;
            const l = parseFloat(String(s.left ?? '0'));
            const t = parseFloat(String(s.top  ?? '0'));
            const w = parseFloat(String(s.width ?? '0'));
            const h = parseFloat(String(s.height ?? s.minHeight ?? '0'));
            minX = Math.min(minX, l); minY = Math.min(minY, t);
            maxX = Math.max(maxX, l + w); maxY = Math.max(maxY, t + h);
        });
        return { minX, minY, maxX, maxY };
    };

    const align = (axis: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
        const { minX, minY, maxX, maxY } = getBBox();
        const cur = elementsRef.current;
        const updates: Record<string, any> = { ...cur };
        selectedIds.forEach(id => {
            const el = cur[id];
            if (!el?.props?.style) return;
            const s = el.props.style as Record<string, any>;
            const w = parseFloat(String(s.width ?? '0'));
            const h = parseFloat(String(s.height ?? s.minHeight ?? '0'));
            let newLeft = parseFloat(String(s.left ?? '0'));
            let newTop  = parseFloat(String(s.top  ?? '0'));
            if (axis === 'left')    newLeft = minX;
            if (axis === 'centerH') newLeft = minX + (maxX - minX) / 2 - w / 2;
            if (axis === 'right')   newLeft = maxX - w;
            if (axis === 'top')     newTop  = minY;
            if (axis === 'centerV') newTop  = minY + (maxY - minY) / 2 - h / 2;
            if (axis === 'bottom')  newTop  = maxY - h;
            updates[id] = { ...el, props: { ...el.props, style: { ...el.props.style,
                left: `${Math.round(newLeft)}px`, top: `${Math.round(newTop)}px` } } };
        });
        updateProject(updates);
        pushHistory(updates);
    };

    const distribute = (dir: 'h' | 'v') => {
        const cur = elementsRef.current;
        const ids = [...selectedIds].filter(id => cur[id]?.props?.style);
        if (ids.length < 3) return;
        ids.sort((a, b) => {
            const sa = cur[a]!.props.style as Record<string, any>;
            const sb = cur[b]!.props.style as Record<string, any>;
            return dir === 'h'
                ? parseFloat(String(sa.left ?? '0')) - parseFloat(String(sb.left ?? '0'))
                : parseFloat(String(sa.top  ?? '0')) - parseFloat(String(sb.top  ?? '0'));
        });
        const first = cur[ids[0]]!.props.style as Record<string, any>;
        const last  = cur[ids[ids.length - 1]]!.props.style as Record<string, any>;
        const startPos  = parseFloat(String(dir === 'h' ? first.left : first.top ?? '0'));
        const endExtent = parseFloat(String(dir === 'h' ? last.left : last.top ?? '0'))
                        + parseFloat(String(dir === 'h' ? (last.width ?? '0') : (last.height ?? last.minHeight ?? '0')));
        const totalSize = ids.reduce((sum, id) => {
            const s = cur[id]!.props.style as Record<string, any>;
            return sum + parseFloat(String(dir === 'h' ? (s.width ?? '0') : (s.height ?? s.minHeight ?? '0')));
        }, 0);
        const gap = (endExtent - startPos - totalSize) / (ids.length - 1);
        let cursor = startPos;
        const updates: Record<string, any> = { ...cur };
        ids.forEach(id => {
            const el = cur[id]!;
            const s = el.props.style as Record<string, any>;
            const sz = parseFloat(String(dir === 'h' ? (s.width ?? '0') : (s.height ?? s.minHeight ?? '0')));
            updates[id] = { ...el, props: { ...el.props, style: { ...el.props.style,
                ...(dir === 'h' ? { left: `${Math.round(cursor)}px` } : { top: `${Math.round(cursor)}px` }),
            }}};
            cursor += sz + gap;
        });
        updateProject(updates);
        pushHistory(updates);
    };

    type ABtnDef = { icon: React.ReactNode; action: () => void; title: string };
    const btns: ABtnDef[] = [
        { icon: <span className="text-[11px] font-mono">⊢L</span>,  action: () => align('left'),    title: 'Align left edges' },
        { icon: <span className="text-[11px] font-mono">C↔</span>,  action: () => align('centerH'), title: 'Align centers horizontally' },
        { icon: <span className="text-[11px] font-mono">R⊣</span>,  action: () => align('right'),   title: 'Align right edges' },
        { icon: <span className="text-[11px] font-mono">⊤T</span>,  action: () => align('top'),     title: 'Align top edges' },
        { icon: <span className="text-[11px] font-mono">C↕</span>,  action: () => align('centerV'), title: 'Align centers vertically' },
        { icon: <span className="text-[11px] font-mono">B⊥</span>,  action: () => align('bottom'),  title: 'Align bottom edges' },
        { icon: <span className="text-[11px] font-mono">⇔H</span>,  action: () => distribute('h'),  title: 'Distribute horizontally (3+ nodes)' },
        { icon: <span className="text-[11px] font-mono">⇕V</span>,  action: () => distribute('v'),  title: 'Distribute vertically (3+ nodes)' },
    ];

    return (
        <div
            className="fixed z-[10001] pointer-events-auto"
            style={{ left: Math.max(8, rect.left), top: toolbarY }}
        >
            <div className="flex items-center gap-0.5 bg-[#1a1a1c]/95 border border-white/[0.09] rounded-xl px-1.5 py-1 shadow-2xl shadow-black/60 backdrop-blur-sm">
                <span className="text-[9px] text-zinc-600 px-1.5 font-mono shrink-0">{selectedIds.size}</span>
                <div className="w-px h-4 bg-white/10 mx-0.5" />
                {btns.map((btn, i) => (
                    <React.Fragment key={i}>
                        {i === 6 && <div className="w-px h-4 bg-white/10 mx-0.5" />}
                        <button
                            title={btn.title}
                            onClick={btn.action}
                            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
                        >
                            {btn.icon}
                        </button>
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

// Main canvas component. Subscribes to useProject (doc data), useUI (60fps viewport), and useEditor (interaction engine) separately to minimise re-renders.
export const Canvas = () => {
    // ── Slow-changing project data ─────────────────────────────────────────────
    const {
        elements, updateProject, activePageId, instantiateTemplate, history, addFrame,
        elementsRef,
        // parentMap for world-space multi-select bbox.
        parentMap,
    } = useProject();

    // 60fps viewport state — isolated from Sidebar and Header so they never re-render on pan/zoom.
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
        // selectedIds drives the bounding box overlay.
        selectedIds,
    } = useUI();

    // ── Assembled bridge values (componentRegistry merges static + dynamic) ───
    const { handleInteractionMove, handleInteractionEnd, componentRegistry } = useEditor();

    const canvasRef = useRef<HTMLDivElement>(null);
    const [spacePressed, setSpacePressed] = useState(false);
    // Stable zoom ref — read inside wheel handler without triggering listener teardown on every setZoom call.
    const zoomRef = useRef(zoom);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);
    // Item 2 — box-select state
    const boxSelectRef = useRef<{ active: boolean; startX: number; startY: number; worldStartX: number; worldStartY: number } | null>(null);
    const [boxSelectRect, setBoxSelectRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

    // World-space bounding box over all selected elements — auto-scales with the canvas transform.
    const multiSelBBox = useMemo(() => {
        if (selectedIds.size < 2 || previewMode) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let anyFound = false;
        selectedIds.forEach(id => {
            const el = elements[id];
            if (!el?.props?.style) return;
            const s = el.props.style as Record<string, any>;
            const elLeft = parseFloat(String(s.left ?? '0'));
            const elTop  = parseFloat(String(s.top  ?? '0'));
            const elW    = parseFloat(String(s.width ?? '0'));
            const elH    = parseFloat(String(s.height ?? s.minHeight ?? '0'));
            if (elW <= 0 && elH <= 0) return;
            // Walk one level to artboard for offset (O(1) parentMap lookup)
            const parentId = parentMap.get(id);
            const parent = parentId ? elements[parentId] : null;
            let ax = 0, ay = 0;
            if (parent?.props?.style) {
                const ps = parent.props.style as Record<string, any>;
                ax = parseFloat(String(ps.left ?? '0'));
                ay = parseFloat(String(ps.top  ?? '0'));
            }
            minX = Math.min(minX, ax + elLeft);
            minY = Math.min(minY, ay + elTop);
            maxX = Math.max(maxX, ax + elLeft + elW);
            maxY = Math.max(maxY, ay + elTop + elH);
            anyFound = true;
        });
        if (!anyFound) return null;
        const PAD = 3;
        return { x: minX - PAD, y: minY - PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2, count: selectedIds.size };
    }, [selectedIds, elements, parentMap, previewMode]);
    // ── End FIX-6 ─────────────────────────────────────────────────────────────

    // ── 1. WHEEL — zoom & pan ─────────────────────────────────────────────────
    // Isolated to Canvas. Only Canvas re-renders on wheel events.
    useEffect(() => {
        const onWheel = (e: WheelEvent) => {
            if (previewMode) return;
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                // read from zoomRef — never from closed-over zoom state.
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

    // Saves the departing page's viewport and restores the arriving page's viewport on every page switch.
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

        // Scroll-to-node: pan so the clicked layer element is centered in the viewport at current zoom.
        const handleScrollToNode = (e: Event) => {
            if (previewMode) return;
            const { id } = (e as CustomEvent<{ id: string }>).detail;
            const el = elements[id];
            if (!el?.props?.style) return;

            const s = el.props.style as Record<string, any>;
            // Walk one level up to artboard for world-space offset (O(1) parentMap lookup).
            const parentId = parentMap.get(id);
            const parent = parentId ? elements[parentId] : null;
            let ax = 0, ay = 0;
            if (parent?.props?.style) {
                const ps = parent.props.style as Record<string, any>;
                ax = parseFloat(String(ps.left ?? '0'));
                ay = parseFloat(String(ps.top  ?? '0'));
            }
            const elLeft   = ax + parseFloat(String(s.left   ?? '0'));
            const elTop    = ay + parseFloat(String(s.top    ?? '0'));
            const elWidth  = parseFloat(String(s.width  ?? '200'));
            const elHeight = parseFloat(String(s.height ?? s.minHeight ?? '100'));

            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            // Center the element in the viewport, keeping current zoom level.
            setPan({
                x: rect.width  / 2 - (elLeft + elWidth  / 2) * zoomRef.current,
                y: rect.height / 2 - (elTop  + elHeight / 2) * zoomRef.current,
            });
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                e.preventDefault();
                handleZoomToFit();
            }
        };

        // vectra:wrap-node — fired by SingleNodeToolbar "Wrap" button.
        // Builds a new container around the target element using current elementsRef state.
        const handleWrapNode = (e: Event) => {
            const { id } = (e as CustomEvent<{ id: string }>).detail;
            const cur = elementsRef.current;
            const el = cur[id];
            if (!el) return;
            const pid = parentMap.get(id);
            if (!pid) return;
            const s = (el.props?.style || {}) as Record<string, any>;
            const wrapperId = `wrapper_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            updateProject({
                ...cur,
                [wrapperId]: {
                    id: wrapperId, type: 'container', name: 'Container',
                    children: [id],
                    props: {
                        layoutMode: 'canvas',
                        style: {
                            position: 'absolute',
                            left: s.left ?? '0px', top: s.top ?? '0px',
                            width: s.width ?? '200px', height: s.height ?? '100px',
                        },
                        className: '',
                    },
                },
                [id]: { ...el, props: { ...el.props, style: { ...s, left: '0px', top: '0px' } } },
                [pid]: { ...cur[pid], children: (cur[pid].children || []).map((c: string) => c === id ? wrapperId : c) },
            });
            setSelectedId(wrapperId);
        };

        // vectra:ai-edit-node — fired by SingleNodeToolbar "AI Edit" button.
        // Stamps the target node id on window so MagicBar can pre-fill the prompt context.
        const handleAiEditNode = (e: Event) => {
            const { id } = (e as CustomEvent<{ id: string }>).detail;
            (window as any).__vectra_ai_edit_target = id;
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('vectra:zoom-to-fit', handleZoomToFit);
        window.addEventListener('vectra:scroll-to-node', handleScrollToNode);
        window.addEventListener('vectra:wrap-node', handleWrapNode);
        window.addEventListener('vectra:ai-edit-node', handleAiEditNode);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('vectra:zoom-to-fit', handleZoomToFit);
            window.removeEventListener('vectra:scroll-to-node', handleScrollToNode);
            window.removeEventListener('vectra:wrap-node', handleWrapNode);
            window.removeEventListener('vectra:ai-edit-node', handleAiEditNode);
        };
    }, [elements, activePageId, previewMode, setZoom, setPan, parentMap, elementsRef, updateProject, setSelectedId]);

    // Snaps a drop coordinate to the nearest artboard frame. DATA_BINDING drops bypass this and use a hit-test instead.
    const snapDropToArtboard = (wx: number, wy: number): { x: number; y: number } => {
        const pageRoot = elements[activePageId];
        if (!pageRoot?.children) return { x: wx, y: wy };

        const frames = pageRoot.children
            .map(id => elements[id])
            .filter(el => el?.type === 'webpage')
            .map(el => {
                const s = (el.props?.style ?? {}) as Record<string, any>;
                return {
                    left:   parseFloat(String(s.left   ?? '0')),
                    top:    parseFloat(String(s.top    ?? '0')),
                    width:  parseFloat(String(s.width  ?? '1440')),
                    height: parseFloat(String(s.height ?? s.minHeight ?? '900')),
                };
            });

        if (frames.length === 0) return { x: wx, y: wy };

        // Point already inside a frame — no snap needed
        const inside = frames.find(f =>
            wx >= f.left && wx <= f.left + f.width &&
            wy >= f.top  && wy <= f.top  + f.height
        );
        if (inside) return { x: wx, y: wy };

        // Find nearest frame by center distance, clamp to its bounds with 40px inset
        let nearest = frames[0];
        let nearestDist = Infinity;
        for (const f of frames) {
            const cx = f.left + f.width  / 2;
            const cy = f.top  + f.height / 2;
            const dist = Math.sqrt((wx - cx) ** 2 + (wy - cy) ** 2);
            if (dist < nearestDist) { nearestDist = dist; nearest = f; }
        }
        const PAD = 40;
        return {
            x: Math.max(nearest.left + PAD, Math.min(wx, nearest.left + nearest.width  - PAD)),
            y: Math.max(nearest.top  + PAD, Math.min(wy, nearest.top  + nearest.height - PAD)),
        };
    };

    const handleGlobalDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (!dragData || previewMode) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        // use let so snapDropToArtboard can reassign x/y after DATA_BINDING bypass
        let worldX = (e.clientX - rect.left - pan.x) / zoom;
        let worldY = (e.clientY - rect.top - pan.y) / zoom;

        // ── Data binding drop ───────────────────────────────────────────────
        if (dragData.type === 'DATA_BINDING') {
            // Walk active-page descendants only — elements from other pages can share the same world coordinates.
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

        // Snap all non-binding drops to the nearest artboard.
        // 'webpage' artboard drops (new frames) bypass snap — they land at cursor.
        if (dragData.type !== 'DATA_BINDING' && dragData.payload !== 'webpage') {
            const snapped = snapDropToArtboard(worldX, worldY);
            worldX = snapped.x;
            worldY = snapped.y;
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
            // crypto.randomUUID() — Date.now() collides on same-ms drops
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
                // Stamp importMeta at creation so the node always carries its component identity.
                ...(conf.importMeta ? { importMeta: conf.importMeta } : {}),
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
                // Spread-clone activePageId node before appending — never mutate the shared reference directly.
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
                // Accumulate ancestor offsets to convert local left/top into world-space coords for intersection testing.

                interface WorldNode {
                    id: string;
                    worldX: number;
                    worldY: number;
                    w: number;
                    h: number;
                }

                const collectAbsoluteNodesWithWorldCoords = (
                    ids: string[],
                    offsetX: number,
                    offsetY: number,
                    visited: Set<string> = new Set()
                ): WorldNode[] => {
                    const result: WorldNode[] = [];
                    for (const id of ids) {
                        if (visited.has(id)) continue;
                        visited.add(id);
                        const node = elements[id];
                        if (!node) continue;
                        const st = (node.props?.style || {}) as Record<string, any>;
                        const isAbsolute = st.position === 'absolute';
                        const localLeft = isAbsolute ? parseFloat(String(st.left ?? '0')) : 0;
                        const localTop = isAbsolute ? parseFloat(String(st.top ?? '0')) : 0;
                        const worldX = offsetX + localLeft;
                        const worldY = offsetY + localTop;
                        if (isAbsolute) {
                            const w = parseFloat(String(st.width ?? '0'));
                            const h = parseFloat(String(st.height ?? '0'));
                            if (w > 0 || h > 0) result.push({ id, worldX, worldY, w, h });
                        }
                        if (node.children?.length) {
                            // canvas-mode children are offset relative to this node's world pos;
                            // flex-mode children are flow-positioned — pass parent offset unchanged.
                            const childOffsetX = isAbsolute ? worldX : offsetX;
                            const childOffsetY = isAbsolute ? worldY : offsetY;
                            result.push(...collectAbsoluteNodesWithWorldCoords(
                                node.children, childOffsetX, childOffsetY, visited
                            ));
                        }
                    }
                    return result;
                };

                const pageRoot = elements[activePageId];
                const allCandidates = collectAbsoluteNodesWithWorldCoords(
                    pageRoot?.children || [], 0, 0
                );
                const hits = allCandidates.filter(({ worldX, worldY, w, h }) =>
                    worldX < selMaxX && worldX + w > selMinX &&
                    worldY < selMaxY && worldY + h > selMinY
                );
                if (hits.length > 0) { hits.forEach(({ id }) => addToSelection(id)); }
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
                            {/* Item 3: per-frame resize handles — suppressed for mirror & collapsed frames */}
                            {(elements[activePageId]?.children || []).map(cid => {
                                const el = elements[cid];
                                if (!el) return null;
                                if (el.type !== 'webpage' && el.type !== 'canvas') return null;
                                if (el.props?.mirrorOf) return null;   // mirror frames skip
                                if (el.props?.collapsed) return null;  // collapsed frames skip
                                return <ArtboardResizeHandle key={`arh-${cid}`} frameId={cid} zoom={zoom} />;
                            })}
                        </div>
                    </CanvasErrorBoundary>

                    {/* Snap guides — line + distance label badge */}
                    {guides.map((g, i) => {
                        const isVertical = g.orientation === 'vertical';
                        const lineLength = g.end - g.start;
                        // Only show a label when the guide is long enough and carries a distance value
                        const labelText  = g.label ? `${Math.round(parseFloat(g.label))}` : null;
                        const showLabel  = labelText !== null && lineLength > 20;
                        const midMain    = (g.start + g.end) / 2;

                        return (
                            <React.Fragment key={i}>
                                {/* Guide line */}
                                <div
                                    className="absolute bg-red-500 z-[9999] pointer-events-none"
                                    style={{
                                        left:   isVertical ? g.pos   : g.start,
                                        top:    isVertical ? g.start : g.pos,
                                        width:  isVertical ? '1px'   : lineLength,
                                        height: isVertical ? lineLength : '1px',
                                    }}
                                />
                                {/* Distance label — floats at the midpoint of the guide */}
                                {showLabel && (
                                    <div
                                        className="absolute z-[10000] pointer-events-none select-none"
                                        style={{
                                            left: isVertical ? g.pos + 4 : midMain - 16,
                                            top:  isVertical ? midMain - 9 : g.pos + 4,
                                            background: 'rgba(220,38,38,0.92)',
                                            color: '#fff',
                                            fontSize: '9px',
                                            fontFamily: 'monospace',
                                            fontWeight: 700,
                                            padding: '1px 5px',
                                            borderRadius: '3px',
                                            whiteSpace: 'nowrap',
                                            lineHeight: '16px',
                                            letterSpacing: '0.03em',
                                        }}
                                    >
                                        {labelText}
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                    {/* Item 2: Box-select rectangle */}
                    {boxSelectRect && (
                        <div
                            className="absolute pointer-events-none z-[9999] border border-blue-500 bg-blue-500/10"
                            style={{ left: boxSelectRect.x, top: boxSelectRect.y, width: boxSelectRect.w, height: boxSelectRect.h }}
                        />
                    )}
                    {/* Multi-select bounding box — rendered in world space so it scales with zoom. pointer-events-none. */}
                    {multiSelBBox && (
                        <div
                            data-multisel-bbox
                            className="absolute pointer-events-none border border-dashed border-blue-400/80 bg-blue-500/[0.04]"
                            style={{ left: multiSelBBox.x, top: multiSelBBox.y, width: multiSelBBox.w, height: multiSelBBox.h, zIndex: 9997 }}
                        >
                            <div
                                className="absolute left-1/2 -translate-x-1/2 -top-5 bg-blue-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap select-none"
                                style={{ zIndex: 9998 }}
                            >
                                {multiSelBBox.count} selected
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Zoom level badge — outer container (not world div) so it never scales.
                Click fires zoom-to-fit. Matches Header button behaviour exactly. */}
            {!previewMode && (
                <div className="absolute bottom-4 left-4 z-[9990] pointer-events-none select-none">
                    <button
                        className="pointer-events-auto flex items-center gap-1 px-2 py-1 bg-[#252526]/90 border border-[#3f3f46] rounded text-[10px] font-mono text-[#666] hover:text-white hover:bg-[#2d2d2d] transition-colors backdrop-blur-sm"
                        onClick={() => window.dispatchEvent(new CustomEvent('vectra:zoom-to-fit'))}
                        title="Zoom to fit (⌘0 / Ctrl+0)"
                    >
                        {Math.round(zoom * 100)}%
                    </button>
                </div>
            )}

            {/* CF-1: Frame Picker — fixed to viewport bottom-left */}
            {!previewMode && <FramePicker onAddFrame={addFrame} />}

            {/* ── TOOLBAR-1 [PERMANENT]: Floating toolbars — fixed, outside world div, never scale with zoom.
                Single-node toolbar: Duplicate + Delete for selected non-artboard nodes.
                Multi-select bar:    Align (6) + Distribute (2) when selectedIds.size ≥ 2.
                Hidden during interaction, previewMode, or nothing selected.        */}
            {!previewMode && !interaction && _sid && selectedIds.size <= 1 && (() => {
                const domEl = document.querySelector(`[data-vid="${_sid}"]`) as HTMLElement | null;
                return <SingleNodeToolbar elementId={_sid} nodeEl={domEl} />;
            })()}
            {!previewMode && !interaction && selectedIds.size >= 2 && (() => {
                const bboxDom = document.querySelector('[data-multisel-bbox]') as HTMLElement | null;
                return <AlignDistributeBar selectedIds={selectedIds} bboxEl={bboxDom} />;
            })()}
        </div>
    );
};

/**
 * ─── EDITOR CONTEXT (Legacy Compatibility Bridge) ─────────────────────────────
 * The real state lives in two optimised contexts:
 *   • ProjectContext  — heavyweight document data (elements, history, pages…)
 *   • UIContext       — lightweight UI state (sel, hover, tool, zoom, panel…)
 *
 * This file keeps backward-compatibility so every existing component that calls
 * `useEditor()` continues to work without modification.
 *
 * PHASE 3 — Interaction engine optimisations
 * ──────────────────────────────────────────
 * • handleInteractionMove calls updateProject(..., skipHistory=true): 60fps drag
 *   updates never trigger JSON.stringify on the main thread.
 * • handleInteractionEnd commits ONE history entry on pointer-up.
 *
 * PHASE 5 — Retained-Mode LayoutEngine snapping
 * ───────────────────────────────────────────────
 * • querySnapping (from ProjectContext) is called with 5 scalar args at 60fps —
 *   zero large JS→Wasm data transfer per frame.
 * • syncLayoutEngine (from ProjectContext) is exposed through useEditor() so
 *   RenderNode can call it on pointer-down (alongside setInteraction) to push
 *   all sibling rects into Wasm ONCE per drag gesture.
 */

import React, { useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useProject } from './ProjectContext';
import { useUI } from './UIContext';
import { useHover } from './HoverContext';
import { COMPONENT_TYPES } from '../data/constants';
import type { EditorContextType } from '../types';

export type { SidebarPanel, AppView, ViewMode } from './UIContext';
export type { GlobalTheme, DataSource } from './ProjectContext';

// ── Interaction engine ────────────────────────────────────────────────────────
// Assembled here so ProjectContext and UIContext stay decoupled from each other.
function useInteractionEngine() {
    const { elementsRef, updateProject, pushHistory, querySnapping, syncLayoutEngine } = useProject();
    // NM-8 FIX: zoomRef instead of zoom — removes zoom from handleInteractionMove
    // dep array. zoom in deps caused useCallback to be recreated on every wheel
    // tick (60fps) → Canvas useEffect tore down + reattached pointermove + pointerup
    // listeners 60×/sec. Two DOM API calls per tick = 120 ops/sec listener churn,
    // plus a one-frame gap where no handler was attached → drag skip during zoom+drag.
    const { interaction, zoomRef, setGuides, setInteraction, device } = useUI();

    // P2-B2 FIX: mirror device into a stable ref so handleInteractionMove reads
    // the current breakpoint at 60fps without adding device to its dep array.
    // device only changes on user click — but ref pattern keeps dep array stable
    // and consistent with NM-8 (zoomRef) and the project-wide ref-for-60fps rule.
    const bpRef = useRef<'desktop' | 'tablet' | 'mobile'>(device);
    useEffect(() => { bpRef.current = device; }, [device]);

    // ── MOVE / RESIZE — called at 60fps during drag ────────────────────────────
    // • updateProject(next, true) → setElements only, no JSON.stringify per frame
    // • querySnapping → 5 scalar f64 args cross the Wasm boundary (no serde cost)
    const handleInteractionMove = useCallback((e: PointerEvent) => {
        if (!interaction) return;
        const { type, itemId, startX, startY, startRect, handle } = interaction as any;
        const deltaX = (e.clientX - (startX || 0)) / zoomRef.current;
        const deltaY = (e.clientY - (startY || 0)) / zoomRef.current;
        let newRect = startRect ? { ...startRect } : { left: 0, top: 0, width: 0, height: 0 };

        if (type === 'MOVE') {
            newRect.left = (startRect?.left || 0) + deltaX;
            newRect.top = (startRect?.top || 0) + deltaY;

            // 🚀 Phase 5: Retained-Mode snapping — 5 scalars, zero serde cost at 60fps
            const snap = querySnapping(newRect.left, newRect.top, newRect.width, newRect.height);
            if (snap) {
                newRect.left = snap.x;
                newRect.top = snap.y;
                setGuides(snap.guides as any);
            } else {
                setGuides([]);
            }
        } else if (type === 'RESIZE' && handle && startRect) {
            if (handle.includes('e')) newRect.width = Math.max(20, startRect.width + deltaX);
            if (handle.includes('w')) { newRect.width = Math.max(20, startRect.width - deltaX); newRect.left = startRect.left + deltaX; }
            if (handle.includes('s')) newRect.height = Math.max(20, startRect.height + deltaY);
            if (handle.includes('n')) { newRect.height = Math.max(20, startRect.height - deltaY); newRect.top = startRect.top + deltaY; }
            setGuides([]);
        }

        // H-4 partial: read current elements from ref for move path
        const curElements = elementsRef.current;
        const el = curElements[itemId];
        if (!el) return;

        // P2-B2 FIX: breakpoint-aware write destination.
        // Desktop → write to props.style (existing behaviour).
        // Tablet/Mobile → write to props.breakpoints[bp] so the base desktop
        // layout is never clobbered when the user resizes in a breakpoint view.
        //
        // WHY bpRef NOT bpState: bpRef.current is read here at 60fps. Adding
        // `device` state to this dep array would make handleInteractionMove
        // re-create on every device toggle, forcing Canvas to re-attach the
        // global pointermove listener — same churn NM-8 solved for zoom.
        const bp = bpRef.current;
        const isBreakpointMode = bp !== 'desktop';

        let nextNode: typeof el;
        if (isBreakpointMode) {
            const currentBpStyle = el.props.breakpoints?.[bp as 'mobile' | 'tablet'] || {};
            nextNode = {
                ...el,
                props: {
                    ...el.props,
                    breakpoints: {
                        ...(el.props.breakpoints || {}),
                        [bp]: {
                            ...currentBpStyle,
                            left: `${newRect.left}px`,
                            top: `${newRect.top}px`,
                            width: `${newRect.width}px`,
                            height: `${newRect.height}px`,
                        },
                    },
                },
            };
        } else {
            // Desktop — original behavior preserved exactly
            nextNode = {
                ...el,
                props: {
                    ...el.props,
                    style: {
                        ...el.props.style,
                        left: `${newRect.left}px`,
                        top: `${newRect.top}px`,
                        width: `${newRect.width}px`,
                        height: `${newRect.height}px`,
                    },
                },
            };
        }

        const next = { ...curElements, [itemId]: nextNode };
        updateProject(next, true); // skipHistory=true → no JSON.stringify per frame
        // bpRef is a stable ref — its identity never changes, so it is NOT listed
        // in deps as a reactive value. Reading bpRef.current inside the callback
        // always gets the current breakpoint without triggering re-creation.
    }, [interaction, zoomRef, bpRef, elementsRef, setGuides, updateProject, querySnapping]);

    // ── DRAG END — called once on pointer-up ──────────────────────────────────
    // H-4 FIX: `elements` removed from deps — reads from elementsRef.current at call
    // time so this callback is NOT recreated on every 60fps element update during drag.
    const handleInteractionEnd = useCallback(() => {
        if (!interaction) return;
        pushHistory(elementsRef.current); // read current, not stale closure
        setGuides([]);
        setInteraction(null);
    }, [interaction, elementsRef, pushHistory, setGuides, setInteraction]);

    return { handleInteractionMove, handleInteractionEnd, syncLayoutEngine };
}

// ─── COMBINED useEditor HOOK ──────────────────────────────────────────────────

export const useEditor = () => {
    const project = useProject();
    const ui = useUI();
    const { handleInteractionMove, handleInteractionEnd, syncLayoutEngine } = useInteractionEngine();

    // H-2 FIX: memoize the merged registry so the reference is stable between
    // renders. Previously { ...COMPONENT_TYPES, ...ui.componentRegistry } created
    // a new object on every call, forcing a re-render in every subscriber
    // (RenderNode, RightSidebar, InsertDrawer, Header, …) on every frame.
    // COMPONENT_TYPES is a module-level constant — omit it from deps.
    const componentRegistry = useMemo(
        () => ({ ...COMPONENT_TYPES, ...ui.componentRegistry }),
        [ui.componentRegistry] // eslint-disable-line react-hooks/exhaustive-deps
    );

    return {
        // ── Project ───────────────────────────────────────────────────────────
        elements: project.elements,
        setElements: project.setElements,
        elementsRef: project.elementsRef,
        updateProject: project.updateProject,
        pushHistory: project.pushHistory,
        deleteElement: project.deleteElement,
        duplicateElement: project.duplicateElement,   // Item 1
        reorderElement: project.reorderElement,       // Item 4
        instantiateTemplate: project.instantiateTemplate,
        parentMap: project.parentMap,                 // H-1 / M-7
        pages: project.pages,
        activePageId: project.activePageId,
        setActivePageId: project.setActivePageId,
        realPageId: project.realPageId,
        addPage: project.addPage,
        deletePage: project.deletePage,
        switchPage: project.switchPage,
        importPage: project.importPage,
        updatePageSEO: project.updatePageSEO,  // Direction D
        history: project.history,
        undo: project.undo,   // S-2: flat stable reference
        redo: project.redo,   // S-2: flat stable reference
        querySnapping: project.querySnapping,
        theme: project.theme,
        updateTheme: project.updateTheme,
        dataSources: project.dataSources,
        addDataSource: project.addDataSource,
        removeDataSource: project.removeDataSource,
        updateDataSource: project.updateDataSource,
        apiRoutes: project.apiRoutes,
        addApiRoute: project.addApiRoute,
        updateApiRoute: project.updateApiRoute,
        deleteApiRoute: project.deleteApiRoute,
        framework: project.framework,
        setFramework: project.setFramework,
        createNewProject: project.createNewProject,
        exitProject: project.exitProject,
        runAI: project.runAI,

        // ── Phase H: Multi-project ────────────────────────────────────────────
        projectId: project.projectId,
        projectName: project.projectName,
        projectIndex: project.projectIndex,
        loadProject: project.loadProject,
        renameProject: project.renameProject,
        duplicateProject: project.duplicateProject,
        deleteProject: project.deleteProject,
        // ── Sprint 2: soft-delete API ─────────────────────────────────────────
        removeProjectFromIndex: project.removeProjectFromIndex,
        purgeProjectData: project.purgeProjectData,
        restoreProjectToIndex: project.restoreProjectToIndex,


        // ── UI ────────────────────────────────────────────────────────────────
        selectedId: ui.selectedId,
        setSelectedId: ui.setSelectedId,
        // NM-8 / HoverContext fix: hoveredId moved out of UIContext into HoverContext.
        // Forward from useHover() so existing useEditor().hoveredId consumers don't break.
        hoveredId: useHover().hoveredId,
        setHoveredId: useHover().setHoveredId,
        activeTool: ui.activeTool,
        setActiveTool: ui.setActiveTool,
        zoom: ui.zoom,
        setZoom: ui.setZoom,
        pan: ui.pan,
        setPan: ui.setPan,
        isPanning: ui.isPanning,
        setIsPanning: ui.setIsPanning,
        dragData: ui.dragData,
        setDragData: ui.setDragData,
        interaction: ui.interaction,
        setInteraction: ui.setInteraction,
        guides: ui.guides,
        previewMode: ui.previewMode,
        setPreviewMode: ui.setPreviewMode,
        device: ui.device,
        setDevice: ui.setDevice,
        viewMode: ui.viewMode,
        setViewMode: ui.setViewMode,
        activePanel: ui.activePanel,
        setActivePanel: ui.setActivePanel,
        togglePanel: ui.togglePanel,
        isInsertDrawerOpen: ui.isInsertDrawerOpen,
        toggleInsertDrawer: ui.toggleInsertDrawer,
        isMagicBarOpen: ui.isMagicBarOpen,
        setMagicBarOpen: ui.setMagicBarOpen,
        assets: ui.assets,
        addAsset: ui.addAsset,
        globalStyles: ui.globalStyles,
        setGlobalStyles: ui.setGlobalStyles,
        currentView: ui.currentView,
        setCurrentView: ui.setCurrentView,
        runAction: ui.runAction,
        componentRegistry,
        registerComponent: ui.registerComponent,
        recentComponents: ui.recentComponents,
        addRecentComponent: ui.addRecentComponent,

        // ── Assembled from both ───────────────────────────────────────────────
        handleInteractionMove,
        handleInteractionEnd,
        syncLayoutEngine,
    // ARCH-1: `satisfies` validates this shape matches EditorContextType at compile time
    // without widening the inferred type. Any field added to EditorContextType that is
    // missing from this return object will immediately fail tsc — permanently prevents drift.
    } satisfies EditorContextType;
};

// ─── DEPRECATED PROVIDER ──────────────────────────────────────────────────────
// All state has moved to ProjectProvider + UIProvider in App.tsx.
// This stub prevents import errors in components not yet updated.

export const EditorProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
    <>{children}</>
);

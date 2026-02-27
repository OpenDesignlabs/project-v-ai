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

import React, { useCallback, type ReactNode } from 'react';
import { useProject } from './ProjectContext';
import { useUI } from './UIContext';
import { COMPONENT_TYPES } from '../data/constants';

export type { SidebarPanel, AppView, ViewMode } from './UIContext';
export type { GlobalTheme, DataSource } from './ProjectContext';

// ── Interaction engine ────────────────────────────────────────────────────────
// Assembled here so ProjectContext and UIContext stay decoupled from each other.
function useInteractionEngine() {
    const { elements, updateProject, pushHistory, querySnapping, syncLayoutEngine } = useProject();
    const { interaction, zoom, setGuides, setInteraction } = useUI();

    // ── MOVE / RESIZE — called at 60fps during drag ────────────────────────────
    // • updateProject(next, true) → setElements only, no JSON.stringify per frame
    // • querySnapping → 5 scalar f64 args cross the Wasm boundary (no serde cost)
    const handleInteractionMove = useCallback((e: PointerEvent) => {
        if (!interaction) return;
        const { type, itemId, startX, startY, startRect, handle } = interaction as any;
        const deltaX = (e.clientX - (startX || 0)) / zoom;
        const deltaY = (e.clientY - (startY || 0)) / zoom;
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

        const el = elements[itemId];
        if (!el) return;
        const next = {
            ...elements,
            [itemId]: {
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
            },
        };
        updateProject(next, true); // skipHistory=true → no JSON.stringify per frame
    }, [interaction, zoom, elements, setGuides, updateProject, querySnapping]);

    // ── DRAG END — called once on pointer-up ──────────────────────────────────
    // Commits ONE history entry for the entire drag gesture.
    const handleInteractionEnd = useCallback(() => {
        if (!interaction) return;
        pushHistory(elements);
        setGuides([]);
        setInteraction(null);
    }, [interaction, elements, pushHistory, setGuides, setInteraction]);

    return { handleInteractionMove, handleInteractionEnd, syncLayoutEngine };
}

// ─── COMBINED useEditor HOOK ──────────────────────────────────────────────────

export const useEditor = () => {
    const project = useProject();
    const ui = useUI();
    const { handleInteractionMove, handleInteractionEnd, syncLayoutEngine } = useInteractionEngine();

    return {
        // ── Project ───────────────────────────────────────────────────────────
        elements: project.elements,
        setElements: project.setElements,
        updateProject: project.updateProject,
        pushHistory: project.pushHistory,
        deleteElement: project.deleteElement,
        instantiateTemplate: project.instantiateTemplate,
        pages: project.pages,
        activePageId: project.activePageId,
        setActivePageId: project.setActivePageId,
        realPageId: project.realPageId,
        addPage: project.addPage,
        deletePage: project.deletePage,
        switchPage: project.switchPage,
        history: project.history,
        querySnapping: project.querySnapping,
        theme: project.theme,
        updateTheme: project.updateTheme,
        dataSources: project.dataSources,
        addDataSource: project.addDataSource,
        removeDataSource: project.removeDataSource,
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
        hoveredId: ui.hoveredId,
        setHoveredId: ui.setHoveredId,
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
        componentRegistry: { ...COMPONENT_TYPES, ...ui.componentRegistry },
        registerComponent: ui.registerComponent,
        recentComponents: ui.recentComponents,
        addRecentComponent: ui.addRecentComponent,

        // ── Assembled from both ───────────────────────────────────────────────
        handleInteractionMove,
        handleInteractionEnd,
        syncLayoutEngine,
    };
};

// ─── DEPRECATED PROVIDER ──────────────────────────────────────────────────────
// All state has moved to ProjectProvider + UIProvider in App.tsx.
// This stub prevents import errors in components not yet updated.

export const EditorProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
    <>{children}</>
);

import React, { useRef, useState, useEffect, Suspense, lazy, Component } from 'react';
import type { ErrorInfo } from 'react';
import { useProject } from '../context/ProjectContext';
import { useUI } from '../context/UIContext';
import { useEditor } from '../context/EditorContext'; // Legacy — for sub-components not yet migrated
import { SANDBOX_BLOCKED_PATTERNS } from '../utils/codeSanitizer';
import type { VectraProject, VectraNode } from '../types';
import { TEMPLATES } from '../data/templates';
import { Resizer } from './Resizer';
import { cn } from '../lib/utils';
import { Loader2, Plus, PlayCircle, Zap } from 'lucide-react';
// Preserve full framer-motion imports — AnimatePresence etc. are injected into
// the AI sandbox so components that use them don’t crash with "undefined" errors.
import { motion, AnimatePresence, useAnimation, useInView, useMotionValue, useTransform } from 'framer-motion';
import { getIconComponent } from '../data/iconRegistry';


// --- LAZY LOAD MARKETPLACE COMPONENTS ---
const GeometricShapes = lazy(() => import('./marketplace/GeometricShapes'));
const GeometricShapesBackground = lazy(() => import('./marketplace/GeometricShapes').then(m => ({ default: m.GeometricShapesBackground })));
const FeatureHover = lazy(() => import('./marketplace/FeatureHover'));
const FeaturesSectionWithHoverEffects = lazy(() => import('./marketplace/FeatureHover').then(m => ({ default: m.FeaturesSectionWithHoverEffects })));
const HeroGeometric = lazy(() => import('./marketplace/HeroGeometric').then(m => ({ default: m.HeroGeometric })));

// --- SMART COMPONENTS ---
import { SmartAccordion, SmartCarousel, SmartTable } from './smart/SmartComponents';
import * as LucideAll from 'lucide-react';

// ─── COMPILER WORKER (Singleton) ─────────────────────────────────────────────
// Created ONCE at module level so Babel isn’t re-loaded on every component mount.
// Classic worker mode: the worker uses importScripts('/babel.min.js') internally.

const compilerWorker = new Worker(
    new URL('../workers/compiler.worker.ts', import.meta.url),
    { type: 'classic' }
);

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
// Upgraded to catch BOTH compile-time errors (from LiveComponent's useEffect try/catch)
// AND runtime errors (React render-phase errors like ReferenceError: Heart is not defined).
// autoTrigger prop enables full autonomous self-healing without user interaction.
class ComponentErrorBoundary extends Component<
    { children: React.ReactNode; label: string; onFix?: (err: string) => Promise<void>; autoTrigger?: boolean },
    { hasError: boolean; message: string; isFixing: boolean }
> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false, message: '', isFixing: false };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, message: error?.message || 'Unknown runtime error' };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`🔴 [${this.props.label}] Runtime Error:`, error, info.componentStack);
        // AUTONOMOUS FIX: trigger silently if retries remain
        if (this.props.autoTrigger && this.props.onFix) {
            setTimeout(() => this.handleFix(), 100);
        }
    }

    handleFix = async () => {
        if (!this.props.onFix) return;
        this.setState({ isFixing: true });
        try {
            await this.props.onFix(this.state.message);
            this.setState({ hasError: false, message: '', isFixing: false });
        } catch {
            this.setState({ isFixing: false });
        }
    };

    render() {
        if (this.state.hasError) {
            const maxHit = !this.props.autoTrigger;
            return (
                <div
                    onPointerDown={(e: any) => e.stopPropagation()}
                    className='cursor-auto p-4 border-2 border-dashed border-orange-400 bg-orange-950/30 rounded-lg text-orange-300 text-xs font-mono w-full h-full overflow-auto flex flex-col gap-3 relative'
                >
                    <div>
                        <strong>⚠ AI Runtime Error</strong>
                        <pre className='mt-1 whitespace-pre-wrap opacity-80'>{this.state.message}</pre>
                    </div>
                    {this.props.onFix && (
                        <button
                            onClick={this.handleFix}
                            disabled={this.state.isFixing || maxHit}
                            className="self-start flex items-center gap-2 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 text-orange-300 px-3 py-1.5 rounded-md font-sans font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {this.state.isFixing
                                ? <><Loader2 className="w-3 h-3 animate-spin" /> Auto-Healing...</>
                                : maxHit
                                    ? <><Zap className="w-3 h-3" /> Max Retries Hit</>
                                    : <><Zap className="w-3 h-3" /> Auto-Fix with AI</>}
                        </button>
                    )}
                </div>
            );
        }
        return this.props.children;
    }
}

// ─── LIVE COMPONENT ───────────────────────────────────────────────────────────
const LiveComponent = ({
    code,
    elementId,
    updateProject,
    elements,
    ...props
}: {
    code: string;
    elementId: string;
    updateProject: (proj: Record<string, any>) => void;
    elements: Record<string, any>;
    [key: string]: any;
}) => {
    const [Component, setComponent] = useState<React.ElementType | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isFixing, setIsFixing] = useState(false);

    // Safety guardrail: stop looping if AI keeps hallucinating
    const autoFixRetries = useRef(0);
    const MAX_RETRIES = 2;
    // Race-condition guard: only apply results from the LATEST compile request
    const reqId = useRef(0);

    // ── Unified Auto-Fix Handler ──────────────────────────────────────────────
    // Handles BOTH compile-time errors (called by the red box button)
    // AND runtime errors (called by ComponentErrorBoundary's onFix prop).
    const handleAutoFix = async (errorMessage: string) => {
        if (autoFixRetries.current >= MAX_RETRIES) {
            console.warn(`⚠️ Auto-fix: max retries (${MAX_RETRIES}) reached — stopping loop.`);
            throw new Error('Max retries reached');
        }
        autoFixRetries.current += 1;
        setIsFixing(true);
        try {
            const { fixComponentError } = await import('../services/aiAgent');
            const fixedCode = await fixComponentError(code, errorMessage);

            // Write fixed code back into the canvas element tree
            const newElements = { ...elements };
            if (newElements[elementId]) {
                newElements[elementId] = { ...newElements[elementId], code: fixedCode };
                updateProject(newElements);
            }
            setError(null);
        } catch (err: any) {
            console.error('🔴 Auto-fix failed:', err.message);
            setError(prev => (prev || errorMessage) + '\n\n[Auto-fix failed: ' + err.message + ']');
            throw err;
        } finally {
            setIsFixing(false);
        }
    };

    useEffect(() => {
        if (!code) return;

        // ── Fast security scan on the main thread (no async needed) ──────────
        const violation = SANDBOX_BLOCKED_PATTERNS.find(p => p.test(code));
        if (violation) {
            setError(`Security violation: ${violation.source.slice(0, 60)}`);
            return;
        }

        // ── Offload Babel + import-stripping to background worker ─────────────
        const currentReqId = ++reqId.current;

        const handleWorkerMessage = (e: MessageEvent) => {
            // Discard stale results from a previous code version
            if (e.data.id !== currentReqId) return;
            compilerWorker.removeEventListener('message', handleWorkerMessage);

            if (e.data.error) {
                const errMsg: string = e.data.error;
                console.error('🔴 Worker compile error:', errMsg);
                setError(errMsg);
                if (autoFixRetries.current < MAX_RETRIES) {
                    handleAutoFix(errMsg).catch(() => { });
                }
                return;
            }

            // ── Execute pre-compiled sandbox code on the main thread ──────────
            // new Function() is near-instantaneous — the heavy Babel work is done.
            try {
                const fakeExports: Record<string, any> = {};
                const fakeModule = { exports: fakeExports };
                // eslint-disable-next-line no-new-func
                const factory = new Function(
                    'React', 'Lucide', 'motion', 'AnimatePresence', 'cn', '_framerExtras',
                    'exports', 'module', 'require',
                    e.data.sandboxCode
                );
                factory(
                    React, LucideAll, motion, AnimatePresence, cn,
                    { useAnimation, useInView, useMotionValue, useTransform },
                    fakeExports, fakeModule,
                    () => { throw new Error('require() not available in sandbox'); }
                );

                const Comp: React.ElementType =
                    fakeExports['default']
                    ?? fakeModule.exports['default']
                    ?? (Object.values(fakeExports).find(v => typeof v === 'function') as any);

                if (typeof Comp !== 'function') {
                    throw new Error('No default export found. The AI component must use: export default function MyComponent() { ... }');
                }

                setComponent(() => Comp);
                setError(null);
                autoFixRetries.current = 0; // ✨ Reset on clean success

                // ── Write cleanCode back into the element tree ────────────────
                // The worker already sanitised the code (stripped imports, fixed
                // quotes, fixed icon syntax). Persisting this means subsequent
                // compile passes skip re-sanitising, saving CPU every re-render.
                if (e.data.cleanCode && e.data.cleanCode !== code) {
                    setTimeout(() => {
                        const newEls = { ...elements };
                        if (newEls[elementId]) {
                            newEls[elementId] = { ...newEls[elementId], code: e.data.cleanCode };
                            updateProject(newEls);
                        }
                    }, 0);
                }

            } catch (execErr: any) {
                const errMsg = execErr.message || 'Unknown sandbox execution error';
                console.error('🔴 Sandbox execution error:', errMsg);
                setError(errMsg);
                if (autoFixRetries.current < MAX_RETRIES) {
                    handleAutoFix(errMsg).catch(() => { });
                }
            }
        };

        compilerWorker.addEventListener('message', handleWorkerMessage);
        compilerWorker.postMessage({ code, id: currentReqId });

        // Cleanup: remove stale listener if code prop changes before worker responds
        return () => {
            compilerWorker.removeEventListener('message', handleWorkerMessage);
        };
    }, [code]);

    // ── Compile-time error UI (red) ───────────────────────────────────────────
    if (error) return (
        <div
            onPointerDown={(e) => e.stopPropagation()}
            className='cursor-auto p-4 border-2 border-dashed border-red-400 bg-red-950/30 rounded-lg text-red-400 text-sm font-mono w-full h-full overflow-auto flex flex-col gap-3'
        >
            <div>
                <strong>⚠ Component Compile Error</strong>
                <pre className='mt-2 whitespace-pre-wrap text-[10px] opacity-80'>{error}</pre>
            </div>
            <button
                onClick={() => handleAutoFix(error).catch(() => { })}
                disabled={isFixing || autoFixRetries.current >= MAX_RETRIES}
                className="self-start flex items-center gap-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 px-3 py-1.5 rounded-md text-xs font-sans font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isFixing
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Auto-Healing...</>
                    : autoFixRetries.current >= MAX_RETRIES
                        ? <><Zap className="w-3 h-3" /> Max Retries Hit</>
                        : <><Zap className="w-3 h-3" /> Auto-Fix with AI</>}
            </button>
        </div>
    );

    if (!Component) return (
        <div className='p-4 text-zinc-500 animate-pulse w-full h-full flex items-center justify-center bg-zinc-900/20 text-sm'>
            Compiling UI...
        </div>
    );

    // ── Runtime error UI (orange) — caught by ErrorBoundary ──────────────────
    return (
        <ComponentErrorBoundary
            label='LiveComponent'
            onFix={handleAutoFix}
            autoTrigger={autoFixRetries.current < MAX_RETRIES}
        >
            <Component {...props} />
        </ComponentErrorBoundary>
    );
};
interface RenderNodeProps { elementId: string; isMobileMirror?: boolean; }

export const RenderNode: React.FC<RenderNodeProps> = ({ elementId, isMobileMirror = false }) => {
    // ── Split context subscriptions ───────────────────────────────────────────
    // useProject: re-renders when document data changes (elements, updateProject)
    // useUI:      re-renders when UI state changes (selection, hover, tool, zoom)
    // Keeping them separate means hovering an element doesn't re-render every
    // RenderNode that only uses project data, and vice-versa.
    const { elements, updateProject, instantiateTemplate, syncLayoutEngine } = useProject();
    const {
        selectedId, setSelectedId, hoveredId, setHoveredId,
        previewMode, dragData, setDragData,
        interaction, setInteraction, zoom, activeTool, setActivePanel,
        device,
        // Item 2 — multi-select
        isInMultiSelect, addToSelection, removeFromSelection,
    } = useUI();
    // componentRegistry merges static COMPONENT_TYPES + dynamically-registered entries
    const { componentRegistry } = useEditor();



    const element = elements[elementId];
    const nodeRef = useRef<HTMLDivElement>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isVisualHover, setIsVisualHover] = useState(false);
    const [animKey, setAnimKey] = useState(0);

    const styleAny = element?.props?.style as Record<string, unknown> | undefined;
    const prevAnim = useRef(element?.props?.animation);
    const prevTrigger = useRef(styleAny?.['--anim-trigger']);

    useEffect(() => {
        if (previewMode) return;
        const currentAnim = element?.props?.animation;
        const currentTrigger = styleAny?.['--anim-trigger'];
        if (currentAnim !== prevAnim.current || currentTrigger !== prevTrigger.current) {
            prevAnim.current = currentAnim;
            prevTrigger.current = currentTrigger;
            setAnimKey(prev => prev + 1);
        }
    }, [element?.props?.animation, styleAny?.['--anim-trigger'], previewMode]);

    const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0 });

    if (!element) return null;
    if (previewMode && element.type === 'canvas') return null;
    if (element.hidden && !previewMode) return <div className="hidden" />;
    if (element.hidden && previewMode) return null;

    const isSelected = selectedId === elementId && !previewMode;
    const isMultiSel = isInMultiSelect(elementId) && !previewMode;
    const isHovered = hoveredId === elementId && !isSelected && !isMultiSel && !previewMode && !dragData;
    const isContainer = ['container', 'page', 'section', 'canvas', 'webpage', 'app', 'grid', 'card', 'stack_v', 'stack_h', 'hero', 'navbar', 'pricing'].includes(element.type);

    const parentId = Object.keys(elements).find(key => elements[key].children?.includes(elementId));
    const parent = parentId ? elements[parentId] : null;
    const isParentCanvas = parent ? (parent.props.layoutMode === 'canvas') : false;
    const isArtboard = element.type === 'canvas' || element.type === 'webpage';
    const canMove = !element.locked && activeTool === 'select' && isParentCanvas && !isArtboard && !isMobileMirror;

    const handlePointerDown = (e: React.PointerEvent) => {
        if (previewMode) return;
        if (activeTool === 'select') e.preventDefault();
        if (!element.locked) e.stopPropagation();

        // Item 2: Shift+click toggles this element in/out of multi-select
        if (e.shiftKey && !element.locked) {
            if (isInMultiSelect(elementId)) { removeFromSelection(elementId); }
            else { addToSelection(elementId); }
            return; // don't start a drag on shift-click
        }

        if (!element.locked) setSelectedId(elementId);

        if (activeTool === 'type' && ['text', 'button', 'heading', 'link'].includes(element.type)) {
            setIsEditing(true); return;
        }

        if (canMove && nodeRef.current) {
            e.currentTarget.setPointerCapture(e.pointerId);
            e.stopPropagation();
            const style = element.props.style || {};
            const currentLeft = parseFloat(String(style.left || 0));
            const currentTop = parseFloat(String(style.top || 0));
            dragStart.current = { x: e.clientX, y: e.clientY, left: currentLeft, top: currentTop };
            setInteraction({ type: 'MOVE', itemId: elementId });
            syncLayoutEngine(elementId);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (interaction?.type === 'MOVE' && interaction.itemId === elementId) {
            e.stopPropagation();
            const deltaX = (e.clientX - dragStart.current.x) / zoom;
            const deltaY = (e.clientY - dragStart.current.y) / zoom;
            let newLeft = dragStart.current.left + deltaX;
            let newTop = dragStart.current.top + deltaY;

            const parentEl = nodeRef.current?.parentElement;
            if (parentEl && nodeRef.current) {
                const pWidth = parentEl.offsetWidth;
                const pHeight = parentEl.offsetHeight;
                const elWidth = nodeRef.current.offsetWidth;
                const elHeight = nodeRef.current.offsetHeight;
                if (pWidth > 0 && pHeight > 0) {
                    newLeft = Math.max(0, Math.min(newLeft, pWidth - elWidth));
                    newTop = Math.max(0, Math.min(newTop, pHeight - elHeight));
                }
            }

            const newElements = { ...elements };
            newElements[elementId].props.style = {
                ...newElements[elementId].props.style,
                left: `${Math.round(newLeft)}px`,
                top: `${Math.round(newTop)}px`,
                position: 'absolute'
            };
            updateProject(newElements);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (interaction?.itemId === elementId) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setInteraction(null);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        if (!element) return;
        const isValidTarget = isArtboard || element.props.layoutMode;
        if (!isValidTarget || element.locked || previewMode) return;

        e.stopPropagation();
        e.preventDefault();
        if (!dragData) return;

        const rect = nodeRef.current?.getBoundingClientRect();
        if (!rect) return;

        const dropX = (e.clientX - rect.left) / zoom;
        const dropY = (e.clientY - rect.top) / zoom;

        if (dragData.type === 'NEW') {
            const conf = componentRegistry[dragData.payload];
            if (conf) {
                const newId = `el-${Date.now()}`;
                const isFrame = dragData.payload === 'webpage' || dragData.payload === 'canvas';
                const defaultW = isFrame ? 1440 : 200;
                const defaultH = isFrame ? 1080 : 100;

                const newNode = {
                    id: newId,
                    type: dragData.payload,
                    name: conf.label,
                    children: [],
                    props: {
                        ...conf.defaultProps,
                        style: {
                            ...conf.defaultProps?.style,
                            position: element.props.layoutMode === 'flex' ? 'relative' : 'absolute',
                            left: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropX - (defaultW / 2))}px`,
                            top: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropY - (defaultH / 2))}px`,
                            width: conf.defaultProps?.style?.width || `${defaultW}px`,
                            height: dragData.payload === 'webpage' ? 'auto' : conf.defaultProps?.style?.height || `${defaultH}px`,
                            ...(dragData.payload === 'webpage' ? { minHeight: `${defaultH}px` } : {}),
                        }
                    },
                    content: conf.defaultContent,
                    src: conf.src
                };

                const newElements = { ...elements, [newId]: newNode };
                newElements[elementId].children = [...(newElements[elementId].children || []), newId];
                updateProject(newElements);
                setSelectedId(newId);
            }
        }
        else if (dragData.type === 'TEMPLATE') {
            const tpl = TEMPLATES[dragData.payload];
            if (tpl) {
                const { newNodes, rootId } = instantiateTemplate(tpl.rootId, tpl.nodes);
                const w = parseFloat(String(newNodes[rootId].props.style?.width || 0));
                const h = parseFloat(String(newNodes[rootId].props.style?.height || 0));

                newNodes[rootId].props.style = {
                    ...newNodes[rootId].props.style,
                    position: element.props.layoutMode === 'flex' ? 'relative' : 'absolute',
                    left: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropX - w / 2)}px`,
                    top: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropY - h / 2)}px`
                };

                if (isArtboard) {
                    const currentH = parseFloat(String(element.props.style?.height || rect.height / zoom));
                    const bottomEdge = (dropY - h / 2) + h + 50;
                    if (bottomEdge > currentH) {
                        const newElements = { ...elements, ...newNodes };
                        newElements[elementId].props.style = { ...newElements[elementId].props.style, height: `${bottomEdge}px` };
                        newElements[elementId].children = [...(newElements[elementId].children || []), rootId];
                        updateProject(newElements);
                        setSelectedId(rootId);
                        setDragData(null);
                        return;
                    }
                }

                const newElements = { ...elements, ...newNodes };
                newElements[elementId].children = [...(newElements[elementId].children || []), rootId];
                updateProject(newElements);
                setSelectedId(rootId);
            }
        }
        else if (dragData.type === 'ASSET_IMAGE') {
            const newId = `img-${Date.now()}`;
            const imgW = 256;
            const imgH = 192;
            const newNode = {
                id: newId, type: 'image', name: 'Image', children: [],
                props: {
                    className: 'object-cover rounded-lg shadow-sm',
                    style: {
                        position: (element.props.layoutMode === 'flex' ? 'relative' : 'absolute') as any,
                        left: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropX - imgW / 2)}px`,
                        top: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropY - imgH / 2)}px`,
                        width: `${imgW}px`, height: `${imgH}px`
                    }
                },
                src: dragData.payload,
            };
            const newElements = { ...elements, [newId]: newNode };
            newElements[elementId].children = [...(newElements[elementId].children || []), newId];
            updateProject(newElements);
            setSelectedId(newId);
        }
        else if (dragData.type === 'ICON') {
            const newId = `icon-${Date.now()}`;
            const iconSize = 48;
            const newNode = {
                id: newId, type: 'icon', name: dragData.payload, children: [],
                props: {
                    iconName: dragData.payload, className: 'text-slate-900',
                    style: {
                        position: (element.props.layoutMode === 'flex' ? 'relative' : 'absolute') as any,
                        left: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropX - iconSize / 2)}px`,
                        top: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropY - iconSize / 2)}px`,
                        width: `${iconSize}px`, height: `${iconSize}px`, color: 'inherit'
                    }
                }
            };
            const newElements = { ...elements, [newId]: newNode };
            newElements[elementId].children = [...(newElements[elementId].children || []), newId];
            updateProject(newElements);
            setSelectedId(newId);
        }
        else if (dragData.type === 'DATA_BINDING') {
            const newId = `data-${Date.now()}`;
            const isFlex = element.props.layoutMode === 'flex';
            const newNode: VectraNode = {
                id: newId, type: 'text', name: dragData.payload, children: [],
                props: {
                    className: 'text-blue-600 font-mono bg-blue-50 px-2 py-1 rounded border border-blue-200 text-sm inline-block',
                    style: {
                        position: isFlex ? 'relative' : 'absolute',
                        left: isFlex ? 'auto' : `${Math.round(dropX)}px`,
                        top: isFlex ? 'auto' : `${Math.round(dropY)}px`,
                        width: 'auto', height: 'auto'
                    }
                },
                content: `{{${dragData.payload}}}`
            };
            const newElements: VectraProject = { ...elements, [newId]: newNode };
            newElements[elementId].children = [...(newElements[elementId].children || []), newId];
            updateProject(newElements);
            setSelectedId(newId);
        }

        setDragData(null);
    };

    let finalStyle: React.CSSProperties = { ...element.props.style };
    let finalClass = element.props.className || '';

    if (element.props.layoutMode === 'grid') {
        finalStyle.display = 'grid';
    }

    const hasExplicitTransform = finalStyle.transform && finalStyle.transform !== 'none';

    if (!hasExplicitTransform) {
        const transformParts: string[] = [];
        if (finalStyle.rotate) transformParts.push(`rotate(${finalStyle.rotate})`);
        let currentScale = parseFloat(String(finalStyle.scale || 1));

        const hoverEffect = element.props.hoverEffect;
        if (hoverEffect && hoverEffect !== 'none') {
            finalStyle.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            if (isVisualHover && !interaction) {
                if (hoverEffect === 'lift') transformParts.push('translateY(-8px)');
                if (hoverEffect === 'scale') currentScale *= 1.05;
                if (hoverEffect === 'glow') finalStyle.boxShadow = '0 10px 40px -10px rgba(0,122,204,0.5)';
                if (hoverEffect === 'border') finalStyle.borderColor = '#007acc';
                if (hoverEffect === 'opacity') finalStyle.opacity = 0.7;
            }
        }

        if (currentScale !== 1) transformParts.push(`scale(${currentScale})`);
        if (transformParts.length > 0) finalStyle.transform = transformParts.join(' ');
    }

    if (!interaction && !element.props.hoverEffect) {
        finalStyle.transition = 'background-color 0.2s, color 0.2s, opacity 0.2s, transform 0.2s, border-radius 0.2s, border-width 0.2s';
    } else if (interaction) {
        finalStyle.transition = 'none';
    }

    // ── Direction A Gap A1: Breakpoint override merge ─────────────────────────
    // Applies per-node responsive overrides from props.breakpoints in the editor
    // so the canvas previews mobile/tablet styles live at the correct device setting.
    //
    // ORDER IS INTENTIONAL:
    //   1. Base style (props.style)         — already in finalStyle above
    //   2. Breakpoint merge (here)          — additively overrides specific keys
    //   3. Artboard / isMobileMirror blocks (below) — structural constraints always win
    //
    // We guard with !previewMode because the exported page applies overrides via
    // @media CSS rules (buildBreakpointCSS), not via inline style.
    if (!previewMode && element.props.breakpoints) {
        const bpOverride: React.CSSProperties =
            device === 'mobile' ? (element.props.breakpoints.mobile ?? {}) :
                device === 'tablet' ? (element.props.breakpoints.tablet ?? {}) :
                    {};
        if (Object.keys(bpOverride).length > 0) {
            Object.assign(finalStyle, bpOverride);
        }
    }
    // ── End Direction A Gap A1 ────────────────────────────────────────────────

    if (isArtboard) {
        finalStyle.display = 'block';
        // Allow AI content to grow the artboard — never clip it
        finalStyle.overflow = 'visible';
        const hasBg = finalStyle.backgroundColor || finalStyle.backgroundImage;
        if (!hasBg) finalStyle.backgroundColor = '#ffffff';
        finalClass = cn(finalClass, 'shadow-xl ring-1 ring-black/10');

        if (element.type === 'webpage') {
            // Grow with AI-generated content instead of clipping at a fixed height
            finalStyle.height = 'auto';
            finalStyle.minHeight = finalStyle.minHeight || '1080px';
        }

        if (previewMode && element.type === 'webpage') {
            finalStyle.position = 'relative'; finalStyle.left = 'auto'; finalStyle.top = 'auto'; finalStyle.transform = 'none';
            finalStyle.margin = '0 auto'; finalStyle.minHeight = '100vh';
            finalClass = cn(finalClass, '!shadow-none !border-none');
        } else {
            finalStyle.position = 'absolute';
        }
    }

    if (isParentCanvas && !isMobileMirror && !isArtboard) {
        finalStyle.position = 'absolute'; finalStyle.left = finalStyle.left || '0px'; finalStyle.top = finalStyle.top || '0px';
        finalClass = finalClass.replace(/relative|fixed|sticky/g, '');
    }

    if (isMobileMirror) {
        finalStyle = { ...finalStyle, position: 'relative', left: 'auto', top: 'auto', width: '100%', height: 'auto', transform: 'none' };
    }

    let content = null;
    const LoadingPlaceholder = () => <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400"><Loader2 className="animate-spin" size={24} /></div>;

    if (element.type === 'accordion') content = <SmartAccordion {...element.props} />;
    else if (element.type === 'carousel') content = <SmartCarousel {...element.props} />;
    else if (element.type === 'table') content = <SmartTable {...element.props} />;
    // --- CUSTOM AI-GENERATED COMPONENT (Live Compiler) ---
    else if ((element.type === 'custom_component' || element.type === 'custom_code') && element.code) {
        content = (
            <Suspense fallback={<LoadingPlaceholder />}>
                <LiveComponent
                    code={element.code}
                    elementId={elementId}
                    updateProject={updateProject}
                    elements={elements}
                    {...(element.props as any)}
                />
            </Suspense>
        );
    }
    else if (element.type === 'geometric_shapes') content = <Suspense fallback={<LoadingPlaceholder />}><GeometricShapes {...(element.props as any)} /></Suspense>;
    else if (element.type === 'geometric_bg') content = <Suspense fallback={<LoadingPlaceholder />}><GeometricShapesBackground {...(element.props as any)} /></Suspense>;
    else if (element.type === 'feature_hover') content = <Suspense fallback={<LoadingPlaceholder />}><FeatureHover {...(element.props as any)} /></Suspense>;
    else if (element.type === 'features_section') content = <Suspense fallback={<LoadingPlaceholder />}><FeaturesSectionWithHoverEffects {...(element.props as any)} /></Suspense>;
    else if (element.type === 'hero_geometric') content = <Suspense fallback={<LoadingPlaceholder />}><HeroGeometric {...(element.props as any)} /></Suspense>;
    else if (element.type === 'hero_modern') {
        content = <>{element.children?.map(childId => <RenderNode key={isMobileMirror ? `${childId}-mobile` : childId} elementId={childId} isMobileMirror={isMobileMirror} />)}</>;
    }
    else if (element.type === 'text' || element.type === 'button' || element.type === 'heading' || element.type === 'link') {
        content = element.content;
    }
    else if (element.type === 'input') {
        content = <input type="text" readOnly className="w-full h-full bg-transparent outline-none border-none text-inherit px-2 cursor-text" placeholder={element.props.placeholder || 'Input...'} />;
    }
    else if (element.type === 'checkbox') {
        content = <input type="checkbox" readOnly className="w-5 h-5 accent-blue-600 pointer-events-none" checked={element.props.checked} />;
    }
    else if (element.type === 'image') {
        content = <img className="w-full h-full object-cover pointer-events-none" src={element.src} alt="" />;
    }
    else if (element.type === 'video') {
        content = (
            <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900/10 text-slate-400 pointer-events-none border border-slate-200/50 rounded-lg overflow-hidden">
                <PlayCircle size={32} className="mb-2 opacity-40 text-slate-900" />
                <span className="text-[10px] font-bold tracking-widest uppercase text-slate-900 opacity-40">Video Player</span>
            </div>
        );
    }
    else if (element.type === 'icon') {
        const IconComp = getIconComponent(element.props.iconName || element.name || 'HelpCircle');
        content = <IconComp className="w-full h-full" strokeWidth={1.5} />;
    }
    else {
        content = (
            <>
                {(element.type === 'canvas' || element.type === 'webpage') && !previewMode && !isMobileMirror && (
                    <div className="absolute top-0 left-0 bg-white text-slate-500 text-[10px] px-2 py-0.5 rounded-br border-b border-r border-slate-200 pointer-events-none z-10 font-medium">
                        {element.name}
                    </div>
                )}
                {element.children?.map(childId => (
                    <RenderNode key={isMobileMirror ? `${childId}-mobile` : childId} elementId={childId} isMobileMirror={isMobileMirror} />
                ))}
                {isContainer && !isArtboard && !element.children?.length && !previewMode && !element.props['data-custom-code'] && (
                    <div
                        onClick={(e) => { e.stopPropagation(); setSelectedId(elementId); setActivePanel('add'); }}
                        className="w-full h-full min-h-[60px] flex items-center justify-center gap-2 border-2 border-dashed border-slate-300/50 rounded hover:border-blue-500/50 hover:bg-blue-500/5 transition-all cursor-pointer group"
                    >
                        <Plus size={16} className="text-neutral-400 group-hover:text-blue-500" />
                    </div>
                )}
            </>
        );
    }

    const motionProps: any = {};
    if (element.props.animation && element.props.animation !== 'none') {
        const type = element.props.animation;
        if (type === 'fade') { motionProps.initial = { opacity: 0 }; motionProps.animate = { opacity: 1 }; }
        if (type === 'slide-up') { motionProps.initial = { opacity: 0, y: 20 }; motionProps.animate = { opacity: 1, y: 0 }; }
        if (type === 'slide-left') { motionProps.initial = { opacity: 0, x: -20 }; motionProps.animate = { opacity: 1, x: 0 }; }
        if (type === 'scale-in') { motionProps.initial = { opacity: 0, scale: 0.9 }; motionProps.animate = { opacity: 1, scale: 1 }; }

        const duration = element.props.animationDuration !== undefined ? element.props.animationDuration : 0.3;
        const delay = element.props.animationDelay !== undefined ? element.props.animationDelay : 0;
        motionProps.transition = { duration, delay, ease: 'easeOut' };
    }

    if (element.props.hoverEffect && element.props.hoverEffect !== 'none' && !interaction) {
        const type = element.props.hoverEffect;
        if (type === 'scale') motionProps.whileHover = { scale: 1.05 };
        if (type === 'lift') motionProps.whileHover = { y: -8 };
        if (type === 'glow') motionProps.whileHover = { boxShadow: "0 10px 40px -10px rgba(0,122,204,0.5)" };
        if (type === 'border') motionProps.whileHover = { borderColor: "#007acc" };
        if (type === 'opacity') motionProps.whileHover = { opacity: 0.7 };
        if (!motionProps.transition) motionProps.transition = { duration: 0.2 };
    }

    return (
        <motion.div
            key={`${elementId}-${animKey}`}
            ref={nodeRef}
            {...motionProps}
            id={isMobileMirror ? `${element.props.id}-mobile` : element.id}
            data-vid={element.id}         // Direction A Gap A2: enables [data-vid] CSS selectors from buildBreakpointCSS
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onMouseEnter={() => setIsVisualHover(true)}
            onMouseLeave={() => setIsVisualHover(false)}
            contentEditable={isEditing}
            suppressContentEditableWarning
            onBlur={(e) => {
                if (isEditing) {
                    setIsEditing(false);
                    updateProject({ ...elements, [elementId]: { ...elements[elementId], content: e.currentTarget.innerText } });
                }
            }}
            className={cn(
                finalClass,
                'box-border',
                isSelected && !isMobileMirror && !isEditing && 'outline outline-2 outline-blue-500 z-50',
                // Item 2 — multi-select ring: distinct orange so anchor vs group is clear
                isMultiSel && !isSelected && !isMobileMirror && 'outline outline-2 outline-orange-400 z-40',
                isHovered && !isSelected && !isMultiSel && !isMobileMirror && 'outline outline-2 outline-blue-500 z-40',
                canMove ? 'cursor-move' : '',
                isArtboard ? 'bg-white' : ''
            )}
            style={finalStyle}
            onPointerOver={(e: any) => { if (previewMode || dragData) return; e.stopPropagation(); setHoveredId(elementId); }}
            onPointerOut={() => { if (!previewMode) setHoveredId(null); }}
        >
            {isSelected && !isMobileMirror && !isEditing && !element.locked && (isParentCanvas || isArtboard) && !previewMode && (
                <Resizer elementId={elementId} />
            )}
            {content}
        </motion.div>
    );
};

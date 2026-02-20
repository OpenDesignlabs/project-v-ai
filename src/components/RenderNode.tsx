import React, { useRef, useState, useEffect, Suspense, lazy } from 'react';
import { useEditor } from '../context/EditorContext';
import type { VectraProject, VectraNode } from '../types';
import { TEMPLATES } from '../data/templates';
import { Resizer } from './Resizer';
import { cn } from '../lib/utils';
import { Loader2, Plus, PlayCircle } from 'lucide-react';
import { motion } from 'framer-motion';
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

// --- LIVE COMPILER ---
// Compiles raw AI-generated JSX code strings into real React components at runtime.
// Uses Babel Standalone (loaded via index.html) to transpile JSX → CommonJS JS.
// Scope (React, Lucide, motion, cn) is injected so AI code needs no imports.
//
// SECURITY NOTE: new Function() executes with app-origin privileges.
// We apply a keyword blocklist as defense-in-depth before any transpilation.
const BLOCKED_PATTERNS = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /document\s*\.\s*cookie/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\bimportScripts\s*\(/,
    /navigator\s*\.\s*(sendBeacon|geolocation|credentials)/,
    /window\s*\.\s*open\s*\(/,
    /location\s*\.\s*(href|replace|assign)/,
];

const LiveComponent = ({ code, ...props }: { code: string;[key: string]: any }) => {
    const [Component, setComponent] = useState<React.ElementType | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!code) return;
        try {
            // ── Step 1: Security scan ───────────────────────────────────────
            const violation = BLOCKED_PATTERNS.find(p => p.test(code));
            if (violation) throw new Error(`Security violation: ${violation.source.slice(0, 40)}`);

            // ── Step 2: Pre-clean — convert ALL export forms to bare return ──────
            // This MUST happen before Babel. If Babel sees 'export default' it
            // emits Object.defineProperty(exports,'__esModule') which our sandbox
            // can't satisfy. Converting to 'return' means the new Function body
            // itself returns the component — zero exports lookup needed.
            const cleanCode = code
                .replace(/import\s+[\s\S]*?from\s+['"\`][^'"\`]+['"\`];?/g, '') // strip imports
                .replace(/export\s+default\s+function\s+([A-Za-z0-9_]*)/g,      // export default fn
                    'return function $1')
                .replace(/export\s+function\s+([A-Za-z0-9_]+)/g,                // export named fn
                    'return function $1')
                .replace(/export\s+default\s+([A-Za-z0-9_]+)\s*;?/g,           // export default id
                    'return $1;')
                .trim();

            // ── Step 3: Transpile — sourceType:'script' prevents any module boilerplate ──
            const Babel = (window as any).Babel;
            if (!Babel) throw new Error('Babel not loaded. Please wait and try again.');

            const transpiled = Babel.transform(cleanCode, {
                presets: ['react', 'env'],
                sourceType: 'script',   // <─ critical: no module polyfills emitted
                filename: 'component.jsx',
                configFile: false,
                babelrc: false,
            }).code;

            // ── Step 4: Execute — transpiled code contains 'return function Foo(){}' ──
            // new Function wraps it, so the return bubbles up directly as the component.
            // eslint-disable-next-line no-new-func
            const factory = new Function('React', 'Lucide', 'motion', 'cn', transpiled);
            const Comp = factory(React, LucideAll, motion, cn);

            if (typeof Comp !== 'function') {
                throw new Error('Code did not return a React component. Ensure it has: export default function MyComponent() { ... }');
            }
            setComponent(() => Comp);
            setError(null);

        } catch (e: any) {
            console.error('🔴 LiveComponent compile error:', e.message);
            setError(e.message || 'Unknown compile error');
        }
    }, [code]);

    if (error) return (
        <div className='p-4 border-2 border-dashed border-red-400 bg-red-950/30 rounded-lg text-red-400 text-sm font-mono w-full h-full overflow-auto'>
            <strong>⚠ Live Compile Error</strong>
            <pre className='mt-2 whitespace-pre-wrap text-xs'>{error}</pre>
        </div>
    );
    if (!Component) return (
        <div className='p-4 text-zinc-500 animate-pulse w-full h-full flex items-center justify-center bg-zinc-900/20 text-sm'>
            Compiling UI...
        </div>
    );
    return <Component {...props} />;
};


interface RenderNodeProps { elementId: string; isMobileMirror?: boolean; }

export const RenderNode: React.FC<RenderNodeProps> = ({ elementId, isMobileMirror = false }) => {
    const {
        elements, selectedId, setSelectedId, hoveredId, setHoveredId,
        previewMode, dragData, setDragData, updateProject,
        interaction, setInteraction, zoom, activeTool, setActivePanel,
        instantiateTemplate, componentRegistry
    } = useEditor();

    const element = elements[elementId];
    const nodeRef = useRef<HTMLDivElement>(null);
    const [isEditing, setIsEditing] = useState(false);

    // --- HOVER STATE ---
    const [isVisualHover, setIsVisualHover] = useState(false);

    // Animation State
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
            setAnimKey(prev => prev + 1); // Re-mount or re-trigger animation
        }
    }, [element?.props?.animation, styleAny?.['--anim-trigger'], previewMode]);

    const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0 });

    if (!element) return null;

    if (previewMode && element.type === 'canvas') return null;
    if (element.hidden && !previewMode) return <div className="hidden" />;
    if (element.hidden && previewMode) return null;

    const isSelected = selectedId === elementId && !previewMode;
    const isHovered = hoveredId === elementId && !isSelected && !previewMode && !dragData;
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
        // FIX: Safety Check - if element is somehow undefined, abort immediately
        if (!element) return;

        // FIX 2: Do NOT stop propagation yet. Check if this is a valid target first.
        const isValidTarget = isArtboard || element.props.layoutMode;

        // If this element cannot accept drops, let the event bubble to its parent
        if (!isValidTarget || element.locked || previewMode) return;

        // If we are here, THIS element will handle the drop. Now we stop bubbling.
        e.stopPropagation();
        e.preventDefault();

        if (!dragData) return;

        const rect = nodeRef.current?.getBoundingClientRect();
        if (!rect) return;

        const dropX = (e.clientX - rect.left) / zoom;
        const dropY = (e.clientY - rect.top) / zoom;

        if (dragData.type === 'NEW') {
            const conf = componentRegistry[dragData.payload]; // FIX 1: Use registry
            if (conf) {
                const newId = `el-${Date.now()}`;
                const isFrame = dragData.payload === 'webpage' || dragData.payload === 'canvas';
                const defaultW = isFrame ? 800 : 200;
                const defaultH = isFrame ? 600 : 100;

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
                            height: conf.defaultProps?.style?.height || `${defaultH}px`
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
                id: newId,
                type: 'image',
                name: 'Image',
                children: [],
                props: {
                    className: 'object-cover rounded-lg shadow-sm',
                    style: {
                        position: (element.props.layoutMode === 'flex' ? 'relative' : 'absolute') as any,
                        left: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropX - imgW / 2)}px`,
                        top: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropY - imgH / 2)}px`,
                        width: `${imgW}px`,
                        height: `${imgH}px`
                    }
                },
                src: dragData.payload,
            };

            const newElements = { ...elements, [newId]: newNode };
            newElements[elementId].children = [...(newElements[elementId].children || []), newId];
            updateProject(newElements);
            setSelectedId(newId);
        }
        // Handle Icon drops from Icon Explorer
        else if (dragData.type === 'ICON') {
            const newId = `icon-${Date.now()}`;
            const iconSize = 48;

            const newNode = {
                id: newId,
                type: 'icon',
                name: dragData.payload, // Stores Icon Name like 'Activity'
                children: [],
                props: {
                    iconName: dragData.payload,
                    className: 'text-slate-900',
                    style: {
                        position: (element.props.layoutMode === 'flex' ? 'relative' : 'absolute') as any,
                        left: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropX - iconSize / 2)}px`,
                        top: element.props.layoutMode === 'flex' ? 'auto' : `${Math.round(dropY - iconSize / 2)}px`,
                        width: `${iconSize}px`,
                        height: `${iconSize}px`,
                        color: 'inherit'
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
                id: newId,
                type: 'text',
                name: dragData.payload,
                children: [],
                props: {
                    className: 'text-blue-600 font-mono bg-blue-50 px-2 py-1 rounded border border-blue-200 text-sm inline-block',
                    style: {
                        position: isFlex ? 'relative' : 'absolute',
                        left: isFlex ? 'auto' : `${Math.round(dropX)}px`,
                        top: isFlex ? 'auto' : `${Math.round(dropY)}px`,
                        width: 'auto',
                        height: 'auto'
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

    // Part 3: Grid layout support
    if (element.props.layoutMode === 'grid') {
        finalStyle.display = 'grid';
    }

    // Part 3: Transform handling - prioritize explicit transform string
    const hasExplicitTransform = finalStyle.transform && finalStyle.transform !== 'none';

    if (!hasExplicitTransform) {
        // Legacy fallback for old rotate/scale props
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



    if (isArtboard) {
        finalStyle.display = 'block';
        finalStyle.overflow = 'hidden';
        const hasBg = finalStyle.backgroundColor || finalStyle.backgroundImage;
        if (!hasBg) finalStyle.backgroundColor = '#ffffff';
        finalClass = cn(finalClass, 'shadow-xl ring-1 ring-black/10');

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
    else if (element.type === 'custom_component' && element.code) {
        content = (
            <Suspense fallback={<LoadingPlaceholder />}>
                <LiveComponent code={element.code} {...(element.props as any)} />
            </Suspense>
        );
    }

    // Geometric Shapes (new default export)
    else if (element.type === 'geometric_shapes') content = <Suspense fallback={<LoadingPlaceholder />}><GeometricShapes {...(element.props as any)} /></Suspense>;
    else if (element.type === 'geometric_bg') content = <Suspense fallback={<LoadingPlaceholder />}><GeometricShapesBackground {...(element.props as any)} /></Suspense>;

    // Feature Cards (new default export with dynamic props)
    else if (element.type === 'feature_hover') content = <Suspense fallback={<LoadingPlaceholder />}><FeatureHover {...(element.props as any)} /></Suspense>;
    else if (element.type === 'features_section') content = <Suspense fallback={<LoadingPlaceholder />}><FeaturesSectionWithHoverEffects {...(element.props as any)} /></Suspense>;

    // Hero Section (dynamic props: badge, title1, title2, subtitle)
    else if (element.type === 'hero_geometric') content = <Suspense fallback={<LoadingPlaceholder />}><HeroGeometric {...(element.props as any)} /></Suspense>;

    else if (element.type === 'hero_modern') {
        content = <>{element.children?.map(childId => <RenderNode key={isMobileMirror ? `${childId}-mobile` : childId} elementId={childId} isMobileMirror={isMobileMirror} />)}</>;
    }
    // TEXT / BASIC TYPES
    else if (element.type === 'text' || element.type === 'button' || element.type === 'heading' || element.type === 'link') {
        content = element.content;
    }
    // INPUTS
    else if (element.type === 'input') {
        content = (
            <input
                type="text"
                readOnly
                className="w-full h-full bg-transparent outline-none border-none text-inherit px-2 cursor-text"
                placeholder={element.props.placeholder || 'Input...'}
            />
        );
    }
    else if (element.type === 'checkbox') {
        content = (
            <input
                type="checkbox"
                readOnly
                className="w-5 h-5 accent-blue-600 pointer-events-none"
                checked={element.props.checked}
            />
        );
    }
    // MEDIA
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
    // ICONS (from Icon Explorer)
    else if (element.type === 'icon') {
        const IconComp = getIconComponent(element.props.iconName || element.name || 'HelpCircle');
        content = <IconComp className="w-full h-full" strokeWidth={1.5} />;
    }
    // CONTAINERS / PAGES
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

                {/* Empty Container Placeholder */}
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

        if (!motionProps.transition) {
            motionProps.transition = { duration: 0.2 };
        }
    }

    return (
        <motion.div
            key={`${elementId}-${animKey}`}
            ref={nodeRef}
            {...motionProps}
            id={isMobileMirror ? `${element.props.id}-mobile` : element.id}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onMouseEnter={() => setIsVisualHover(true)}
            onMouseLeave={() => setIsVisualHover(false)}
            contentEditable={isEditing}
            suppressContentEditableWarning
            onBlur={(e) => { if (isEditing) { setIsEditing(false); updateProject({ ...elements, [elementId]: { ...elements[elementId], content: e.currentTarget.innerText } }); } }}
            className={cn(
                finalClass,
                'box-border',
                isSelected && !isMobileMirror && !isEditing && 'outline outline-2 outline-blue-500 z-50',
                isHovered && !isSelected && !isMobileMirror && 'outline outline-2 outline-blue-500 z-40',
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

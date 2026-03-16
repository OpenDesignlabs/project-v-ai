import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import React from 'react';
import { useEditor } from '../context/EditorContext';
import { useUI } from '../context/UIContext';
import ColorPicker from 'react-best-gradient-color-picker';
import { Section, Row, NumberInput, ColorInput, ToggleGroup, BoxModel, TextInput, SelectInput } from './ui/PremiumInputs';
import { removeClasses } from '../utils/tailwindHelpers';
import {
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    Grid, Box, Maximize, Lock, Eye,
    Type, ArrowRight, ArrowDown, Image as ImageIcon, PaintBucket, RotateCw, MousePointer2,
    Hand, Settings, Layout, Hash, Type as TypeIcon,
    MoveHorizontal, MoveVertical, Droplets, Sun, Move,
    CornerUpLeft, CornerUpRight, CornerDownLeft, CornerDownRight, Layers,
    Smartphone, Tablet, Monitor,
    Code2, Wand2, Clipboard, ClipboardCheck, TerminalSquare, Loader2,
} from 'lucide-react';
import { fixComponentError } from '../services/aiAgent';
import { cn } from '../lib/utils';
import {
    type VectraLoaderPropSchema,
    resolveControlType,
} from '../utils/vectraLoaderBridge';

// --- TYPES ---
// CODE-TAB-1 [PERMANENT]: 'code' tab is only shown/active for custom_code nodes.
// It is never the default tab for structural elements (containers, text, images).
type Tab = 'design' | 'interact' | 'settings' | 'props' | 'code';
type FillMode = 'solid' | 'gradient' | 'image';

// --- SUB-COMPONENTS ---

/**
 * AddPropRow — isolated sub-component so useState is called at the correct
 * hook level. PROPS-TAB-3 [PERMANENT]: hooks must not be called inside
 * callbacks, conditionals, or IIFEs. Extracting here keeps the parent clean.
 */
const AddPropRow: React.FC<{ onAdd: (key: string, value: string) => void }> = ({ onAdd }) => {
    const [newKey, setNewKey] = React.useState('');
    const [newVal, setNewVal] = React.useState('');
    const commit = () => {
        if (!newKey.trim()) return;
        onAdd(newKey.trim(), newVal);
        setNewKey('');
        setNewVal('');
    };
    return (
        <div className="mt-2 flex gap-1.5">
            <input
                type="text" value={newKey}
                onChange={e => setNewKey(e.target.value)}
                placeholder="key"
                className="w-24 bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white font-mono outline-none focus:border-blue-500/50 placeholder-[#444]"
            />
            <input
                type="text" value={newVal}
                onChange={e => setNewVal(e.target.value)}
                placeholder="value"
                onKeyDown={e => { if (e.key === 'Enter') commit(); }}
                className="flex-1 bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white font-mono outline-none focus:border-blue-500/50 placeholder-[#444]"
            />
            <button
                onClick={commit}
                className="px-2 py-1 rounded bg-[#2a2a2d] border border-[#3e3e42] text-[10px] text-[#888] hover:text-white transition-all"
            >+</button>
        </div>
    );
};

const TabButton = ({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Layout; label: string }) => (
    <button
        onClick={onClick}
        className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all",
            active ? "border-[#007acc] text-white bg-[#2d2d2d]" : "border-transparent text-[#666] hover:text-[#999] hover:bg-[#3d3d3d]"
        )}
    >
        <Icon size={14} />
        {label}
    </button>
);

const RangeControl = ({ label, value, max, min = 0, onChange, unit = '' }: { label: string; value: number; max: number; min?: number; onChange: (v: number) => void; unit?: string }) => (
    <div>
        <div className="flex justify-between mb-1">
            <label className="text-[9px] text-[#888] uppercase font-semibold">{label}</label>
            <span className="text-[9px] text-[#666]">{value}{unit}</span>
        </div>
        <input
            type="range" min={min} max={max} value={value}
            onChange={(e) => onChange(parseInt(e.target.value))}
            className="w-full accent-blue-500 h-1 bg-[#333] rounded-lg appearance-none cursor-pointer"
        />
    </div>
);

const InputUnit = ({ label, icon: Icon, value, onChange, step, unit }: { label: string; icon: any; value: number; onChange: (v: number) => void; step?: number; unit?: string }) => (
    <div className="bg-[#2a2a2c] p-2 rounded border border-[#333] flex items-center justify-between">
        <div className="flex items-center gap-2 text-[#888]">
            <Icon size={12} />
            <span className="text-[9px] uppercase font-semibold">{label}</span>
        </div>
        <div className="flex items-center gap-0.5">
            <input
                type="number"
                step={step || 1}
                className="w-12 bg-transparent text-right text-xs text-white outline-none border-b border-transparent focus:border-blue-500"
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            />
            {unit && <span className="text-[9px] text-[#666]">{unit}</span>}
        </div>
    </div>
);

export const RightSidebar = () => {
    const { elements, selectedId, updateProject, pushHistory, elementsRef, previewMode, pages, parentMap, setElements, componentRegistry, setMagicBarOpen } = useEditor();
    // Direction A: read activeBreakpoint and setDevice from UIContext
    const { activeBreakpoint, setDevice, selectedIds } = useUI();
    const [activeTab, setActiveTab] = useState<Tab>('design');
    const [animScope, setAnimScope] = useState<'single' | 'all'>('single');
    // NM-7 FIX: track whether the user is actively dragging a slider so we can skip
    // history entries during the drag and commit exactly ONE entry on pointerUp.
    // Previously every onChange called updateProject() without skipHistory — dragging
    // opacity 100→50 produced ~50 undo steps, evicting all prior structural changes.
    const isSliderDragging = useRef(false);

    // Local state for glassmorphism effects
    const [blur, setBlur] = useState(0);
    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);

    // Local state for gradient picker
    const [colorPickerValue, setColorPickerValue] = useState('rgba(255,255,255,1)');

    // Local state for transforms
    const [rotate, setRotate] = useState(0);
    const [scale, setScale] = useState(1);
    const [skewX, setSkewX] = useState(0);
    const [skewY, setSkewY] = useState(0);
    const [translateX, setTranslateX] = useState(0);
    const [translateY, setTranslateY] = useState(0);

    // Get element
    const element = selectedId ? elements[selectedId] : null;

    // FIX-13: Derive fillMode from element's actual background style (after element is declared).
    // derivedFillMode reflects the element's real fill every render.
    // fillModeOverride is set when the user manually clicks a fill-type tab.
    // fillMode = override ?? derived. Override cleared on element.id switch.
    const derivedFillMode = useMemo((): FillMode => {
        const bg = String(element?.props?.style?.background ?? element?.props?.style?.backgroundImage ?? '');
        if (bg.includes('gradient')) return 'gradient';
        if (bg.includes('url(')) return 'image';
        return 'solid';
    }, [element?.props?.style?.background, element?.props?.style?.backgroundImage]);
    const [fillModeOverride, setFillModeOverride] = useState<FillMode | null>(null);
    const fillMode = fillModeOverride ?? derivedFillMode;
    useEffect(() => { setFillModeOverride(null); }, [element?.id]);

    // ── Code Tab: isCodeNode ──────────────────────────────────────────────────
    // True for AI-generated and manually-imported custom_code nodes that carry
    // inline source. Loader-registered components (importMeta path) do NOT set
    // element.code — they render via the registry. Mutually exclusive with Props tab.
    const isCodeNode = !!(
        (element?.type === 'custom_code' || element?.type === 'custom_component') &&
        element?.code
    );

    // Local textarea buffer — avoids calling setElements on every keystroke.
    // CODE-TAB-2 [PERMANENT]: write to elements only on blur or Cmd+Enter,
    // same pattern as PROPS-TAB-2. Keystroke-level setElements at 60wpm would
    // push ~8 state updates/sec and thrash the Babel worker queue.
    const [localCode, setLocalCode] = useState<string>('');
    const [isAiFixing, setIsAiFixing] = useState(false);
    const [codeCopied, setCodeCopied] = useState(false);
    const prevElementIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!element) return;
        const style = element.props.style || {};

        // Parse Backdrop Filter
        const bf = String(style.backdropFilter || '');
        const blurMatch = bf.match(/blur\((\d+)px\)/);
        const brightMatch = bf.match(/brightness\(([\d.]+)\)/);
        const contMatch = bf.match(/contrast\(([\d.]+)\)/);

        if (blurMatch) setBlur(parseInt(blurMatch[1])); else setBlur(0);
        if (brightMatch) setBrightness(Math.round(parseFloat(brightMatch[1]) * 100)); else setBrightness(100);
        if (contMatch) setContrast(Math.round(parseFloat(contMatch[1]) * 100)); else setContrast(100);

        // Set color picker value
        if (style.background) setColorPickerValue(String(style.background));
        else if (style.backgroundColor) setColorPickerValue(String(style.backgroundColor));

        // Parse Transforms
        const transform = String(style.transform || '');
        const rotMatch = transform.match(/rotate\(([\d.-]+)deg\)/);
        const scMatch = transform.match(/scale\(([\d.-]+)\)/);
        const skXMatch = transform.match(/skewX\(([\d.-]+)deg\)/);
        const skYMatch = transform.match(/skewY\(([\d.-]+)deg\)/);
        const trMatch = transform.match(/translate\(([\d.-]+)px,\s*([\d.-]+)px\)/);

        setRotate(rotMatch ? parseFloat(rotMatch[1]) : 0);
        setScale(scMatch ? parseFloat(scMatch[1]) : 1);
        setSkewX(skXMatch ? parseFloat(skXMatch[1]) : 0);
        setSkewY(skYMatch ? parseFloat(skYMatch[1]) : 0);
        if (trMatch) { setTranslateX(parseFloat(trMatch[1])); setTranslateY(parseFloat(trMatch[2])); }
        else { setTranslateX(0); setTranslateY(0); }

    }, [
        element?.id,
        // NS-5 FIX: re-parse whenever these specific style values change, not just on selection.
        // AI generation, Cmd+Z, and programmatic setElements can all update transform/filter
        // without changing the selected element ID — sliders showed stale values while canvas
        // rendered correctly.
        element?.props?.style?.transform,
        element?.props?.style?.backdropFilter,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ]);

    // ── Code Tab: sync localCode when element or its code changes ─────────────
    // Deps: element.id (selection change) + element.code (external fix applied
    // by ComponentErrorBoundary auto-fix loop). Both cases must reset localCode.
    useEffect(() => {
        setLocalCode(element?.code ?? '');
    }, [element?.id, element?.code]);

    // ── Code Tab: auto-switch to 'code' tab when a code node is selected ──────
    // Only fires on selection change (element.id), not on every code update.
    // Does NOT auto-switch away — user's manual tab choice is respected.
    useEffect(() => {
        if (!element) return;
        if (element.id === prevElementIdRef.current) return;
        prevElementIdRef.current = element.id;
        const isCode = (element.type === 'custom_code' || element.type === 'custom_component') && !!element.code;
        if (isCode) setActiveTab('code');
    }, [element?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Code Tab: commitCode ──────────────────────────────────────────────────
    // HOOKS-ORDER-1 [PERMANENT]: declared HERE, before ALL early returns.
    // useCallback must never appear after an early return — React counts hooks
    // in render order; a conditional early-return that skips a hook causes
    // "Rendered more hooks than during the previous render" crash.
    // Internal `if (!element) return` guards the null case safely.
    const commitCode = useCallback(() => {
        if (!element) return;
        const code = localCode;
        setElements(prev => ({
            ...prev,
            [element.id]: { ...prev[element.id], code },
        }));
        setTimeout(() => pushHistory(elementsRef.current), 0);
    }, [element, localCode, setElements, pushHistory, elementsRef]);

    // ── Code Tab: handleAiFix ─────────────────────────────────────────────────
    // HOOKS-ORDER-1 [PERMANENT]: same constraint — before all early returns.
    const handleAiFix = useCallback(async () => {
        if (!element || !localCode || isAiFixing) return;
        setIsAiFixing(true);
        try {
            const fixed = await fixComponentError(
                localCode,
                [
                    'Ensure this component renders without errors in the Vectra sandbox.',
                    'Fix: icon bracket notation (use const IC = Lucide[name]; not <Lucide[name]/>),',
                    'hook-outside-function violations, missing export default, invalid JSX syntax,',
                    'undefined .map() calls (add ?? []), and multiple root elements (wrap in <>).',
                    'Preserve ALL visual design intent — only fix what is broken.',
                ].join(' ')
            );
            setLocalCode(fixed);
            setElements(prev => ({
                ...prev,
                [element.id]: { ...prev[element.id], code: fixed },
            }));
            setTimeout(() => pushHistory(elementsRef.current), 0);
        } catch (err) {
            console.error('[CodeTab] AI Fix failed:', err);
        } finally {
            setIsAiFixing(false);
        }
    }, [element, localCode, isAiFixing, setElements, pushHistory, elementsRef]);

    if (previewMode) return null;

    // --- EMPTY STATE (Simplified) ---
    if (!element) {
        return (
            <div className="w-[320px] bg-[#333333] border-l border-[#252526] h-full flex flex-col items-center justify-center text-center p-6 text-[#666]">
                <MousePointer2 size={48} className="mb-4 opacity-20" />
                <h3 className="text-sm font-bold text-[#888] mb-2">No Selection</h3>
                <p className="text-xs max-w-[200px]">Select an element to edit properties, or use the AI Agent to generate new content.</p>
            </div>
        );
    }

    const updateStyle = (key: string, value: any) => {
        const unitlessKeys = ['fontWeight', 'opacity', 'zIndex', 'flexGrow', 'scale', 'lineHeight'];
        const finalValue = (typeof value === 'number' && !unitlessKeys.includes(key)) ? `${value}px` : value;

        let targetIds = [element.id];

        if (animScope === 'all' && key.startsWith('animation')) {
            // M-7 FIX: O(1) lookup via parentMap instead of O(N) Object.keys().find().
            const parentId = parentMap.get(element.id);
            if (parentId) {
                const parent = elements[parentId];
                if (['webpage', 'canvas', 'page'].includes(parent.type)) {
                    targetIds = parent.children || [];
                }
            }
        }

        // C-2 FIX: build the updated element map without mutating any existing reference.
        // Each node in targetIds is fully cloned along its mutation path.
        const next = { ...elements };
        targetIds.forEach(id => {
            const el = next[id];
            if (!el) return;
            if (activeBreakpoint === 'desktop') {
                const currentStyle = el.props.style || {};
                let mergeStyle: Record<string, any> = {};
                if (key === 'animationName' && value !== 'none' && !currentStyle.animationDuration) {
                    mergeStyle = { animationDuration: '0.5s', animationFillMode: 'both' };
                }
                next[id] = {
                    ...el,
                    props: {
                        ...el.props,
                        style: { ...currentStyle, [key]: finalValue, ...mergeStyle },
                    },
                };
            } else {
                const bp = activeBreakpoint;
                const currentBpStyle = el.props.breakpoints?.[bp] || {};
                next[id] = {
                    ...el,
                    props: {
                        ...el.props,
                        breakpoints: {
                            ...(el.props.breakpoints || {}),
                            [bp]: { ...currentBpStyle, [key]: finalValue },
                        },
                    },
                };
            }
        });

        updateProject(next, { skipHistory: isSliderDragging.current });
    };

    // NM-7: call on slider pointerUp to commit one stable history entry.
    const commitSliderHistory = () => {
        isSliderDragging.current = false;
        pushHistory(elementsRef.current);
    };
    // Spread onto any NumberInput that should participate in skip-history drag:
    //   <NumberInput {...sliderDragProps} ... />
    const sliderDragProps = {
        onDragStart: () => { isSliderDragging.current = true; },
        onDragEnd: commitSliderHistory,
    };

    // C-2 FIX: clone the node chain — don't mutate newElements[element.id].props in-place.
    const updateProp = (key: string, value: any) => {
        const el = elements[element.id];
        const updatedNode = { ...el, props: { ...el.props, [key]: value } };
        updateProject({ ...elements, [element.id]: updatedNode });
    };

    const updateFilter = (newBlur: number, newBright: number, newCont: number) => {
        setBlur(newBlur);
        setBrightness(newBright);
        setContrast(newCont);
        const parts = [];
        if (newBlur > 0) parts.push(`blur(${newBlur}px)`);
        if (newBright !== 100) parts.push(`brightness(${newBright / 100})`);
        if (newCont !== 100) parts.push(`contrast(${newCont / 100})`);
        updateStyle('backdropFilter', parts.length > 0 ? parts.join(' ') : 'none');
    };

    const updateTransform = () => {
        const parts = [];
        if (rotate !== 0) parts.push(`rotate(${rotate}deg)`);
        if (scale !== 1) parts.push(`scale(${scale})`);
        if (skewX !== 0) parts.push(`skewX(${skewX}deg)`);
        if (skewY !== 0) parts.push(`skewY(${skewY}deg)`);
        if (translateX !== 0 || translateY !== 0) parts.push(`translate(${translateX}px, ${translateY}px)`);
        updateStyle('transform', parts.length > 0 ? parts.join(' ') : 'none');
    };

    const handleGridChange = (key: string, val: number) => {
        updateStyle(key, `repeat(${val}, 1fr)`);
    };

    // Direction A: when on a non-desktop breakpoint, the style panel displays
    // the merged (base + override) value so the user sees the effective result.
    const baseStyle = element.props.style || {};
    const bpOverride = activeBreakpoint !== 'desktop'
        ? (element.props.breakpoints?.[activeBreakpoint] || {})
        : {};
    const style = { ...baseStyle, ...bpOverride };
    const props = element.props || {};
    const classes = props.className || '';
    const getVal = (val: any, fallback: any = 0) => parseInt(String(val || fallback).replace('px', ''));
    const handleBoxModelChange = (field: string, value: string) => updateStyle(field, parseInt(value) || 0);

    return (
        <div id="right-sidebar" className="w-[320px] bg-[#333333] border-l border-[#252526] h-full flex flex-col">

            {/* UX-4 [PERMANENT]: Multi-select alignment toolbar.
                Only shown when 2+ elements are selected. All ops use elementsRef.current (H-4)
                and call updateProject() once per action — never per-element in a loop. */}
            {selectedIds.size > 1 && (() => {
                const ids = Array.from(selectedIds);
                const boxes = ids.map(id => {
                    const el = elementsRef.current[id];
                    const s = (el?.props?.style || {}) as Record<string, any>;
                    return { id, left: parseFloat(String(s.left ?? '0')), top: parseFloat(String(s.top ?? '0')),
                             width: parseFloat(String(s.width ?? '0')), height: parseFloat(String(s.height ?? '0')) };
                }).filter(b => !!elementsRef.current[b.id]);
                if (!boxes.length) return null;
                const minLeft = Math.min(...boxes.map(b => b.left));
                const maxRight = Math.max(...boxes.map(b => b.left + b.width));
                const minTop = Math.min(...boxes.map(b => b.top));
                const maxBottom = Math.max(...boxes.map(b => b.top + b.height));
                const centerH = (minLeft + maxRight) / 2;
                const centerV = (minTop + maxBottom) / 2;
                const align = (transform: (b: typeof boxes[0]) => { left?: number; top?: number }) => {
                    const cur = elementsRef.current;
                    const next = { ...cur };
                    boxes.forEach(b => {
                        const el = cur[b.id]; if (!el) return;
                        const d = transform(b);
                        next[b.id] = { ...el, props: { ...el.props, style: {
                            ...el.props.style,
                            ...(d.left !== undefined ? { left: `${d.left}px` } : {}),
                            ...(d.top  !== undefined ? { top:  `${d.top}px`  } : {}),
                        }}};
                    });
                    updateProject(next);
                };
                const distributeH = () => {
                    if (boxes.length < 3) return;
                    const sorted = [...boxes].sort((a, b) => a.left - b.left);
                    const gap = (maxRight - minLeft - sorted.reduce((s, b) => s + b.width, 0)) / (sorted.length - 1);
                    let cursor = minLeft;
                    const cur = elementsRef.current; const next = { ...cur };
                    sorted.forEach(b => {
                        const el = cur[b.id]; if (!el) return;
                        next[b.id] = { ...el, props: { ...el.props, style: { ...el.props.style, left: `${cursor}px` } } };
                        cursor += b.width + gap;
                    });
                    updateProject(next);
                };
                const distributeV = () => {
                    if (boxes.length < 3) return;
                    const sorted = [...boxes].sort((a, b) => a.top - b.top);
                    const gap = (maxBottom - minTop - sorted.reduce((s, b) => s + b.height, 0)) / (sorted.length - 1);
                    let cursor = minTop;
                    const cur = elementsRef.current; const next = { ...cur };
                    sorted.forEach(b => {
                        const el = cur[b.id]; if (!el) return;
                        next[b.id] = { ...el, props: { ...el.props, style: { ...el.props.style, top: `${cursor}px` } } };
                        cursor += b.height + gap;
                    });
                    updateProject(next);
                };
                const ABtns: { title: string; icon: string; onClick: () => void; disabled?: boolean }[] = [
                    { title: 'Align left edges',      icon: '⊢',   onClick: () => align(_b => ({ left: minLeft })) },
                    { title: 'Center horizontally',   icon: '↔',   onClick: () => align(b => ({ left: centerH - b.width / 2 })) },
                    { title: 'Align right edges',     icon: '⊣',   onClick: () => align(b => ({ left: maxRight - b.width })) },
                    { title: 'Align top edges',       icon: '⊤',   onClick: () => align(_b => ({ top: minTop })) },
                    { title: 'Center vertically',     icon: '↕',   onClick: () => align(b => ({ top: centerV - b.height / 2 })) },
                    { title: 'Align bottom edges',    icon: '⊥',   onClick: () => align(b => ({ top: maxBottom - b.height })) },
                    { title: 'Distribute H', icon: '⇔', onClick: distributeH, disabled: boxes.length < 3 },
                    { title: 'Distribute V', icon: '⇕', onClick: distributeV, disabled: boxes.length < 3 },
                ];
                return (
                    <div className="p-3 border-b border-[#252526] bg-[#2a2a2d]">
                        <div className="text-[9px] font-bold text-[#555] uppercase tracking-widest mb-2">{ids.length} elements selected</div>
                        <div className="grid grid-cols-8 gap-1">
                            {ABtns.map(({ title, icon, onClick, disabled }) => (
                                <button key={title} title={title} onClick={onClick} disabled={disabled}
                                    className="h-7 rounded bg-[#333] border border-[#3e3e42] text-[#888] hover:text-white hover:bg-[#007acc] hover:border-[#007acc] disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm flex items-center justify-center"
                                >{icon}</button>
                            ))}
                        </div>
                        <p className="text-[9px] text-[#444] mt-1.5">Shift-click to add/remove · distribute needs 3+</p>
                    </div>
                );
            })()}

            {/* IDENTITY HEADER */}
            <div className="p-3 border-b border-[#252526] bg-[#333333]">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold bg-[#007acc] text-white px-1.5 py-0.5 rounded uppercase flex items-center gap-1 truncate max-w-[120px]">
                        {element.type === 'text' ? <Type size={10} /> : <Box size={10} />}
                        {element.type}
                    </span>
                    <div className="flex gap-1">
                        <button onClick={() => updateProject({ ...elements, [element.id]: { ...element, locked: !element.locked } })} className={cn("p-1 rounded hover:bg-[#444]", element.locked ? "text-red-400" : "text-[#666]")}><Lock size={12} /></button>
                        <button onClick={() => updateProject({ ...elements, [element.id]: { ...element, hidden: !element.hidden } })} className={cn("p-1 rounded hover:bg-[#444]", element.hidden ? "text-[#666]" : "text-[#ccc]")}><Eye size={12} /></button>
                    </div>
                </div>
                <div className="flex gap-2">
                    <input
                        value={element.name}
                        onChange={(e) => updateProject({ ...elements, [element.id]: { ...element, name: e.target.value } })}
                        className="w-full bg-transparent text-sm font-bold text-white focus:bg-[#3d3d3d] px-1 rounded outline-none border border-transparent focus:border-[#007acc] transition-all"
                    />
                </div>
            </div>

            {/* TABS */}
            <div className="flex border-b border-[#252526] bg-[#333333]">
                {/* Code tab — AI-generated / custom_code elements only */}
                {isCodeNode && (
                    <TabButton
                        active={activeTab === 'code'}
                        onClick={() => setActiveTab('code')}
                        icon={Code2}
                        label="Code"
                    />
                )}
                {/* Props tab — loader/imported components (importMeta present) */}
                {element?.importMeta && (
                    <TabButton
                        active={activeTab === 'props'}
                        onClick={() => setActiveTab('props')}
                        icon={Box}
                        label="Props"
                    />
                )}
                <TabButton active={activeTab === 'design'} onClick={() => setActiveTab('design')} icon={Layout} label="Design" />
                <TabButton active={activeTab === 'interact'} onClick={() => setActiveTab('interact')} icon={MousePointer2} label="Interact" />
                <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={Settings} label="Settings" />
            </div>

            {/* Direction A: Breakpoint selector — hidden on code tab (sections own their responsive CSS) */}
            {activeTab !== 'code' && <div className="flex items-center gap-0.5 px-2 pt-2 pb-1 border-b border-[#2a2a2c]">
                {([
                    { bp: 'desktop', icon: Monitor, label: 'Desktop' },
                    { bp: 'tablet', icon: Tablet, label: 'Tablet' },
                    { bp: 'mobile', icon: Smartphone, label: 'Mobile' },
                ] as const).map(({ bp, icon: Icon, label }) => (
                    <button
                        key={bp}
                        title={`Edit ${label} styles`}
                        onClick={() => setDevice(
                            bp === 'desktop' ? 'desktop' :
                                bp === 'tablet' ? 'tablet' : 'mobile'
                        )}
                        className={cn(
                            'flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-bold transition-all',
                            activeBreakpoint === bp
                                ? 'bg-blue-500/15 border border-blue-500/30 text-blue-400'
                                : 'text-[#555] hover:text-[#888] border border-transparent'
                        )}
                    >
                        <Icon size={10} />
                        {label}
                    </button>
                ))}
            </div>}

            {/* Breakpoint edit banner — only shown when NOT on desktop */}
            {activeBreakpoint !== 'desktop' && (
                <div className="mx-2 mt-1.5 px-2 py-1 rounded bg-blue-500/8 border border-blue-500/20 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    <span className="text-[9px] text-blue-400 font-bold uppercase tracking-wider">
                        Editing {activeBreakpoint} overrides — desktop style unchanged
                    </span>
                </div>
            )}

            {/* CONTENT AREA */}
            {/* CODE-TAB-3: overflow:hidden when on code tab so textarea fills the
                pane without a double-scrollbar. overflow-y:auto for all other tabs. */}
            <div className={cn(
                'flex-1 custom-scrollbar',
                activeTab === 'code' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'
            )}>

                {/* ════════════════════════════════════════════════════════════
                    TAB: CODE
                    Visible only for custom_code / AI-generated section nodes.
                    Inline editor: view, edit, Tab-indent, Cmd+Enter live commit,
                    blur commit, copy, AI Fix, Regenerate via MagicBar.
                    CODE-TAB-1 [PERMANENT]: never shown for importMeta nodes.
                    CODE-TAB-2 [PERMANENT]: writes via setElements on commit only.
                    CODE-TAB-3 [PERMANENT]: outer div is overflow:hidden so the
                      absolute-fill textarea has no double-scrollbar.
                    ════════════════════════════════════════════════════════════ */}
                {activeTab === 'code' && isCodeNode && (() => {
                    const fnName =
                        element.code?.match(/export\s+default\s+function\s+(\w+)/)?.[1]
                        ?? element.name
                        ?? 'Component';
                    const lineCount = (localCode || '').split('\n').length;
                    return (
                        <div className="flex flex-col h-full">
                            {/* Toolbar */}
                            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e1e1e] bg-[#111] shrink-0">
                                <div className="flex items-center gap-2">
                                    <Code2 size={10} className="text-blue-400" />
                                    <span className="text-[10px] font-bold font-mono text-blue-300 truncate max-w-[140px]">{fnName}</span>
                                    <span className="text-[9px] text-[#444] font-mono">{lineCount}L</span>
                                </div>
                                <button
                                    title="Copy code to clipboard"
                                    onClick={() => {
                                        navigator.clipboard.writeText(localCode).catch(() => { });
                                        setCodeCopied(true);
                                        setTimeout(() => setCodeCopied(false), 1500);
                                    }}
                                    className="p-1 rounded hover:bg-[#2a2a2c] text-[#555] hover:text-[#ccc] transition-colors"
                                >
                                    {codeCopied
                                        ? <ClipboardCheck size={12} className="text-green-400" />
                                        : <Clipboard size={12} />}
                                </button>
                            </div>
                            {/* Editor textarea */}
                            <div className="flex-1 relative min-h-0">
                                <textarea
                                    className="absolute inset-0 w-full h-full bg-[#0d0d0f] text-[11px] text-[#d4d4d4] font-mono resize-none outline-none p-3 leading-[1.65] custom-scrollbar selection:bg-blue-500/30 placeholder-[#333]"
                                    value={localCode}
                                    onChange={(e) => setLocalCode(e.target.value)}
                                    onBlur={commitCode}
                                    onKeyDown={(e) => {
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                            e.preventDefault();
                                            commitCode();
                                        }
                                        if (e.key === 'Tab') {
                                            e.preventDefault();
                                            const ta = e.currentTarget;
                                            const start = ta.selectionStart;
                                            const end = ta.selectionEnd;
                                            const next = localCode.substring(0, start) + '  ' + localCode.substring(end);
                                            setLocalCode(next);
                                            requestAnimationFrame(() => {
                                                ta.selectionStart = start + 2;
                                                ta.selectionEnd = start + 2;
                                            });
                                        }
                                    }}
                                    spellCheck={false}
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    autoComplete="off"
                                    placeholder={`export default function ${fnName}(props) {\n  return (\n    <div className="w-full">\n      {/* content */}\n    </div>\n  );\n}`}
                                />
                            </div>
                            {/* Hint bar */}
                            <div className="px-3 py-1.5 bg-[#111] border-t border-[#1e1e1e] flex items-center gap-2 shrink-0">
                                <span className="text-[9px] text-[#3a3a3a] font-mono">
                                    <span className="text-[#444]">⌘↵</span> commit · <span className="text-[#444]">Tab</span> indent · blur saves
                                </span>
                            </div>
                            {/* Action bar */}
                            <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[#252526] bg-[#1e1e1e] shrink-0">
                                <button
                                    onClick={handleAiFix}
                                    disabled={isAiFixing}
                                    title="Ask the SRE AI agent to fix syntax errors, icon issues, and hook violations"
                                    className={cn(
                                        'flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold transition-all flex-1 justify-center',
                                        isAiFixing
                                            ? 'bg-[#1a1a1c] text-[#444] cursor-not-allowed border border-[#2a2a2c]'
                                            : 'bg-blue-600/15 border border-blue-500/25 text-blue-300 hover:bg-blue-600/25 hover:border-blue-500/40 active:scale-95'
                                    )}
                                >
                                    {isAiFixing
                                        ? <><Loader2 size={10} className="animate-spin" /><span>Fixing…</span></>
                                        : <><Wand2 size={10} /><span>AI Fix</span></>}
                                </button>
                                <button
                                    onClick={() => setMagicBarOpen(true)}
                                    title="Open AI bar to regenerate or refine this section"
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold transition-all border border-[#3a3a3a] text-[#666] hover:text-[#aaa] hover:border-[#555] active:scale-95 flex-1 justify-center"
                                >
                                    <TerminalSquare size={10} /><span>Regenerate</span>
                                </button>
                            </div>
                        </div>
                    );
                })()}

                {/* ════════════════════════════════════════════════════════════
                    TAB: PROPS
                    Visible only when element.importMeta is set (loader/imported).
                    Schema-driven controls when propSchema present;
                    raw key-value editor fallback otherwise.
                    PROPS-TAB-1 [PERMANENT]: never shows style/className/breakpoints.
                    PROPS-TAB-2 [PERMANENT]: writes directly to element.props via
                      setElements (not updateProject — avoids history thrash at 60fps).
                    ════════════════════════════════════════════════════════════ */}
                {activeTab === 'props' && element?.importMeta && (() => {
                    const conf = componentRegistry[element.type];
                    const schema: Record<string, VectraLoaderPropSchema> | undefined =
                        (conf as any)?.propSchema;

                    // Keys owned by Design/Settings tabs — never expose here
                    const RESERVED = new Set([
                        'style', 'className', 'breakpoints', 'layoutMode',
                        'stackOnMobile', 'animation', 'animationDuration',
                        'animationDelay', 'hoverEffect', 'id',
                    ]);

                    // PROPS-TAB-2: direct setElements write, NOT updateProject
                    const updatePropKey = (key: string, value: unknown) => {
                        setElements(prev => ({
                            ...prev,
                            [element.id]: {
                                ...prev[element.id],
                                props: { ...prev[element.id].props, [key]: value },
                            },
                        }));
                    };

                    // ── Schema-driven controls ─────────────────────────────────
                    if (schema && Object.keys(schema).length > 0) {
                        return (
                            <div className="p-3 flex flex-col gap-0.5">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[9px] font-bold text-[#555] uppercase tracking-wider">Component Props</span>
                                    {conf?.importMeta && (
                                        <span className="text-[9px] font-mono text-[#444] bg-[#1e1e1e] px-1.5 py-0.5 rounded truncate max-w-[140px]">
                                            {conf.importMeta.exportName}
                                        </span>
                                    )}
                                </div>

                                {Object.entries(schema).map(([key, propSchema]) => {
                                    const currentValue = (element.props as any)[key] ?? propSchema.default ?? '';
                                    const controlType = resolveControlType(propSchema);
                                    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

                                    return (
                                        <div key={key} className="flex items-center gap-2 py-1 border-b border-[#252526] last:border-0">
                                            <span className="text-[10px] text-[#777] w-24 shrink-0 truncate" title={key}>{label}</span>
                                            <div className="flex-1 min-w-0">
                                                {(controlType === 'text' || controlType === 'textarea') && (
                                                    controlType === 'textarea'
                                                        ? <textarea value={String(currentValue)} onChange={e => updatePropKey(key, e.target.value)} rows={2}
                                                            className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white font-mono resize-none outline-none focus:border-blue-500/50" />
                                                        : <input type="text" value={String(currentValue)} onChange={e => updatePropKey(key, e.target.value)}
                                                            className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white font-mono outline-none focus:border-blue-500/50" />
                                                )}
                                                {controlType === 'number' && (
                                                    <input type="number" value={Number(currentValue)} min={propSchema.min} max={propSchema.max} step={propSchema.step ?? 1}
                                                        onChange={e => updatePropKey(key, parseFloat(e.target.value))}
                                                        className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white font-mono outline-none focus:border-blue-500/50" />
                                                )}
                                                {controlType === 'slider' && (
                                                    <div className="flex items-center gap-2">
                                                        <input type="range" value={Number(currentValue)} min={propSchema.min ?? 0} max={propSchema.max ?? 100} step={propSchema.step ?? 1}
                                                            onChange={e => updatePropKey(key, parseFloat(e.target.value))}
                                                            className="flex-1 h-1 accent-blue-500" />
                                                        <span className="text-[10px] text-[#888] w-8 text-right font-mono tabular-nums">{Number(currentValue)}</span>
                                                    </div>
                                                )}
                                                {controlType === 'toggle' && (
                                                    <button type="button" onClick={() => updatePropKey(key, !currentValue)}
                                                        className={cn('w-8 h-4 rounded-full flex items-center px-0.5 transition-colors',
                                                            currentValue ? 'bg-blue-500 justify-end' : 'bg-[#444] justify-start')}>
                                                        <span className="w-3 h-3 rounded-full bg-white shadow-sm" />
                                                    </button>
                                                )}
                                                {controlType === 'select' && (
                                                    <select value={String(currentValue)} onChange={e => updatePropKey(key, e.target.value)}
                                                        className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white outline-none focus:border-blue-500/50">
                                                        {(propSchema.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                    </select>
                                                )}
                                                {controlType === 'color' && (
                                                    <div className="flex items-center gap-2">
                                                        <input type="color" value={String(currentValue) || '#000000'} onChange={e => updatePropKey(key, e.target.value)}
                                                            className="w-7 h-6 rounded cursor-pointer border border-[#3e3e42] bg-transparent" />
                                                        <input type="text" value={String(currentValue)} onChange={e => updatePropKey(key, e.target.value)}
                                                            className="flex-1 bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white font-mono outline-none focus:border-blue-500/50" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                <button
                                    onClick={() => { Object.entries(schema).forEach(([k, s]) => { if (s.default !== undefined) updatePropKey(k, s.default); }); }}
                                    className="mt-3 w-full py-1.5 rounded border border-[#3e3e42] text-[10px] text-[#666] hover:text-[#999] hover:border-[#555] transition-all"
                                >
                                    Reset to defaults
                                </button>
                            </div>
                        );
                    }

                    // ── Raw props fallback (no propSchema) ────────────────────
                    const editableEntries = Object.entries(element.props).filter(
                        ([k, v]) => !RESERVED.has(k) && typeof v !== 'object'
                    );

                    return (
                        <div className="p-3 flex flex-col gap-1">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[9px] font-bold text-[#555] uppercase tracking-wider">Props</span>
                                {conf?.importMeta && (
                                    <span className="text-[9px] font-mono text-[#444] bg-[#1e1e1e] px-1.5 py-0.5 rounded truncate max-w-[140px]">
                                        {conf.importMeta.exportName}
                                    </span>
                                )}
                            </div>

                            <div className="mb-2 px-2 py-1.5 rounded bg-[#1e1e1e] border border-[#2a2a2a] text-[9px] text-[#555] leading-relaxed">
                                No prop schema. Add{' '}
                                <code className="text-[#777]">propSchema</code> to your{' '}
                                <code className="text-[#777]">vectra.config.ts</code> for typed controls.
                            </div>

                            {editableEntries.length === 0 && (
                                <div className="text-[10px] text-[#444] text-center py-4">No editable props found.</div>
                            )}

                            {editableEntries.map(([key, val]) => (
                                <div key={key} className="flex items-center gap-2 py-1 border-b border-[#252526] last:border-0">
                                    <span className="text-[10px] text-[#777] w-24 shrink-0 truncate font-mono" title={key}>{key}</span>
                                    <div className="flex-1 min-w-0">
                                        {typeof val === 'boolean' ? (
                                            <button type="button" onClick={() => updatePropKey(key, !val)}
                                                className={cn('w-8 h-4 rounded-full flex items-center px-0.5 transition-colors',
                                                    val ? 'bg-blue-500 justify-end' : 'bg-[#444] justify-start')}>
                                                <span className="w-3 h-3 rounded-full bg-white shadow-sm" />
                                            </button>
                                        ) : typeof val === 'number' ? (
                                            <input type="number" value={val} onChange={e => updatePropKey(key, parseFloat(e.target.value))}
                                                className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white font-mono outline-none focus:border-blue-500/50" />
                                        ) : (
                                            <input type="text" value={String(val ?? '')} onChange={e => updatePropKey(key, e.target.value)}
                                                className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-2 py-1 text-[10px] text-white font-mono outline-none focus:border-blue-500/50" />
                                        )}
                                    </div>
                                </div>
                            ))}

                            {/* PROPS-TAB-3: AddPropRow extracted as named component — hooks-safe */}
                            <AddPropRow onAdd={(key, val) => updatePropKey(key, val)} />
                        </div>
                    );
                })()}

                {/* --- TAB: DESIGN --- */}
                {activeTab === 'design' && (
                    <>
                        {/* TAILWIND CLASS EDITOR */}
                        <div className="p-3 border-b border-[#252526]">
                            <Row label="Classes">
                                <TextInput
                                    value={props.className || ''}
                                    onChange={(v: string) => updateProp('className', v)}
                                    placeholder="p-4 bg-blue-500..."
                                    icon={Hash}
                                />
                            </Row>
                        </div>

                        {/* LAYOUT */}
                        <Section title="Layout">
                            <div className="grid grid-cols-2 gap-2 mb-2">
                                <NumberInput label="W" value={getVal(style.width, 'auto')} onChange={(v: any) => updateStyle('width', v)} {...sliderDragProps} />
                                <NumberInput label="H" value={getVal(style.height, 'auto')} onChange={(v: any) => updateStyle('height', v)} {...sliderDragProps} />
                            </div>
                            {element.props.style?.position === 'absolute' && (
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <NumberInput label="X" value={getVal(style.left)} onChange={(v: any) => updateStyle('left', v)} {...sliderDragProps} />
                                    <NumberInput label="Y" value={getVal(style.top)} onChange={(v: any) => updateStyle('top', v)} {...sliderDragProps} />
                                </div>
                            )}

                            <div className="mb-3">
                                <NumberInput label="Z-Index" value={getVal(style.zIndex, 0)} onChange={(v: number) => updateStyle('zIndex', v)} {...sliderDragProps} />
                            </div>

                            <div className="h-px bg-[#2a2a2c] my-3" />

                            <Row label="Display">
                                <ToggleGroup
                                    value={element.props.layoutMode || 'canvas'} onChange={(v: any) => updateProp('layoutMode', v)}
                                    options={[{ value: 'canvas', icon: <Maximize size={12} /> }, { value: 'flex', icon: <Box size={12} /> }, { value: 'grid', icon: <Grid size={12} /> }]}
                                />
                            </Row>

                            {/* GRID CONTROLS */}
                            {element.props.layoutMode === 'grid' && (
                                <div className="mt-2 space-y-2 p-2 bg-[#252526] rounded border border-[#3e3e42]">
                                    <div className="text-[9px] text-[#888] font-bold uppercase mb-2">Grid Template</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <NumberInput
                                            label="Cols"
                                            value={parseInt(String(style.gridTemplateColumns || '').match(/repeat\((\d+)/)?.[1] || '1')}
                                            onChange={(v: number) => handleGridChange('gridTemplateColumns', v)}
                                        />
                                        <NumberInput
                                            label="Rows"
                                            value={parseInt(String(style.gridTemplateRows || '').match(/repeat\((\d+)/)?.[1] || '1')}
                                            onChange={(v: number) => handleGridChange('gridTemplateRows', v)}
                                        />
                                    </div>
                                    <Row label="Gap"><NumberInput value={getVal(style.gap, 0)} onChange={(v: number) => updateStyle('gap', v)} /></Row>
                                </div>
                            )}

                            {/* FLEX CONTROLS */}
                            {element.props.layoutMode === 'flex' && (
                                <div className="mt-2 space-y-2 p-2 bg-[#252526] rounded border border-[#3e3e42]">
                                    <Row label="Direction">
                                        <ToggleGroup value={style.flexDirection || 'row'} onChange={(v: string) => updateStyle('flexDirection', v)}
                                            options={[{ value: 'row', icon: <ArrowRight size={12} /> }, { value: 'column', icon: <ArrowDown size={12} /> }]}
                                        />
                                    </Row>

                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                        <div>
                                            <label className="text-[9px] text-[#666] mb-1 block">JUSTIFY</label>
                                            <div className="grid grid-cols-3 gap-1">
                                                {['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].map(opt => (
                                                    <button
                                                        key={opt}
                                                        onClick={() => updateStyle('justifyContent', opt)}
                                                        className={cn(
                                                            "h-6 rounded bg-[#333] hover:bg-[#444] flex items-center justify-center transition-colors",
                                                            style.justifyContent === opt && "bg-[#007acc] text-white hover:bg-[#007acc]"
                                                        )}
                                                        title={opt}
                                                    >
                                                        {opt === 'center' ? <AlignCenter size={10} /> : opt === 'space-between' ? <MoveHorizontal size={10} /> : <AlignLeft size={10} />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[9px] text-[#666] mb-1 block">ALIGN</label>
                                            <div className="grid grid-cols-3 gap-1">
                                                {['flex-start', 'center', 'flex-end', 'stretch', 'baseline'].map(opt => (
                                                    <button
                                                        key={opt}
                                                        onClick={() => updateStyle('alignItems', opt)}
                                                        className={cn(
                                                            "h-6 rounded bg-[#333] hover:bg-[#444] flex items-center justify-center transition-colors",
                                                            style.alignItems === opt && "bg-[#007acc] text-white hover:bg-[#007acc]"
                                                        )}
                                                        title={opt}
                                                    >
                                                        {opt === 'stretch' ? <MoveVertical size={10} /> : opt === 'center' ? <AlignCenter size={10} className="rotate-90" /> : <AlignLeft size={10} className="rotate-90" />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <Row label="Gap"><NumberInput value={getVal(style.gap, 0)} onChange={(v: number) => updateStyle('gap', v)} /></Row>
                                </div>
                            )}

                            <div className="mt-4 mb-2">
                                <BoxModel
                                    margin={{ top: getVal(style.marginTop), right: getVal(style.marginRight), bottom: getVal(style.marginBottom), left: getVal(style.marginLeft) }}
                                    padding={{ top: getVal(style.paddingTop), right: getVal(style.paddingRight), bottom: getVal(style.paddingBottom), left: getVal(style.paddingLeft) }}
                                    onChange={handleBoxModelChange}
                                />
                            </div>

                            {/* Phase F: Stack on Mobile toggle */}
                            {(element.props.style?.position === 'absolute' || element.props.layoutMode) && (
                                <div className="mt-3 pt-3 border-t border-[#2a2a2c]">
                                    <Row label="Stack on Mobile">
                                        <button
                                            onClick={() => updateProp('stackOnMobile', !props.stackOnMobile)}
                                            title={
                                                props.stackOnMobile
                                                    ? 'On mobile: this element becomes full-width and stacks vertically. Click to disable.'
                                                    : 'On mobile: this element keeps its absolute position (may require scrolling). Click to enable stack.'
                                            }
                                            className={cn(
                                                'w-full flex items-center justify-between px-3 py-1.5 rounded border text-[11px] font-medium transition-all',
                                                props.stackOnMobile
                                                    ? 'bg-blue-500/15 border-blue-500/40 text-blue-400 hover:bg-blue-500/20'
                                                    : 'bg-[#2d2d2d] border-[#3e3e42] text-[#555] hover:text-[#999] hover:border-[#4e4e52]'
                                            )}
                                        >
                                            <div className="flex items-center gap-2">
                                                <Smartphone size={11} className={props.stackOnMobile ? 'text-blue-400' : 'text-[#555]'} />
                                                <span>{props.stackOnMobile ? 'Stack on mobile — ON' : 'Stack on mobile — OFF'}</span>
                                            </div>
                                            {/* Toggle pill */}
                                            <div className={cn(
                                                'w-7 h-3.5 rounded-full transition-colors flex items-center px-0.5',
                                                props.stackOnMobile ? 'bg-blue-500' : 'bg-[#3e3e42]'
                                            )}>
                                                <div className={cn(
                                                    'w-2.5 h-2.5 rounded-full bg-white transition-transform shadow-sm',
                                                    props.stackOnMobile ? 'translate-x-3.5' : 'translate-x-0'
                                                )} />
                                            </div>
                                        </button>
                                    </Row>

                                    {/* Contextual hint — only shown when toggle is ON */}
                                    {props.stackOnMobile && (
                                        <div className="mt-1.5 flex items-start gap-2 px-1">
                                            <Smartphone size={10} className="text-blue-400 mt-0.5 shrink-0" />
                                            <p className="text-[9px] text-[#555] leading-relaxed">
                                                On screens ≤ 768px, this element will be{' '}
                                                <span className="text-[#777]">position: relative</span>,{' '}
                                                <span className="text-[#777]">width: 100%</span>, and flow with the
                                                document. Exported via{' '}
                                                <span className="text-blue-500 font-mono">.vectra-stack-mobile</span>{' '}
                                                CSS class.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </Section>

                        {/* TYPOGRAPHY */}
                        {['text', 'button', 'heading', 'link'].includes(element.type) && (
                            <Section title="Typography">
                                <div className="space-y-2">
                                    <Row label="Font">
                                        <SelectInput
                                            value={style.fontFamily || 'Inter'}
                                            onChange={(v: string) => updateStyle('fontFamily', v)}
                                            options={[
                                                { value: 'Inter', label: 'Inter' },
                                                { value: 'Roboto', label: 'Roboto' },
                                                { value: 'Open Sans', label: 'Open Sans' },
                                                { value: 'serif', label: 'Serif' },
                                                { value: 'monospace', label: 'Mono' }
                                            ]}
                                        />
                                    </Row>
                                    <div className="grid grid-cols-2 gap-2">
                                        <NumberInput label="Size" value={getVal(style.fontSize, 16)} onChange={(v: number) => updateStyle('fontSize', v)} />
                                        <NumberInput label="Weight" value={getVal(style.fontWeight, 400)} onChange={(v: number) => updateStyle('fontWeight', v)} step={100} min={100} max={900} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <NumberInput label="Height" value={parseFloat(String(style.lineHeight || '1.5'))} onChange={(v: number) => updateStyle('lineHeight', v)} step={0.1} />
                                        <NumberInput label="Letter" value={parseFloat(String(style.letterSpacing || '0'))} onChange={(v: number) => updateStyle('letterSpacing', `${v}px`)} step={0.5} />
                                    </div>
                                    <Row label="Color"><ColorInput value={style.color || '#000000'} onChange={(v) => updateStyle('color', v)} /></Row>
                                    <Row label="Align">
                                        <ToggleGroup value={style.textAlign || 'left'} onChange={(v: string) => updateStyle('textAlign', v)} options={[{ value: 'left', icon: <AlignLeft size={12} /> }, { value: 'center', icon: <AlignCenter size={12} /> }, { value: 'right', icon: <AlignRight size={12} /> }, { value: 'justify', icon: <AlignJustify size={12} /> }]} />
                                    </Row>
                                    <Row label="Case">
                                        <ToggleGroup value={style.textTransform || 'none'} onChange={(v: string) => updateStyle('textTransform', v)} options={[{ value: 'none', icon: <TypeIcon size={12} /> }, { value: 'uppercase', icon: <span className="text-[8px] font-bold">AA</span> }, { value: 'lowercase', icon: <span className="text-[8px] font-bold">aa</span> }, { value: 'capitalize', icon: <span className="text-[8px] font-bold">Aa</span> }]} />
                                    </Row>
                                </div>
                            </Section>
                        )}

                        {/* FILL & GRADIENT */}
                        <Section title="Fill & Gradient">
                            <div className="flex bg-[#252526] p-0.5 rounded border border-[#3e3e42] mb-3">
                                <button onClick={() => setFillModeOverride('solid')} className={cn("flex-1 py-1 rounded text-[10px] font-medium transition-all", fillMode === 'solid' ? "bg-[#3e3e42] text-white" : "text-[#858585]")}><PaintBucket size={10} className="inline mr-1" />Solid</button>
                                <button onClick={() => setFillModeOverride('gradient')} className={cn("flex-1 py-1 rounded text-[10px] font-medium transition-all", fillMode === 'gradient' ? "bg-[#3e3e42] text-white" : "text-[#858585]")}><Sun size={10} className="inline mr-1" />Gradient</button>
                                <button onClick={() => setFillModeOverride('image')} className={cn("flex-1 py-1 rounded text-[10px] font-medium transition-all", fillMode === 'image' ? "bg-[#3e3e42] text-white" : "text-[#858585]")}><ImageIcon size={10} className="inline mr-1" />Image</button>
                            </div>

                            {(fillMode === 'solid' || fillMode === 'gradient') && (
                                <div className="bg-[#2a2a2c] p-2 rounded-lg border border-[#333]">
                                    <ColorPicker
                                        value={colorPickerValue}
                                        onChange={(color) => {
                                            setColorPickerValue(color);
                                            updateStyle('background', color);
                                            // Clean tailwind conflict
                                            let newClass = classes;
                                            newClass = removeClasses(newClass, 'bg-');
                                            newClass = removeClasses(newClass, 'from-');
                                            newClass = removeClasses(newClass, 'to-');
                                            newClass = removeClasses(newClass, 'via-');
                                            if (newClass !== classes) {
                                                updateProp('className', newClass);
                                            }
                                        }}
                                        hideControls={fillMode === 'solid'}
                                        hidePresets={false}
                                        hideEyeDrop={false}
                                        hideAdvancedSliders={true}
                                        hideColorGuide={true}
                                        hideInputType={false}
                                        width={280}
                                        height={fillMode === 'gradient' ? 180 : 120}
                                    />
                                </div>
                            )}

                            {fillMode === 'image' && (
                                <div className="space-y-2">
                                    <TextInput value={style.backgroundImage?.replace('url(', '').replace(')', '') || ''} onChange={(v: string) => { updateStyle('backgroundImage', `url(${v})`); updateStyle('backgroundSize', 'cover'); updateStyle('backgroundPosition', 'center'); }} placeholder="Image URL..." icon={ImageIcon} />
                                    <Row label="Size"><SelectInput value={style.backgroundSize || 'cover'} onChange={(v: string) => updateStyle('backgroundSize', v)} options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'auto', label: 'Auto' }]} /></Row>
                                </div>
                            )}
                        </Section>

                        {/* BORDERS */}
                        <Section title="Border Radius">
                            <div className="grid grid-cols-2 gap-2 mb-3">
                                <InputUnit label="TL" icon={CornerUpLeft} value={getVal(style.borderTopLeftRadius)} onChange={(v) => updateStyle('borderTopLeftRadius', v)} />
                                <InputUnit label="TR" icon={CornerUpRight} value={getVal(style.borderTopRightRadius)} onChange={(v) => updateStyle('borderTopRightRadius', v)} />
                                <InputUnit label="BL" icon={CornerDownLeft} value={getVal(style.borderBottomLeftRadius)} onChange={(v) => updateStyle('borderBottomLeftRadius', v)} />
                                <InputUnit label="BR" icon={CornerDownRight} value={getVal(style.borderBottomRightRadius)} onChange={(v) => updateStyle('borderBottomRightRadius', v)} />
                            </div>

                            <div className="pt-3 border-t border-[#333]">
                                <label className="text-[9px] text-[#666] mb-2 block uppercase font-bold">Border Width & Color</label>
                                <div className="flex gap-2 items-center">
                                    <NumberInput label="Width" value={getVal(style.borderWidth)} onChange={(v: number) => { updateStyle('borderWidth', v); updateStyle('borderStyle', 'solid'); }} />
                                    <ColorInput value={style.borderColor || 'transparent'} onChange={(v) => updateStyle('borderColor', v)} />
                                </div>
                            </div>
                        </Section>

                        {/* EFFECTS */}
                        <Section title="Effects & Glassmorphism">
                            <div className="space-y-4">
                                <RangeControl label="Opacity" value={Math.round((style.opacity !== undefined ? parseFloat(String(style.opacity)) : 1) * 100)} max={100} onChange={(v) => updateStyle('opacity', v / 100)} unit="%" />

                                <div className="pt-3 border-t border-[#333]">
                                    <label className="text-[9px] text-[#666] uppercase font-semibold mb-3 block flex items-center gap-2">
                                        <Droplets size={10} className="text-cyan-400" /> Glassmorphism
                                    </label>
                                    <div className="space-y-3">
                                        <RangeControl label="Blur" value={blur} max={40} onChange={(v) => updateFilter(v, brightness, contrast)} unit="px" />
                                        <RangeControl label="Brightness" value={brightness} max={200} onChange={(v) => updateFilter(blur, v, contrast)} unit="%" />
                                        <RangeControl label="Contrast" value={contrast} max={200} onChange={(v) => updateFilter(blur, brightness, v)} unit="%" />
                                    </div>
                                    {blur > 0 && (
                                        <div className="mt-3 text-[10px] text-cyan-400 bg-cyan-500/10 p-2 rounded border border-cyan-500/20">
                                            💡 Set a semi-transparent fill color to see the glass effect
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Section>

                        {/* TRANSFORMS */}
                        <Section title="Transforms">
                            <div className="grid grid-cols-2 gap-3">
                                {/* Rotation */}
                                <InputUnit
                                    label="Rotate"
                                    icon={RotateCw}
                                    unit="°"
                                    value={rotate}
                                    onChange={(v: number) => { setRotate(v); setTimeout(updateTransform, 0); }}
                                />
                                {/* Scale */}
                                <InputUnit
                                    label="Scale"
                                    icon={Maximize}
                                    step={0.1}
                                    value={scale}
                                    onChange={(v: number) => { setScale(v); setTimeout(updateTransform, 0); }}
                                />
                                {/* Skew X */}
                                <InputUnit
                                    label="Skew X"
                                    icon={MoveHorizontal}
                                    unit="°"
                                    value={skewX}
                                    onChange={(v: number) => { setSkewX(v); setTimeout(updateTransform, 0); }}
                                />
                                {/* Skew Y */}
                                <InputUnit
                                    label="Skew Y"
                                    icon={MoveVertical}
                                    unit="°"
                                    value={skewY}
                                    onChange={(v: number) => { setSkewY(v); setTimeout(updateTransform, 0); }}
                                />
                            </div>

                            {/* Translate */}
                            <div className="mt-3 bg-[#2a2a2c] p-2 rounded border border-[#333]">
                                <div className="text-[9px] text-[#888] uppercase font-bold mb-2 flex items-center gap-1">
                                    <Move size={10} /> Translate
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <NumberInput
                                        label="X"
                                        value={translateX}
                                        onChange={(v: number) => { setTranslateX(v); setTimeout(updateTransform, 0); }}
                                    />
                                    <NumberInput
                                        label="Y"
                                        value={translateY}
                                        onChange={(v: number) => { setTranslateY(v); setTimeout(updateTransform, 0); }}
                                    />
                                </div>
                            </div>
                        </Section>
                    </>
                )}

                {/* --- TAB: INTERACT --- */}
                {activeTab === 'interact' && (
                    <>
                        <Section title="Animation">
                            <div className="space-y-3">
                                <Row label="Apply To">
                                    <ToggleGroup
                                        value={animScope}
                                        onChange={setAnimScope}
                                        options={[
                                            { value: 'single', icon: <MousePointer2 size={12} />, label: 'Selected' },
                                            { value: 'all', icon: <Layers size={12} />, label: 'All in Frame' },
                                        ]}
                                    />
                                </Row>
                                <Row label="Type">
                                    <div className="flex gap-2 w-full">
                                        <SelectInput
                                            value={props.animation || 'none'}
                                            onChange={(v: string) => updateProp('animation', v)}
                                            options={[
                                                { value: 'none', label: 'None' },
                                                { value: 'fade', label: 'Fade In' },
                                                { value: 'slide-up', label: 'Slide Up' },
                                                { value: 'slide-left', label: 'Slide Left' },
                                                { value: 'scale-in', label: 'Scale In' },
                                            ]}
                                        />
                                        <button onClick={() => updateStyle('--anim-trigger', Date.now())} className="p-1 bg-[#333] border border-[#3e3e42] rounded hover:bg-[#444] text-[#ccc] hover:text-white transition-colors" title="Replay">
                                            <RotateCw size={12} />
                                        </button>
                                    </div>
                                </Row>
                                {props.animation && props.animation !== 'none' && (
                                    <>
                                        <div className="grid grid-cols-2 gap-2">
                                            <NumberInput label="Dur (s)" value={parseFloat(props.animationDuration || '0.3')} onChange={(v: number) => updateProp('animationDuration', v)} step={0.1} />
                                            <NumberInput label="Dly (s)" value={parseFloat(props.animationDelay || '0')} onChange={(v: number) => updateProp('animationDelay', v)} step={0.1} />
                                        </div>
                                    </>
                                )}
                            </div>
                        </Section>

                        <Section title="Hover Effects">
                            <div className="space-y-3">
                                <Row label="Effect">
                                    <SelectInput
                                        value={props.hoverEffect || 'none'}
                                        onChange={(v: string) => updateProp('hoverEffect', v)}
                                        options={[
                                            { value: 'none', label: 'None' },
                                            { value: 'lift', label: 'Lift Up' },
                                            { value: 'scale', label: 'Scale Up' },
                                            { value: 'glow', label: 'Glow' },
                                            { value: 'border', label: 'Blue Border' },
                                            { value: 'opacity', label: 'Dim Opacity' }
                                        ]}
                                    />
                                </Row>
                                {props.hoverEffect && props.hoverEffect !== 'none' && (
                                    <div className="text-[10px] text-[#666] bg-[#252526] p-2 rounded border border-[#3e3e42] flex items-start gap-2">
                                        <Hand size={12} className="mt-0.5" />
                                        <span>Effect plays when user hovers over this element.</span>
                                    </div>
                                )}
                            </div>
                        </Section>

                        <Section title="Prototyping">
                            {/* SPRINT-C-FIX-14: On Click now supports External URL.
                                '__external__' is a sentinel stored in linkTo.
                                Guard in generateNodeCode prevents it reaching
                                React Router <Link> (would produce broken route).
                                When '__external__' is selected, props.href is the
                                actual URL and props.target controls tab behaviour. */}
                            <div className="space-y-3">
                                <Row label="On Click">
                                    <SelectInput
                                        value={props.linkTo || ''}
                                        onChange={(v: string) => {
                                            updateProp('linkTo', v || undefined);
                                            if (v !== '__external__') {
                                                updateProp('href', undefined);
                                                updateProp('target', undefined);
                                            }
                                        }}
                                        options={[
                                            { value: '', label: '— No Action —' },
                                            { value: '__external__', label: '↗ External URL' },
                                            ...pages.map(p => ({
                                                value: p.slug,
                                                label: `Navigate → ${p.name}`,
                                            }))
                                        ]}
                                    />
                                </Row>

                                {/* External URL controls */}
                                {props.linkTo === '__external__' && (
                                    <div className="space-y-2 pl-2 border-l-2 border-blue-500/30">
                                        <Row label="URL">
                                            <TextInput
                                                value={String(props.href ?? '')}
                                                onChange={(v: string) => updateProp('href', v || undefined)}
                                                placeholder="https://example.com"
                                                icon={ArrowRight}
                                            />
                                        </Row>
                                        <Row label="Opens in">
                                            <ToggleGroup
                                                value={String(props.target ?? '_self')}
                                                onChange={(v: string) => updateProp('target', v)}
                                                options={[
                                                    { value: '_self', label: 'Same tab', icon: <span className="text-[9px] font-bold">↩</span> },
                                                    { value: '_blank', label: 'New tab', icon: <span className="text-[9px] font-bold">↗</span> },
                                                ]}
                                            />
                                        </Row>
                                        {props.href && (
                                            <div className="text-[10px] text-[#666] bg-[#252526] p-2 rounded border border-[#3e3e42] flex items-start gap-2">
                                                <ArrowRight size={12} className="mt-0.5 shrink-0" />
                                                <span>
                                                    Links to{' '}
                                                    <strong className="text-[#007acc] font-mono break-all">{String(props.href)}</strong>
                                                    {props.target === '_blank' && <span className="text-[#555]"> — opens in new tab with <code className="text-[9px] bg-[#1e1e1e] px-1 rounded">rel="noopener noreferrer"</code></span>}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Internal navigation info banner */}
                                {props.linkTo && props.linkTo !== '__external__' && (
                                    <div className="text-[10px] text-[#666] bg-[#252526] p-2 rounded border border-[#3e3e42] flex items-start gap-2">
                                        <ArrowRight size={12} className="mt-0.5 shrink-0" />
                                        <span>Navigates to <strong className="text-[#007acc]">{props.linkTo}</strong> using React Router <code className="text-[9px] bg-[#1e1e1e] px-1 rounded">{'<Link>'}</code></span>
                                    </div>
                                )}
                            </div>
                        </Section>
                    </>
                )}

                {/* --- TAB: SETTINGS --- */}
                {/* SPRINT-C-FIX-11: Settings tab fully implemented.
                    All writes use updateProject (C-1/C-2 spread-clone).
                    aria-label/role/tabIndex write into element.props —
                    RenderNode spreads these onto native DOM elements immediately
                    so accessibility is live on the canvas without an export.
                    data-testid / data-cy stored in props for Playwright/Cypress. */}
                {activeTab === 'settings' && (
                    <>
                        {/* ── Metadata ─────────────────────────────────── */}
                        <Section title="Metadata">
                            <Row label="Node ID">
                                <TextInput
                                    value={element.id}
                                    onChange={() => { /* read-only */ }}
                                    icon={Hash}
                                />
                            </Row>
                            <p className="mt-1 text-[10px] text-[#484848] leading-relaxed">
                                Read-only UUID used for code generation and{' '}
                                <code className="text-[#555] bg-[#1e1e1e] px-1 rounded text-[9px]">data-vid</code>{' '}
                                canvas targeting.
                            </p>
                        </Section>

                        {/* ── Accessibility ─────────────────────────────── */}
                        <Section title="Accessibility (ARIA)">
                            <div className="space-y-2.5">
                                <Row label="aria-label">
                                    <TextInput
                                        value={String((element.props as any)['aria-label'] ?? '')}
                                        onChange={(v: string) => updateProject({
                                            ...elements,
                                            [element.id]: {
                                                ...element,
                                                props: { ...element.props, 'aria-label': v || undefined },
                                            },
                                        })}
                                        placeholder="Describe this element..."
                                        icon={Hand}
                                    />
                                </Row>
                                <Row label="role">
                                    <SelectInput
                                        value={String((element.props as any)['role'] ?? '')}
                                        onChange={(v: string) => updateProject({
                                            ...elements,
                                            [element.id]: {
                                                ...element,
                                                props: { ...element.props, role: v || undefined },
                                            },
                                        })}
                                        options={[
                                            { value: '', label: '— default —' },
                                            { value: 'button', label: 'button' },
                                            { value: 'link', label: 'link' },
                                            { value: 'heading', label: 'heading' },
                                            { value: 'img', label: 'img' },
                                            { value: 'navigation', label: 'navigation' },
                                            { value: 'main', label: 'main' },
                                            { value: 'section', label: 'section' },
                                            { value: 'article', label: 'article' },
                                            { value: 'aside', label: 'aside' },
                                            { value: 'dialog', label: 'dialog' },
                                            { value: 'banner', label: 'banner (header)' },
                                            { value: 'contentinfo', label: 'contentinfo (footer)' },
                                            { value: 'region', label: 'region' },
                                            { value: 'list', label: 'list' },
                                            { value: 'listitem', label: 'listitem' },
                                            { value: 'none', label: 'none (hide from SR)' },
                                        ]}
                                    />
                                </Row>
                                <Row label="tabIndex">
                                    <NumberInput
                                        label=""
                                        value={Number((element.props as any)['tabIndex'] ?? 0)}
                                        onChange={(v: number) => updateProject({
                                            ...elements,
                                            [element.id]: {
                                                ...element,
                                                props: { ...element.props, tabIndex: v },
                                            },
                                        })}
                                        min={-1}
                                        max={99}
                                        step={1}
                                    />
                                </Row>
                            </div>
                            <p className="mt-2 text-[10px] text-[#484848] leading-relaxed">
                                ARIA attributes apply live on the canvas and are written into exported JSX.
                                Use <code className="text-[#555] bg-[#1e1e1e] px-1 rounded text-[9px]">aria-label</code> for icon-only buttons.
                            </p>
                        </Section>

                        {/* ── Test & Data Attributes ──────────────────── */}
                        <Section title="Test IDs & Data Attributes">
                            <div className="space-y-2.5">
                                <Row label="data-testid">
                                    <TextInput
                                        value={String((element.props as any)['data-testid'] ?? '')}
                                        onChange={(v: string) => updateProject({
                                            ...elements,
                                            [element.id]: {
                                                ...element,
                                                props: { ...element.props, 'data-testid': v || undefined },
                                            },
                                        })}
                                        placeholder="e.g. submit-button"
                                        icon={Hash}
                                    />
                                </Row>
                                <Row label="data-cy">
                                    <TextInput
                                        value={String((element.props as any)['data-cy'] ?? '')}
                                        onChange={(v: string) => updateProject({
                                            ...elements,
                                            [element.id]: {
                                                ...element,
                                                props: { ...element.props, 'data-cy': v || undefined },
                                            },
                                        })}
                                        placeholder="e.g. checkout-form"
                                        icon={Hash}
                                    />
                                </Row>
                            </div>
                            <p className="mt-2 text-[10px] text-[#484848] leading-relaxed">
                                For Playwright, Cypress, and Jest/Testing Library. Written into exported JSX.
                            </p>
                        </Section>
                    </>
                )}

            </div>
        </div>
    );
};

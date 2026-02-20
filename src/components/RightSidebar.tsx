import { useState, useEffect } from 'react';
import { useEditor } from '../context/EditorContext';
import ColorPicker from 'react-best-gradient-color-picker';
import { Section, Row, NumberInput, ColorInput, ToggleGroup, BoxModel, TextInput, SelectInput } from './ui/PremiumInputs';
import { removeClasses } from '../utils/tailwindHelpers';
import {
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    Grid, Box, Maximize, Lock, Eye,
    Type, ArrowRight, ArrowDown, Image as ImageIcon, PaintBucket, RotateCw, MousePointer2,
    Hand, Settings, Layout, Hash, Type as TypeIcon,
    MoveHorizontal, MoveVertical, Droplets, Sun, Move,
    CornerUpLeft, CornerUpRight, CornerDownLeft, CornerDownRight, Layers
} from 'lucide-react';
import { cn } from '../lib/utils';

// --- TYPES ---
type Tab = 'design' | 'interact' | 'settings';
type FillMode = 'solid' | 'gradient' | 'image';

// --- SUB-COMPONENTS ---
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
    const { elements, selectedId, updateProject, previewMode, pages } = useEditor();
    const [activeTab, setActiveTab] = useState<Tab>('design');
    const [fillMode, setFillMode] = useState<FillMode>('solid');
    const [animScope, setAnimScope] = useState<'single' | 'all'>('single');

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

    }, [element?.id]);

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

    // --- HELPERS ---
    const updateStyle = (key: string, value: any) => {
        const newElements = { ...elements };
        const unitlessKeys = ['fontWeight', 'opacity', 'zIndex', 'flexGrow', 'scale', 'lineHeight'];
        const finalValue = (typeof value === 'number' && !unitlessKeys.includes(key)) ? `${value}px` : value;

        let targetIds = [element.id];

        if (animScope === 'all' && key.startsWith('animation')) {
            const parentId = Object.keys(elements).find(k => elements[k].children?.includes(element.id));
            if (parentId) {
                const parent = elements[parentId];
                if (['webpage', 'canvas', 'page'].includes(parent.type)) {
                    targetIds = parent.children || [];
                }
            }
        }

        targetIds.forEach(id => {
            const currentStyle = newElements[id].props.style || {};
            let mergeStyle = {};
            if (key === 'animationName' && value !== 'none' && !currentStyle.animationDuration) {
                mergeStyle = { animationDuration: '0.5s', animationFillMode: 'both' };
            }
            newElements[id].props.style = { ...currentStyle, [key]: finalValue, ...mergeStyle };
        });

        updateProject(newElements);
    };

    const updateProp = (key: string, value: any) => {
        const newElements = { ...elements };
        newElements[element.id].props = { ...newElements[element.id].props, [key]: value };
        updateProject(newElements);
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

    const style = element.props.style || {};
    const props = element.props || {};
    const classes = props.className || '';
    const getVal = (val: any, fallback: any = 0) => parseInt(String(val || fallback).replace('px', ''));
    const handleBoxModelChange = (field: string, value: string) => updateStyle(field, parseInt(value) || 0);

    return (
        <div className="w-[320px] bg-[#333333] border-l border-[#252526] h-full flex flex-col">

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
                <TabButton active={activeTab === 'design'} onClick={() => setActiveTab('design')} icon={Layout} label="Design" />
                <TabButton active={activeTab === 'interact'} onClick={() => setActiveTab('interact')} icon={MousePointer2} label="Interact" />
                <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={Settings} label="Settings" />
            </div>

            {/* CONTENT AREA */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">

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
                                <NumberInput label="W" value={getVal(style.width, 'auto')} onChange={(v: any) => updateStyle('width', v)} />
                                <NumberInput label="H" value={getVal(style.height, 'auto')} onChange={(v: any) => updateStyle('height', v)} />
                            </div>
                            {element.props.style?.position === 'absolute' && (
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <NumberInput label="X" value={getVal(style.left)} onChange={(v: any) => updateStyle('left', v)} />
                                    <NumberInput label="Y" value={getVal(style.top)} onChange={(v: any) => updateStyle('top', v)} />
                                </div>
                            )}

                            <div className="mb-3">
                                <NumberInput label="Z-Index" value={getVal(style.zIndex, 0)} onChange={(v: number) => updateStyle('zIndex', v)} />
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
                                <button onClick={() => setFillMode('solid')} className={cn("flex-1 py-1 rounded text-[10px] font-medium transition-all", fillMode === 'solid' ? "bg-[#3e3e42] text-white" : "text-[#858585]")}><PaintBucket size={10} className="inline mr-1" />Solid</button>
                                <button onClick={() => setFillMode('gradient')} className={cn("flex-1 py-1 rounded text-[10px] font-medium transition-all", fillMode === 'gradient' ? "bg-[#3e3e42] text-white" : "text-[#858585]")}><Sun size={10} className="inline mr-1" />Gradient</button>
                                <button onClick={() => setFillMode('image')} className={cn("flex-1 py-1 rounded text-[10px] font-medium transition-all", fillMode === 'image' ? "bg-[#3e3e42] text-white" : "text-[#858585]")}><ImageIcon size={10} className="inline mr-1" />Image</button>
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
                            <div className="space-y-3">
                                <Row label="On Click">
                                    <SelectInput
                                        value={props.linkTo || ''}
                                        onChange={(v: string) => updateProp('linkTo', v || undefined)}
                                        options={[
                                            { value: '', label: '— No Action —' },
                                            ...pages.map(p => ({
                                                value: p.slug,
                                                label: `Maps to: ${p.name}`
                                            }))
                                        ]}
                                    />
                                </Row>
                                {props.linkTo && (
                                    <div className="text-[10px] text-[#666] bg-[#252526] p-2 rounded border border-[#3e3e42] flex items-start gap-2">
                                        <ArrowRight size={12} className="mt-0.5" />
                                        <span>Clicking this element will navigate to <strong className="text-[#007acc]">{props.linkTo}</strong></span>
                                    </div>
                                )}
                            </div>
                        </Section>
                    </>
                )}

                {/* --- TAB: SETTINGS --- */}
                {activeTab === 'settings' && (
                    <>
                        <Section title="Metadata">
                            <Row label="ID">
                                <TextInput
                                    value={element.id}
                                    onChange={() => { }}
                                    icon={Hash}
                                />
                            </Row>
                            <div className="mt-2 text-[10px] text-[#555]">
                                Unique identifier used for code generation.
                            </div>
                        </Section>

                        <Section title="Custom Attributes">
                            <div className="p-4 text-center text-xs text-[#666]">
                                ARIA labels and data attributes configuration coming soon.
                            </div>
                        </Section>
                    </>
                )}

            </div>
        </div>
    );
};

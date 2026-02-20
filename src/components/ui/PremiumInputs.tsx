import React, { useState, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

// --- 1. COLLAPSIBLE SECTION ---
export const Section = ({ title, children, defaultOpen = true, actions }: any) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className="border-b border-[#252526]">
            <div
                className="flex items-center justify-between p-3 group hover:bg-[#2a2a2c] transition-colors cursor-pointer select-none"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={12} className="text-[#858585]" /> : <ChevronRight size={12} className="text-[#858585]" />}
                    <span className="text-[11px] font-bold text-[#cccccc] uppercase tracking-wide">{title}</span>
                </div>
                {actions && <div onClick={e => e.stopPropagation()}>{actions}</div>}
            </div>
            {isOpen && <div className="px-3 pb-4 space-y-3 animate-in slide-in-from-top-1 duration-200">{children}</div>}
        </div>
    );
};

// --- 2. PROPERTY ROW ---
export const Row = ({ label, children }: { label?: string, children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-3 min-h-[24px]">
        {label && <label className="text-[10px] font-medium text-[#999999] w-16 shrink-0 truncate select-none">{label}</label>}
        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">{children}</div>
    </div>
);

// --- 3. DRAGGABLE NUMBER INPUT ---
export const NumberInput = ({ label, value, onChange, min = -9999, max = 9999, step = 1, className }: any) => {
    const startX = useRef<number>(0);
    const startVal = useRef<number>(0);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        startX.current = e.clientX;
        startVal.current = typeof value === 'number' ? value : parseInt(value) || 0;
        document.body.style.cursor = 'ew-resize';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
        const delta = Math.round((e.clientX - startX.current) * step);
        const newValue = Math.min(Math.max(startVal.current + delta, min), max);
        onChange(newValue);
    };

    const handleMouseUp = () => {
        document.body.style.cursor = 'default';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };

    return (
        <div className={cn("flex items-center gap-1 group bg-[#252526] border border-[#3e3e42] rounded px-1.5 py-0.5 hover:border-[#555] transition-colors w-full focus-within:border-[#007acc] focus-within:bg-[#1e1e1e]", className)}>
            {label && (
                <span
                    className="text-[10px] font-medium text-[#666] group-hover:text-[#007acc] cursor-ew-resize select-none w-3 text-center"
                    onMouseDown={handleMouseDown}
                >
                    {label}
                </span>
            )}
            <input
                className="w-full bg-transparent text-xs text-[#cccccc] font-mono outline-none text-center appearance-none p-0 focus:text-white"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Number(value) + step); }
                    if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Number(value) - step); }
                }}
            />
        </div>
    );
};

// --- 4. COLOR INPUT ---
export const ColorInput = ({ value, onChange }: { value: string, onChange: (val: string) => void }) => {
    const displayValue = value === 'transparent' ? 'None' : value;
    const bgStyle = value === 'transparent'
        ? { backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)', backgroundSize: '6px 6px', backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px' }
        : { backgroundColor: value };

    return (
        <div className="flex items-center gap-2 w-full">
            <div className="relative w-full flex items-center bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 hover:border-[#555] focus-within:border-[#007acc]">
                <div className="w-4 h-4 rounded-[2px] border border-[#444] shrink-0 mr-2 relative overflow-hidden" style={bgStyle}>
                    <input
                        type="color"
                        value={value === 'transparent' ? '#000000' : value}
                        onChange={(e) => onChange(e.target.value)}
                        className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] opacity-0 cursor-pointer"
                    />
                </div>
                <input
                    className="flex-1 bg-transparent text-xs text-[#cccccc] font-mono outline-none uppercase"
                    value={displayValue}
                    onChange={(e) => onChange(e.target.value)}
                />
            </div>
        </div>
    );
};

// --- 5. TEXT/URL INPUT ---
export const TextInput = ({ value, onChange, placeholder, icon: Icon }: any) => (
    <div className="relative w-full flex items-center bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 hover:border-[#555] focus-within:border-[#007acc]">
        {Icon && <Icon size={12} className="text-[#666] mr-2" />}
        <input
            className="flex-1 bg-transparent text-xs text-[#cccccc] placeholder-[#666] outline-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

// --- 6. SELECT INPUT ---
export const SelectInput = ({ value, onChange, options }: any) => (
    <div className="relative w-full">
        <select
            className="w-full bg-[#252526] border border-[#3e3e42] rounded px-2 py-1 text-xs text-[#cccccc] appearance-none outline-none hover:border-[#555] focus:border-[#007acc]"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        >
            {options.map((opt: any) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1.5 text-[#666] pointer-events-none" />
    </div>
);

// --- 7. TOGGLE GROUP ---
export const ToggleGroup = ({ options, value, onChange }: any) => (
    <div className="flex bg-[#252526] p-0.5 rounded border border-[#3e3e42] w-full">
        {options.map((opt: any) => (
            <button
                key={opt.value}
                onClick={() => onChange(opt.value)}
                className={cn(
                    "flex-1 flex items-center justify-center py-1 rounded-sm transition-all",
                    value === opt.value ? "bg-[#3e3e42] text-white shadow-sm" : "text-[#858585] hover:text-[#cccccc] hover:bg-[#333]"
                )}
                title={opt.label}
            >
                {opt.icon}
            </button>
        ))}
    </div>
);

// --- 8. VISUAL BOX MODEL ---
export const BoxModel = ({ margin, padding, onChange }: any) => {
    const TinyInput = ({ val, field, className }: any) => (
        <input
            className={cn("w-6 bg-transparent text-[9px] text-[#cccccc] text-center outline-none focus:text-white focus:font-bold", className)}
            value={parseInt(val || 0)}
            onChange={(e) => onChange(field, e.target.value)}
        />
    );

    return (
        <div className="relative w-full h-[100px] flex items-center justify-center select-none text-[9px]">
            {/* MARGIN */}
            <div className="absolute inset-0 bg-[#2d2d2d] border border-[#3e3e42] rounded flex flex-col items-center justify-between py-1 px-1">
                <span className="text-[8px] text-[#555] absolute top-1 left-1">MARGIN</span>
                <TinyInput val={margin.top} field="marginTop" />
                <div className="w-full flex justify-between items-center px-1">
                    <TinyInput val={margin.left} field="marginLeft" />
                    <TinyInput val={margin.right} field="marginRight" />
                </div>
                <TinyInput val={margin.bottom} field="marginBottom" />
            </div>
            {/* PADDING */}
            <div className="absolute inset-[24px] bg-[#252526] border border-[#444] rounded flex flex-col items-center justify-between py-1 px-1 z-10">
                <span className="text-[8px] text-[#777] absolute top-0.5 left-1">PADDING</span>
                <TinyInput val={padding.top} field="paddingTop" />
                <div className="w-full flex justify-between items-center px-1">
                    <TinyInput val={padding.left} field="paddingLeft" />
                    <div className="w-8 h-3 bg-[#333] rounded border border-[#555]" />
                    <TinyInput val={padding.right} field="paddingRight" />
                </div>
                <TinyInput val={padding.bottom} field="paddingBottom" />
            </div>
        </div>
    );
};

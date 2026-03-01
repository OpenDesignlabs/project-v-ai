import { useState, useRef, useEffect } from 'react';
import { useEditor } from '../../context/EditorContext';
import { ChevronRight, ChevronDown, Lock, Eye, Copy, Trash2, BoxSelect } from 'lucide-react';
import { cn } from '../../lib/utils';

// ── DnD state lives outside React to avoid closure capture issues during drag ──
let _dragNodeId: string | null = null;

interface LayerNodeProps {
    nodeId: string;
    depth: number;
    parentId: string | null;
}

const LayerNode = ({ nodeId, depth, parentId }: LayerNodeProps) => {
    const {
        elements, selectedId, setSelectedId,
        updateProject, deleteElement, duplicateElement, reorderElement,
    } = useEditor();
    const element = elements[nodeId];

    const [isExpanded, setIsExpanded] = useState(true);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameVal, setRenameVal] = useState('');
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);
    const [dropIndicator, setDropIndicator] = useState<'above' | 'below' | 'inside' | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    if (!element) return null;

    const isSelected = selectedId === nodeId;
    const hasChildren = element.children && element.children.length > 0;
    const isContainer = ['container', 'page', 'section', 'canvas', 'webpage', 'app',
        'grid', 'card', 'stack_v', 'stack_h', 'hero', 'navbar', 'pricing'].includes(element.type);

    // ── Focus rename input when opened ────────────────────────────────────────
    useEffect(() => {
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming]);

    const handleRename = () => {
        if (renameVal.trim()) {
            updateProject({ ...elements, [nodeId]: { ...element, name: renameVal } });
        }
        setIsRenaming(false);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
        setSelectedId(nodeId);
    };

    // S-6 FIX: early-return when contextMenu is null so no listener is ever
    // added for the closed state. This prevents the double add+remove pattern
    // that occurred on unrelated re-renders while the menu was already open.
    useEffect(() => {
        if (!contextMenu) return;
        const close = () => setContextMenu(null);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [contextMenu]);

    // ── HTML5 Drag source ─────────────────────────────────────────────────────
    const handleDragStart = (e: React.DragEvent) => {
        _dragNodeId = nodeId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', nodeId);
        e.stopPropagation();
    };
    const handleDragEnd = () => {
        _dragNodeId = null;
        setDropIndicator(null);
    };

    // ── HTML5 Drop target ─────────────────────────────────────────────────────
    const getIndicator = (e: React.DragEvent): 'above' | 'below' | 'inside' => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const rel = (e.clientY - rect.top) / rect.height;
        if (isContainer && rel > 0.25 && rel < 0.75) return 'inside';
        return rel < 0.5 ? 'above' : 'below';
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!_dragNodeId || _dragNodeId === nodeId) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropIndicator(getIndicator(e));
    };

    const handleDragLeave = () => setDropIndicator(null);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const dragged = _dragNodeId;
        _dragNodeId = null;
        setDropIndicator(null);
        if (!dragged || dragged === nodeId) return;

        const finalIndicator = getIndicator(e);

        if (finalIndicator === 'inside') {
            reorderElement(dragged, nodeId, element.children?.length ?? 0);
        } else if (parentId) {
            const siblings = elements[parentId]?.children || [];
            const myIdx = siblings.indexOf(nodeId);
            const targetIdx = finalIndicator === 'above' ? myIdx : myIdx + 1;
            reorderElement(dragged, parentId, targetIdx);
        }
    };

    return (
        <>
            <div
                draggable
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    "flex items-center h-8 px-2 cursor-pointer border-b border-transparent hover:bg-[#2a2a2c] group text-[#ccc] text-xs select-none relative transition-colors",
                    isSelected && "bg-[#007acc] text-white hover:bg-[#007acc]",
                    dropIndicator === 'inside' && "bg-[#007acc]/20",
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={(e) => { e.stopPropagation(); setSelectedId(nodeId); }}
                onDoubleClick={() => { setRenameVal(element.name); setIsRenaming(true); }}
                onContextMenu={handleContextMenu}
            >
                {/* Drop-line indicator above */}
                {dropIndicator === 'above' && (
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-400 z-10 pointer-events-none" />
                )}
                {/* Drop-line indicator below */}
                {dropIndicator === 'below' && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-400 z-10 pointer-events-none" />
                )}

                {/* Expand Toggle */}
                <button
                    onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                    className={cn("w-4 h-4 flex items-center justify-center mr-1 opacity-50 hover:opacity-100", !hasChildren && "invisible")}
                >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>

                {/* Name / Rename Input */}
                {isRenaming ? (
                    <input
                        ref={inputRef}
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onBlur={handleRename}
                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                        className="bg-[#1e1e1e] text-white border border-[#007acc] h-6 px-1 w-full outline-none rounded"
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span className="flex-1 truncate">{element.name}</span>
                )}

                {/* Quick Actions (Hover) */}
                <div className={cn("flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity", isSelected && "opacity-100 text-white")}>
                    <button onClick={(e) => { e.stopPropagation(); updateProject({ ...elements, [nodeId]: { ...element, locked: !element.locked } }) }}>
                        <Lock size={12} className={element.locked ? "opacity-100" : "opacity-50"} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); updateProject({ ...elements, [nodeId]: { ...element, hidden: !element.hidden } }) }}>
                        <Eye size={12} className={element.hidden ? "opacity-50" : "opacity-100"} />
                    </button>
                </div>
            </div>

            {/* Children */}
            {hasChildren && isExpanded && element.children?.map(childId => (
                <LayerNode key={childId} nodeId={childId} depth={depth + 1} parentId={nodeId} />
            ))}

            {/* Context Menu Portal */}
            {contextMenu && (
                <div
                    className="fixed z-[100] bg-[#252526] border border-[#3f3f46] shadow-xl rounded-md py-1 w-40 flex flex-col"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <div className="px-3 py-1.5 text-[10px] font-bold text-[#666] uppercase border-b border-[#3f3f46] mb-1 truncate">{element.name}</div>
                    <MenuBtn icon={Copy} label="Duplicate" onClick={() => {
                        const newId = duplicateElement(nodeId);
                        if (newId) setSelectedId(newId);
                        setContextMenu(null);
                    }} />
                    <MenuBtn icon={BoxSelect} label="Rename" onClick={() => { setRenameVal(element.name); setIsRenaming(true); setContextMenu(null); }} />
                    <div className="h-px bg-[#3f3f46] my-1" />
                    <MenuBtn icon={Trash2} label="Delete" onClick={() => { deleteElement(nodeId); setContextMenu(null); }} danger />
                </div>
            )}
        </>
    );
};

const MenuBtn = ({ icon: Icon, label, onClick, danger }: {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    onClick: () => void;
    danger?: boolean;
}) => (
    <button
        onClick={onClick}
        className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#007acc] hover:text-white transition-colors text-left w-full",
            danger ? "text-red-400 hover:bg-red-500/20 hover:text-red-300" : "text-[#ccc]"
        )}
    >
        <Icon size={12} /> {label}
    </button>
);

export const LayersPanel = () => {
    const { elements, activePageId } = useEditor();
    const root = elements[activePageId];

    if (!root) return <div className="p-4 text-xs text-[#666]">No active page</div>;

    return (
        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar bg-[#1e1e1e]">
            <div className="p-3 border-b border-[#252526] flex items-center justify-between">
                <span className="text-xs font-bold text-[#ccc]">Layers</span>
                <span className="text-[10px] text-[#666]">{Object.keys(elements).length} Elements</span>
            </div>
            <div className="py-2">
                {root.children?.map(childId => (
                    <LayerNode key={childId} nodeId={childId} depth={0} parentId={activePageId} />
                ))}
            </div>
        </div>
    );
};

import { useState, useRef, useEffect } from 'react';
import { useEditor } from '../../context/EditorContext';
import { ChevronRight, ChevronDown, Lock, Eye, Copy, Trash2, BoxSelect } from 'lucide-react';
import { cn } from '../../lib/utils';

// ── DnD state lives outside React to avoid closure capture issues during drag ──
let _dragNodeId: string | null = null;

// Module-level search query — avoids prop-drilling through recursive LayerNode tree. Same pattern as _dragNodeId above. LayerNode reads this directly on each render — zero extra context subscriptions
let _layerSearch = '';

interface LayerNodeProps {
    nodeId: string;
    depth: number;
    parentId: string | null;
}

const LayerNode = ({ nodeId, depth, parentId }: LayerNodeProps) => {
    const {
        elements, selectedId, setSelectedId,
        updateProject, elementsRef, deleteElement, duplicateElement, reorderElement,
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

    // When search is active, hide leaf nodes that don't match. Container nodes (with children) always show so their matching descendants remain reachable — the tree stays navigable
    if (_layerSearch && !hasChildren) {
        if (!element.name.toLowerCase().includes(_layerSearch)) return null;
    }

    // Auto-expand all nodes when search is active so matches are visible.
    const effectiveExpanded = _layerSearch ? true : isExpanded;
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
            // rename is cosmetic — don't consume a history slot.
            // Cmd+Z will revert to the last structural snapshot which retains the old name.
            updateProject({ ...elements, [nodeId]: { ...element, name: renameVal } }, { skipHistory: true });
        }
        setIsRenaming(false);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
        setSelectedId(nodeId);
    };

    // early-return when contextMenu is null so no listener is ever
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
                onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(nodeId);
                    // Pan canvas to center this element — same fire-and-forget pattern as vectra:zoom-to-fit.
                    window.dispatchEvent(new CustomEvent('vectra:scroll-to-node', { detail: { id: nodeId } }));
                }}
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
                    onClick={(e) => { e.stopPropagation(); if (!_layerSearch) setIsExpanded(!isExpanded); }}
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

                {/* Lock + Eye toggles — hover-reveal. Buttons stopPropagation so they don't trigger row selection. */}
                <div className={cn("flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity", isSelected && "opacity-100 text-white")}>
                    <button
                        title={element.locked ? 'Unlock element' : 'Lock element'}
                        onClick={(e) => {
                            e.stopPropagation();
                            const cur = elementsRef.current;
                            updateProject({ ...cur, [nodeId]: { ...cur[nodeId], locked: !cur[nodeId]?.locked } });
                        }}
                    >
                        <Lock size={12} className={element.locked ? "opacity-100 text-amber-400" : "opacity-50"} />
                    </button>
                    <button
                        title={element.hidden ? 'Show element' : 'Hide element'}
                        onClick={(e) => {
                            e.stopPropagation();
                            const cur = elementsRef.current;
                            updateProject({ ...cur, [nodeId]: { ...cur[nodeId], hidden: !cur[nodeId]?.hidden } });
                        }}
                    >
                        <Eye size={12} className={element.hidden ? "opacity-50" : "opacity-100"} />
                    </button>
                </div>
            </div>

            {/* Children */}
            {hasChildren && effectiveExpanded && element.children?.map(childId => (
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
    const [search, setSearch] = useState('');
    // Keep module-level var in sync with React state so LayerNode
    // reads the latest query on each render without needing it as a prop.
    _layerSearch = search.toLowerCase().trim();
    const root = elements[activePageId];

    if (!root) return <div className="p-4 text-xs text-[#666]">No active page</div>;

    return (
        <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar bg-[#1e1e1e]">
            <div className="p-3 border-b border-[#252526] flex items-center justify-between">
                <span className="text-xs font-bold text-[#ccc]">Layers</span>
                <span className="text-[10px] text-[#666]">{Object.keys(elements).length} Elements</span>
            </div>
            {/* Search input — filters layer nodes by name in real time */}
            <div className="px-2 py-1.5 border-b border-[#2a2a2c]">
                <div className="relative">
                    <svg className="absolute left-2 top-1/2 -translate-y-1/2 text-[#555]" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search layers…"
                        className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded pl-6 pr-6 py-1 text-[11px] text-white outline-none focus:border-[#007acc]/50 placeholder-[#444] transition-colors"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#999] transition-colors"
                        >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                        </button>
                    )}
                </div>
            </div>
            <div className="py-2">
                {root.children?.map(childId => (
                    <LayerNode key={childId} nodeId={childId} depth={0} parentId={activePageId} />
                ))}
            </div>
        </div>
    );
};

import React, { useRef, useState, lazy, Suspense, useEffect, useCallback } from 'react';
import { useEditor } from '../context/EditorContext';
import { useContainer } from '../context/ContainerContext';
import {
    Plus, Layers, File, Image as ImageIcon,
    Search, X, Type, Layout, FormInput, Puzzle, Upload,
    ChevronRight, ChevronDown, Folder, Code2, Box, DownloadCloud, Loader2,
    Trash2, Hexagon, Palette, Wand2, Database, Globe, Braces
} from 'lucide-react';
import { cn } from '../lib/utils';
import { processImportedCode, generateComponentId } from '../utils/importHelpers';
import { TEMPLATES, type TemplateConfig } from '../data/templates';
import { ICON_NAMES, getIconComponent } from '../data/iconRegistry';
import { Store, ShoppingBag as ShoppingBagIcon } from 'lucide-react';
import { InsertDrawer } from './InsertDrawer';

const MARKETPLACE_ITEMS = [
    {
        id: 'hero_saas',
        title: 'SaaS Hero',
        category: 'Hero',
        image: 'https://cdn.dribbble.com/users/26642/screenshots/15935398/media/64b22c77607739506727276332766624.png?resize=400x300&vertical=center',
        templateKey: 'hero_saas'
    },
    {
        id: 'pricing_tables',
        title: 'SaaS Pricing',
        category: 'Pricing',
        image: 'https://cdn.dribbble.com/users/1615584/screenshots/15710288/media/78627376722329759368f3a3915220c3.jpg?resize=400x300&vertical=center',
        templateKey: 'pricing_tables'
    },
    {
        id: 'features_grid',
        title: 'Feature Grid',
        category: 'Features',
        image: 'https://cdn.dribbble.com/users/5031392/screenshots/15467520/media/c873099955d5d883b27b872da0c02dc2.png?resize=400x300&vertical=center',
        templateKey: 'features_grid'
    },
    {
        id: 'portfolio_hero',
        title: 'Creative Hero',
        category: 'Portfolio',
        image: 'https://cdn.dribbble.com/users/1256429/screenshots/15536437/media/e57973715c00b73c4d720c224206c649.png?resize=400x300&vertical=center',
        templateKey: 'portfolio_hero'
    }
];

const LayersPanel = lazy(() => import('./panels/LayersPanel').then(m => ({ default: m.LayersPanel })));

type DrawerTab = 'recent' | 'basic' | 'layout' | 'forms' | 'media' | 'templates';

const CATEGORIES: { id: DrawerTab; label: string; icon: any }[] = [
    { id: 'basic', label: 'Basic', icon: Type },
    { id: 'layout', label: 'Layout', icon: Layout },
    { id: 'forms', label: 'Forms', icon: FormInput },
    { id: 'media', label: 'Media', icon: ImageIcon },
    { id: 'templates', label: 'Templates', icon: Puzzle },
];

const JsonTree = ({ data, parentKey = '', setDragData }: any) => {
    if (typeof data !== 'object' || data === null) {
        const displayKey = parentKey.split('.').pop();
        return (
            <div
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', `{{${parentKey}}}`);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDragData({ type: 'DATA_BINDING', payload: parentKey, meta: { sample: String(data) } });
                }}
                className="flex items-center gap-2 py-1 pl-4 text-[10px] text-[#999] hover:bg-[#333] hover:text-white cursor-grab group"
            >
                <div className="w-1 h-1 rounded-full bg-blue-500" />
                <span className="font-mono text-blue-300">{displayKey}</span>
                <span className="text-[#555] truncate max-w-[80px]">"{String(data)}"</span>
            </div>
        );
    }

    return (
        <div className="pl-2 border-l border-[#333] ml-1">
            {Object.entries(data).map(([key, value]) => (
                <div key={key}>
                    {typeof value === 'object' && value !== null ? (
                        <>
                            <div className="py-1 text-[10px] text-[#777] font-bold">{key}</div>
                            <JsonTree data={value} parentKey={parentKey ? `${parentKey}.${key}` : key} setDragData={setDragData} />
                        </>
                    ) : (
                        <JsonTree data={value} parentKey={parentKey ? `${parentKey}.${key}` : key} setDragData={setDragData} />
                    )}
                </div>
            ))}
        </div>
    );
};

const FileTreeNode = ({ name, node, depth = 0 }: { name: string, node: any, depth?: number }) => {
    const [expanded, setExpanded] = useState(false);
    const isDir = node.type === 'folder';
    const paddingLeft = `${depth * 12 + 12}px`;

    if (!isDir) {
        return (
            <div className="flex items-center gap-2 py-1 text-[10px] text-[#ccc] hover:bg-[#2a2d2e] cursor-default" style={{ paddingLeft }}>
                <Code2 size={10} className="text-blue-400" /> {name}
            </div>
        );
    }

    return (
        <div>
            <div
                className="flex items-center gap-2 py-1 text-[10px] text-[#ccc] font-bold hover:bg-[#2a2d2e] cursor-pointer select-none"
                style={{ paddingLeft }}
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                <Folder size={10} className="text-yellow-500" /> {name}
            </div>
            {expanded && node.children && (
                <div>
                    {Object.entries(node.children).map(([childName, childNode]) => (
                        <FileTreeNode key={childName} name={childName} node={childNode} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

const ColorField = ({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) => (
    <div className="flex items-center justify-between">
        <label className="text-xs text-[#ccc]">{label}</label>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#666] font-mono">{value}</span>
            <input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-6 h-6 rounded bg-transparent border-none p-0 cursor-pointer"
            />
        </div>
    </div>
);

export const LeftSidebar = () => {
    const {
        activePanel, setActivePanel, setDragData, previewMode,
        componentRegistry, registerComponent, recentComponents, addRecentComponent,
        pages, addPage, switchPage, deletePage, realPageId,
        theme, updateTheme, selectedId, elements, setElements,
        dataSources, addDataSource, removeDataSource,
        isInsertDrawerOpen, toggleInsertDrawer
    } = useEditor();

    const { fileTree, installPackage, terminalOutput, status } = useContainer();

    const [activeCat, setActiveCat] = useState<DrawerTab>('basic');
    const [search, setSearch] = useState('');
    const [pkgName, setPkgName] = useState('');
    const [isInstalling, setIsInstalling] = useState(false);
    const [iconSearch, setIconSearch] = useState('');
    const [assetSearch, setAssetSearch] = useState('');
    const [unsplashImages, setUnsplashImages] = useState<{ id: number; url: string }[]>([]);
    const [loadingAssets, setLoadingAssets] = useState(false);
    const [newApiUrl, setNewApiUrl] = useState('');
    const [isFetchingApi, setIsFetchingApi] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const searchUnsplash = useCallback(async (query: string) => {
        setLoadingAssets(true);
        // Simulate API delay
        await new Promise(r => setTimeout(r, 600));

        const reliableImages = [
            { id: 1, url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80' },
            { id: 2, url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=400&q=80' },
            { id: 3, url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=400&q=80' },
            { id: 4, url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=400&q=80' },
            { id: 5, url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=400&q=80' },
            { id: 6, url: 'https://images.unsplash.com/photo-1555099962-4199c345e5dd?auto=format&fit=crop&w=400&q=80' },
            { id: 7, url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=400&q=80' },
            { id: 8, url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80' },
        ];

        if (query.trim()) {
            setUnsplashImages([...reliableImages].sort(() => 0.5 - Math.random()));
        } else {
            setUnsplashImages(reliableImages);
        }
        setLoadingAssets(false);
    }, []);

    // --- CRITICAL FIX: MOVE EFFECT BEFORE CONDITIONAL RETURN ---
    useEffect(() => {
        if (activePanel === 'assets' && unsplashImages.length === 0) {
            searchUnsplash('');
        }
    }, [activePanel, unsplashImages.length, searchUnsplash]);

    // --- NOW IT IS SAFE TO RETURN NULL ---
    if (previewMode) return null;

    const togglePanel = (panel: typeof activePanel) => {
        setActivePanel((prev: typeof activePanel) => prev === panel ? null : panel);
    };

    const handleInstall = async () => {
        if (!pkgName) return;
        setIsInstalling(true);
        await installPackage(pkgName);
        setIsInstalling(false);
        setPkgName('');
    };

    const filteredComponents = activeCat === 'recent'
        ? recentComponents.map(id => [id, componentRegistry[id]]).filter(x => x[1]) as [string, any][]
        : activeCat !== 'templates'
            ? Object.entries(componentRegistry)
                .filter(([_type, config]) => {
                    const matchesSearch = config.label.toLowerCase().includes(search.toLowerCase());
                    const matchesCategory = search ? true : config.category === activeCat;
                    return matchesSearch && matchesCategory;
                })
            : [];

    const filteredTemplates = activeCat === 'templates' || search
        ? Object.entries(TEMPLATES)
            .filter(([, tpl]) => {
                if (!search) return activeCat === 'templates';
                return tpl.name.toLowerCase().includes(search.toLowerCase());
            })
        : [];

    const templateGroups = filteredTemplates.reduce((acc, [key, tpl]) => {
        const cat = tpl.category || 'Other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push({ key, ...tpl });
        return acc;
    }, {} as Record<string, (TemplateConfig & { key: string })[]>);

    const sortedCategories = Object.keys(templateGroups).sort();
    const filteredIcons = ICON_NAMES.filter(name => name.toLowerCase().includes(iconSearch.toLowerCase()));

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            const config = processImportedCode(content, file.name);
            const newId = generateComponentId(config.label);
            registerComponent(newId, config);
        };
        reader.readAsText(file);
    };

    const NavButton = ({ icon: Icon, active, onClick, tooltip }: { icon: any; active: boolean; onClick: () => void; tooltip: string }) => (
        <button onClick={onClick} className={cn("w-10 h-10 rounded flex items-center justify-center transition-all duration-100 relative group", active ? "text-white opacity-100 border-l-2 border-[#007acc] bg-[#252526]" : "text-[#999999] opacity-70 hover:opacity-100 hover:text-white")}>
            <Icon size={22} strokeWidth={1.5} />
            {tooltip && <span className="absolute left-full ml-3 px-2 py-1 bg-[#252526] text-white text-[10px] rounded border border-[#3f3f46] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[60] shadow-md">{tooltip}</span>}
        </button>
    );

    return (
        <div className="w-[60px] h-full flex flex-col border-r border-[#3f3f46] bg-[#333333] relative z-50">
            {/* MAIN RAIL */}
            <div className="flex flex-col items-center py-4 gap-4 h-full bg-[#333333] z-50 relative">
                <NavButton icon={Plus} active={isInsertDrawerOpen} onClick={() => { if (activePanel) setActivePanel(null); toggleInsertDrawer(); }} tooltip="Insert" />
                <div className="w-8 h-[1px] bg-[#4f4f4f] my-1" />
                <NavButton icon={Folder} active={activePanel === 'files'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('files'); }} tooltip="Explorer" />
                <NavButton icon={Box} active={activePanel === 'npm'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('npm'); }} tooltip="NPM Packages" />
                <NavButton icon={File} active={activePanel === 'pages'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('pages'); }} tooltip="Pages" />
                <div className="w-8 h-[1px] bg-[#4f4f4f] my-1" />
                <NavButton icon={Hexagon} active={activePanel === 'icons'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('icons'); }} tooltip="Icons" />
                <NavButton icon={Palette} active={activePanel === 'theme'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('theme'); }} tooltip="Global Theme" />
                <NavButton icon={Database} active={activePanel === 'data'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('data'); }} tooltip="Data Sources" />
                <div className="w-8 h-[1px] bg-[#4f4f4f] my-1" />
                <NavButton icon={Store} active={activePanel === 'marketplace'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('marketplace'); }} tooltip="Marketplace" />
                <NavButton icon={Layers} active={activePanel === 'layers'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('layers'); }} tooltip="Layers" />
                <NavButton icon={ImageIcon} active={activePanel === 'assets'} onClick={() => { if (isInsertDrawerOpen) toggleInsertDrawer(); togglePanel('assets'); }} tooltip="Assets" />
            </div>

            {/* --- PANELS --- */}
            {activePanel === 'add' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[420px] bg-[#252526] border-r border-[#3f3f46] shadow-2xl z-40 flex text-[#cccccc]">
                    <div className="w-16 bg-[#2d2d2d] border-r border-[#3f3f46] flex flex-col items-center py-4 gap-1 overflow-y-auto no-scrollbar">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => { setActiveCat(cat.id); setSearch(''); }}
                                className={cn(
                                    "p-2 rounded-lg transition-all flex flex-col items-center gap-1 w-14 group",
                                    activeCat === cat.id ? "bg-[#37373d] text-white border border-[#3e3e42] shadow-sm" : "text-[#999999] hover:text-white hover:bg-[#333333]"
                                )}
                            >
                                <cat.icon size={18} strokeWidth={activeCat === cat.id ? 2 : 1.5} />
                                <span className="text-[9px] font-semibold leading-tight text-center">{cat.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex-1 flex flex-col min-w-0 bg-[#252526]">
                        <div className="px-4 py-3 border-b border-[#3f3f46] bg-[#2d2d2d]">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-2.5 text-[#999999]" />
                                <input
                                    type="text" placeholder="Search..."
                                    className="w-full pl-9 pr-3 py-2 bg-[#3c3c3c] border border-transparent rounded text-xs text-white placeholder-[#999999] outline-none focus:ring-1 focus:ring-[#007acc]"
                                    value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {activeCat !== 'templates' && filteredComponents.length > 0 && (
                                <div className="grid grid-cols-2 gap-3 mb-6">
                                    {filteredComponents.map(([type, config]) => (
                                        <div
                                            key={type}
                                            draggable
                                            onDragStart={(e) => {
                                                e.dataTransfer.setData('text/plain', type);
                                                e.dataTransfer.effectAllowed = 'copy';
                                                setDragData({ type: 'NEW', payload: type });
                                                addRecentComponent(type);
                                            }}
                                            className="group flex flex-col items-center justify-center p-3 bg-[#2d2d2d] border border-[#3e3e42] rounded-lg cursor-grab hover:border-[#007acc] hover:bg-[#323236] text-center shadow-sm"
                                        >
                                            <div className="w-9 h-9 flex items-center justify-center bg-[#38383e] border border-[#45454a] rounded mb-2 text-[#cccccc] group-hover:text-white">
                                                {config.icon && <config.icon size={18} strokeWidth={1.5} />}
                                            </div>
                                            <span className="text-[11px] font-medium text-[#bbbbbb] group-hover:text-white">{config.label}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {activeCat === 'templates' && (
                                <div className="flex flex-col gap-6">
                                    {sortedCategories.map(cat => (
                                        <div key={cat} className="animate-in slide-in-from-left-2 duration-300">
                                            <h3 className="text-[11px] font-bold text-[#666] uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
                                                <span className="w-1 h-1 rounded-full bg-[#007acc]" />
                                                {cat}
                                            </h3>
                                            <div className="flex flex-col gap-2">
                                                {templateGroups[cat].map((tpl) => (
                                                    <div key={tpl.key} className="group/item relative">
                                                        <div
                                                            draggable
                                                            onDragStart={(e) => {
                                                                e.dataTransfer.setData('text/plain', tpl.key);
                                                                e.dataTransfer.effectAllowed = 'copy';
                                                                setDragData({ type: 'TEMPLATE', payload: tpl.key });
                                                            }}
                                                            className="flex items-center gap-3 p-3 bg-[#2d2d2d] border border-[#3e3e42] rounded-lg cursor-grab hover:border-[#007acc] hover:bg-[#323236] transition-all"
                                                        >
                                                            <div className="w-10 h-10 rounded bg-[#38383e] flex items-center justify-center text-[#cccccc]">
                                                                {tpl.icon && <tpl.icon size={18} />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-semibold text-[#cccccc]">{tpl.name}</div>
                                                            </div>
                                                            <ChevronRight size={16} className="text-[#666] opacity-0 group-hover/item:opacity-100" />
                                                        </div>
                                                        <div className="absolute left-[105%] top-0 w-[240px] bg-[#252526] border border-[#3f3f46] rounded-xl shadow-2xl p-3 z-50 opacity-0 group-hover/item:opacity-100 pointer-events-none transition-opacity duration-200">
                                                            <div className="w-full aspect-video bg-[#1e1e1e] rounded-md mb-2 flex items-center justify-center text-[#444] border border-[#333]">
                                                                {tpl.icon && <tpl.icon size={48} strokeWidth={1} />}
                                                            </div>
                                                            <div className="text-xs font-bold text-white mb-1">{tpl.name}</div>
                                                            <div className="text-[10px] text-[#888] leading-tight">Drag to add pre-configured {tpl.name.toLowerCase()}.</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-3 border-t border-[#3f3f46] bg-[#222222]">
                            <label className="flex items-center justify-center gap-2 text-xs text-[#007acc] cursor-pointer hover:bg-[#007acc]/10 rounded py-2 border border-dashed border-[#007acc]/30">
                                <Upload size={14} /> <span>Import Component</span>
                                <input ref={fileInputRef} type="file" accept=".tsx,.jsx,.js" className="hidden" onChange={handleFileUpload} />
                            </label>
                        </div>
                    </div>
                </div>
            )}

            {activePanel === 'files' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Folder size={14} className="text-blue-400" /> File Explorer
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 custom-scrollbar font-mono">
                        {status !== 'ready' ? (
                            <div className="p-8 text-center text-[#666] flex flex-col items-center gap-3">
                                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs">Booting File System...</span>
                            </div>
                        ) : Object.entries(fileTree).length === 0 ? (
                            <div className="text-center text-[#666] text-xs mt-10">Initializing VFS...</div>
                        ) : (
                            Object.entries(fileTree).map(([name, node]) => (
                                <FileTreeNode key={name} name={name} node={node} />
                            ))
                        )}
                    </div>
                </div>
            )}

            {activePanel === 'npm' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Box size={14} className="text-orange-400" /> NPM Packages
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="p-4 flex flex-col gap-4">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={pkgName}
                                onChange={(e) => setPkgName(e.target.value)}
                                placeholder="package-name"
                                className="flex-1 bg-[#333] border border-[#444] rounded px-3 py-2 text-xs text-white outline-none focus:border-[#007acc]"
                            />
                            <button
                                onClick={handleInstall}
                                disabled={isInstalling || !pkgName}
                                className="bg-[#007acc] hover:bg-[#0063a5] disabled:opacity-50 text-white px-3 py-2 rounded text-xs font-bold transition-colors flex items-center gap-2"
                            >
                                {isInstalling ? <Loader2 size={14} className="animate-spin" /> : <DownloadCloud size={14} />}
                                Install
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#1e1e1e] font-mono text-[10px] text-[#888]">
                        <div className="mb-2 text-[#aaa]">Terminal Output:</div>
                        {terminalOutput.map((line, i) => (
                            <div key={i} className="whitespace-pre-wrap mb-1">{line}</div>
                        ))}
                    </div>
                </div>
            )}

            {activePanel === 'pages' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <File size={14} className="text-purple-400" /> Pages
                        </h2>
                        <button onClick={() => addPage('New Page')} className="p-1 hover:bg-[#333] rounded text-[#007acc]"><Plus size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 custom-scrollbar">
                        {pages.map((page) => (
                            <div
                                key={page.id}
                                onClick={() => switchPage(page.id)}
                                className={cn(
                                    "group flex items-center justify-between p-2 rounded cursor-pointer transition-colors",
                                    realPageId === page.id ? "bg-[#37373d] text-white" : "text-[#999] hover:bg-[#2a2d2e] hover:text-[#ccc]"
                                )}
                            >
                                <div className="flex items-center gap-2">
                                    <File size={12} className={realPageId === page.id ? "text-[#007acc]" : "text-[#666]"} />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-medium">{page.name}</span>
                                        <span className="text-[9px] opacity-50 font-mono">{page.slug}</span>
                                    </div>
                                </div>
                                {pages.length > 1 && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deletePage(page.id); }}
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activePanel === 'icons' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[420px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between bg-[#2d2d2d]">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Hexagon size={14} className="text-cyan-400" /> Icons
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="p-3 border-b border-[#3f3f46]">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-2.5 text-[#999]" />
                            <input
                                value={iconSearch}
                                onChange={(e) => setIconSearch(e.target.value)}
                                placeholder="Search icons (e.g. User, Settings)..."
                                className="w-full bg-[#333] border border-[#444] rounded pl-8 pr-2 py-2 text-xs text-white outline-none focus:border-[#007acc]"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <div className="grid grid-cols-4 gap-2">
                            {filteredIcons.slice(0, 100).map((name) => {
                                const IconComp = getIconComponent(name);
                                return (
                                    <div
                                        key={name}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('text/plain', 'icon');
                                            setDragData({ type: 'ICON', payload: 'icon', meta: { iconName: name } });
                                        }}
                                        className="flex flex-col items-center justify-center aspect-square bg-[#2d2d2d] border border-[#3e3e42] rounded hover:border-[#007acc] hover:bg-[#323236] cursor-grab transition-all group"
                                        title={name}
                                    >
                                        <IconComp size={20} className="text-[#aaa] group-hover:text-white" />
                                        <span className="text-[8px] text-[#666] mt-1 truncate w-full text-center px-1">{name}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {activePanel === 'assets' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <ImageIcon size={14} className="text-green-400" /> Assets
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="p-3 bg-[#2d2d2d] border-b border-[#3f3f46]">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-2.5 text-[#999]" />
                            <input
                                value={assetSearch}
                                onChange={(e) => setAssetSearch(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && searchUnsplash(assetSearch)}
                                placeholder="Search images..."
                                className="w-full bg-[#333] border border-[#444] rounded pl-8 pr-2 py-2 text-xs text-white outline-none focus:border-[#007acc]"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                        {loadingAssets ? (
                            <div className="text-center p-4 text-[#666] text-xs flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={14} /> Fetching...</div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {unsplashImages.map((img) => (
                                    <div
                                        key={img.id}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('text/plain', img.url);
                                            e.dataTransfer.effectAllowed = 'copy';
                                            setDragData({ type: 'ASSET_IMAGE', payload: img.url });
                                        }}
                                        className="aspect-square bg-[#111] rounded overflow-hidden cursor-grab hover:ring-2 hover:ring-[#007acc] relative group"
                                    >
                                        <img src={img.url} alt="asset" className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activePanel === 'theme' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Palette size={14} className="text-cyan-400" /> Global Theme
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="p-4 flex flex-col gap-6 overflow-y-auto">
                        {selectedId && elements[selectedId] && (
                            <div className="p-3 bg-[#333] border border-[#444] rounded flex items-center justify-between">
                                <span className="text-[10px] text-[#999]">Apply to Selected:</span>
                                <button
                                    onClick={() => {
                                        const el = elements[selectedId];
                                        const cls = el.props?.className || '';
                                        const newCls = cls.includes('bg-primary')
                                            ? cls.replace('bg-primary', '').replace('text-white', '').trim()
                                            : `${cls} bg-primary text-white`.trim();
                                        setElements(prev => ({
                                            ...prev,
                                            [selectedId]: { ...prev[selectedId], props: { ...prev[selectedId].props, className: newCls } }
                                        }));
                                    }}
                                    className="text-[10px] bg-[#007acc] text-white px-2 py-1 rounded hover:bg-[#0063a5] flex items-center gap-1"
                                >
                                    <Wand2 size={10} /> bg-primary
                                </button>
                            </div>
                        )}
                        <div className="space-y-3">
                            <ColorField label="Primary" value={theme.primary} onChange={(v) => updateTheme({ primary: v })} />
                            <ColorField label="Secondary" value={theme.secondary} onChange={(v) => updateTheme({ secondary: v })} />
                            <ColorField label="Accent" value={theme.accent} onChange={(v) => updateTheme({ accent: v })} />
                        </div>
                    </div>
                </div>
            )}

            {activePanel === 'data' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <Database size={14} className="text-emerald-400" /> Data Sources
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white"><X size={16} /></button>
                    </div>

                    <div className="p-3 bg-[#2d2d2d] border-b border-[#3f3f46]">
                        <div className="flex gap-2">
                            <input
                                value={newApiUrl}
                                onChange={(e) => setNewApiUrl(e.target.value)}
                                placeholder="https://api.example.com/data"
                                className="flex-1 bg-[#333] border border-[#444] rounded px-2 py-1 text-xs text-white outline-none focus:border-[#007acc]"
                            />
                            <button
                                onClick={async () => {
                                    if (!newApiUrl) return;
                                    setIsFetchingApi(true);
                                    try {
                                        const res = await fetch(newApiUrl);
                                        const d = await res.json();
                                        const sample = Array.isArray(d) ? d[0] : d;
                                        addDataSource({
                                            id: `ds-${Date.now()}`,
                                            name: newApiUrl.split('/').pop() || 'API',
                                            url: newApiUrl,
                                            method: 'GET',
                                            data: sample
                                        });
                                        setNewApiUrl('');
                                    } catch (e) {
                                        alert("CORS or Network Error: Connection to external API failed.");
                                    } finally {
                                        setIsFetchingApi(false);
                                    }
                                }}
                                disabled={isFetchingApi || !newApiUrl}
                                className="bg-[#333] hover:bg-[#444] text-white p-1.5 rounded border border-[#444]"
                            >
                                {isFetchingApi ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {dataSources.map(ds => (
                            <div key={ds.id} className="mb-4 bg-[#2d2d2d] rounded border border-[#3f3f46] overflow-hidden">
                                <div className="p-2 bg-[#333] flex items-center justify-between border-b border-[#3f3f46]">
                                    <div className="flex items-center gap-2 text-xs font-bold text-[#ccc]">
                                        <Globe size={12} className="text-[#007acc]" />
                                        {ds.name}
                                    </div>
                                    <button onClick={() => removeDataSource(ds.id)} className="text-[#666] hover:text-red-400"><Trash2 size={10} /></button>
                                </div>
                                <div className="p-2">
                                    <div className="text-[9px] text-[#666] mb-2 uppercase font-bold flex items-center gap-1">
                                        <Braces size={9} /> Response Schema
                                    </div>
                                    <JsonTree data={ds.data} setDragData={setDragData} />
                                </div>
                            </div>
                        ))}
                        {dataSources.length === 0 && (
                            <div className="text-center text-[#666] text-xs mt-4 px-4 leading-relaxed">
                                Connect external REST APIs to bind live data to your components.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activePanel === 'marketplace' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[420px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <div className="p-4 border-b border-[#3f3f46] flex items-center justify-between bg-[#2d2d2d]">
                        <h2 className="font-bold text-[#cccccc] text-xs uppercase tracking-wide flex items-center gap-2">
                            <ShoppingBagIcon size={14} className="text-purple-400" /> Component Marketplace
                        </h2>
                        <button onClick={() => setActivePanel(null)} className="text-[#999] hover:text-white transition-colors"><X size={16} /></button>
                    </div>

                    <div className="p-4 flex-1 overflow-y-auto custom-scrollbar bg-[#1e1e1e]/30">
                        <div className="mb-6 text-[11px] text-[#888] bg-[#2d2d2d] p-3 rounded-lg border border-[#333] leading-relaxed">
                            <span className="text-purple-400 font-bold">Pro Tip:</span> Drag these high-end sections onto your canvas. They are fully responsive and pre-optimized.
                        </div>

                        <div className="grid grid-cols-1 gap-5">
                            {MARKETPLACE_ITEMS.map(item => (
                                <div
                                    key={item.id}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('text/plain', item.templateKey);
                                        e.dataTransfer.effectAllowed = 'copy';
                                        setDragData({ type: 'TEMPLATE', payload: item.templateKey });
                                    }}
                                    className="group bg-[#2a2a2d] border border-[#3e3e42] rounded-xl overflow-hidden cursor-grab hover:border-[#3b82f6] hover:shadow-lg transition-all"
                                >
                                    <div className="h-40 bg-[#111] relative overflow-hidden">
                                        <img src={item.image} alt={item.title} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" />
                                        <div className="absolute top-3 right-3 bg-black/80 text-white text-[10px] px-2 py-1 rounded-md backdrop-blur-md border border-white/10 font-bold tracking-wide">
                                            {item.category}
                                        </div>
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                    <div className="p-4 bg-[#2a2a2d]">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-xs font-bold text-white group-hover:text-[#3b82f6] transition-colors">{item.title}</div>
                                            <div className="text-[9px] text-[#3b82f6] bg-[#3b82f6]/10 px-2 py-0.5 rounded font-bold">SMART</div>
                                        </div>
                                        <div className="flex items-center gap-2 text-[9px] text-[#666]">
                                            <span className="flex items-center gap-1"><Wand2 size={10} /> Auto-Style</span>
                                            <span className="w-1 h-1 rounded-full bg-[#444]" />
                                            <span className="flex items-center gap-1"><Layout size={10} /> Full Layout</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activePanel === 'layers' && (
                <div className="absolute left-[60px] top-0 bottom-0 w-[300px] bg-[#252526] border-r border-[#3f3f46] shadow-xl z-40 flex flex-col">
                    <Suspense fallback={<div className="p-8 text-center"><Loader2 className="animate-spin mx-auto mb-2 text-[#007acc]" /> Loading Layers...</div>}>
                        <LayersPanel />
                    </Suspense>
                </div>
            )}

            {/* Insert Drawer (Overlay) */}
            <InsertDrawer />
        </div>
    );
};

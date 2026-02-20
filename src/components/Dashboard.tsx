import { useState } from 'react';
import { useEditor } from '../context/EditorContext';
import {
    Plus, Layout, ArrowRight, Github, Code2, Cpu,
    Search, ArrowLeft,
    Plus as PlusIcon, Sparkles
} from 'lucide-react';

export const Dashboard = () => {
    const { createNewProject } = useEditor();
    const [view, setView] = useState<'home' | 'templates'>('home');
    const [searchQuery, setSearchQuery] = useState('');

    const templates = [
        {
            id: 'vite-react',
            name: 'React + Vite',
            description: 'Lightning fast React development with Tailwind CSS pre-configured.',
            icon: <Code2 size={24} className="text-blue-400" />,
            color: 'from-blue-500/20 to-cyan-500/20',
            border: 'hover:border-blue-500/50'
        },
        {
            id: 'nextjs',
            name: 'Next.js (Coming Soon)',
            description: 'The React Framework for production. Full-stack power.',
            icon: <Cpu size={24} className="text-white" />,
            color: 'from-neutral-500/20 to-stone-500/20',
            border: 'hover:border-white/50',
            disabled: true
        }
    ];

    // --- VIEW 1: PROJECT LIST (HOME) ---
    if (view === 'home') {
        return (
            <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-blue-500/30 flex flex-col">
                {/* Header */}
                <header className="border-b border-white/5 px-8 py-4 flex items-center justify-between bg-[#09090b]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
                            <Layout size={18} className="text-white" />
                        </div>
                        <span className="font-bold text-lg tracking-tight">Vectra</span>
                        <span className="px-2 py-0.5 bg-purple-600/20 text-purple-400 text-[10px] font-bold rounded-full">
                            BETA
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <a href="https://github.com" target="_blank" rel="noreferrer" className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-400 hover:text-white">
                            <Github size={20} />
                        </a>
                    </div>
                </header>

                <main className="flex-1 max-w-6xl mx-auto w-full p-8">
                    {/* Top Bar */}
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h1 className="text-2xl font-bold">Your Projects</h1>
                            <p className="text-zinc-500 text-sm mt-1">
                                Projects are saved locally in your browser.
                            </p>
                        </div>

                        {/* THE TRIGGER BUTTON */}
                        <button
                            onClick={() => setView('templates')}
                            className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-bold rounded-lg hover:bg-zinc-200 transition-all"
                        >
                            <Plus size={16} /> New Project
                        </button>
                    </div>

                    {/* Search & Filters */}
                    <div className="flex gap-4 mb-8">
                        <div className="relative flex-1 max-w-md">
                            <Search size={16} className="absolute left-3 top-3 text-zinc-500" />
                            <input
                                type="text"
                                placeholder="Search projects..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-[#18181b] border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                            />
                        </div>
                    </div>

                    {/* Projects Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Sample Local Project */}
                        <div className="group p-5 rounded-xl border border-white/5 bg-[#121214] hover:border-white/10 transition-all cursor-pointer">
                            <div className="flex items-start justify-between mb-4">
                                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center border border-white/5">
                                    <Code2 size={20} className="text-blue-400" />
                                </div>
                                <span className="text-[10px] text-zinc-500 font-mono">Local</span>
                            </div>
                            <h3 className="font-bold text-zinc-200 mb-1">Sample Project</h3>
                            <p className="text-xs text-zinc-500 mb-4">Last edited recently</p>
                            <div className="flex items-center gap-2 text-[10px] text-zinc-600 bg-black/20 p-2 rounded border border-white/5">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                <span>Ready to Edit</span>
                            </div>
                        </div>

                        {/* Create New Card (Shortcut) */}
                        <button
                            onClick={() => setView('templates')}
                            className="group flex flex-col items-center justify-center gap-3 p-5 rounded-xl border border-dashed border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-zinc-500 hover:text-zinc-300"
                        >
                            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                                <PlusIcon size={24} />
                            </div>
                            <span className="text-sm font-medium">Create New Project</span>
                        </button>
                    </div>

                    {/* AI Banner */}
                    <div className="mt-12 p-6 rounded-2xl bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/20">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                                <Sparkles size={24} className="text-white" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-lg mb-1">AI-Powered Design</h3>
                                <p className="text-zinc-400 text-sm">
                                    Get design suggestions, generate CSS, and improve accessibility with AI.
                                </p>
                            </div>
                        </div>
                    </div>
                </main>

                {/* Footer */}
                <footer className="border-t border-white/5 px-8 py-4 text-center text-zinc-600 text-xs">
                    Vectra v1.0 — Local Edition
                </footer>
            </div>
        );
    }

    // --- VIEW 2: TEMPLATE SELECTION (NEW PROJECT FLOW) ---
    return (
        <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-4 font-sans animate-in fade-in slide-in-from-bottom-4 duration-300">

            <div className="w-full max-w-4xl">
                {/* Back Navigation */}
                <button
                    onClick={() => setView('home')}
                    className="flex items-center gap-2 text-zinc-500 hover:text-white mb-8 transition-colors text-sm font-medium"
                >
                    <ArrowLeft size={16} /> Back to Dashboard
                </button>

                <div className="mb-8">
                    <h1 className="text-3xl font-bold mb-2">Select a Framework</h1>
                    <p className="text-zinc-400">Choose the technology stack for your new project.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {templates.map((t) => (
                        <button
                            key={t.id}
                            disabled={t.disabled}
                            onClick={() => createNewProject(t.id)}
                            className={`
                                group relative p-6 rounded-2xl border border-white/5 bg-[#121214] text-left transition-all duration-300
                                ${t.disabled ? 'opacity-50 cursor-not-allowed' : `hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-900/10 cursor-pointer ${t.border}`}
                            `}
                        >
                            <div className={`absolute inset-0 bg-gradient-to-br ${t.color} opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl`} />

                            <div className="relative z-10 flex gap-4">
                                <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center border border-white/5 shrink-0">
                                    {t.icon}
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                                        {t.name}
                                    </h3>
                                    <p className="text-zinc-400 text-sm leading-relaxed">
                                        {t.description}
                                    </p>
                                </div>
                                {!t.disabled && (
                                    <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all text-blue-400">
                                        <ArrowRight size={20} />
                                    </div>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

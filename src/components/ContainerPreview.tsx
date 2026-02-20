import { useState } from 'react';
import { useContainer } from '../context/ContainerContext';
import { useEditor } from '../context/EditorContext';
import {
    Maximize2, Minimize2, ExternalLink,
    RefreshCw, X, Loader2, Terminal
} from 'lucide-react';
import { cn } from '../lib/utils';

export const ContainerPreview = () => {
    const { url, status, terminalOutput } = useContainer();
    const { previewMode, setPreviewMode, device } = useEditor();
    const [iframeKey, setIframeKey] = useState(0);

    // Helper to reload the internal iframe without reloading the app
    const refreshPreview = () => setIframeKey(p => p + 1);

    // --- 1. PREVIEW NOT READY STATE ---
    if (status !== 'ready' && !url) {
        // If minimized, show nothing or a small loader
        if (!previewMode) return (
            <div className="absolute bottom-4 right-4 px-4 py-2 bg-zinc-900 border border-white/10 rounded-full flex items-center gap-2 text-xs text-zinc-400 shadow-xl">
                <Loader2 size={12} className="animate-spin text-blue-500" />
                <span>Starting Dev Server...</span>
            </div>
        );

        // If fullscreen (forced), show terminal logs
        return (
            <div className="fixed inset-0 z-[100] bg-[#09090b] flex flex-col font-mono">
                <div className="h-12 border-b border-white/10 flex items-center justify-between px-4 bg-zinc-900/50">
                    <span className="text-zinc-400 text-xs flex items-center gap-2">
                        <Terminal size={14} /> Booting WebContainer...
                    </span>
                    <button onClick={() => setPreviewMode(false)} className="p-2 hover:bg-white/10 rounded-full text-zinc-400 hover:text-white">
                        <X size={16} />
                    </button>
                </div>
                <div className="flex-1 p-4 overflow-y-auto text-xs text-zinc-500 space-y-1">
                    {terminalOutput.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap font-mono">{line}</div>
                    ))}
                    <div className="animate-pulse text-blue-500">_</div>
                </div>
            </div>
        );
    }

    // --- 2. ACTIVE PREVIEW STATE ---

    // Calculate CSS based on mode
    const containerClasses = previewMode
        ? "fixed inset-0 z-[200] bg-white flex flex-col animate-in fade-in zoom-in-95 duration-200" // Full Screen
        : "absolute bottom-6 right-6 w-[400px] h-[280px] bg-[#09090b] rounded-xl shadow-2xl border border-white/10 flex flex-col overflow-hidden transition-all duration-300 hover:shadow-blue-900/20 hover:border-blue-500/30"; // Mini

    return (
        <div className={containerClasses}>
            {/* TOOLBAR */}
            <div className={`
                flex items-center justify-between px-3 py-2 border-b 
                ${previewMode ? 'bg-zinc-900 border-white/10 h-14' : 'bg-zinc-900/80 backdrop-blur border-white/5 h-10 cursor-move'}
            `}>
                {/* Left: Status & URL */}
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                    <span className="text-xs text-zinc-400 truncate max-w-[200px] font-mono opacity-70">
                        {previewMode ? url : 'Live Preview'}
                    </span>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={refreshPreview}
                        className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                        title="Reload Preview"
                    >
                        <RefreshCw size={14} />
                    </button>

                    <a
                        href={url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                        title="Open in New Tab"
                    >
                        <ExternalLink size={14} />
                    </a>

                    <div className="w-px h-3 bg-white/10 mx-1" />

                    <button
                        onClick={() => setPreviewMode(!previewMode)}
                        className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                        title={previewMode ? "Minimize" : "Maximize"}
                    >
                        {previewMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>

                    {previewMode && (
                        <button
                            onClick={() => setPreviewMode(false)}
                            className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors ml-1"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* IFRAME */}
            <div className={`flex-1 relative ${previewMode ? 'bg-[#18181b] overflow-hidden' : 'bg-white'}`}>
                <div className={cn(
                    "h-full mx-auto bg-white transition-all duration-300 relative shadow-2xl",
                    !previewMode ? "w-full" :
                        device === 'mobile' ? "w-[375px]" :
                            device === 'tablet' ? "w-[768px]" : "w-full"
                )}>
                    <iframe
                        key={iframeKey}
                        src={url || ''}
                        className="absolute inset-0 w-full h-full border-0"
                        title="Vectra Preview"
                        referrerPolicy="no-referrer"
                        // Minimal permissions — camera/mic/geolocation/clipboard NOT granted
                        allow="accelerometer; encrypted-media; midi"
                        // WebContainer sandbox requirements:
                        // allow-scripts      → React/Vite JS must run
                        // allow-same-origin  → Service Workers for HMR (WebContainer core requirement)
                        // allow-forms        → Internal form handling
                        // allow-popups       → pnpm uses browser redirects during registry.npmjs.org fetches
                        // allow-modals       → pnpm error dialogs during install
                        // NOTE: allow-top-navigation and allow-presentation are intentionally excluded
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                    />


                </div>
            </div>
        </div>
    );
};

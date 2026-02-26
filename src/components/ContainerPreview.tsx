import { useEffect, useRef, useState, useCallback } from 'react';
import { useProject } from '../context/ProjectContext';
import { useUI } from '../context/UIContext';

import { cn } from '../lib/utils';
import {
  Maximize2, Minimize2, RefreshCw, X,
  Loader2, Zap, Monitor, Tablet, Smartphone,
} from 'lucide-react';
import { SHELL_HTML } from './shellHtml';

// ─── TYPES ────────────────────────────────────────────────────────────────────

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

// ─── PLACEHOLDER DOC ─────────────────────────────────────────────────────────────

const PLACEHOLDER_DOC = `<!DOCTYPE html>
  <html class="dark">
    <head>
      <script src="/tailwind.js"></script>
      <script>tailwind.config={darkMode:'class'}</script>
      <style>body{margin:0;background:#000;}</style>
    </head>
    <body class="min-h-screen bg-black flex flex-col items-center justify-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
        <svg width="20" height="20" fill="none" stroke="#6366f1" stroke-width="2" viewBox="0 0 24 24">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
      </div>
      <p class="text-zinc-600 text-sm font-mono">Generate a component to see the instant preview</p>
    </body>
  </html>`;

// ─── DEVICE WIDTH MAP ─────────────────────────────────────────────────────────

const DEVICE_WIDTHS: Record<DeviceMode, string> = {
  desktop: 'w-full',
  tablet: 'max-w-[768px]',
  mobile: 'max-w-[375px]',
};

// ─── IMPORT STRIP HELPER ──────────────────────────────────────────────────────
// Same logic as compiler.worker.ts — keeps the iframe and the canvas in sync.

const stripAndFixCode = (code: string): string =>
  code
    // Named/typed imports
    .replace(/^[ \t]*import\s+type?\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
    // Default / namespace imports (single line)
    .replace(/^[ \t]*import\s+[^\n{]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    // Side-effect imports
    .replace(/^[ \t]*import\s+['"][^'"]+['"];?\s*$/gm, '')
    // Icon JSX auto-fix
    .replace(/<Icon\s*(?:=|name=)["']([^"']+)["']/g, '<Lucide.$1')
    .replace(/<Lucide\[([^\]]+)\]/g, '<DynamicIcon name={$1}')
    .replace(/<\/Lucide\[[^\]]*\]>/g, '</DynamicIcon>')
    .replace(/<Icon\s*(?:=|name=|icon=)\{([^}]+)\}/g, '<DynamicIcon name={$1}')
    .replace(/<\/Icon>/g, '')
    .trim();

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export const ContainerPreview = () => {
  const { elements, compileComponent } = useProject();
  const { previewMode, setPreviewMode, device, setDevice } = useUI();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);

  // ── Listen for SHELL_READY signal from the iframe ─────────────────────────
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (ev.data?.type === 'SHELL_READY') setIframeReady(true);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Boot: set the shell HTML once ─────────────────────────────────────────
  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = SHELL_HTML;
    }
  }, []);

  // ── Hot-reload: Compile (Rust SWC) → Send to shell ───────────────────────
  // Phase 6: Compilation happens HERE (host side, ~5ms via Rust) instead of
  // THERE (iframe Babel, 100–300ms). The shell just executes the received JS.
  const buildAndInject = useCallback(async () => {
    const customEls = Object.values(elements).filter(
      el => (el.type === 'custom_code' || el.type === 'custom_component')
        && typeof el.code === 'string' && (el.code as string).trim().length > 0
    );

    if (customEls.length === 0) {
      // No AI component yet — show the muted placeholder or clear the shell
      if (iframeRef.current?.contentWindow && iframeReady) {
        iframeRef.current.contentWindow.postMessage({ type: 'UPDATE_CODE', code: '' }, '*');
      } else if (iframeRef.current && !iframeReady) {
        iframeRef.current.srcdoc = PLACEHOLDER_DOC;
      }
      return;
    }

    setIsCompiling(true);
    try {
      // 1. Strip imports + fix icon aliases (same pass used by the old sandbox)
      //    then compile TSX → CJS JS via Rust SWC in parallel
      const compiledParts = await Promise.all(
        customEls.map(el => compileComponent(stripAndFixCode(el.code as string)))
      );
      const combinedCode = compiledParts.join('\n\n');

      // 2. Send pre-compiled JS to the shell — it executes via new Function()
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: 'UPDATE_CODE', code: combinedCode }, '*'
        );
      }
    } catch (e) {
      console.error('[ContainerPreview] Build error:', e);
    } finally {
      setTimeout(() => setIsCompiling(false), 300);
    }
  }, [elements, iframeReady, compileComponent]);

  // Fire hot-reload whenever elements change OR after the iframe signals ready
  useEffect(() => {
    if (iframeReady) buildAndInject();
  }, [buildAndInject, iframeReady]);

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const DeviceButton = ({
    mode, icon: Icon,
  }: { mode: DeviceMode; icon: React.ElementType }) => (
    <button
      onClick={() => setDevice(mode)}
      title={mode}
      className={cn(
        'p-1.5 rounded-md transition-colors text-zinc-500 hover:text-white hover:bg-white/10',
        device === mode && 'text-blue-400 bg-blue-500/10'
      )}
    >
      <Icon size={13} />
    </button>
  );

  // ── Layout classes ────────────────────────────────────────────────────────
  const outerClasses = previewMode
    ? 'fixed inset-0 z-[200] bg-[#09090b] flex flex-col'
    : 'absolute bottom-6 right-6 w-[400px] h-[280px] bg-[#09090b] rounded-xl shadow-2xl border border-white/10 flex flex-col overflow-hidden transition-all duration-300 hover:shadow-blue-900/20 hover:border-blue-500/20';

  const toolbarClasses = previewMode
    ? 'h-12 border-b border-white/10 bg-zinc-900/80 backdrop-blur'
    : 'h-9 border-b border-white/5 bg-zinc-900/60 backdrop-blur';

  return (
    <div className={outerClasses}>

      {/* ── TOOLBAR ──────────────────────────────────────────────────── */}
      <div className={cn('flex items-center justify-between px-3 shrink-0', toolbarClasses)}>

        {/* Left: traffic lights + URL bar */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex gap-1.5 mr-1">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/30   border border-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/30 border border-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/30  border border-green-500/60" />
          </div>

          {/* Fake address bar */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 min-w-0">
            <Zap size={10} className="text-blue-400 shrink-0" />
            <span className="text-[11px] text-zinc-500 font-mono truncate">
              instant-preview.vectra
            </span>
            {isCompiling && (
              <Loader2 size={10} className="text-blue-400 animate-spin shrink-0" />
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-0.5">
          {/* Device toggle buttons — only shown in fullscreen */}
          {previewMode && (
            <>
              <DeviceButton mode="desktop" icon={Monitor} />
              <DeviceButton mode="tablet" icon={Tablet} />
              <DeviceButton mode="mobile" icon={Smartphone} />
              <div className="w-px h-3 bg-white/10 mx-1" />
            </>
          )}

          {/* Manual refresh — re-sends latest code */}
          <button
            onClick={() => buildAndInject()}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            title="Refresh Preview"
          >
            <RefreshCw size={13} />
          </button>

          {/* Maximize / Minimize */}
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            title={previewMode ? 'Minimize' : 'Expand'}
          >
            {previewMode ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          {/* Close (fullscreen only) */}
          {previewMode && (
            <button
              onClick={() => setPreviewMode(false)}
              className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors ml-0.5"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── IFRAME AREA ──────────────────────────────────────────────── */}
      <div className={cn(
        'flex-1 relative overflow-hidden',
        previewMode ? 'bg-[#18181b]' : 'bg-[#09090b]'
      )}>
        {/* Device-width wrapper (only meaningful in fullscreen) */}
        <div className={cn(
          'h-full mx-auto transition-all duration-300',
          previewMode ? DEVICE_WIDTHS[device as DeviceMode] : 'w-full'
        )}>
          <iframe
            ref={iframeRef}
            className="w-full h-full border-0"
            title="Instant Preview"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
};

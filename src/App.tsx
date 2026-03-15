import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { EditorProvider, useEditor } from './context/EditorContext';
import { ProjectProvider, useProject } from './context/ProjectContext';
import { UIProvider, useUI } from './context/UIContext';
import { HoverProvider } from './context/HoverContext';
import { ContainerProvider, useContainer } from './context/ContainerContext';

import { useFileSync } from './hooks/useFileSync';
import { useAssetSync } from './hooks/useAssetSync';
import { Dashboard } from './components/Dashboard';

// 1. LAZY LOAD CHUNKS
const Header = lazy(() => import('./components/Header').then(module => ({ default: module.Header })));
const LeftSidebar = lazy(() => import('./components/LeftSidebar').then(module => ({ default: module.LeftSidebar })));
const RightSidebar = lazy(() => import('./components/RightSidebar').then(module => ({ default: module.RightSidebar })));
const Canvas = lazy(() => import('./components/Canvas').then(module => ({ default: module.Canvas })));
const ImportModal = lazy(() => import('./components/ImportModal').then(module => ({ default: module.ImportModal })));
const MagicBar = lazy(() => import('./components/MagicBar').then(module => ({ default: module.MagicBar })));
// --- MONOCHROME ANIMATED LOGO ---
const VectraAnimatedLogo = () => (
  <svg width="120" height="120" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="animate-[logo-float_3s_ease-in-out_infinite]">
    <svg x="6" y="6" width="28" height="28" viewBox="0 0 24 24">
      {/* 1. Left Leg (Dashed) */}
      <path
        d="m5 6 7 14"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="3 3"
        className="animate-[dash-flow_1s_linear_infinite]"
      />

      {/* 2. Right Leg (Solid) */}
      <path
        d="m12 20 7-14"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="24"
        strokeDashoffset="24"
        className="animate-[draw-path_2s_ease-out_infinite]"
      />

      {/* 3. Dots */}
      <circle
        cx="5" cy="6" r="1.5" fill="white"
        className="animate-[pop-in_2s_ease-in-out_infinite]"
        style={{ animationDelay: '0s', transformOrigin: 'center' }}
      />
      <circle
        cx="19" cy="6" r="1.5" fill="white"
        className="animate-[pop-in_2s_ease-in-out_infinite]"
        style={{ animationDelay: '0.3s', transformOrigin: 'center' }}
      />

      {/* 4. Center Anchor */}
      <path
        fill="white" d="M10.5 18.5h3v3h-3z"
        className="animate-pulse"
      />
    </svg>
  </svg>
);

// --- MONOCHROME LOADING SCREEN ---
const LoadingScreen = ({ message = "INITIALIZING ENVIRONMENT" }) => (
  <div className="w-full h-screen bg-[#09090b] flex flex-col items-center justify-center gap-8 z-[9999] fixed inset-0">
    {/* Subtle Glow (White/Gray instead of Purple) */}
    <div className="absolute w-[500px] h-[500px] bg-white/5 rounded-full blur-[100px] animate-pulse" />

    {/* Logo */}
    <div className="relative z-10">
      <VectraAnimatedLogo />
    </div>

    {/* Loading Bar & Text */}
    <div className="flex flex-col items-center gap-4 z-10">
      <div className="w-48 h-[2px] bg-[#27272a] rounded-full overflow-hidden">
        <div className="h-full bg-white w-1/3 animate-[shimmer_1s_infinite_linear] rounded-full relative">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-50" />
        </div>
      </div>
      <span className="text-[10px] font-bold text-[#52525b] tracking-[0.2em] uppercase font-mono text-center px-4">
        {message}
      </span>
    </div>
  </div>
);

const EditorLayout = () => {
  const { history, deleteElement, duplicateElement, selectedId, setSelectedId, setActivePanel,
          elementsRef, updateProject, projectName, importPage, parentMap } = useEditor();
  const { selectedIds, clearSelection, addToSelection } = useUI();
  const { status } = useContainer();

  // UX-30 [PERMANENT]: Browser tab title tracks active project name.
  // Resets to 'Vectra' on unmount (user returns to dashboard).
  useEffect(() => {
    document.title = projectName ? `${projectName} — Vectra` : 'Vectra';
    return () => { document.title = 'Vectra'; };
  }, [projectName]);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // UX-3: session clipboard — stores last copied node ID.
  const clipboardRef = useRef<string | null>(null);

  useFileSync();
  useAssetSync();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      const PROTECTED = new Set(['application-root', 'page-home', 'main-frame',
        'main-frame-desktop', 'main-frame-mobile', 'main-canvas']);

      // UX-2 [PERMANENT]: Arrow key nudge — 1px per tap, 10px with Shift.
      // Reads elementsRef.current (H-4 pattern) — no stale closure on elements state.
      // Guard: position === 'absolute' only — flex/grid children have no left/top.
      // skipHistory:true during motion — one undo entry per gesture, not per pixel.
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (isTyping || !selectedId) return;
        const el = elementsRef.current[selectedId];
        if (!el?.props?.style) return;
        const s = el.props.style as Record<string, string>;
        if (s.position !== 'absolute') return;
        e.preventDefault();
        const NUDGE = e.shiftKey ? 10 : 1;
        const left = parseFloat(s.left ?? '0');
        const top  = parseFloat(s.top  ?? '0');
        const newLeft = e.key === 'ArrowLeft'  ? left - NUDGE
                      : e.key === 'ArrowRight' ? left + NUDGE : left;
        const newTop  = e.key === 'ArrowUp'    ? top  - NUDGE
                      : e.key === 'ArrowDown'  ? top  + NUDGE : top;
        updateProject({
          ...elementsRef.current,
          [selectedId]: { ...el, props: { ...el.props, style: { ...s, left: `${newLeft}px`, top: `${newTop}px` } } },
        }, { skipHistory: true });
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isTyping) return;
        // Item 2: multi-delete
        if (selectedIds.size > 1) {
          e.preventDefault();
          selectedIds.forEach(id => { if (!PROTECTED.has(id)) deleteElement(id); });
          clearSelection();
          return;
        }
        // Single-delete (existing logic)
        if (selectedId && !PROTECTED.has(selectedId)) {
          e.preventDefault();
          deleteElement(selectedId);
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); history.redo(); }
      if (e.key === 'Escape') { if (isImportOpen) setIsImportOpen(false); else setSelectedId(null); }
      if (e.key === 'i' && !isTyping && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setActivePanel(prev => prev === 'add' ? null : 'add'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i' && !isTyping) { e.preventDefault(); setIsImportOpen(true); }

      // Item 1: Copy — also writes to window.__vectra_clipboard for context-menu symmetry (UX-1-2)
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !isTyping) {
        if (selectedId && !PROTECTED.has(selectedId)) {
          clipboardRef.current = selectedId;
          (window as any).__vectra_clipboard = selectedId;
        }
      }
      // UX-1-2 [PERMANENT]: Sync context-menu Copy into clipboardRef so Cmd+V works after right-click Copy.
      // Checked on every keydown — cost is a single property read.
      if ((window as any).__vectra_clipboard && (window as any).__vectra_clipboard !== clipboardRef.current) {
        clipboardRef.current = (window as any).__vectra_clipboard;
        (window as any).__vectra_clipboard = null;
      }

      // UX-3 [PERMANENT]: True cross-page paste.
      // Same-page: duplicateElement() (parent lookup succeeds).
      // Cross-page: deepClone subtree with fresh IDs, importPage() for atomic insert.
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !isTyping) {
        const srcId = clipboardRef.current;
        if (!srcId) { /* nothing */ }
        else {
          e.preventDefault();
          const srcEl = elementsRef.current[srcId];
          if (srcEl) {
            // Same-page fast path — parent still exists in current elements
            if (parentMap.get(srcId)) {
              const newId = duplicateElement(srcId);
              if (newId) setSelectedId(newId);
            } else {
              // Cross-page: rebuild full subtree with collision-free IDs
              const src = elementsRef.current;
              const idMap = new Map<string, string>();
              const walk = (id: string) => {
                const node = src[id]; if (!node) return;
                idMap.set(id, `el-${crypto.randomUUID().replace(/-/g,'').slice(0,12)}`);
                (node.children || []).forEach(walk);
              };
              walk(srcId);
              const cloned: Record<string, any> = {};
              idMap.forEach((newId, oldId) => {
                const node = src[oldId]; if (!node) return;
                cloned[newId] = {
                  ...node, id: newId,
                  children: (node.children || []).map((c: string) => idMap.get(c) ?? c),
                  props: { ...node.props, style: { ...node.props?.style, left: '120px', top: '120px' } },
                };
              });
              const newRootId = idMap.get(srcId) ?? srcId;
              importPage({ pageName: `__paste_${newRootId}`, slug: `/__paste_${newRootId}`, nodes: cloned, rootId: newRootId });
              setSelectedId(newRootId);
            }
          }
        }
      }

      // Item 1 + 2: Duplicate (single or multi)
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !isTyping) {
        e.preventDefault();
        if (selectedIds.size > 1) {
          const newIds: string[] = [];
          selectedIds.forEach(id => {
            if (!PROTECTED.has(id)) {
              const newId = duplicateElement(id);
              if (newId) newIds.push(newId);
            }
          });
          if (newIds.length > 0) {
            // Select the last duplicate as anchor
            newIds.forEach(id => addToSelection(id));
          }
        } else if (selectedId && !PROTECTED.has(selectedId)) {
          const newId = duplicateElement(selectedId);
          if (newId) setSelectedId(newId);
        }
      }

      // UX-29 [PERMANENT]: ? key opens keyboard shortcut reference.
      if (e.key === '?' && !isTyping) {
        e.preventDefault();
        setShowShortcuts(p => !p);
      }
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, deleteElement, duplicateElement, selectedId, selectedIds, setSelectedId,
    clearSelection, addToSelection, isImportOpen, elementsRef, updateProject,
    showShortcuts, importPage, parentMap]);

  if (status === 'booting' || status === 'mounting') {
    let message = "Initializing...";
    switch (status) {
      case 'booting': message = "Booting WebContainer Kernel..."; break;
      case 'mounting': message = "Setup your project..."; break;
    }
    return <LoadingScreen message={message} />;
  }

  if (status === 'error') {
    return <LoadingScreen message="CRITICAL STARTUP ERROR. Check logs." />;
  }

  return (
    <div className="h-screen w-full flex flex-col bg-[#1e1e1e] overflow-hidden select-none font-sans">
      <Suspense fallback={<LoadingScreen message="Loading Interface..." />}>
        <MagicBar />
        <Header />
        <div className="flex-1 flex overflow-hidden relative">
          <LeftSidebar />
          <Canvas />
          <RightSidebar />
        </div>
      </Suspense>

      {isImportOpen && (
        <Suspense fallback={null}>
          <ImportModal onClose={() => setIsImportOpen(false)} />
        </Suspense>
      )}

      {/* UX-29 [PERMANENT]: Keyboard shortcut reference modal. Opened with '?' key. */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="bg-[#1e1e1e] border border-[#3f3f46] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2c]">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="text-[#007acc]">⌨</span> Keyboard Shortcuts
              </h2>
              <button onClick={() => setShowShortcuts(false)} className="text-[#555] hover:text-[#ccc] transition-colors text-xs">✕</button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-8">
              {([
                { group: 'Canvas', items: [
                  ['Space + drag', 'Pan canvas'],
                  ['Ctrl/⌘ + scroll', 'Zoom in/out'],
                  ['⌘0 / Ctrl+0', 'Zoom to fit'],
                  ['Arrow keys', 'Nudge 1px'],
                  ['Shift + Arrow', 'Nudge 10px'],
                ]},
                { group: 'Selection', items: [
                  ['Click', 'Select element'],
                  ['Shift + click', 'Multi-select'],
                  ['Escape', 'Deselect'],
                  ['Delete / Backspace', 'Delete selected'],
                  ['Right-click', 'Context menu'],
                ]},
                { group: 'Edit', items: [
                  ['⌘D / Ctrl+D', 'Duplicate'],
                  ['⌘C / Ctrl+C', 'Copy'],
                  ['⌘V / Ctrl+V', 'Paste (cross-page)'],
                  ['⌘Z / Ctrl+Z', 'Undo'],
                  ['⌘⇧Z / Ctrl+Y', 'Redo'],
                  ['Double-click', 'Edit text inline'],
                ]},
                { group: 'View & Tools', items: [
                  ['⌘K / Ctrl+K', 'Open AI magic bar'],
                  ['I', 'Toggle insert drawer'],
                  ['⌘I / Ctrl+I', 'Import component'],
                  ['?', 'This shortcut list'],
                  ['Escape', 'Close panels / dialogs'],
                ]},
              ] as const).map(({ group, items }) => (
                <div key={group}>
                  <div className="text-[10px] font-bold text-[#007acc] uppercase tracking-widest mb-3">{group}</div>
                  <div className="space-y-2">
                    {items.map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between gap-4">
                        <span className="text-[11px] text-[#888]">{desc}</span>
                        <kbd className="text-[10px] font-mono bg-[#2a2a2d] border border-[#3e3e42] text-[#ccc] px-2 py-0.5 rounded shrink-0">{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-[#2a2a2c] text-[10px] text-[#444] text-center">
              Press <kbd className="font-mono bg-[#2a2a2d] border border-[#3e3e42] text-[#777] px-1.5 py-0.5 rounded">?</kbd> to toggle
              · <kbd className="font-mono bg-[#2a2a2d] border border-[#3e3e42] text-[#777] px-1.5 py-0.5 rounded">Esc</kbd> to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- THE MAIN ROUTER ---
const MainRouter = () => {
  // Use UIContext directly — doesn't subscribe to project data changes
  const { currentView } = useUI();
  // Phase E: Read framework from ProjectContext — available because
  // ProjectProvider wraps MainRouter in the App component tree.
  const { framework } = useProject();

  if (currentView === 'dashboard') {
    return <Dashboard />;
  }

  return (
    // framework prop tells ContainerProvider which VFS template to mount.
    // It is set synchronously by createNewProject() before currentView switches.
    <ContainerProvider framework={framework}>
      <EditorLayout />
    </ContainerProvider>
  );
};


const App = () => {
  return (
    <ProjectProvider>
      <UIProvider>
        {/* HoverProvider isolated from UIContext: pointer-move only re-renders */}
        {/* the 2 nodes changing hover state, not all 200 RenderNode instances. */}
        <HoverProvider>
          {/* EditorProvider is now a no-op stub kept for import compatibility */}
          <EditorProvider>
            <MainRouter />
          </EditorProvider>
        </HoverProvider>
      </UIProvider>
    </ProjectProvider>
  );
};


export default App;

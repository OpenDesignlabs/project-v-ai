import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { EditorProvider, useEditor } from './context/EditorContext';
import { ProjectProvider, useProject } from './context/ProjectContext';
import { UIProvider, useUI } from './context/UIContext';
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
  const { history, deleteElement, duplicateElement, selectedId, setSelectedId, setActivePanel } = useEditor();
  const { selectedIds, clearSelection, addToSelection } = useUI();
  const { status } = useContainer();
  const [isImportOpen, setIsImportOpen] = useState(false);
  // Item 1 — session clipboard: stores the last copied node ID.
  // Module-level ref — survives renders, zero context writes.
  const clipboardRef = useRef<string | null>(null);

  useFileSync();
  useAssetSync();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      const PROTECTED = new Set(['application-root', 'page-home', 'main-frame',
        'main-frame-desktop', 'main-frame-mobile', 'main-canvas']);

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

      // Item 1: Copy
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !isTyping) {
        if (selectedId && !PROTECTED.has(selectedId)) {
          clipboardRef.current = selectedId;
        }
      }

      // Item 1: Paste
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !isTyping) {
        if (clipboardRef.current) {
          e.preventDefault();
          const newId = duplicateElement(clipboardRef.current);
          if (newId) setSelectedId(newId);
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

    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, deleteElement, duplicateElement, selectedId, selectedIds, setSelectedId,
    clearSelection, addToSelection, isImportOpen]);

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
        {/* EditorProvider is now a no-op stub kept for import compatibility */}
        <EditorProvider>
          <MainRouter />
        </EditorProvider>
      </UIProvider>
    </ProjectProvider>
  );
};


export default App;

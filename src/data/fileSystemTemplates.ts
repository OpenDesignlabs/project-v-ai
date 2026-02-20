import type { FileSystemTree } from '@webcontainer/api';

// --- 1. UTILS ---
const UTILS_CODE = `
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
`;

// --- 2. MARKETPLACE COMPONENT SOURCE CODE ---

const HERO_GEOMETRIC_CODE = `
import React from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

export default function HeroGeometric({ 
  badge = "KOKONUT UI", 
  title1 = "Elevate Your", 
  title2 = "Digital Vision",
  subtitle,
  style,
  className 
}: any) {
  return (
    <div className={cn("relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#030303]", className)} style={style}>
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/[0.05] via-transparent to-rose-500/[0.05] blur-3xl" />
        <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -left-[10%] top-[-10%] h-[500px] w-[500px] rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 blur-[100px]" />
            <div className="absolute right-[10%] bottom-[10%] h-[400px] w-[400px] rounded-full bg-gradient-to-br from-indigo-500/10 to-purple-500/10 blur-[80px]" />
        </div>
        <div className="relative z-10 container mx-auto px-4 md:px-6 text-center">
             <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.08] mb-8 md:mb-12">
                <span className="text-sm text-white/60 tracking-wide">{badge}</span>
             </div>
            <h1 className="text-4xl sm:text-6xl md:text-8xl font-bold mb-6 tracking-tight">
              <span className="bg-clip-text text-transparent bg-gradient-to-b from-white to-white/80">{title1}</span>
              <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-white/90 to-rose-300">{title2}</span>
            </h1>
            {subtitle && (
              <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto">
                {subtitle}
              </p>
            )}
        </div>
    </div>
  );
}
`;

const FEATURE_HOVER_CODE = `
import React from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import * as Lucide from "lucide-react";

export default function FeatureHover({
  title = "Smart Hover",
  description = "Interactive cards that respond to your cursor.",
  icon = "Sparkles",
  style,
  className
}: any) {
  const Icon = Lucide[icon] || Lucide.Sparkles;

  return (
    <motion.div
      whileHover={{ y: -5 }}
      transition={{ type: "spring", stiffness: 300 }}
      className={cn(
        "group relative p-8 bg-zinc-900/50 border border-white/10 rounded-2xl overflow-hidden cursor-pointer backdrop-blur-sm",
        className
      )}
      style={style}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 via-transparent to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="relative z-10 flex flex-col h-full">
        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 text-zinc-300 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-300">
          <Icon size={24} />
        </div>
        <h3 className="text-xl font-bold text-white mb-3 group-hover:text-blue-200 transition-colors">
          {title}
        </h3>
        <p className="text-zinc-400 text-sm leading-relaxed group-hover:text-zinc-300 transition-colors">
          {description}
        </p>
      </div>
    </motion.div>
  );
}
`;

const GEOMETRIC_SHAPES_CODE = `
import React from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

export default function GeometricShapes({ style, className }: any) {
  return (
    <div className={cn("relative w-full h-full overflow-hidden min-h-[300px] bg-slate-950", className)} style={style}>
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute top-1/4 left-1/4 w-64 h-64 border border-slate-700/30 rounded-full"
      />
      <motion.div 
        animate={{ rotate: -360 }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="absolute bottom-1/4 right-1/4 w-48 h-48 border border-slate-600/20 rounded-full border-dashed"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent" />
    </div>
  );
}
`;

// --- 3. SMART UNIVERSAL RENDERER (App.tsx) ---
//
// EMBEDDING RULES — this string lives inside a TypeScript template literal:
//   1. NO nested backticks           → use string concatenation for dynamic strings
//   2. NO regex with \s \( etc.      → use .includes() for security checks
//   3. NO ${} interpolations         → they get evaluated by TypeScript at build time
//
const RENDERER_CODE = `
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import * as Lucide from 'lucide-react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import HeroGeometric from './components/marketplace/HeroGeometric';
import FeatureHover from './components/marketplace/FeatureHover';
import GeometricShapes from './components/marketplace/GeometricShapes';

const getMotionProps = (props) => {
  const motionProps = {};
  if (props.hoverEffect && props.hoverEffect !== 'none') {
    switch(props.hoverEffect) {
      case 'lift':    motionProps.whileHover = { y: -5 };           break;
      case 'scale':   motionProps.whileHover = { scale: 1.05 };     break;
      case 'glow':    motionProps.whileHover = { boxShadow: '0 0 15px rgba(59,130,246,0.6)' }; break;
      case 'border':  motionProps.whileHover = { borderColor: '#3b82f6' };  break;
      case 'opacity': motionProps.whileHover = { opacity: 0.7 };    break;
    }
    motionProps.transition = { type: 'spring', stiffness: 300, damping: 20 };
  }
  if (props.animation && props.animation !== 'none') {
    const duration = parseFloat(props.animationDuration || '0.5');
    const delay    = parseFloat(props.animationDelay    || '0');
    motionProps.transition = { duration, delay, ease: 'easeOut' };
    switch(props.animation) {
      case 'fade':       motionProps.initial = { opacity: 0 };            motionProps.animate = { opacity: 1 };           break;
      case 'slide-up':   motionProps.initial = { opacity: 0, y: 30 };     motionProps.animate = { opacity: 1, y: 0 };     break;
      case 'slide-left': motionProps.initial = { opacity: 0, x: -30 };    motionProps.animate = { opacity: 1, x: 0 };     break;
      case 'scale-in':   motionProps.initial = { opacity: 0, scale: 0.8 }; motionProps.animate = { opacity: 1, scale: 1 }; break;
    }
  }
  return motionProps;
};

// --- LIVE COMPILER ---
// Security uses .includes() — NOT regex — to avoid backslash-escape bugs
// when this string is embedded in the outer TypeScript template literal.
// executableCode uses string concatenation — NOT nested backticks.
const BLOCKED_KEYWORDS = ['eval(', 'document.cookie', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'window.open('];

const LiveComponent = ({ code, ...props }) => {
  const [Component, setComponent] = useState(null);
  const [error, setError]         = useState(null);

  useEffect(() => {
    if (!code) return;
    try {
      // Step 1: Security scan via .includes()
      const hit = BLOCKED_KEYWORDS.find(function(kw) { return code.includes(kw); });
      if (hit) throw new Error('Security violation: restricted keyword "' + hit + '"');

      // Step 2: Pre-clean — convert ALL export forms to bare 'return' statements.
      // MUST happen before Babel — if Babel sees 'export default' it emits
      // Object.defineProperty(exports,'__esModule') which our sandbox can't satisfy.
      // With 'return function Foo', new Function returns the component directly.
      var cleanCode = code
        .split('\\n').filter(function(l) { return !l.trimStart().startsWith('import '); }).join('\\n')
        .replace(/export\\s+default\\s+function\\s+([A-Za-z0-9_]*)/g, 'return function $1')
        .replace(/export\\s+function\\s+([A-Za-z0-9_]+)/g,            'return function $1')
        .replace(/export\\s+default\\s+([A-Za-z0-9_]+)\\s*;?/g,       'return $1;')
        .trim();

      // Step 3: Babel — sourceType:'script' guarantees no module polyfills emitted
      const Babel = window.Babel;
      if (!Babel) throw new Error('Babel not loaded yet — please wait a moment.');

      const transpiled = Babel.transform(cleanCode, {
        presets: ['react', 'env'],
        sourceType: 'script',
        filename: 'component.jsx',
        configFile: false,
        babelrc: false,
      }).code;

      // Step 4: Execute — transpiled code IS 'return function Foo(){...}'
      // New Function wraps it, return bubbles up as the component directly.
      var execCode = transpiled;

      var factory = new Function('React', 'Lucide', 'motion', 'cn', execCode);
      var Comp = factory(React, Lucide, motion, function cn() { return Array.prototype.slice.call(arguments).filter(Boolean).join(' '); });

      if (typeof Comp !== 'function') throw new Error('Code did not return a React component. Ensure it has: export default function MyComp() { ... }');
      setComponent(function () { return Comp; });
      setError(null);
    } catch (e) {
      console.error('[LiveComponent]', e);
      setError(e.message);
    }
  }, [code]);

if (error) return React.createElement('div', { style: { padding: '12px', color: '#f87171', fontSize: '12px', fontFamily: 'monospace', border: '1px dashed #f87171', borderRadius: '6px', background: 'rgba(248,113,113,0.05)', whiteSpace: 'pre-wrap' } }, 'Compile Error: ' + error);
if (!Component) return React.createElement('div', { style: { padding: '12px', color: '#94a3b8', fontSize: '12px' } }, 'Compiling...');
return React.createElement(Component, props);
};

const resolveComponent = (type, props) => {
  if (type === 'custom_component') {
    return props.code
      ? React.createElement(LiveComponent, props)
      : React.createElement('div', { style: { padding: '8px', color: '#94a3b8', fontSize: '12px' } }, 'No code provided');
  }
  if (type === 'hero_geometric') return React.createElement(HeroGeometric, props);
  if (type === 'feature_hover') return React.createElement(FeatureHover, props);
  if (type === 'geometric_shapes') return React.createElement(GeometricShapes, props);
  if (type === 'icon') {
    const Icon = Lucide[props.iconName || props.icon] || Lucide.HelpCircle;
    return React.createElement(motion.div, { style: { display: 'inline-flex' }, ...props }, React.createElement(Icon, { size: props.iconSize || 24 }));
  }
  if (['container', 'section', 'div', 'card', 'stack_v', 'stack_h', 'grid', 'flex', 'webpage', 'canvas', 'hero', 'navbar', 'pricing'].includes(type)) return React.createElement(motion.div, props);
  if (type === 'text') return React.createElement(motion.p, props);
  if (type === 'heading') return React.createElement(motion.h1, props);
  if (type === 'image') return React.createElement(motion.img, props);
  if (type === 'button') return React.createElement(motion.button, props);
  if (type === 'input') return React.createElement(motion.input, props);
  return React.createElement(motion.div, props);
};

const RenderNode = ({ nodeId, nodes, isRootFrame }) => {
  const node = nodes[nodeId];
  if (!node) return null;

  const isLeaf = ['image', 'input', 'icon', 'hero_geometric', 'feature_hover', 'geometric_shapes', 'custom_component'].includes(node.type);

  let children = null;
  if (node.children && node.children.length > 0 && !isLeaf) {
    children = node.children.map(function (cid) { return React.createElement(RenderNode, { key: cid, nodeId: cid, nodes: nodes }); });
  }

  const propsObj = node.props || {};
  const style = propsObj.style;
  const className = propsObj.className;
  let finalStyle = Object.assign({}, style);

  if (isRootFrame || node.type === 'webpage') {
    finalStyle = Object.assign({}, finalStyle, { position: 'relative', top: 'auto', left: 'auto', width: '100%', height: 'auto', minHeight: '100vh', transform: 'none', boxShadow: 'none', border: 'none' });
  }

  const motionProps = getMotionProps(propsObj);
  const finalClass = twMerge(clsx(className));
  const finalProps = Object.assign({}, propsObj, motionProps, {
    style: finalStyle,
    className: finalClass,
    src: node.src,
    href: node.href,
    iconName: node.icon,
    code: node.code,
  });

  const element = resolveComponent(node.type, finalProps);

  if (propsObj.linkTo) {
    return React.createElement(Link, { to: propsObj.linkTo, className: 'contents' },
      isLeaf ? element : React.cloneElement(element, {}, children)
    );
  }
  if (isLeaf) return element;
  return React.cloneElement(element, {}, node.content || children);
};

const PageRenderer = ({ pageId, nodes }) => {
  const pageNode = nodes[pageId];
  if (!pageNode) return null;
  let rootFrameId = null;
  if (pageNode.children) {
    rootFrameId = pageNode.children.find(function (cid) { return nodes[cid] && nodes[cid].type === 'webpage'; });
    if (!rootFrameId && pageNode.children.length > 0) rootFrameId = pageNode.children[0];
  }
  if (!rootFrameId) return React.createElement('div', { className: 'p-10 text-center text-slate-400' }, 'Empty Page');
  return React.createElement(RenderNode, { nodeId: rootFrameId, nodes: nodes, isRootFrame: true });
};

const DataLoader = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await fetch('/src/data/project.json?t=' + Date.now());
        if (res.ok) setData(await res.json());
      } catch (e) { console.error(e); }
    };
    fetchProject();
    const interval = setInterval(fetchProject, 500);
    return () => clearInterval(interval);
  }, []);

  if (!data) return React.createElement('div', { className: 'flex h-screen items-center justify-center text-slate-500 bg-white' }, 'Loading Preview...');

  const { pages, elements } = data;
  return React.createElement(
    Routes, null,
    ...pages.map(function (p) {
      return React.createElement(Route, {
        key: p.id,
        path: p.slug,
        element: React.createElement('div', { className: 'min-h-screen bg-white' },
          React.createElement(PageRenderer, { pageId: p.rootId, nodes: elements })
        )
      });
    }),
    React.createElement(Route, { path: '*', element: React.createElement('div', { className: 'p-10 text-center' }, '404') })
  );
};

export default function App() {
  return React.createElement(BrowserRouter, null, React.createElement(DataLoader, null));
}
`;

// Export for dynamic sync
export { RENDERER_CODE };

// --- 4. FILE SYSTEM STRUCTURE ---
export const VITE_REACT_TEMPLATE: FileSystemTree = {
  'package.json': {
    file: {
      contents: JSON.stringify({
        name: "vectra-app",
        type: "module",
        scripts: { "dev": "vite", "build": "vite build", "preview": "vite preview" },
        dependencies: {
          "react": "^18.2.0",
          "react-dom": "^18.2.0",
          "lucide-react": "^0.263.1",
          "framer-motion": "^10.16.4",
          "clsx": "^2.0.0",
          "tailwind-merge": "^1.14.0",
          "react-router-dom": "^6.14.1"
        },
        devDependencies: {
          "@vitejs/plugin-react-swc": "^3.3.2",
          "tailwindcss": "^3.3.3",
          "vite": "^4.4.5",
          "autoprefixer": "^10.4.14",
          "postcss": "^8.4.27"
        }
      }, null, 2)
    }
  },
  'vite.config.ts': {
    file: { contents: `import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react-swc'; export default defineConfig({ plugins: [react()] }); ` }
  },
  'tailwind.config.js': {
    file: { contents: `/** @type {import('tailwindcss').Config} */\nexport default { \n  darkMode: 'class', \n  content: [\n    "./index.html", \n    "./src/**/*.{js,ts,jsx,tsx}", \n    "./src/data/project.json"\n], \n  theme: { extend: { } }, \n  plugins: []\n } ` }
  },
  'postcss.config.js': {
    file: { contents: `export default { plugins: { tailwindcss: {}, autoprefixer: {} } }` }
  },
  'index.html': {
    file: { contents: `< !doctype html >\n < html lang = "en" class="dark" >\n<head>\n < meta charset = "UTF-8" />\n < meta name = "viewport" content = "width=device-width, initial-scale=1.0" />\n < title > Vectra Preview < /title>\n    <script src="https:/ / unpkg.com / @babel / standalone@7.23.10 / babel.min.js" crossorigin="anonymous"><\/script>\n  </head>\n  <body class="dark bg - black text - white">\n    <div id="root"></div>\n    <script type="module " src="/src/main.tsx"><\/script>\n  </body>\n</html>` }
  },
  'src': {
    directory: {
      'lib': { directory: { 'utils.ts': { file: { contents: UTILS_CODE } } } },
      'components': {
        directory: {
          'marketplace': {
            directory: {
              'HeroGeometric.tsx': { file: { contents: HERO_GEOMETRIC_CODE } },
              'FeatureHover.tsx': { file: { contents: FEATURE_HOVER_CODE } },
              'GeometricShapes.tsx': { file: { contents: GEOMETRIC_SHAPES_CODE } }
            }
          }
        }
      },
      'main.tsx': {
        file: { contents: `import React from 'react'; import ReactDOM from 'react-dom/client'; import App from './App'; import './index.css'; ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);` }
      },
      'index.css': {
        file: { contents: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@layer base {\n  body { background-color: #000; color: #fff; }\n}` }
      },
      'App.tsx': { file: { contents: RENDERER_CODE } },
      'data': { directory: { 'project.json': { file: { contents: `{"pages":[], "elements":{}}` } } } },
      'tailwind-gen.js': { file: { contents: '// Auto-generated' } }
    }
  }
};

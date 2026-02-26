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
    file: {
      contents:
        `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vectra App</title>
  </head>
  <body class="dark bg-black text-white">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`
    }
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
      // Initial placeholder — useFileSync overwrites this on first sync
      'App.tsx': {
        file: {
          contents: `import React from 'react';

export default function App() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-black text-zinc-500 font-mono text-sm">
      Vectra is initializing...
    </div>
  );
}
` }
      },
      'data': { directory: { 'project.json': { file: { contents: `{"pages":[], "elements":{}}` } } } },
      'tailwind-gen.js': { file: { contents: '// Auto-generated' } }
    }
  }
};

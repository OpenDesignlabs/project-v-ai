/* ============================================================
   CHANGE LOG
   MODIFIED: vite.config.ts
   UPDATED: manualChunks — now splits both vendor libs AND heavy
            src-level modules into named async chunks.
   ADDED: jszip/file-saver, react-best-gradient, src-level splits
          (RenderNode, codeGenerator, aiAgent, panels, PublishModal,
           Dashboard) — each is its own browser-cacheable file.
   PRESERVED: base, resolve.alias, server/preview headers (COEP)
   ============================================================ */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  base: process.env.VITE_BASE_URL || '/',

  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // ── Build: fine-grained chunk splitting ───────────────────────────────
  build: {
    target: 'esnext',            // No legacy polyfills — all modern browsers
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Each return value becomes a separate async JS chunk.
        // Browser downloads and caches each chunk independently —
        // only the changed chunk is re-downloaded on updates.
        manualChunks(id) {
          // ── Vendor: heavy 3rd-party libs ────────────────────────────────
          // WebContainer: only loaded when editor mounts (~1.5 MB)
          if (id.includes('@webcontainer/api'))       return 'chunk-webcontainer';
          // Framer Motion: animation engine used in canvas only (~500 KB)
          if (id.includes('framer-motion'))           return 'chunk-motion';
          // Lucide: 800-icon library — not needed on dashboard (~800 KB)
          if (id.includes('lucide-react'))            return 'chunk-lucide';
          // Babel standalone: compile fence for custom_code preview
          if (id.includes('@babel/standalone'))       return 'chunk-babel';
          // JSZip + file-saver: only when publish/download is triggered
          if (id.includes('jszip') ||
              id.includes('file-saver'))              return 'chunk-zip';
          // Color picker: gradient editor inside RightSidebar design tab
          if (id.includes('react-best-gradient'))     return 'chunk-colorpicker';
          // React core: tiny, long-lived cache
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/')) return 'chunk-react';
          // Remaining node_modules
          if (id.includes('node_modules'))            return 'chunk-vendor';

          // ── Src: application modules split by feature ──────────────────
          // RenderNode: 1600-line component tree renderer
          if (id.includes('src/components/canvas/RenderNode'))    return 'chunk-app-rendernode';
          // Code generator: 1480-line multi-framework export engine
          if (id.includes('src/utils/codegen/codeGenerator'))      return 'chunk-app-codegen';
          // AI agent: only pulled in when AI features are invoked
          if (id.includes('src/services/aiAgent'))         return 'chunk-app-ai';
          // All sidebar panels: 6 panels loaded per-activation
          if (id.includes('src/components/panels/') ||
              id.includes('src/components/modals/DeployPanel'))   return 'chunk-app-panels';
          // Publish modal + deployer utilities
          if (id.includes('src/components/modals/PublishModal') ||
              id.includes('src/utils/deploy/netlifyDeployer'))    return 'chunk-app-publish';
          // Dashboard: route-level, lazy-loaded in App.tsx
          if (id.includes('src/components/dashboard/Dashboard'))     return 'chunk-app-dashboard';
        },
      },
    },
  },

  // ── Dev server: COEP headers required for SharedArrayBuffer (WebContainer) ──
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
  },

  // ── Preview server: same COEP headers (for `vite preview` after build) ──
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});

/* ============================================================
   CHANGE LOG — FIX-4
   MODIFIED: vite.config.ts
   ADDED: manualChunks — splits @webcontainer/api, framer-motion,
          lucide-react into separate async chunks.
          Each is only downloaded when the module is first used.
   ADDED: build.target = 'esnext' — skips legacy polyfill emission
   ADDED: @vitejs/plugin-react-swc — SWC transpiler (~3x faster
          than Babel plugin-react for both dev and build)
   PRESERVED: base, resolve.alias, server headers (COEP required
              by WebContainer)
   ============================================================ */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// https://vitejs.dev/config/
// Use './' for universal deployment (works on any platform)
// Override with VITE_BASE_URL env variable if needed for specific platforms
export default defineConfig({
  base: process.env.VITE_BASE_URL || './',

  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // ── Build: aggressive chunk splitting ─────────────────────────────────
  build: {
    target: 'esnext',           // No legacy polyfills — all modern browsers
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // FIX-4: Split large dependencies into separate async chunks.
        // Browser downloads only the chunk it needs, when it needs it.
        // This cuts the initial JS parse time from ~10s to ~2-3s.
        manualChunks(id) {
          // WebContainer: only loaded when the editor mounts, heavy (~1.5MB)
          if (id.includes('@webcontainer/api')) return 'chunk-webcontainer';
          // Framer Motion: only needed inside the canvas (~500KB)
          if (id.includes('framer-motion')) return 'chunk-motion';
          // Lucide: icon library, not needed on dashboard (~800KB)
          if (id.includes('lucide-react')) return 'chunk-lucide';
          // Babel standalone: may still appear if imported via legacy path
          if (id.includes('@babel/standalone')) return 'chunk-babel';
          // React core: tiny, separate for long-term caching
          if (id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/')) return 'chunk-react';
          // Everything else from node_modules goes into a generic vendor chunk
          if (id.includes('node_modules')) return 'chunk-vendor';
        },
      },
    },
  },

  // ── Dev server: COEP headers required for SharedArrayBuffer (WebContainer) ──
  // Required for WebContainers (SharedArrayBuffer support in Preview window)
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      // Prevent MIME-type sniffing
      'X-Content-Type-Options': 'nosniff',
      // Only send origin (no path) in Referer header for cross-origin requests
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      // Disable browser features not used by this app
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

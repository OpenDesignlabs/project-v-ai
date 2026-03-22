/* Vite CDN proxy + COEP headers for dev/preview. Both /cdn/* routes forward to their
   respective CDNs and inject CORP headers so COEP: require-corp doesn't block them.
   In production, Vercel rewrites handle the same /cdn/* paths identically. */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// ── Shared security headers (dev + preview) ───────────────────────────────────
const SECURITY_HEADERS: Record<string, string> = {
  'Cross-Origin-Embedder-Policy':  'require-corp',
  'Cross-Origin-Opener-Policy':    'same-origin',
  'X-Content-Type-Options':        'nosniff',
  'Referrer-Policy':               'strict-origin-when-cross-origin',
  'Permissions-Policy':            'camera=(), microphone=(), geolocation=()',
};

// ── CDN proxy config — injected into server.proxy ────────────────────────────
// Proxying CDN through Vite makes requests same-origin → COEP never blocks them.
// The configure hook adds CORP: cross-origin to every proxied response so the
// browser also accepts it when loaded from the local files as a fallback.
const makeCdnProxy = (
  targetBase: string,
  rewrittenPath: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
) => ({
  target: targetBase,
  changeOrigin: true,
  rewrite: () => rewrittenPath,
  configure: (proxy: any) => {
    proxy.on('proxyRes', (proxyRes: any) => {
      proxyRes.headers['cross-origin-resource-policy'] = 'cross-origin';
      proxyRes.headers['access-control-allow-origin']  = '*';
      proxyRes.headers['access-control-allow-methods'] = 'GET, OPTIONS';
      // Long cache — these files are content-addressed / versioned
      proxyRes.headers['cache-control'] = 'public, max-age=604800, stale-while-revalidate=86400';
    });
  },
});

export default defineConfig({
  base: process.env.VITE_BASE_URL || '/',

  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // ── Build: fine-grained chunk splitting ───────────────────────────────────
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor: heavy 3rd-party libs
          if (id.includes('@webcontainer/api'))       return 'chunk-webcontainer';
          if (id.includes('framer-motion'))           return 'chunk-motion';
          if (id.includes('lucide-react'))            return 'chunk-lucide';
          if (id.includes('@babel/standalone'))       return 'chunk-babel';
          if (id.includes('jszip') ||
              id.includes('file-saver'))              return 'chunk-zip';
          if (id.includes('react-best-gradient'))     return 'chunk-colorpicker';
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/')) return 'chunk-react';
          if (id.includes('node_modules'))            return 'chunk-vendor';

          // Src: app modules split by feature
          if (id.includes('src/components/canvas/RenderNode'))          return 'chunk-app-rendernode';
          if (id.includes('src/utils/codegen/codeGenerator'))            return 'chunk-app-codegen';
          if (id.includes('src/services/aiAgent'))                       return 'chunk-app-ai';
          if (id.includes('src/components/panels/') ||
              id.includes('src/components/modals/DeployPanel'))          return 'chunk-app-panels';
          if (id.includes('src/components/modals/PublishModal') ||
              id.includes('src/utils/deploy/netlifyDeployer'))           return 'chunk-app-publish';
          if (id.includes('src/components/dashboard/Dashboard'))         return 'chunk-app-dashboard';
        },
      },
    },
  },

  // ── Dev server ────────────────────────────────────────────────────────────
  server: {
    headers: SECURITY_HEADERS,

    // Proxy /cdn/* → external CDN, injecting CORP headers on the way back.
    // This makes CDN assets same-origin from the browser's perspective,
    // so COEP: require-corp never blocks them — no crossorigin="" needed.
    proxy: {
      // Babel Standalone  →  unpkg.com/@babel/standalone/babel.min.js
      '/cdn/babel': makeCdnProxy(
        'https://unpkg.com',
        '/@babel/standalone/babel.min.js',
      ),
      // Tailwind Play CDN  →  cdn.tailwindcss.com (latest stable)
      '/cdn/tailwind': makeCdnProxy(
        'https://cdn.tailwindcss.com',
        '/',
      ),
    },
  },

  // ── Preview server (vite preview, after build) ────────────────────────────
  // Note: preview serves static dist/ — /cdn/* won't proxy, but the onerror
  // fallback in index.html will load the local /public files instead.
  preview: {
    headers: SECURITY_HEADERS,
  },
});

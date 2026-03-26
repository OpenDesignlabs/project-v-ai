/* Vite Dev/Preview Config
   Configures CORS/COEP headers and code splitting for the build. */
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
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

export default defineConfig({
  base: process.env.VITE_BASE_URL || '/',

  plugins: [
    tailwindcss(),
    react()
  ],

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
          // Vendor: heavy 3rd-party libs.
          // Consolidated react into vendor to avoid circular dependency warnings.
          if (id.includes('@webcontainer/api'))       return 'chunk-webcontainer';
          if (id.includes('framer-motion'))           return 'chunk-motion';
          if (id.includes('lucide-react'))            return 'chunk-lucide';
          if (id.includes('jszip') ||
              id.includes('file-saver'))              return 'chunk-zip';
          if (id.includes('react-best-gradient'))     return 'chunk-colorpicker';
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
  },

  // ── Preview server (vite preview, after build) ────────────────────────────
  preview: {
    headers: SECURITY_HEADERS,
  },
});

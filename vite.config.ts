import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
// Use './' for universal deployment (works on any platform)
// Override with VITE_BASE_URL env variable if needed for specific platforms
export default defineConfig({
  base: process.env.VITE_BASE_URL || './',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
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
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()',
    },
  },


})


/**
 * ─── FIGMA PROXY — PATCH: add resetProxy() ────────────────────────────────────
 *
 * ADD THIS BLOCK to the PUBLIC API section of src/utils/figmaProxy.ts,
 * immediately after the closing brace of the `ensureProxy` function.
 *
 * PERMANENT CONSTRAINTS PRESERVED:
 *   FIGMA-PROXY-2: proxy is written to VFS only once per session.
 *   resetProxy() explicitly clears the singleton so FigmaPanel v2 can trigger
 *   a fresh ensureProxy() call after a connection error or on user reconnect.
 *
 * USAGE (FigmaPanel.tsx):
 *   import { resetProxy } from '../../utils/figmaProxy';
 *   // In handleReconnect():
 *   resetProxy();   // clears singleton flags
 *   await ensureProxy(instance);  // re-spawns proxy
 */

// ── ADD after `export const ensureProxy = ...` block ──────────────────────────

/**
 * resetProxy
 * ──────────
 * Clears the module-level singleton so the next call to ensureProxy()
 * will re-spawn the proxy process.
 *
 * Call this when:
 *   - The user clicks "Reconnect" after a proxy error
 *   - The WebContainer instance is recycled
 *   - The proxy process has exited (MCP-IDLE style auto-exit)
 *
 * NOTE: This does NOT kill the running proxy process — the WebContainer
 * process lifecycle is managed by the container. It only resets the
 * TypeScript singleton state so ensureProxy() will re-try.
 */
export const resetProxy = (): void => {
    proxyBootPromise = null;
    proxyIsRunning   = false;
    // proxyBaseUrl stays at its last value — will be overwritten on next boot
    console.log('[figma-proxy] Singleton reset. Next ensureProxy() will re-spawn.');
};

// ── ALSO export getProxyBaseUrl if not already exported ──────────────────────
// (it is already exported in the current codebase — no change needed there)

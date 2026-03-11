/**
 * ─── FIGMA VFS PROXY ──────────────────────────────────────────────────────────
 * FIG-1 — Solves FIGMA-CORS-1: Figma API blocks direct browser fetches.
 *
 * ARCHITECTURE
 * ────────────
 * A minimal Node.js http server (zero npm deps — uses built-ins only) is written
 * into the WebContainer VFS at `/proxy.mjs` and spawned via `node proxy.mjs`.
 * It runs on port 3001. All FigmaPanel.tsx Figma API calls route through:
 *   http://localhost:3001/figma-proxy/v1/...
 *
 * SECURITY CONSTRAINTS
 * ─────────────────────
 * FIGMA-SEC-1 [PERMANENT]: PAT stored in sessionStorage ONLY. Never localStorage.
 *   Key = 'vectra_figma_token'. Tab-close = token gone.
 *
 * FIGMA-SEC-2 [PERMANENT]: Token passed as `X-Figma-Token` request header only.
 *   Never in URL query params (visible in server logs).
 *   Never written to the proxy source file (would persist in VFS).
 *   The proxy reads it from the incoming request header and forwards it as
 *   `Authorization: Bearer` to api.figma.com.
 *
 * FIGMA-PROXY-1 [PERMANENT]: Proxy port = 3001. Dev server port = 3000.
 *   These must never collide.
 *
 * FIGMA-PROXY-2 [PERMANENT]: Proxy is written to VFS only once per session.
 *   ensureProxy() health-checks before re-writing. proxyBootPromise singleton
 *   prevents double-spawns under React Strict Mode double-invoke.
 */

import type { WebContainer } from '@webcontainer/api';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const PROXY_PORT = 3001;

// FIG-WC-1 [PERMANENT]: WebContainer servers are NOT reachable via localhost:PORT
// from the browser. Use the container-forwarded URL from the server-ready event.
let proxyBaseUrl = `http://localhost:${PROXY_PORT}/figma-proxy`;
export const getProxyBaseUrl = () => proxyBaseUrl;

// Module-level singleton — prevents duplicate proxy processes
let proxyBootPromise: Promise<string> | null = null;
let proxyIsRunning = false;

// ─── PROXY SOURCE ─────────────────────────────────────────────────────────────
// Written to WebContainer VFS as /proxy.mjs.
// Uses ONLY Node.js built-ins (http, https) — no npm install required.
// This means zero install latency: proxy boots instantly.
//
// FIGMA-SEC-2 implementation:
//   token ← req.headers['x-figma-token']
//   forwarded as: Authorization: Bearer {token}
//   never stored, never logged.

const PROXY_SOURCE = `
import http from 'http';
import https from 'https';

const PORT = ${PROXY_PORT};
const FIGMA_HOST = 'api.figma.com';
const IDLE_MS = 10 * 60 * 1000; // 10 min idle → self-terminate

let idleTimer = setTimeout(() => process.exit(0), IDLE_MS);
const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => process.exit(0), IDLE_MS); };

const server = http.createServer((req, res) => {
    resetIdle();

    // CORS — allow WebContainer iframe origins
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Figma-Token');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Health check
    if (req.url === '/figma-proxy/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', port: PORT }));
        return;
    }

    // Only handle /figma-proxy/* paths
    if (!req.url || !req.url.startsWith('/figma-proxy/')) {
        res.writeHead(404); res.end('Not found'); return;
    }

    // FIGMA-SEC-2: read token from header, never from URL or stored file
    const token = req.headers['x-figma-token'];
    if (!token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing X-Figma-Token header' }));
        return;
    }

    // Rewrite path: /figma-proxy/v1/... → /v1/...
    const figmaPath = req.url.replace('/figma-proxy', '');

    const options = {
        hostname: FIGMA_HOST,
        port: 443,
        path: figmaPath,
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
    };

    const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 200, {
            'Content-Type': proxyRes.headers['content-type'] ?? 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream error', detail: err.message }));
    });

    proxyReq.end();
});

server.listen(PORT, () => {
    console.log('[figma-proxy] Listening on port ' + PORT);
});
`.trim();

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * checkProxyHealth
 * ─────────────────
 * Fast check — returns true if proxy already running and healthy.
 * Skips re-writing VFS + re-spawning on every panel open.
 */
export const checkProxyHealth = async (): Promise<boolean> => {
    if (!proxyIsRunning) return false;
    try {
        const healthUrl = `${proxyBaseUrl}/health`;
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
        return res.ok;
    } catch {
        proxyIsRunning = false;
        return false;
    }
};

/**
 * ensureProxy
 * ───────────
 * Guarantees the Figma CORS proxy is running. Idempotent — safe to call many
 * times. Module-level singleton prevents duplicate spawns.
 *
 * Steps:
 *   1. Fast health check → return if already up.
 *   2. Write /proxy.mjs to VFS (deterministic content, overwrite is safe).
 *   3. Spawn `node proxy.mjs` inside the WebContainer.
 *   4. Poll /figma-proxy/health until ready (max 8 s).
 *
 * @throws Error if proxy does not become healthy within timeout.
 */
export const ensureProxy = async (instance: WebContainer): Promise<string> => {
    if (await checkProxyHealth()) return proxyBaseUrl;
    if (proxyBootPromise) { await proxyBootPromise; return proxyBaseUrl; }

    proxyBootPromise = (async (): Promise<string> => {
        try {
            await instance.fs.writeFile('/proxy.mjs', PROXY_SOURCE);
            console.log('[figma-proxy] proxy.mjs written to VFS');

            // FIG-WC-1: subscribe to server-ready BEFORE spawning
            const serverReadyPromise = new Promise<string>((resolve) => {
                instance.on('server-ready', (port, url) => {
                    if (port === PROXY_PORT) {
                        console.log('[figma-proxy] server-ready:', port, url);
                        resolve(url);
                    }
                });
            });

            const proc = await instance.spawn('node', ['proxy.mjs']);
            proc.output.pipeTo(
                new WritableStream({ write: (chunk) => console.log('[figma-proxy]', chunk) })
            ).catch(() => { /* process ended */ });

            // Race server-ready vs 10s timeout
            const timeoutPromise = new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('Figma proxy did not fire server-ready within 10 seconds.')), 10000)
            );

            const resolvedUrl = await Promise.race([serverReadyPromise, timeoutPromise]);
            proxyBaseUrl = resolvedUrl.replace(/\/$/, '') + '/figma-proxy';
            proxyIsRunning = true;
            console.log('[figma-proxy] ✅ Base URL:', proxyBaseUrl);
            return proxyBaseUrl; // Explicit return makes this Promise<string>
        } catch (err) {
            proxyBootPromise = null;
            throw err;
        }
    })();

    await proxyBootPromise;
    return proxyBaseUrl;
};

/**
 * figmaFetch
 * ──────────
 * Makes an authenticated Figma API call through the VFS proxy.
 * FIGMA-SEC-2: token passed as X-Figma-Token header — never in the URL.
 *
 * @param path   Figma API path, e.g. '/v1/files/{key}'
 * @param token  Figma PAT (caller retrieves from sessionStorage)
 * @param signal Optional AbortSignal for cancellation
 */
export const figmaFetch = async <T>(
    path: string,
    token: string,
    signal?: AbortSignal,
): Promise<T> => {
    const url = `${getProxyBaseUrl()}${path}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-Figma-Token': token, // FIGMA-SEC-2
        },
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => response.statusText);
        throw new Error(`Figma API ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
};

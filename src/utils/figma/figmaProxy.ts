// Server-side proxy that forwards requests to api.figma.com inside a WebContainer to bypass browser CORS.

import type { WebContainer } from '@webcontainer/api';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const PROXY_PORT = 3001;

// WebContainer proxy base URL — updated to the container-forwarded URL from the server-ready event.
let proxyBaseUrl = `http://localhost:${PROXY_PORT}/figma-proxy`;
export const getProxyBaseUrl = () => proxyBaseUrl;

// Module-level singleton — prevents duplicate proxy processes
let proxyBootPromise: Promise<string> | null = null;
let proxyIsRunning = false;

// ─── PROXY SOURCE ─────────────────────────────────────────────────────────────
// Written to the WebContainer VFS as /proxy.mjs. Uses only Node.js built-ins — no install needed.

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

    // CORS headers must be passed into writeHead() directly — setHeader() before writeHead() is silently discarded by Node.js.
    const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Figma-Token',
    };

    // Handle CORS preflight — must come before any routing
    if (req.method === 'OPTIONS') {
        res.writeHead(204, cors); // headers embedded in writeHead — NOT via setHeader
        res.end();
        return;
    }

    // Health check
    if (req.url === '/figma-proxy/health') {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', port: PORT }));
        return;
    }

    // Shutdown endpoint — signals the proxy process to exit before the port is re-used by ensureProxy().
    if (req.url === '/figma-proxy/shutdown') {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        setTimeout(() => process.exit(0), 50); // respond first, exit after
        return;
    }

    // Only handle /figma-proxy/* paths
    if (!req.url || !req.url.startsWith('/figma-proxy/')) {
        res.writeHead(404, cors); res.end('Not found'); return;
    }

    // read token from header, never from URL or stored file
    const token = req.headers['x-figma-token'];
    if (!token) {
        res.writeHead(401, { ...cors, 'Content-Type': 'application/json' });
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
            ...cors,
            'Content-Type': proxyRes.headers['content-type'] ?? 'application/json',
        });
        proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
        res.writeHead(502, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream error', detail: err.message }));
    });

    proxyReq.end();
});

server.listen(PORT, () => {
    console.log('[figma-proxy] Listening on port ' + PORT);
});
`.trim();

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

// Returns true quickly if the proxy is already running and healthy. Skips VFS write and respawn on every panel open.
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

// Ensures the Figma CORS proxy is running inside the WebContainer. Idempotent — uses a module-level singleton to prevent duplicate spawns.
export const ensureProxy = async (instance: WebContainer): Promise<string> => {
    if (await checkProxyHealth()) return proxyBaseUrl;
    if (proxyBootPromise) { await proxyBootPromise; return proxyBaseUrl; }

    proxyBootPromise = (async (): Promise<string> => {
        try {
            await instance.fs.writeFile('/proxy.mjs', PROXY_SOURCE);
            console.log('[figma-proxy] proxy.mjs written to VFS');

            // subscribe to server-ready BEFORE spawning
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

// Calls the /shutdown endpoint first so the running Node process exits cleanly before the port is re-used.
export const resetProxy = async (): Promise<void> => {
    if (proxyIsRunning) {
        try {
            // Signal the running proxy to exit gracefully (50ms delay inside)
            await fetch(`${proxyBaseUrl}/shutdown`, {
                signal: AbortSignal.timeout(1500),
            });
            // Give the process time to exit before we re-use the port
            await new Promise<void>(r => setTimeout(r, 300));
        } catch {
            // Process may already be dead — safe to continue
        }
    }
    proxyBootPromise = null;
    proxyIsRunning   = false;
    // proxyBaseUrl stays at its last value — will be overwritten on next boot
    console.log('[figma-proxy] Singleton reset. Next ensureProxy() will re-spawn.');
};

// Makes an authenticated Figma API call through the VFS proxy. Token is passed as X-Figma-Token header, never in the URL.
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

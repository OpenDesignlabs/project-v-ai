/**
 * --- VERCEL DEPLOYER --------------------------------------------------------
 * Deploys the current project to Vercel using the Vercel REST API.
 * Creates or re-uses a Vercel project, generates all project files via
 * codeGenerator.ts, and uploads them as deployment files.
 * The Vercel token is stored in sessionStorage only (never persisted to disk).
 */

const VERCEL_API = 'https://api.vercel.com';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

// ─── Public types ─────────────────────────────────────────────────────────────

export interface VercelDeployConfig {
    /** Vercel API token — session only (VERCEL-SEC-1). */
    token: string;
    /** Vercel project name — created automatically if it does not exist. */
    projectName: string;
    /** 'production' or 'preview'. Default: 'preview'. */
    target: 'production' | 'preview';
    /** Build-time environment variables. Values never logged (VERCEL-SEC-2). */
    env: Record<string, string>;
    /** Framework hint for Vercel build settings. */
    framework: 'nextjs' | 'vite';
}

export type VercelDeployPhase =
    | 'uploading'   // Step 1: blob uploads in progress
    | 'creating'    // Step 2: POSTing deployment manifest
    | 'building'    // Step 3: Vercel is building
    | 'ready'       // Terminal: deploy is live
    | 'error';      // Terminal: deploy failed

export interface VercelDeployProgress {
    phase: VercelDeployPhase;
    /** For 'uploading' phase: files uploaded so far */
    uploadsDone?: number;
    uploadsTotal?: number;
    /** For 'building' phase: Vercel readyState string */
    readyState?: string;
    /** Append this to the terminal log */
    logLine?: string;
}

export interface VercelDeployResult {
    deploymentId: string;
    url: string;          // e.g. "https://my-project-abc123.vercel.app"
    inspectorUrl: string;          // Vercel dashboard URL for this deploy
    target: 'production' | 'preview';
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** SHA-1 digest of a Uint8Array via Web Crypto. Returns lowercase hex. */
async function sha1Hex(bytes: Uint8Array): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-1', bytes.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Low-level Vercel API fetch wrapper. */
async function vFetch(
    token: string,
    method: string,
    path: string,
    options: {
        jsonBody?: unknown;
        rawBody?: Uint8Array;
        extraHeaders?: Record<string, string>;
        signal?: AbortSignal;
    } = {}
): Promise<any> {
    const { jsonBody, rawBody, extraHeaders = {}, signal } = options;

    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...extraHeaders,
    };

    let body: BodyInit | undefined;
    if (rawBody !== undefined) {
        headers['Content-Type'] = 'application/octet-stream';
        body = new Blob([rawBody.buffer as ArrayBuffer]);
    } else if (jsonBody !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(jsonBody);
    }

    const res = await fetch(`${VERCEL_API}${path}`, { method, headers, body, signal });

    if (res.status === 204) return null;

    const json = await res.json().catch(() => ({ error: { message: res.statusText } }));

    if (!res.ok) {
        // 409 on /v2/files = file already exists — not an error (Vercel dedup)
        if (res.status === 409 && path === '/v2/files') return null;
        const msg = json?.error?.message ?? json?.message ?? res.statusText;
        throw new Error(`Vercel ${method} ${path} → ${res.status}: ${msg}`);
    }

    return json;
}

// ─── Step 1: Upload file blobs ────────────────────────────────────────────────

interface FileManifestEntry {
    file: string;   // relative path
    sha: string;   // sha1 hex
    size: number;   // byte length
}

async function uploadBlobs(
    token: string,
    files: Record<string, string>,
    onProgress: (p: VercelDeployProgress) => void,
    signal: AbortSignal
): Promise<FileManifestEntry[]> {
    const entries = Object.entries(files);
    const total = entries.length;
    let done = 0;

    onProgress({
        phase: 'uploading', uploadsDone: 0, uploadsTotal: total,
        logLine: `Uploading ${total} files to Vercel…`,
    });

    // Pre-compute all sha1 digests in parallel (CPU-bound but fast in browser)
    const prepared = await Promise.all(
        entries.map(async ([path, content]) => {
            const bytes = new TextEncoder().encode(content);
            const sha = await sha1Hex(bytes);
            return { path, bytes, sha, size: bytes.byteLength };
        })
    );

    // Upload all blobs in parallel — Vercel deduplicates by sha1
    await Promise.all(
        prepared.map(async ({ path, bytes, sha, size }) => {
            await vFetch(token, 'POST', '/v2/files', {
                rawBody: bytes,
                extraHeaders: {
                    'x-now-digest': sha,
                    'x-now-size': String(size),
                },
                signal,
            });
            done++;
            onProgress({
                phase: 'uploading', uploadsDone: done, uploadsTotal: total,
                logLine: `  ▶ ${path}`,
            });
        })
    );

    return prepared.map(({ path, sha, size }) => ({ file: path, sha, size }));
}

// ─── Step 2: Create deployment ────────────────────────────────────────────────

async function createDeployment(
    token: string,
    config: VercelDeployConfig,
    manifest: FileManifestEntry[],
    signal: AbortSignal
): Promise<{ id: string; url: string; inspectorUrl: string; readyState: string }> {
    const projectSettings = config.framework === 'nextjs'
        ? { framework: 'nextjs' }
        : { framework: 'vite', buildCommand: 'vite build', outputDirectory: 'dist' };

    const body = {
        name: config.projectName,
        files: manifest,
        target: config.target,
        projectSettings,
        // Build-time env — VERCEL-SEC-2: values go directly to API, never to logs
        env: Object.entries(config.env).reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
        }, {} as Record<string, string>),
    };

    const res = await vFetch(token, 'POST', '/v13/deployments', { jsonBody: body, signal });

    return {
        id: res.id,
        url: res.url ?? '',
        inspectorUrl: res.inspectorUrl ?? `https://vercel.com/deployments/${res.id}`,
        readyState: res.readyState ?? 'INITIALIZING',
    };
}

// ─── Step 3: Poll until ready ─────────────────────────────────────────────────

const TERMINAL_STATES = new Set(['READY', 'ERROR', 'CANCELED', 'FAILED']);

async function pollDeployment(
    token: string,
    id: string,
    onProgress: (p: VercelDeployProgress) => void,
    signal: AbortSignal
): Promise<{ url: string; inspectorUrl: string }> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastState = '';

    while (Date.now() < deadline) {
        if (signal.aborted) throw new DOMException('Deploy cancelled', 'AbortError');

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        if (signal.aborted) throw new DOMException('Deploy cancelled', 'AbortError');

        const dep = await vFetch(token, 'GET', `/v13/deployments/${id}`, { signal });

        const state: string = dep.readyState ?? dep.status ?? 'BUILDING';

        if (state !== lastState) {
            lastState = state;
            onProgress({
                phase: 'building',
                readyState: state,
                logLine: `  ● Build state: ${state}`,
            });
        }

        if (state === 'READY') {
            return {
                url: `https://${dep.url}`,
                inspectorUrl: dep.inspectorUrl ?? `https://vercel.com/deployments/${id}`,
            };
        }

        if (TERMINAL_STATES.has(state) && state !== 'READY') {
            const reason = dep.errorMessage ?? state;
            throw new Error(`Deployment ${state}: ${reason}`);
        }
    }

    throw new Error('Deploy timed out after 5 minutes. Check Vercel dashboard.');
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * deployToVercel
 * ──────────────
 * Uploads files directly to Vercel and polls until deployment is live.
 * Returns the live URL on success.
 *
 * @param files      Path → content map from generateNextProjectCode / generateProjectCode
 * @param config     Token, project name, target, env vars, framework
 * @param onProgress Progress callback for terminal-style log streaming
 * @param signal     AbortSignal — cancel on unmount or manual cancel
 *
 * VERCEL-ABORT-1: signal is non-optional. All Vercel API calls
 * must accept an AbortSignal. DeployPanel creates a new AbortController per
 * deploy, stores it in abortRef, calls abort() on unmount AND on manual cancel.
 */
export async function deployToVercel(
    files: Record<string, string>,
    config: VercelDeployConfig,
    onProgress: (p: VercelDeployProgress) => void,
    signal: AbortSignal
): Promise<VercelDeployResult> {
    if (!config.token.trim()) throw new Error('Vercel API token is required.');
    if (!config.projectName.trim()) throw new Error('Project name is required.');
    if (Object.keys(files).length === 0) throw new Error('No files to deploy — add content first.');

    // ── Step 1: upload blobs ──────────────────────────────────────────────────
    const manifest = await uploadBlobs(config.token, files, onProgress, signal);

    onProgress({ phase: 'creating', logLine: 'Creating deployment…' });

    // ── Step 2: create deployment ─────────────────────────────────────────────
    const deploy = await createDeployment(config.token, config, manifest, signal);

    onProgress({ phase: 'building', logLine: `Deployment created: ${deploy.id}` });
    onProgress({ phase: 'building', logLine: `Vercel is building… (${config.target})` });

    // ── Step 3: poll until ready ──────────────────────────────────────────────
    const { url, inspectorUrl } = await pollDeployment(config.token, deploy.id, onProgress, signal);

    onProgress({ phase: 'ready', logLine: `✓ Deployment ready → ${url}` });

    return {
        deploymentId: deploy.id,
        url,
        inspectorUrl,
        target: config.target,
    };
}

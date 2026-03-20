/**
 * --- NETLIFY DEPLOYER -------------------------------------------------------
 * Deploys the current project to Netlify using the ZIP deploy API.
 * Generates all project files via codeGenerator.ts, bundles them into a
 * ZIP archive, and uploads to /api/v1/sites/{siteId}/deploys.
 */

const NETLIFY_API = 'https://api.netlify.com/api/v1';
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS  = 300_000; // 5 minutes

// ─── Public types ─────────────────────────────────────────────────────────────

export interface NetlifyDeployConfig {
    /** Personal Access Token from app.netlify.com/user/applications — NETLIFY-SEC-1 */
    token: string;
    /** Becomes {name}.netlify.app — alphanumeric + hyphens only */
    siteName: string;
    /** Cached from a previous deploy; skips site creation if set */
    existingSiteId?: string;
}

export interface NetlifyDeployResult {
    siteId: string;
    siteName: string;
    /** Live URL — https://{name}.netlify.app */
    url: string;
    deployId: string;
}

export type NetlifyDeployPhase =
    | 'zipping'     // Building ZIP in browser
    | 'uploading'   // Sending to Netlify API
    | 'processing'  // Netlify is building
    | 'ready'       // Live
    | 'error';

export interface NetlifyDeployProgress {
    phase: NetlifyDeployPhase;
    message: string;
    percent: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sanitizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63); // Netlify site name max length
}

function siteKey(name: string): string {
    return `netlify_site_${sanitizeName(name)}`;
}

async function nFetch(
    token: string,
    method: string,
    path: string,
    body?: BodyInit,
    contentType?: string,
    signal?: AbortSignal,
): Promise<any> {
    const res = await fetch(`${NETLIFY_API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        body,
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        let msg = `Netlify API error ${res.status}`;
        try {
            const json = JSON.parse(text);
            msg = json.message ?? json.error_message ?? json.errors?.join(', ') ?? msg;
        } catch {
            msg = text || msg;
        }
        throw new Error(msg);
    }
    return res.json();
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function deployToNetlify(
    files: Record<string, string>,
    config: NetlifyDeployConfig,
    onProgress: (p: NetlifyDeployProgress) => void,
    signal: AbortSignal,
): Promise<NetlifyDeployResult> {
    if (!config.token.trim())    throw new Error('Netlify access token is required.');
    if (!config.siteName.trim()) throw new Error('Site name is required.');
    if (Object.keys(files).length === 0) throw new Error('No files to deploy.');

    const cleanName = sanitizeName(config.siteName);

    // ── Step 1: Build ZIP ────────────────────────────────────────────────────
    onProgress({ phase: 'zipping', message: 'Preparing your project files…', percent: 5 });

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const [filePath, content] of Object.entries(files)) {
        const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
        zip.file(cleanPath, content);
    }
    const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
    });

    if (signal.aborted) throw new DOMException('Deploy cancelled', 'AbortError');

    // ── Step 2: Create or redeploy ───────────────────────────────────────────
    const existingId = config.existingSiteId ?? sessionStorage.getItem(siteKey(cleanName));
    let deployId: string;
    let siteId: string;
    let siteUrl: string;
    let returnedName: string;

    if (existingId) {
        onProgress({ phase: 'uploading', message: `Updating ${cleanName}.netlify.app…`, percent: 30 });
        const deploy = await nFetch(
            config.token, 'POST',
            `/sites/${existingId}/deploys`,
            zipBlob, 'application/zip', signal,
        );
        deployId      = deploy.id;
        siteId        = existingId;
        returnedName  = cleanName;
        siteUrl       = deploy.deploy_url ?? deploy.url ?? `https://${cleanName}.netlify.app`;
    } else {
        onProgress({ phase: 'uploading', message: 'Creating your site on Netlify…', percent: 30 });
        const site = await nFetch(
            config.token, 'POST',
            `/sites?name=${encodeURIComponent(cleanName)}`,
            zipBlob, 'application/zip', signal,
        );
        siteId       = site.id;
        deployId     = site.deploy_id ?? site.id;
        returnedName = site.name ?? cleanName;
        siteUrl      = site.ssl_url ?? site.url ?? `https://${returnedName}.netlify.app`;
        // session only
        try { sessionStorage.setItem(siteKey(cleanName), siteId); } catch { /* quota */ }
    }

    // ── Step 3: Poll ─────────────────────────────────────────────────────────
    onProgress({ phase: 'processing', message: 'Netlify is building your site…', percent: 55 });

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastState  = '';
    let pct        = 55;

    while (Date.now() < deadline) {
        if (signal.aborted) throw new DOMException('Deploy cancelled', 'AbortError');
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        if (signal.aborted) throw new DOMException('Deploy cancelled', 'AbortError');

        const dep = await nFetch(
            config.token, 'GET', `/deploys/${deployId}`,
            undefined, undefined, signal,
        );

        const state: string = dep.state ?? 'processing';

        if (state !== lastState) {
            lastState = state;
            pct = Math.min(pct + 10, 90);
            const msgs: Record<string, string> = {
                uploading:  'Uploading files to Netlify…',
                processing: 'Processing your project…',
                building:   'Building your site…',
                ready:      'Almost there…',
            };
            onProgress({
                phase: state === 'ready' ? 'ready' : 'processing',
                message: msgs[state] ?? `Building… (${state})`,
                percent: pct,
            });
        }

        if (state === 'ready') {
            const liveUrl = dep.ssl_url ?? dep.url ?? siteUrl;
            onProgress({ phase: 'ready', message: 'Your site is live! 🎉', percent: 100 });
            return { siteId, siteName: returnedName, url: liveUrl, deployId };
        }
        if (state === 'error') {
            throw new Error(dep.error_message ?? 'Netlify build failed. Check your project for errors.');
        }
    }

    throw new Error('Deploy timed out after 5 minutes. Check your Netlify dashboard for status.');
}

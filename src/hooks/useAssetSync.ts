/**
 * ─── useAssetSync ─────────────────────────────────────────────────────────────
 * Scans the element tree for remote image URLs, downloads each one exactly
 * once per session, and writes them as base64 data-URL files to the VFS.
 *
 * WHY A SEPARATE HOOK?
 * ─────────────────────
 * Image downloads are async, slow (network), and independent of code generation.
 * Merging them into useFileSync would:
 *   • Block code file writes while a slow image downloads
 *   • Re-trigger image downloads every time any element changes
 *
 * Keeping them separate means:
 *   • Code sync runs fast (pure CPU, no network)
 *   • Asset sync runs independently, with its own debounce
 *   • A failed image download never blocks component file generation
 *
 * DEDUPLICATION
 * ─────────────
 * `processedUrls` is a session-scoped `Set`. Once a URL is added (even before
 * the fetch completes), it will never be fetched again. If a fetch fails, the
 * URL is removed so it can be retried on the next sync tick.
 *
 * VFS STORAGE FORMAT
 * ──────────────────
 * ContainerContext's `writeFile` accepts a `string`, so images are stored as
 * base64 data URIs. The file on disk contains the full data: URI string, which
 * can be read back and used directly as an <img src> value.
 *
 * File naming: public/assets/{elementId}.{ext}
 * The extension is inferred from the fetch response Content-Type header.
 */

import { useEffect, useRef } from 'react';
import { useProject } from '../context/ProjectContext';
import { useContainer } from '../context/ContainerContext';
import type { VectraProject } from '../types';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Map MIME type → file extension for the most common image formats. */
const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
};

/**
 * Recursively collects all { id, src } pairs from nodes whose type === 'image'
 * and whose `src` prop is a remote HTTP/HTTPS URL.
 */
const collectRemoteImages = (
    elements: VectraProject,
    nodeId: string,
    out: Array<{ id: string; url: string }>,
    visited: Set<string>
): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = elements[nodeId];
    if (!node) return;

    // Check this node
    const src = (node.props as any)?.src || (node as any).src || '';
    if (
        node.type === 'image' &&
        typeof src === 'string' &&
        (src.startsWith('http://') || src.startsWith('https://'))
    ) {
        out.push({ id: node.id, url: src });
    }

    // Recurse into children
    if (node.children) {
        for (const childId of node.children) {
            collectRemoteImages(elements, childId, out, visited);
        }
    }
};

/**
 * Downloads `url`, converts to base64 data URI, returns the data URI string.
 * Returns null on fetch failure.
 */
const fetchAsDataUrl = async (url: string): Promise<{ dataUrl: string; ext: string } | null> => {
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const mimeType = contentType.split(';')[0].trim();
        const ext = MIME_TO_EXT[mimeType] || 'jpg';

        const blob = await response.blob();

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({ dataUrl: reader.result as string, ext });
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        console.warn(`[AssetSync] Fetch failed for ${url}:`, err);
        return null;
    }
};

// ─── HOOK ─────────────────────────────────────────────────────────────────────

export const useAssetSync = () => {
    // Narrow subscription: only project elements, not UI state
    const { elements } = useProject();
    const { writeFile, status } = useContainer();

    /**
     * Session-scope dedup set.
     * A URL is added immediately when download starts, before the fetch
     * completes, to prevent concurrent duplicate downloads. Removed on failure
     * so the URL can be retried on the next sync tick.
     */
    const processedUrls = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (status !== 'ready') return;

        const syncAssets = async () => {
            // Collect all remote images reachable from the page root
            const images: Array<{ id: string; url: string }> = [];
            const visited = new Set<string>();

            const pageRoot = elements['page-home'];
            if (!pageRoot?.children) return;

            for (const childId of pageRoot.children) {
                collectRemoteImages(elements, childId, images, visited);
            }

            // Filter to only URLs we haven't already processed this session
            const pending = images.filter(img => !processedUrls.current.has(img.url));
            if (pending.length === 0) return;

            // Download and write each new image (in parallel, up to 4 concurrent)
            const CONCURRENCY = 4;
            for (let i = 0; i < pending.length; i += CONCURRENCY) {
                const batch = pending.slice(i, i + CONCURRENCY);

                await Promise.all(batch.map(async ({ id, url }) => {
                    // Mark as "in-flight" immediately to prevent duplicate starts
                    processedUrls.current.add(url);

                    const result = await fetchAsDataUrl(url);

                    if (!result) {
                        // Let it retry next tick
                        processedUrls.current.delete(url);
                        return;
                    }

                    const { dataUrl, ext } = result;
                    const vfsPath = `public/assets/${id}.${ext}`;

                    try {
                        // writeFile accepts string — store the full data URI
                        await writeFile(vfsPath, dataUrl);
                        console.log(`[AssetSync] ✅ Cached → ${vfsPath}`);
                    } catch (writeErr) {
                        console.error(`[AssetSync] Write failed for ${vfsPath}:`, writeErr);
                        // Don't remove from processedUrls — the download succeeded;
                        // only the VFS write failed (disk full?). Don't spam fetches.
                    }
                }));
            }
        };

        // 2 s debounce — image syncing is less time-sensitive than code syncing
        // (useFileSync uses 600ms). Assets don't affect Vite HMR.
        const timer = setTimeout(syncAssets, 2000);
        return () => clearTimeout(timer);

    }, [elements, status, writeFile]);
};

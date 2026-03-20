// / <reference lib="webworker" /> --- HISTORY WORKER -------------------------------------------------------- Manages undo/redo off the main thread using a Wasm HistoryManager

import init, { HistoryManager } from '../../vectra-engine/pkg/vectra_engine.js';

let manager: HistoryManager | null = null;

// ── Wasm init ──────────────────────────────────────────────────────────────
async function boot() {
    try {
        await init();
        // Signal the host that Wasm is loaded and we're ready for INIT
        self.postMessage({ type: 'READY' });
    } catch (err) {
        console.error('[HistoryWorker] Wasm init failed:', err);
    }
}

boot();

// ── Message handler ────────────────────────────────────────────────────────
self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data as { type: string; payload?: unknown };

    try {
        switch (type) {
            // ── INIT ───────────────────────────────────────────────────── Payload: elements object (received via Structured Clone — no stringify needed on host side). We stringify here, off-thread
            case 'INIT': {
                const json = JSON.stringify(payload);
                manager = new HistoryManager(json);
                break;
            }

            // ── PUSH ─────────────────────────────────────────────────────
            // Payload: elements object — the heavy JSON.stringify + Gzip happen here.
            case 'PUSH': {
                if (manager) {
                    const json = JSON.stringify(payload);
                    manager.push_state(json); // compress inside Rust (~2–5ms, off main thread)
                }
                break;
            }

            // ── UNDO ─────────────────────────────────────────────────────
            // HistoryManager.undo() returns the decompressed JSON string (Option<String>).
            // If there's nothing to undo it returns undefined — we silently ignore.
            case 'UNDO': {
                if (manager) {
                    const result: string | undefined = manager.undo();
                    if (result) {
                        self.postMessage({ type: 'UNDO_RESULT', payload: result });
                    }
                }
                break;
            }

            // ── REDO ─────────────────────────────────────────────────────
            case 'REDO': {
                if (manager) {
                    const result: string | undefined = manager.redo();
                    if (result) {
                        self.postMessage({ type: 'REDO_RESULT', payload: result });
                    }
                }
                break;
            }

            default:
                console.warn('[HistoryWorker] Unknown message type:', type);
        }
    } catch (err) {
        console.error('[HistoryWorker] Error handling message:', type, err);
    }
};

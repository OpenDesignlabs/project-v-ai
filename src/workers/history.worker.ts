/// <reference lib="webworker" />
// ─── HISTORY WORKER ───────────────────────────────────────────────────────────
// Moves three expensive main-thread operations into a background thread:
//   1. JSON.stringify(elements)  — O(N) string allocation, ~1–5ms for typical projects
//   2. Gzip compression (Wasm)   — ~2–5ms via flate2 inside the Rust engine
//   3. Gzip decompression        — ~1–3ms on undo/redo
//
// API CONTRACT (postMessage protocol):
//   Host  → Worker: { type: 'INIT', payload: elements }
//   Host  → Worker: { type: 'PUSH', payload: elements }
//   Host  → Worker: { type: 'UNDO' }
//   Host  → Worker: { type: 'REDO' }
//
//   Worker → Host:  { type: 'READY' }                          (Wasm init done)
//   Worker → Host:  { type: 'UNDO_RESULT', payload: string }   (decompressed JSON)
//   Worker → Host:  { type: 'REDO_RESULT', payload: string }   (decompressed JSON)
//
// NOTE: HistoryManager.undo() / redo() return string | undefined via
// Option<String> in Rust. We deliberately keep this API (not Uint8Array)
// to maintain the infallible constructor and void push_state from Phase 8.

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
            // ── INIT ─────────────────────────────────────────────────────
            // Payload: elements object (received via Structured Clone — no stringify needed on host side).
            // We stringify here, off-thread.
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

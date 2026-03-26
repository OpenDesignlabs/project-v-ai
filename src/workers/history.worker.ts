// / <reference lib="webworker" />
// ── HISTORY WORKER v0.2 ───────────────────────────────────────────────────────
// New in v0.2 — uses the upgraded HistoryManager which:
//   • Uses LZ4 compression (5-10× faster than old gzip)
//   • VecDeque internally (O(1) eviction vs O(N) Vec::remove(0))
//   • Deduplicates consecutive identical states automatically
//   • Exposes: get_stats(), undo_steps(n), set_max_history(n), clear_future()

import init, { HistoryManager } from '../../vectra-engine/pkg/vectra_engine.js';

let manager: HistoryManager | null = null;

async function boot() {
    try {
        await init();
        self.postMessage({ type: 'READY' });
    } catch (err) {
        console.error('[HistoryWorker] Wasm init failed:', err);
    }
}

boot();

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data as { type: string; payload?: unknown };

    try {
        switch (type) {
            case 'INIT': {
                const json = JSON.stringify(payload);
                manager = new HistoryManager(json);
                // ── NEW v0.2: set higher limit for large projects ──────────
                // 50 is the default; 80 stays well under ~10MB with LZ4.
                manager.set_max_history(80);
                break;
            }

            case 'PUSH': {
                if (manager) {
                    // ── NEW v0.2: dedup is automatic — consecutive identical
                    // states (hover events, benign re-renders) are silently skipped
                    // inside Rust before compression.
                    manager.push_state(JSON.stringify(payload));
                }
                break;
            }

            case 'UNDO': {
                if (manager) {
                    const result = manager.undo();
                    if (result) {
                        self.postMessage({ type: 'UNDO_RESULT', payload: result });
                    }
                }
                break;
            }

            case 'REDO': {
                if (manager) {
                    const result = manager.redo();
                    if (result) {
                        self.postMessage({ type: 'REDO_RESULT', payload: result });
                    }
                }
                break;
            }

            // ── NEW v0.2: bulk undo (jump back N steps at once) ──────────
            case 'UNDO_STEPS': {
                if (manager) {
                    const steps = (payload as number) ?? 1;
                    const result = manager.undo_steps(steps);
                    if (result) {
                        self.postMessage({ type: 'UNDO_RESULT', payload: result });
                    }
                }
                break;
            }

            // ── NEW v0.2: diagnostic stats for DevTools / Header badge ────
            case 'GET_STATS': {
                if (manager) {
                    const statsJson: string = manager.get_stats();
                    self.postMessage({ type: 'STATS_RESULT', payload: statsJson });
                }
                break;
            }

            // ── NEW v0.2: clear redo branch (called after AI generation) ──
            case 'CLEAR_FUTURE': {
                manager?.clear_future();
                break;
            }

            // ── GAP-1 FIX: expose can_undo/can_redo capability to host ────────
            // Header undo/redo buttons need to know if they should be enabled.
            // Previously the host guessed from history stack length (stale).
            // Now we ask Rust directly — single bool, zero decompression cost.
            case 'CAN_UNDO': {
                self.postMessage({ type: 'CAN_UNDO_RESULT', payload: manager?.can_undo() ?? false });
                break;
            }
            case 'CAN_REDO': {
                self.postMessage({ type: 'CAN_REDO_RESULT', payload: manager?.can_redo() ?? false });
                break;
            }

            // ── GAP-1 FIX: memory usage for DevTools / debug panel ────────────
            case 'GET_MEMORY_USAGE': {
                if (manager) {
                    self.postMessage({ type: 'MEMORY_USAGE_RESULT', payload: manager.get_memory_usage() });
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
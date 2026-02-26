/// <reference lib="webworker" />
// ─── SWC COMPILER WORKER ──────────────────────────────────────────────────────
// Runs all heavy TSX→JS compilation (Rust SWC) off the main thread so that:
//   • Typing in the code editor never causes a jank frame (~5ms blocked)
//   • Preview updates that trigger multiple compilations run in parallel
//     without competing with React's 60fps reconciler
//
// Protocol (postMessage):
//   Host  → Worker: { id: string, code: string }
//   Worker → Host:  { id: string, code: string }   (success)
//   Worker → Host:  { id: string, code: string }   (failure: fallback error component)
//
// The ESM→CJS shim is applied HERE (inside the worker) so the host's
// compileComponent() receives ready-to-execute CJS and does not double-shim.
//
// NOTE: SwcCompiler is a zero-sized Rust struct (Phase 6 stability fix).
//       It is safe to call compile() as many times as needed.

import init, { SwcCompiler } from '../../vectra-engine/pkg/vectra_engine.js';

let compiler: SwcCompiler | null = null;

// ── Boot: initialise Wasm and signal readiness ─────────────────────────────
(async () => {
    try {
        await init();
        compiler = new SwcCompiler();
        self.postMessage({ type: 'READY' });
    } catch (err) {
        console.error('[SwcWorker] Wasm init failed:', err);
        self.postMessage({ type: 'ERROR', error: 'SwcWorker Wasm init failed' });
    }
})();

// ── Pre-compile: strip ESM imports ────────────────────────────────────────
// Safety net: upstream stripAndFixCode should already remove imports, but any
// that survive would generate `require(...)` calls in SWC output that fail in
// the iframe sandbox (no module system). We strip them here defensively.
function stripImports(code: string): string {
    return code
        // import type { X } from 'y' — type-only, always safe to remove
        .replace(/^[ \t]*import\s+type?\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
        // import { X, Y } from 'y' — named import
        .replace(/^[ \t]*import\s+[^\n{]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        // import 'y' — side-effect import
        .replace(/^[ \t]*import\s+['"][^'"]+['"];?\s*$/gm, '')
        .trim();
}

// ── Post-compile: ESM → CJS shim ──────────────────────────────────────────
// SWC emits ESM syntax. The iframe shell executes code via new Function() and
// expects CJS-style exports. Two cases:
//
// 1. Default exports:
//    `export default function Foo` → `exports.default = function Foo`
//    `export default class Foo`    → `exports.default = class Foo`
//    `export default `             → `exports.default = `
//
// 2. Named exports (AI components often use these):
//    `export const Foo = ...`   → `const Foo = ...`  (stays in local scope)
//    `export function Bar`      → `function Bar`
//    `export class Baz`         → `class Baz`
//    The variable remains accessible in the combined sandbox code string.
function shimExports(code: string): string {
    return code
        // ── Default exports (order matters: specific before general) ──────
        .replace(/export\s+default\s+function\s+(\w+)/, 'exports.default = function $1')
        .replace(/export\s+default\s+class\s+(\w+)/, 'exports.default = class $1')
        .replace(/export\s+default\s+/, 'exports.default = ')
        // ── Named exports: strip the `export` keyword, keep declaration ───
        .replace(/\bexport\s+(const|let|var|function|class)\b/g, '$1');
}

// ── Message handler ────────────────────────────────────────────────────────
self.onmessage = (e: MessageEvent) => {
    const { id, code } = e.data as { id: string; code: string };

    // Empty code: resolve immediately, no compilation needed
    if (!code?.trim()) {
        self.postMessage({ id, code: '' });
        return;
    }

    // Compiler not ready yet: return an error component so the preview
    // doesn't go blank while Wasm is booting
    if (!compiler) {
        self.postMessage({
            id,
            code: [
                'exports.default = function CompilerWarmingUp() {',
                '  return React.createElement("div",',
                '    { style: { padding: 16, color: "#94a3b8", fontSize: 13, fontFamily: "monospace" } },',
                '    "⏳ Compiler warming up…"',
                '  );',
                '}',
            ].join('\n'),
        });
        return;
    }

    try {
        const clean = stripImports(code);
        const transpiled = shimExports(compiler.compile(clean));
        self.postMessage({ id, code: transpiled });
    } catch (err: unknown) {
        const msg = (err instanceof Error ? err.message : String(err))
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n');

        // Return a renderable error component — preview stays visible
        self.postMessage({
            id,
            code: [
                'exports.default = function SyntaxError() {',
                '  return React.createElement("div",',
                '    { style: { padding: 16, color: "#ef4444", background: "#fef2f2",',
                '        border: "1px solid #fecaca", borderRadius: 6, fontSize: 13, fontFamily: "monospace" } },',
                '    React.createElement("strong", null, "Compile Error: "),',
                `    "${msg}"`,
                '  );',
                '}',
            ].join('\n'),
        });
    }
};

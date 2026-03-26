// / <reference lib="webworker" /> --- COMPILER WEB WORKER ----------------------------------------
// Runs heavy JSX/TSX compilation off the main thread so the editor stays at 60fps.
// Migrated from Babel (importScripts) to Rust/SWC (WASM) — same API, 20-70x faster.

import init, { SwcCompiler } from '../../vectra-engine/pkg/vectra_engine.js';

let compiler: SwcCompiler | null = null;

// ── Boot: initialise WASM SwcCompiler ──────────────────────────────────────
// Module workers (type:'module') support top-level await and ES imports.
// WASM init is async; messages received before it completes return a graceful error.
(async () => {
    try {
        await init();
        compiler = new SwcCompiler();
    } catch (e) {
        console.error('[CompilerWorker] WASM init failed:', e);
    }
})();

// ── Security block-list ───────────────────────────────────────────────────────
const BLOCKED: RegExp[] = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /document\s*\.\s*cookie/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\bimportScripts\s*\(/,
    /navigator\s*\.\s*(sendBeacon|geolocation|credentials)/,
    /window\s*\.\s*open\s*\(/,
    /location\s*\.\s*(href|replace|assign)/,
];

// ── Code sanitiser ────────────────────────────────────────────────────────────
// Kept in-sync with codeSanitizer.ts manually.
function sanitize(code: string): string {
    return code
        .replace(/^[ \t]*import\s+type?\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^[ \t]*import\s+[^\n{]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^[ \t]*import\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/<Icon\s*(?:=|name=|icon=|component=)["']([^"']+)["']/g, '<Lucide.$1')
        .replace(/<Lucide\[([^\]]+)\]/g, '<DynamicIcon name={$1}')
        .replace(/<\/Lucide\[[^\]]*\]>/g, '</DynamicIcon>')
        .replace(/<Icon\s*(?:=|name=|icon=|component=)\{([^}]+)\}/g, '<DynamicIcon name={$1}')
        .replace(/<\/Icon>/g, '')
        .trim();
}

// ── Post-compile: ESM → CJS shim ─────────────────────────────────────────────
// SWC emits ESM syntax; the iframe sandbox executes via new Function() which
// expects CJS-style exports. Mirrors the shim in swc.worker.ts.
function shimExports(code: string): string {
    return code
        .replace(/export\s+default\s+function\s+(\w+)/, 'exports.default = function $1')
        .replace(/export\s+default\s+class\s+(\w+)/, 'exports.default = class $1')
        .replace(/export\s+default\s+/, 'exports.default = ')
        .replace(/\bexport\s+(const|let|var|function|class)\b/g, '$1');
}

// ── Sandbox preamble ─────────────────────────────────────────────────────────
// Hooks + Framer extras + DynamicIcon pre-declared so compiled code needs no imports.
const PREAMBLE = [
    'const { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, useReducer, useContext, Fragment } = React;',
    'const { useAnimation: _ua, useInView: _uiv, useMotionValue: _umv, useTransform: _utr } = _framerExtras;',
    'const useAnimation = _ua, useInView = _uiv, useMotionValue = _umv, useTransform = _utr;',
    'const DynamicIcon = ({ name, ...props }) => {',
    '  const Comp = Lucide[name] || Lucide.HelpCircle || (() => null);',
    '  return React.createElement(typeof Comp === "function" ? Comp : () => null, props);',
    '};',
].join('\n');

self.onmessage = (e: MessageEvent) => {
    const { code, id } = e.data;

    if (!code) {
        (self as any).postMessage({ id, error: 'No code provided' });
        return;
    }

    // WASM not ready yet — return graceful error
    if (!compiler) {
        (self as any).postMessage({
            id,
            error: 'SWC compiler warming up — retry in a moment',
        });
        return;
    }

    try {
        // 1. Security scan (on raw code before any transform)
        const violation = BLOCKED.find(p => p.test(code));
        if (violation) {
            (self as any).postMessage({
                id,
                error: `Security violation: ${violation.source.slice(0, 60)}`,
            });
            return;
        }

        // 2. Sanitize: strip imports, fix curly quotes, fix icon syntax
        const cleanCode = sanitize(code);

        // 3. Compile TSX → JS via Rust SWC (20-70x faster than Babel)
        const compiled = compiler.compile(cleanCode);

        // 4. Shim ESM exports → CJS so the iframe sandbox can execute it
        const sandboxCode = PREAMBLE + '\n' + shimExports(compiled);

        (self as any).postMessage({ id, sandboxCode, cleanCode });

    } catch (err: any) {
        (self as any).postMessage({ id, error: err.message || 'Unknown compiler error' });
    }
};

// ── NO export {} HERE ─────────────────────────────────────────────────────────
// Switching from classic worker (importScripts) to module worker (type:'module')
// means we use ES imports at the top — no export{} needed, as the /// reference
// directive handles WorkerGlobalScope types.

/// <reference lib="webworker" />
// ─── COMPILER WEB WORKER ────────────────────────────────────────────────────
// Runs ALL heavy work off the main thread:
//   • Security scan  (BLOCKED patterns)
//   • Code sanitisation  (import stripping, quote normalisation, icon aliases)
//   • 3-tier Babel transpilation  (TSX → JSX → bare React)
//   • Sandbox preamble assembly
//
// Returns { id, sandboxCode, cleanCode } on success so the main thread can:
//   a) execute `sandboxCode` via new Function() — instantaneous
//   b) persist `cleanCode` back into elements so future passes skip re-sanitising
//
// CLASSIC worker (not ES module) because importScripts() is required for Babel.
// Vite understands classic workers when { type: 'classic' } is passed to
// new Worker(..., { type: 'classic' }).
//
// DO NOT add `export {}` or any `import`/`export` statement — doing so switches
// TypeScript's module mode ON and makes the worker fail at runtime because
// classic workers cannot load ES modules via importScripts().

declare function importScripts(...urls: string[]): void;

// Load Babel from the local public folder (same origin, avoids CORS on workers)
try {
    importScripts('/babel.min.js');
} catch (e) {
    // Worker will still start; individual compile requests will fail gracefully
    // with "Babel not available" rather than crashing the whole worker.
    console.error('[Worker] Failed to load Babel via importScripts:', e);
}

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
// If you update codeSanitizer.ts, update this block too.
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

self.onmessage = (e: MessageEvent) => {
    const { code, id } = e.data;

    if (!code) {
        (self as any).postMessage({ id, error: 'No code provided' });
        return;
    }

    try {
        // ── 1. Security scan (on raw code before any transform) ──────────────
        const violation = BLOCKED.find(p => p.test(code));
        if (violation) {
            (self as any).postMessage({
                id,
                error: `Security violation: ${violation.source.slice(0, 60)}`,
            });
            return;
        }

        // ── 2. Sanitize: strip imports, fix curly quotes, fix icon syntax ────
        const cleanCode = sanitize(code);

        // ── 3. Babel transpilation — 3-tier fallback ─────────────────────────
        const Babel = (self as any).Babel;
        if (!Babel) {
            (self as any).postMessage({
                id,
                error: 'Babel not available in worker — ensure /babel.min.js exists in public/',
            });
            return;
        }

        const BABEL_BASE = {
            sourceType: 'module' as const,
            configFile: false,
            babelrc: false,
        };

        let transpiled = '';
        try {
            // Tier 1: Full TypeScript + React + CommonJS
            transpiled = Babel.transform(cleanCode, {
                ...BABEL_BASE,
                presets: [
                    ['env', { modules: 'commonjs' }],
                    ['react', { runtime: 'classic' }],
                    ['typescript', { isTSX: true, allExtensions: true }],
                ],
                filename: 'component.tsx',
            }).code;
        } catch (_e1) {
            try {
                // Tier 2: Drop TypeScript preset (handles JSX-only components)
                transpiled = Babel.transform(cleanCode, {
                    ...BABEL_BASE,
                    presets: [
                        ['env', { modules: 'commonjs' }],
                        ['react', { runtime: 'classic' }],
                    ],
                    filename: 'component.jsx',
                }).code;
            } catch (_e2) {
                // Tier 3: Bare React transform only
                transpiled = Babel.transform(cleanCode, {
                    ...BABEL_BASE,
                    presets: [['react', { runtime: 'classic' }]],
                    filename: 'component.jsx',
                }).code;
            }
        }

        // ── 4. Assemble sandbox preamble ──────────────────────────────────────
        // Hooks + Framer extras + DynamicIcon are pre-declared so the compiled
        // code doesn't need any imports. Runtime values are injected by new Function().
        const sandboxCode = [
            'const { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, useReducer, useContext, Fragment } = React;',
            'const { useAnimation: _ua, useInView: _uiv, useMotionValue: _umv, useTransform: _utr } = _framerExtras;',
            'const useAnimation = _ua, useInView = _uiv, useMotionValue = _umv, useTransform = _utr;',
            'const DynamicIcon = ({ name, ...props }) => {',
            '  const Comp = Lucide[name] || Lucide.HelpCircle || (() => null);',
            '  return React.createElement(typeof Comp === "function" ? Comp : () => null, props);',
            '};',
            transpiled,
        ].join('\n');

        // Return both compiled code AND the cleaned source string.
        // The main thread uses cleanCode to update element state so the next
        // compile pass skips re-sanitising already-clean code.
        (self as any).postMessage({ id, sandboxCode, cleanCode });

    } catch (err: any) {
        (self as any).postMessage({ id, error: err.message || 'Unknown compiler error' });
    }
};

// ── NO export {} HERE ────────────────────────────────────────────────────────
// An export statement switches TypeScript into ES module mode which causes
// "importScripts is not defined" at runtime in classic workers.
// The /// <reference lib="webworker" /> directive at the top of this file is
// the correct way to get WorkerGlobalScope types without using export {}.

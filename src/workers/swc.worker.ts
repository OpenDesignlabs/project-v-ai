// / <reference lib="webworker" />
// ── SWC COMPILER WORKER v0.2 ─────────────────────────────────────────────────
// New in v0.2:
//   • VALIDATE message: parse-only check (~5ms vs ~50ms full compile).
//     Used by RightSidebar Code tab for live feedback while the user types.
//   • COMPILE_MINIFIED message: full compile with minification (~35% smaller).
//     Used by Header ZIP export for smaller bundled output files.
//   • Parse errors now include line:col from SWC span data.

import init, { SwcCompiler } from '../../vectra-engine/pkg/vectra_engine.js';

let compiler: SwcCompiler | null = null;

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

// ── Helpers (unchanged from v0.1) ────────────────────────────────────────────
function stripImports(code: string): string {
    return code
        .replace(/^[ \t]*import\s+type?\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^[ \t]*import\s+[^\n{]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^[ \t]*import\s+['"][^'"]+['"];?\s*$/gm, '')
        .trim();
}

function shimExports(code: string): string {
    return code
        .replace(/export\s+default\s+function\s+(\w+)/, 'exports.default = function $1')
        .replace(/export\s+default\s+class\s+(\w+)/, 'exports.default = class $1')
        .replace(/export\s+default\s+/, 'exports.default = ')
        .replace(/\bexport\s+(const|let|var|function|class)\b/g, '$1');
}

function makeErrorComponent(msg: string): string {
    const escaped = msg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return [
        'exports.default = function SyntaxError() {',
        '  return React.createElement("div",',
        '    { style: { padding: 16, color: "#ef4444", background: "#fef2f2",',
        '        border: "1px solid #fecaca", borderRadius: 6, fontSize: 13, fontFamily: "monospace" } },',
        '    React.createElement("strong", null, "Compile Error: "),',
        `    "${escaped}"`,
        '  );',
        '}',
    ].join('\n');
}

// ── Message handler ───────────────────────────────────────────────────────────
self.onmessage = (e: MessageEvent) => {
    const { id, code, messageType } = e.data as {
        id: string;
        code: string;
        /** 'COMPILE' (default) | 'VALIDATE' | 'COMPILE_MINIFIED' */
        messageType?: string;
    };

    if (!code?.trim()) {
        self.postMessage({ id, code: '' });
        return;
    }

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

    // ── NEW v0.2: VALIDATE — syntax check only, no transform ─────────────────
    if (messageType === 'VALIDATE') {
        try {
            const error: string = compiler.validate_jsx(code);
            // "" = valid; "line:col — parse error" = invalid
            self.postMessage({ id, validationError: error });
        } catch (err) {
            self.postMessage({ id, validationError: String(err) });
        }
        return;
    }

    // ── NEW v0.2: COMPILE_MINIFIED — for ZIP export ───────────────────────────
    if (messageType === 'COMPILE_MINIFIED') {
        try {
            const clean      = stripImports(code);
            const transpiled = shimExports(compiler.compile_minified(clean));
            self.postMessage({ id, code: transpiled });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            self.postMessage({ id, code: makeErrorComponent(msg) });
        }
        return;
    }

    // ── Default: standard compile (unchanged from v0.1) ─────────────────────
    try {
        const clean      = stripImports(code);
        const transpiled = shimExports(compiler.compile(clean));
        self.postMessage({ id, code: transpiled });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        self.postMessage({ id, code: makeErrorComponent(msg) });
    }
};
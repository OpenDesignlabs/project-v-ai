/**
 * --- CODE SANITIZER ---------------------------------------------------------
 * Cleans AI-generated component code before it is compiled or embedded.
 * Strips disallowed import statements, normalises quote characters, and
 * validates code against a blocklist of browser-unsafe patterns (eval, fetch, etc.).
 * SANDBOX_BLOCKED_PATTERNS is re-exported for use in the compiler worker.
 */

// ENGINE v0.4: Rust sanitize_code (§13) handles all 6 stages.
// JS implementation kept as fallback — called if WASM not yet loaded.
const _getWasm = (): any => (window as any).vectraWasm ?? null;

/** Rust-accelerated code sanitizer. Falls back to JS. */
export const sanitizeCode = (code: string): string => {
    const wasm = _getWasm();
    if (wasm?.sanitize_code) {
        try { return wasm.sanitize_code(code) as string; } catch { /* fall through */ }
    }
    return sanitizeCode_JS(code);
};

/** Original JS implementation — fallback only. */
const sanitizeCode_JS = (code: string): string =>
    code
        // ── 1. Strip ES imports (3 safe line-anchored patterns) ────────────────
        // Named / typed:   import { Foo, type Bar } from '...'
        .replace(/^[ \t]*import\s+type?\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?\s*$/gm, '')
        // Default / namespace (always single-line):  import Foo from '...'
        .replace(/^[ \t]*import\s+[^\n{]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        // import '...'
        .replace(/^[ \t]*import\s+['"][^'"]+['"];?\s*$/gm, '')

        // ── 2. Normalise smart quotes & zero-width chars ────────────────────────
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/[\u200B-\u200D\uFEFF]/g, '')

        // ── 3. Fix static Icon JSX:  <Icon name="Star" />  →  <Lucide.Star />
        .replace(/<Icon\s*(?:=|name=|icon=|component=)["']([^"']+)["']/g, '<Lucide.$1')

        // ── 4. Fix dynamic bracket notation:  <Lucide[name]>  →  <DynamicIcon name={name}>
        //    (must run BEFORE the dot-notation pass to avoid double-matching)
        .replace(/<Lucide\[([^\]]+)\]/g, '<DynamicIcon name={$1}')
        .replace(/<\/Lucide\[[^\]]*\]>/g, '</DynamicIcon>')

        // ── 5. Fix dynamic prop syntax:  <Icon name={varName} />  →  <DynamicIcon name={varName} />
        .replace(/<Icon\s*(?:=|name=|icon=|component=)\{([^}]+)\}/g, '<DynamicIcon name={$1}')

        // ── 6. Remove orphaned </Icon> closing tags
        .replace(/<\/Icon>/g, '')

        .trim();

/**
 * Security patterns that are blocked in the sandbox.
 * Run on the RAW (pre-sanitize) code so every call-site has the same list.
 */
// ENGINE v0.4: Rust check_sandbox_violations (§13) — faster than JS RegExp find.
/** Returns the first violation name or '' if code is clean. */
export const checkSandboxViolations = (code: string): string => {
    const wasm = _getWasm();
    if (wasm?.check_sandbox_violations) {
        try { return wasm.check_sandbox_violations(code) as string; } catch { /* fall through */ }
    }
    // JS fallback: test each pattern, return the source string of the first match
    const hit = SANDBOX_BLOCKED_PATTERNS.find(p => p.test(code));
    return hit ? hit.source : '';
};

export const SANDBOX_BLOCKED_PATTERNS: RegExp[] = [
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
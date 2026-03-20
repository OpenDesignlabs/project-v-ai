/**
 * --- CODE SANITIZER ---------------------------------------------------------
 * Cleans AI-generated component code before it is compiled or embedded.
 * Strips disallowed import statements, normalises quote characters, and
 * validates code against a blocklist of browser-unsafe patterns (eval, fetch, etc.).
 * SANDBOX_BLOCKED_PATTERNS is re-exported for use in the compiler worker.
 */

export const sanitizeCode = (code: string): string =>
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

import { FileCode } from 'lucide-react';
import type { ComponentConfig, ComponentCategory, ComponentImportMeta } from '../../types';

// ─── NAME DETECTION ───────────────────────────────────────────────────────────
// Ordered by specificity — most explicit pattern first.
// The first match wins. Fallback to filename, then 'CustomComponent'.
const NAME_PATTERNS = [
    /export\s+default\s+function\s+(\w+)/,
    /export\s+const\s+(\w+)\s*=/,
    /export\s+function\s+(\w+)/,
    /function\s+(\w+)\s*\(/,
    /const\s+(\w+)\s*=\s*\(/,
] as const;

/**
 * detectComponentName
 * ────────────────────
 * Extracts the exported component name from source code.
 * Filename is used as a fallback when no pattern matches.
 */
const detectComponentName = (code: string, filename?: string): string => {
    for (const pattern of NAME_PATTERNS) {
        const match = code.match(pattern);
        if (match?.[1]) return match[1];
    }
    if (filename) {
        const cleaned = filename.split('.')[0].replace(/[^a-zA-Z0-9]/g, '');
        if (cleaned) return cleaned;
    }
    return 'CustomComponent';
};

/**
 * detectDefaultExport
 * ────────────────────
 * Returns true if the code uses a default export.
 * Drives importMeta.isDefault → correct import statement on export/publish:
 *   true  → import MyButton from './components/MyButton'
 *   false → import { MyButton } from './components/MyButton'
 */
const detectDefaultExport = (code: string): boolean =>
    /export\s+default\s+function\s+\w+/.test(code) ||
    /export\s+default\s+class\s+\w+/.test(code) ||
    /export\s+default\s+\(/.test(code) ||
    /export\s+default\s+\w+\s*;?\s*$/.test(code.trim());

/**
 * processImportedCode
 * ────────────────────
 * Converts raw React source into a ComponentConfig ready for registerComponent().
 *
 * PHASE-C-1 [PERMANENT]:
 *   Sets ComponentConfig.code  → Phase B routing in RenderNode renders via
 *   LiveComponent (the Babel worker compile path). No DOM access needed.
 *   Sets ComponentConfig.importMeta → CIS-1 stamps importMeta onto the VectraNode
 *   at drop time. codeGenerator reads it to emit the correct import statement.
 *
 *   NEVER store component source in defaultProps['data-custom-code'].
 *   That approach predates Phase A/B and is permanently dead.
 *
 * Import path convention:
 *   './components/{Name}' — correct for both Next.js and Vite project layouts.
 */
export const processImportedCode = (code: string, filename?: string): ComponentConfig => {
    const detectedName = detectComponentName(code, filename);
    const isDefault = detectDefaultExport(code);

    // CIS-1: import identity — drives all export paths
    const importMeta: ComponentImportMeta = {
        packageName: `./components/${detectedName}`,
        exportName: detectedName,
        isDefault,
    };

    return {
        label: detectedName,
        icon: FileCode,
        category: 'basic' as ComponentCategory,

        // Phase B: code → LiveComponent compiles + renders on canvas.
        // RenderNode routing: importMeta ✅ + !element.code ✅ + conf.code ✅ → fires.
        code,

        // CIS-1: stamped onto every VectraNode created from this config at drop time.
        importMeta,

        defaultProps: {
            style: {
                position: 'absolute' as const,
                width: '320px',
                height: '200px',
            },
        },
    };
};

/**
 * Read file content as text.
 * Unchanged from original.
 */
export const readFileContent = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });

/**
 * Validate if code looks like a React component.
 * Unchanged from original.
 */
export const isValidReactComponent = (code: string): boolean => {
    const hasReactImport = /import\s+.*from\s+['"]react['"]/.test(code);
    const hasJSX = /<[A-Za-z]/.test(code);
    const hasExport = /export\s+/.test(code);
    return hasJSX || (hasReactImport && hasExport);
};

/**
 * Generate a unique component registry ID from a display name.
 *
 * PHASE-C-2 [PERMANENT]: crypto.randomUUID() replaces Date.now().toString(36).
 * Date.now() collides when two components are imported in the same millisecond.
 * crypto.randomUUID() is collision-proof and consistent with the project-wide
 * ID generation standard (M-1, M-5, NH-3).
 */
export const generateComponentId = (name: string): string => {
    const baseId = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return `custom-${baseId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
};

/**
 * DetectionPreview — shape returned by getDetectionPreview().
 * Used by ImportModal to show what Vectra will derive before the user commits.
 *
 * PHASE-C-3 [PERMANENT]: this is the single source of truth for name detection.
 * ImportModal, LeftSidebar, InsertDrawer must derive from processImportedCode /
 * getDetectionPreview — never re-implement detection logic independently.
 */
export interface DetectionPreview {
    name: string;
    isDefault: boolean;
    importStatement: string;
    importPath: string;
}

/**
 * getDetectionPreview
 * ────────────────────
 * Derives component name, export type, and import statement string from raw
 * source code. Used by ImportModal for a live preview before the user imports.
 *
 * @returns DetectionPreview or null when code is empty / unparseable.
 */
export const getDetectionPreview = (
    code: string,
    filename?: string
): DetectionPreview | null => {
    if (!code.trim()) return null;
    const name = detectComponentName(code, filename);
    const isDefault = detectDefaultExport(code);
    const importPath = `./components/${name}`;
    const importStatement = isDefault
        ? `import ${name} from '${importPath}'`
        : `import { ${name} } from '${importPath}'`;
    return { name, isDefault, importStatement, importPath };
};

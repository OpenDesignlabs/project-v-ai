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

// Extracts the exported component name from source code. Falls back to filename, then 'CustomComponent'.
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

// Returns true if the source code uses a default export. Drives importMeta.isDefault for correct import statement generation.
const detectDefaultExport = (code: string): boolean =>
    /export\s+default\s+function\s+\w+/.test(code) ||
    /export\s+default\s+class\s+\w+/.test(code) ||
    /export\s+default\s+\(/.test(code) ||
    /export\s+default\s+\w+\s*;?\s*$/.test(code.trim());

// Converts raw React source into a ComponentConfig ready for registerComponent().
// Sets code (for LiveComponent compile path) and importMeta (for CIS-1 identity stamping at drop time).
export const processImportedCode = (code: string, filename?: string): ComponentConfig => {
    const detectedName = detectComponentName(code, filename);
    const isDefault = detectDefaultExport(code);

    // import identity — drives all export paths
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

        // stamped onto every VectraNode created from this config at drop time.
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

/** Reads a File's text content as a Promise. */
export const readFileContent = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });

/** Returns true if the code looks like a valid React component (has JSX or a React import + export). */
export const isValidReactComponent = (code: string): boolean => {
    const hasReactImport = /import\s+.*from\s+['"]react['"]/.test(code);
    const hasJSX = /<[A-Za-z]/.test(code);
    const hasExport = /export\s+/.test(code);
    return hasJSX || (hasReactImport && hasExport);
};

// Generates a collision-proof registry ID using crypto.randomUUID() rather than Date.now().
export const generateComponentId = (name: string): string => {
    const baseId = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return `custom-${baseId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
};

/** Shape returned by getDetectionPreview() — shown in ImportModal before the user commits. */
export interface DetectionPreview {
    name: string;
    isDefault: boolean;
    importStatement: string;
    importPath: string;
}

// Returns a live detection preview (name, import statement) from raw source code. Used by ImportModal before import is committed.
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

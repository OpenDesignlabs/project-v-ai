import { FileCode } from 'lucide-react';
import type { ComponentConfig, ComponentCategory } from '../types';

/**
 * Process imported code and generate a ComponentConfig
 * Auto-detects component name from code using regex patterns
 */
export const processImportedCode = (code: string, filename?: string): ComponentConfig => {
    // 1. Auto-Detect Name (e.g., "export const MyButton = ..." or "export default function Header()")
    const namePatterns = [
        /export\s+default\s+function\s+(\w+)/,
        /export\s+const\s+(\w+)\s*=/,
        /export\s+function\s+(\w+)/,
        /function\s+(\w+)\s*\(/,
        /const\s+(\w+)\s*=\s*\(/
    ];

    let detectedName = 'CustomComponent';

    for (const pattern of namePatterns) {
        const match = code.match(pattern);
        if (match && match[1]) {
            detectedName = match[1];
            break;
        }
    }

    // Fallback to filename if no match
    if (detectedName === 'CustomComponent' && filename) {
        detectedName = filename.split('.')[0].replace(/[^a-zA-Z0-9]/g, '');
    }

    // 2. Generate Config
    return {
        label: detectedName,
        icon: FileCode, // Generic Icon for imported code
        category: 'basic' as ComponentCategory, // Put in basic for now
        defaultContent: `<${detectedName} />`,
        defaultProps: {
            className: 'w-full h-auto min-h-[50px] p-4 border-2 border-dashed border-blue-400 bg-blue-50/50 rounded-lg flex items-center justify-center text-blue-600 text-sm font-mono',
            // CRITICAL: We store the raw code here. 
            // The renderer will use this to display a placeholder
            'data-custom-code': code,
            'data-component-name': detectedName,
            style: {
                position: 'absolute',
                width: '200px',
                height: '100px'
            }
        }
    };
};

/**
 * Read file content as text
 */
export const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
};

/**
 * Validate if code looks like a React component
 */
export const isValidReactComponent = (code: string): boolean => {
    const hasReactImport = /import\s+.*from\s+['"]react['"]/.test(code);
    const hasJSX = /<[A-Za-z]/.test(code);
    const hasExport = /export\s+/.test(code);

    return hasJSX || (hasReactImport && hasExport);
};

/**
 * Generate a unique component ID from name
 */
export const generateComponentId = (name: string): string => {
    const baseId = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return `custom-${baseId}-${Date.now().toString(36)}`;
};

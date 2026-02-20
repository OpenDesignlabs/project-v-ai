import type { VectraProject } from '../types';

export const sanitizeFilename = (name: string) => {
    // Removes spaces/symbols and ensures PascalCase
    return name.replace(/[^a-zA-Z0-9]/g, '') || 'Component';
};

export const generateAppTsx = (project: VectraProject, pageId: string = 'page-home') => {
    const page = project[pageId];
    if (!page || !page.children) return '';

    const childrenIds = page.children;
    const imports: string[] = [];
    const jsxElements: string[] = [];

    childrenIds.forEach(id => {
        const node = project[id];
        if (!node) return;

        const componentName = sanitizeFilename(node.name);
        // Avoid duplicate imports if multiple instances of same component type
        // (For MVP we assume unique names or 1:1 mapping for simplicity)
        // In prod, you'd check a Set of imports.
        imports.push(`import ${componentName} from './components/${componentName}';`);
        jsxElements.push(`<${componentName} />`);
    });

    // Deduplicate imports
    const uniqueImports = Array.from(new Set(imports)).join('\n');

    return `
import React from 'react';
${uniqueImports}

export default function App() {
  return (
    <div className="min-h-screen bg-white">
       {/* VECTRA_INJECTION_POINT */}
       ${jsxElements.join('\n       ')}
    </div>
  )
}
`;
};

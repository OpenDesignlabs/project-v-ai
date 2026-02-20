import React, { useMemo } from 'react';
import * as Babel from '@babel/standalone';
import * as LucideIcons from 'lucide-react';

interface CodeRendererProps {
    code: string;
}

/**
 * CodeRenderer - Live compiles and renders React/JSX/TSX code
 * Uses Rust/SWC (Priority 5) with Babel fallback for transpilation
 */
export const CodeRenderer: React.FC<CodeRendererProps> = ({ code }) => {
    const Component = useMemo(() => {
        if (!code) return null;

        try {
            // 1. PRE-PROCESS: Clean Imports (Standard JS String ops are fine here)
            // We strip imports because the browser runtime (new Function) doesn't support them.
            let functionalCode = code
                .replace(/import\s+.*?from\s+['"][^'"]+['"];?/g, '')
                .replace(/import\s+['"][^'"]+['"];?/g, '')
                .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/g, '')
                .replace(/import\s+type\s+.*?;/g, '')
                .trim();

            // 2. PRE-PROCESS: Handle Exports
            // Convert "export default function" to "const Component =" logic so we can return it.
            if (/export\s+default\s+function\s+(\w+)/.test(functionalCode)) {
                functionalCode = functionalCode.replace(/export\s+default\s+function\s+(\w+)/, 'function $1');
                const match = code.match(/export\s+default\s+function\s+(\w+)/);
                if (match) functionalCode += `; return ${match[1]};`;
            } else if (/export\s+default\s+\(/.test(functionalCode)) {
                functionalCode = functionalCode.replace('export default', 'const DefaultComponent =');
                functionalCode += '; return DefaultComponent;';
            } else if (/export\s+default\s+(\w+)\s*;?$/.test(functionalCode)) {
                const match = functionalCode.match(/export\s+default\s+(\w+)\s*;?$/);
                if (match) {
                    functionalCode = functionalCode.replace(/export\s+default\s+\w+\s*;?$/, '');
                    functionalCode += `; return ${match[1]};`;
                }
            } else if (/export\s*\{/.test(functionalCode)) {
                const exportMatch = functionalCode.match(/export\s*\{\s*(\w+)/);
                functionalCode = functionalCode.replace(/export\s*\{[^}]*\}\s*;?/, '');
                if (exportMatch) {
                    functionalCode += `; return ${exportMatch[1]};`;
                }
            } else if (/export\s+const\s+(\w+)\s*=/.test(functionalCode)) {
                const match = functionalCode.match(/export\s+const\s+(\w+)\s*=/);
                functionalCode = functionalCode.replace('export const', 'const');
                if (match) {
                    functionalCode += `; return ${match[1]};`;
                }
            } else if (/export\s+function\s+(\w+)/.test(functionalCode)) {
                const match = functionalCode.match(/export\s+function\s+(\w+)/);
                functionalCode = functionalCode.replace('export function', 'function');
                if (match) {
                    functionalCode += `; return ${match[1]};`;
                }
            } else {
                // Fallback: Try to find any function definition
                const funcMatch = functionalCode.match(/function\s+(\w+)\s*\(/);
                const constMatch = functionalCode.match(/const\s+(\w+)\s*=\s*\(/);
                const name = funcMatch?.[1] || constMatch?.[1];
                if (name) {
                    functionalCode += `; return ${name};`;
                }
            }

            // 3. TRANSPILE (THE HEAVY LIFTING)
            let transpiledCode = "";

            if ((window as any).vectraWasm?.compile_component) {
                // --- RUST PATH (SWC) ---
                // Uses WASM to strip types and convert JSX -> JS. Extremely fast (20-70x faster than Babel).
                try {
                    transpiledCode = (window as any).vectraWasm.compile_component(functionalCode);
                    console.log("Live compiler: Rust/SWC path used");
                } catch (e) {
                    console.warn("Rust compilation failed, falling back to Babel", e);
                    // Fallback to Babel if Rust panics or fails
                    transpiledCode = Babel.transform(functionalCode, {
                        presets: ['react', 'env', 'typescript'],
                        filename: 'file.tsx'
                    }).code || '';
                }
            } else {
                // --- LEGACY PATH (Babel) ---
                transpiledCode = Babel.transform(functionalCode, {
                    presets: ['react', 'env', 'typescript'],
                    filename: 'file.tsx'
                }).code || '';
            }

            if (!transpiledCode) throw new Error('Compilation failed');

            // 4. EXECUTE
            const func = new Function(
                'React', 'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'lucide',
                transpiledCode
            );

            const Result = func(
                React, React.useState, React.useEffect, React.useMemo, React.useCallback, React.useRef, LucideIcons
            );

            return Result;

        } catch (err) {
            console.error("Component Compilation Error:", err);
            return () => (
                <div className="w-full h-full min-h-[80px] flex flex-col items-center justify-center p-3 bg-red-50 border-2 border-dashed border-red-300 rounded-lg">
                    <div className="w-8 h-8 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    </div>
                    <span className="text-xs font-bold text-red-600 mb-1">Render Error</span>
                    <span className="text-[9px] text-red-500 text-center leading-tight max-w-full overflow-hidden px-2">
                        {err instanceof Error ? err.message.slice(0, 80) : 'Unknown error'}
                    </span>
                </div>
            );
        }
    }, [code]);

    if (!Component) {
        return (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                No component
            </div>
        );
    }

    // Render the compiled component with error boundary wrapper
    try {
        return <Component />;
    } catch (renderErr) {
        console.error("Runtime render error:", renderErr);
        return (
            <div className="w-full h-full flex items-center justify-center p-2 bg-amber-50 border border-amber-200 rounded text-amber-600 text-xs">
                Runtime error
            </div>
        );
    }
};

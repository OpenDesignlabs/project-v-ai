import React, { useState } from 'react';
import { useEditor } from '../context/EditorContext';
import { processImportedCode, readFileContent, isValidReactComponent, generateComponentId } from '../utils/importHelpers';
import { X, Upload, FileText, Code, Check, AlertCircle } from 'lucide-react';

interface ImportModalProps {
    onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ onClose }) => {
    const { registerComponent } = useEditor();
    const [mode, setMode] = useState<'upload' | 'paste'>('upload');
    const [code, setCode] = useState('');
    const [fileName, setFileName] = useState('');
    const [isSuccess, setIsSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const content = await readFileContent(file);
                setCode(content);
                setFileName(file.name);
                setError(null);
            } catch {
                setError('Failed to read file');
            }
        }
    };

    const handleImport = () => {
        if (!code.trim()) {
            setError('Please provide some code to import');
            return;
        }

        // Validate
        if (!isValidReactComponent(code)) {
            setError('This doesn\'t look like a valid React component. Make sure it has JSX and an export.');
            return;
        }

        try {
            // Process the code
            const config = processImportedCode(code, fileName);
            const id = generateComponentId(config.label);

            // Register to Global Context
            registerComponent(id, config);

            console.log(`✅ Imported component: ${config.label} (id: ${id})`);

            setIsSuccess(true);
            setError(null);

            setTimeout(() => {
                setIsSuccess(false);
                onClose();
            }, 1200);
        } catch (err) {
            setError('Failed to import component. Please check your code.');
        }
    };

    // Close on backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div className="bg-white w-[540px] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white">
                            <Code size={16} />
                        </div>
                        Import Component
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex p-2 gap-2 bg-slate-50 border-b border-slate-100">
                    <button
                        onClick={() => { setMode('upload'); setError(null); }}
                        className={`flex-1 py-2.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${mode === 'upload'
                                ? 'bg-white shadow-sm text-blue-600 ring-1 ring-slate-200'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                    >
                        <Upload size={14} /> Upload File
                    </button>
                    <button
                        onClick={() => { setMode('paste'); setError(null); }}
                        className={`flex-1 py-2.5 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${mode === 'paste'
                                ? 'bg-white shadow-sm text-blue-600 ring-1 ring-slate-200'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                    >
                        <FileText size={14} /> Paste Code
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {mode === 'upload' ? (
                        <div className="border-2 border-dashed border-slate-300 rounded-xl p-10 flex flex-col items-center justify-center gap-4 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer relative group">
                            <input
                                type="file"
                                accept=".tsx,.jsx,.js,.ts"
                                onChange={handleFileChange}
                                className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                            <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Upload size={28} />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-slate-700">
                                    {fileName || 'Click to Upload'}
                                </p>
                                <p className="text-xs text-slate-400 mt-1">
                                    Supports .tsx, .jsx, .js, .ts files
                                </p>
                            </div>
                            {fileName && (
                                <div className="mt-2 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-xs font-medium flex items-center gap-1.5">
                                    <Check size={12} /> {fileName}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <textarea
                                value={code}
                                onChange={(e) => { setCode(e.target.value); setError(null); }}
                                placeholder={`// Paste your React component code here...\n\nexport const MyComponent = () => {\n  return (\n    <div className="p-4">\n      Hello World\n    </div>\n  );\n};`}
                                className="w-full h-56 p-4 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder:text-slate-500"
                                spellCheck={false}
                            />
                            <p className="text-[10px] text-slate-400">
                                Paste code from shadcn/ui, 21st.dev, or any React component library.
                            </p>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-xs text-red-600">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                    <p className="text-[10px] text-slate-400">
                        Imported components appear in the Insert panel
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleImport}
                            disabled={!code || isSuccess}
                            className={`px-6 py-2.5 text-xs font-bold text-white rounded-lg flex items-center gap-2 transition-all ${isSuccess
                                    ? 'bg-green-500'
                                    : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/25'
                                }`}
                        >
                            {isSuccess ? (
                                <>
                                    <Check size={14} />
                                    Imported!
                                </>
                            ) : (
                                'Import Component'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

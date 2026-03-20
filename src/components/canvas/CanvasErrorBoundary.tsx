/**
 * ─── CANVAS ERROR BOUNDARY ─────────────────────────────────────────────────────
 *
 * Catches runtime errors thrown inside the canvas artboard (RenderNode tree,
 * custom_code components, CodeRenderer). Without this, a single bad component
 * unmounts the entire editor and the user loses unsaved work.
 *
 * WHAT IS CAUGHT
 * ──────────────
 * • JavaScript errors thrown during React render (inside return statements)
 * • Errors in lifecycle methods of class components inside the canvas
 * • Errors from dynamic code evaluation in CodeRenderer
 *
 * WHAT IS NOT CAUGHT (React limitation)
 * ──────────────────────────────────────
 * • Errors in event handlers (those propagate normally — use try/catch inside them)
 * • Errors in async code (setTimeout, fetch callbacks)
 * • Errors in the error boundary itself
 *
 * RECOVERY PATHS
 * ──────────────
 * 1. "Dismiss" — resets the boundary. Safe if the bad component is no longer
 *    selected / the error was transient.
 * 2. "Undo last change" — calls onUndo() (wired to history.undo in Canvas.tsx)
 *    then resets the boundary. Correct path if the error was caused by the last
 *    edit (e.g., AI-generated code that crashes on render).
 *
 * DESIGN
 * ──────
 * VS Code dark theme to match the editor shell. Stack trace is collapsed by
 * default (details element) — it is noise for most users but available for
 * developers debugging custom components.
 */

import React from 'react';

interface Props {
    children: React.ReactNode;
    /** Called when the user clicks "Undo last change". Wired to history.undo. */
    onUndo?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: React.ErrorInfo | null;
}

export class CanvasErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        this.setState({ errorInfo });
        console.error('[Vectra] Canvas render error caught by ErrorBoundary:', error, errorInfo);
    }

    handleDismiss = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    handleUndo = () => {
        this.props.onUndo?.();
        // Small delay so undo state propagates before boundary resets
        setTimeout(() => {
            this.setState({ hasError: false, error: null, errorInfo: null });
        }, 50);
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        const { error, errorInfo } = this.state;
        const message = error?.message || 'Unknown render error';
        const stack = errorInfo?.componentStack || error?.stack || '';

        return (
            <div
                className="flex-1 flex items-center justify-center bg-[#1e1e1e]"
                style={{ minHeight: '400px' }}
            >
                <div className="max-w-lg w-full mx-4 bg-[#252526] border border-[#f14c4c]/30 rounded-xl overflow-hidden shadow-2xl">

                    {/* Header */}
                    <div className="flex items-center gap-3 px-5 py-3 border-b border-[#333] bg-[#2d2d2d]">
                        <div className="w-3 h-3 rounded-full bg-[#f14c4c]" />
                        <span className="text-[#f14c4c] text-xs font-bold uppercase tracking-widest">
                            Canvas Render Error
                        </span>
                    </div>

                    {/* Body */}
                    <div className="p-5 space-y-4">
                        {/* Error message */}
                        <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-3">
                            <p className="text-[10px] text-[#858585] font-bold uppercase tracking-wider mb-1">
                                Error
                            </p>
                            <p className="text-[#f14c4c] text-sm font-mono leading-relaxed break-all">
                                {message}
                            </p>
                        </div>

                        {/* Stack trace — collapsed */}
                        {stack && (
                            <details className="group">
                                <summary className="text-[10px] text-[#858585] cursor-pointer hover:text-[#cccccc] transition-colors select-none list-none flex items-center gap-1.5">
                                    <svg
                                        className="w-3 h-3 transition-transform group-open:rotate-90"
                                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    Component stack trace
                                </summary>
                                <pre className="mt-2 text-[9px] text-[#666] font-mono leading-relaxed whitespace-pre-wrap break-all bg-[#1a1a1a] p-3 rounded-lg border border-[#2a2a2a] max-h-32 overflow-y-auto">
                                    {stack}
                                </pre>
                            </details>
                        )}

                        {/* Hint */}
                        <p className="text-[10px] text-[#555] leading-relaxed">
                            This error is contained to the canvas — your project data is safe.
                            Use "Undo last change" if a recent edit caused this crash.
                        </p>

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={this.handleUndo}
                                className="flex-1 py-2 bg-[#007acc]/10 hover:bg-[#007acc]/20 border border-[#007acc]/30 hover:border-[#007acc]/50 text-[#007acc] text-xs font-bold rounded-lg transition-all"
                            >
                                ↩ Undo last change
                            </button>
                            <button
                                onClick={this.handleDismiss}
                                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-[#858585] hover:text-white text-xs font-bold rounded-lg transition-all"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

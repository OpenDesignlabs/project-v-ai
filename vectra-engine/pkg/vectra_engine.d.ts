/* tslint:disable */
/* eslint-disable */

export class HistoryManager {
    free(): void;
    [Symbol.dispose](): void;
    can_redo(): boolean;
    can_undo(): boolean;
    /**
     * Diagnostic: total bytes of compressed data currently held in memory.
     * In a browser devtools console: `wasmModule.historyManager.get_memory_usage()`
     */
    get_memory_usage(): number;
    constructor(initial: string);
    /**
     * Compress and push a new snapshot.  Truncates the redo stack first.
     */
    push_state(state: string): void;
    /**
     * Step one entry forward and return the decompressed JSON string.
     */
    redo(): string | undefined;
    /**
     * Step one entry back and return the decompressed JSON string.
     */
    undo(): string | undefined;
}

export class LayoutEngine {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    /**
     * Fast snap query — only 5 scalar args cross the Wasm boundary.
     * Phase 9: resolves only rects in nearby grid cells (O(k²) cells,
     * typically 1–4 cells for threshold=5px and cell_size=100px).
     */
    query_snapping(current_x: number, current_y: number, width: number, height: number, threshold: number): any;
    /**
     * Push sibling rects into Wasm memory and rebuild the spatial hash.
     * Call ONCE on drag-start (pointer-down). O(N) serde + O(N×k) grid cost,
     * where k = number of cells each rect occupies (usually 1–4).
     */
    update_rects(rects_val: any): void;
}

export class SwcCompiler {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Compile TSX/JSX source → plain JS (React.createElement calls).
     * Creates a fresh Globals per call to avoid WASM mutex re-entrancy panics.
     */
    compile(code: string): string;
    constructor();
}

/**
 * Convert a set of absolutely-positioned canvas nodes into a CSS Grid layout.
 *
 * # Arguments
 * * `nodes_json`    — JSON-encoded `Vec<GridInputNode>`. All coordinates must
 *                     be plain numbers (no "px" suffix). The TypeScript caller
 *                     is responsible for stripping units before serializing.
 * * `canvas_width`  — Pixel width of the parent canvas frame. Currently unused
 *                     in track-size computation (tracks use px, not fr), but
 *                     passed for future fr-unit conversion support.
 *
 * # Returns
 * JSON-encoded `GridLayout` on success, or a `JsValue` error string on failure.
 *
 * # CSS Line Numbering
 * CSS Grid is 1-based. Array index 0 in `x_breaks` = CSS line 1.
 * `col_start = find_coord_idx(x_breaks, node.x) + 1`
 * `col_end   = find_coord_idx(x_breaks, node.x + node.w) + 1`
 * The end index is already the exclusive boundary because `node.x + node.w`
 * maps to the line AFTER the last occupied track — adding another +1 would
 * be wrong and produce a one-track-too-wide result.
 */
export function absolute_to_grid(nodes_json: string, _canvas_width: number): string;

/**
 * Free-function shim kept for backward compatibility while callers migrate
 * to the `SwcCompiler` struct. Delegates to a temporary instance.
 * DEPRECATED: Prefer `new SwcCompiler().compile(code)` in TypeScript.
 */
export function compile_component(code: string): string;

export function generate_react_code(project_val: any, root_id: string): string;

export function main_js(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_historymanager_free: (a: number, b: number) => void;
    readonly __wbg_layoutengine_free: (a: number, b: number) => void;
    readonly __wbg_swccompiler_free: (a: number, b: number) => void;
    readonly absolute_to_grid: (a: number, b: number, c: number) => [number, number, number, number];
    readonly compile_component: (a: number, b: number) => [number, number, number, number];
    readonly generate_react_code: (a: any, b: number, c: number) => [number, number, number, number];
    readonly historymanager_can_redo: (a: number) => number;
    readonly historymanager_can_undo: (a: number) => number;
    readonly historymanager_get_memory_usage: (a: number) => number;
    readonly historymanager_new: (a: number, b: number) => number;
    readonly historymanager_push_state: (a: number, b: number, c: number) => void;
    readonly historymanager_redo: (a: number) => [number, number];
    readonly historymanager_undo: (a: number) => [number, number];
    readonly layoutengine_new: () => number;
    readonly layoutengine_query_snapping: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly layoutengine_update_rects: (a: number, b: any) => [number, number];
    readonly main_js: () => void;
    readonly swccompiler_compile: (a: number, b: number, c: number) => [number, number, number, number];
    readonly swccompiler_new: () => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

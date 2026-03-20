/**
 * --- VECTRA LOADER BRIDGE ---------------------------------------------------
 * Provides the dynamic component loading system for externally registered
 * components. Fetches remote component bundles (ESM) at runtime, evaluates
 * them in a sandboxed scope, and makes them available in the editor canvas
 * as draggable elements alongside built-in types.
 */

import { FileCode } from 'lucide-react';
import type { ComponentConfig, ComponentImportMeta, ComponentCategory } from '../types';

// ─── PROTOCOL CONSTANTS ───────────────────────────────────────────────────────

/** Path the @vectra/loader plugin must serve. Never change — it's the contract. */
export const LOADER_ENDPOINT = '/__vectra/components.json';

/** localStorage key for the persisted baseUrl. */
export const LOADER_URL_KEY = 'vectra_loader_url';

// ─── MANIFEST TYPES ───────────────────────────────────────────────────────────

/**
 * PropSchema describes a single prop for the Vectra property panel.
 * Future: RightSidebar reads this to render correct controls per prop.
 */
export interface VectraLoaderPropSchema {
    type: 'string' | 'number' | 'boolean' | 'select' | 'color';
    control?: 'text' | 'textarea' | 'slider' | 'toggle' | 'select' | 'color';
    default?: unknown;
    options?: string[];  // for 'select' type
    min?: number;        // for 'number' + 'slider'
    max?: number;
    step?: number;
}

/** One component entry in the manifest. */
export interface VectraLoaderEntry {
    /** Stable identifier — used as VectraNode.type and registry key. */
    id: string;
    /** Human-readable label shown in the Insert panel. */
    label: string;
    /** Insert panel category. */
    category?: ComponentCategory;
    /**
     * Import identity — drives export path in generated code.
     * Must match the actual import in the developer's codebase.
     */
    importMeta: ComponentImportMeta;
    /**
     * Source code of the component as a string.
     * Must be self-contained JSX/TSX with NO import statements.
     * The @vectra/loader plugin resolves imports, strips them, and
     * relies on Vectra's sandbox globals (React, motion, Lucide, cn).
     */
    code: string;
    /** Default props when the component is dropped onto the canvas. */
    defaultProps?: Record<string, unknown>;
    /** Prop schema for the property panel (optional — future use). */
    propSchema?: Record<string, VectraLoaderPropSchema>;
}

/** Root manifest structure. */
export interface VectraLoaderManifest {
    /** Protocol version — must be "1". */
    version: '1';
    components: VectraLoaderEntry[];
}

// ─── FETCH ────────────────────────────────────────────────────────────────────

/**
 * fetchLoaderManifest
 * ────────────────────
 * Fetches the manifest from the developer's local dev server.
 *
 * @param baseUrl  e.g. "http://localhost:3000" — no trailing slash
 * @returns        Parsed manifest or null on any error
 * @throws         Never — all errors are caught and returned as null
 *
 * Error cases handled:
 *   - Network failure (dev server not running) → null
 *   - Non-200 response (plugin not installed, wrong URL) → null
 *   - Missing CORS headers (browser blocks response) → null
 *   - Invalid JSON or wrong manifest version → null
 */
export async function fetchLoaderManifest(
    baseUrl: string
): Promise<VectraLoaderManifest | null> {
    try {
        const url = `${baseUrl.replace(/\/$/, '')}${LOADER_ENDPOINT}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
            console.warn(`[VectraLoader] ${url} returned ${res.status}`);
            return null;
        }

        const json = await res.json();

        // Validate minimal shape
        if (!json || json.version !== '1' || !Array.isArray(json.components)) {
            console.warn('[VectraLoader] Invalid manifest shape:', json);
            return null;
        }

        return json as VectraLoaderManifest;
    } catch (err) {
        // TypeError: Failed to fetch → CORS block or server down
        console.warn('[VectraLoader] Fetch failed:', err);
        return null;
    }
}

// ─── ENTRY → COMPONENT CONFIG ─────────────────────────────────────────────────

/**
 * manifestEntryToConfig
 * ──────────────────────
 * Converts a VectraLoaderEntry from the manifest into a ComponentConfig
 * ready to pass to registerComponent().
 *
 * Key decisions:
 *   - component field is NOT set — no runtime ref is available over HTTP.
 *     The canvas renders via the LiveComponent compiler path using `code`.
 *   - code is forwarded as ComponentConfig.code — Phase B routing in RenderNode.
 *   - importMeta is forwarded verbatim — CIS-1 stamps it at drop time.
 *   - defaultProps gets position:absolute + safe size defaults if missing.
 */
export function manifestEntryToConfig(entry: VectraLoaderEntry): ComponentConfig {
    const defaultStyle = {
        position: 'absolute' as const,
        width: '240px',
        height: '120px',
        ...(entry.defaultProps?.style as object ?? {}),
    };

    return {
        label: entry.label,
        icon: FileCode,
        category: entry.category ?? 'basic',
        importMeta: entry.importMeta,
        code: entry.code,
        // component is intentionally absent — loader components render via code.
        defaultProps: {
            ...(entry.defaultProps ?? {}),
            style: defaultStyle,
        },
    };
}

// ─── CONTROL RESOLUTION ───────────────────────────────────────────────────────

/**
 * resolveControlType
 * ───────────────────
 * Maps a VectraLoaderPropSchema entry to a canonical control type string
 * the RightSidebar PropSchemaEditor renders.
 *
 * Rule precedence:
 *   1. Explicit `control` field on schema → use verbatim
 *   2. type === 'boolean'  → 'toggle'
 *   3. type === 'select'   → 'select'
 *   4. type === 'color'    → 'color'
 *   5. type === 'number' + min/max defined → 'slider'
 *   6. type === 'number'   → 'number'
 *   7. Fallback            → 'text'
 */
export function resolveControlType(
    schema: VectraLoaderPropSchema
): 'text' | 'textarea' | 'number' | 'slider' | 'toggle' | 'select' | 'color' {
    if (schema.control) return schema.control;
    if (schema.type === 'boolean') return 'toggle';
    if (schema.type === 'select') return 'select';
    if (schema.type === 'color') return 'color';
    if (schema.type === 'number') return (schema.min !== undefined && schema.max !== undefined) ? 'slider' : 'number';
    return 'text';
}

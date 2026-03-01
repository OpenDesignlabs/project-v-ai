/**
 * ─── Async IndexedDB Persistence Layer ────────────────────────────────────────
 *
 * Replaces synchronous localStorage.setItem() which blocks the main thread for
 * ~2–8ms on every save tick, causing visible "hiccups" on large projects.
 *
 * WHY INDEXEDDB OVER LOCALSTORAGE?
 * ─────────────────────────────────
 * • localStorage.setItem() is SYNCHRONOUS — it holds the main thread until the
 *   OS finishes writing. On a large project (100+ nodes) this is 2–10ms of
 *   jank every autosave tick.
 * • IndexedDB writes are fully async and happen on a background I/O thread.
 *   The JS call returns immediately; the browser handles the write off-thread.
 * • IndexedDB has no 5MB cap (localStorage limit). Projects can grow freely.
 *
 * FALLBACK STRATEGY (implemented in ProjectContext)
 * ──────────────────────────────────────────────────
 * localStorage is still written as a fast-read bootstrap cache.
 * On the next page load, localStorage is read synchronously for an instant,
 * zero-flicker start. IndexedDB is then checked async for a more recent save.
 * If IDB has newer data, state is upgraded silently.
 *
 * This gives us the best of both worlds:
 *   • Instant first paint (localStorage)
 *   • No save jank (IndexedDB async write)
 *   • No data loss (both stores written per tick)
 */

const DB_NAME = 'vectra_db_v1';
const STORE_NAME = 'projects';
const DB_VERSION = 1;

// M-2 FIX: module-level singleton — one connection for the page lifetime.
// Previously every call opened + closed a fresh IDB connection at 3-4×/second
// during autosave. Opening IDB has non-trivial OS I/O overhead.
let _db: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

/** Returns the shared IDB connection, booting it once then reusing it. */
const getDB = (): Promise<IDBDatabase> => {
    if (_db) return Promise.resolve(_db);
    if (_dbPromise) return _dbPromise;
    _dbPromise = openDB().then(db => {
        _db = db;
        // Reset singleton on unexpected close or version bump so the next
        // caller transparently reopens a fresh connection.
        db.onclose = () => { _db = null; _dbPromise = null; };
        db.onversionchange = () => { db.close(); _db = null; _dbPromise = null; };
        return db;
    });
    return _dbPromise;
};

/**
 * Async write — never blocks the main thread.
 * Safe to call every autosave tick without causing frame drops.
 */
export const saveProjectToDB = async (key: string, data: unknown): Promise<void> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

/**
 * Async read — returns `undefined` if the key doesn't exist.
 */
export const loadProjectFromDB = async <T = unknown>(key: string): Promise<T | undefined> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () => reject(request.error);
    });
};

/**
 * Remove a single key from the store (e.g. when "New Project" is triggered).
 */
export const deleteProjectFromDB = async (key: string): Promise<void> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

// ── MULTI-PROJECT PERSISTENCE LAYER (Phase H) ─────────────────────────────────
//
// Architecture overview:
//   IDB key  'vectra_project_index'      → ProjectMeta[]
//   IDB key  'project_data_${uuid}'      → FullProjectSave
//
// The existing saveProjectToDB / loadProjectFromDB / deleteProjectFromDB exports
// are preserved exactly — they are now only used by the legacy migration path.

import type { ProjectMeta } from '../types';

/** Fixed IDB key for the project index (all project metadata). */
export const PROJECT_INDEX_KEY = 'vectra_project_index';

/**
 * Full serialised payload for a single project.
 * Stored under 'project_data_${id}' in IndexedDB.
 * Also written to localStorage as a per-project snap cache for instant boot.
 */
export interface FullProjectSave {
    id: string;
    framework: string;
    elements: Record<string, unknown>;
    pages: unknown[];
    apiRoutes: unknown[];
    theme: unknown;
}

/** Write the full ProjectMeta[] index to IDB. */
export const saveProjectIndexToDB = async (index: ProjectMeta[]): Promise<void> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(index, PROJECT_INDEX_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

/** Read the project index. Returns [] if no index exists (fresh install). */
export const loadProjectIndexFromDB = async (): Promise<ProjectMeta[]> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(PROJECT_INDEX_KEY);
        request.onsuccess = () => {
            resolve(Array.isArray(request.result) ? request.result : []);
        };
        request.onerror = () => reject(request.error);
    });
};

/** Write the full element tree for a specific project UUID. */
export const saveProjectDataToDB2 = async (id: string, data: FullProjectSave): Promise<void> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, `project_data_${id}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

/** Read the full element tree for a specific project UUID. Returns undefined if missing. */
export const loadProjectDataFromDB2 = async (id: string): Promise<FullProjectSave | undefined> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(`project_data_${id}`);
        request.onsuccess = () => {
            resolve(request.result as FullProjectSave | undefined);
        };
        request.onerror = () => reject(request.error);
    });
};

/** Remove the element tree for a specific project UUID. */
export const deleteProjectDataFromDB2 = async (id: string): Promise<void> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(`project_data_${id}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

/**
 * ONE-SHOT MIGRATION — Pre-Phase H → Phase H storage format.
 *
 * Before Phase H, all project data lived under a single fixed key
 * ('vectra_current_project'). Phase H introduces per-UUID storage.
 * This function bridges the gap for existing users.
 *
 * IDEMPOTENT — safe to call on every boot. If the index already has entries,
 * returns null immediately without touching any data.
 *
 * Returns { id, framework } of the migrated project, or null if no migration
 * was needed (fresh install or already migrated).
 */
export const migrateFromLegacyStorage = async (
    legacyStorageKey: string,
    legacyFrameworkKey: string,
): Promise<{ id: string; framework: string } | null> => {
    // Guard: index already populated → migration already done
    const existingIndex = await loadProjectIndexFromDB();
    if (existingIndex.length > 0) return null;

    // Attempt to read old IDB data
    let legacyData: unknown;
    try {
        legacyData = await loadProjectFromDB(legacyStorageKey);
    } catch {
        legacyData = undefined;
    }

    // Nothing to migrate — clean install
    if (
        !legacyData ||
        typeof legacyData !== 'object' ||
        Object.keys(legacyData as object).length === 0
    ) {
        return null;
    }

    const legacyFramework = localStorage.getItem(legacyFrameworkKey) || 'nextjs';
    const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const meta: ProjectMeta = {
        id: newId,
        name: 'My Project',
        framework: legacyFramework as ProjectMeta['framework'],
        createdAt: now,
        lastEditedAt: now,
        pageCount: 1,
    };

    const fullSave: FullProjectSave = {
        id: newId,
        framework: legacyFramework,
        elements: legacyData as Record<string, unknown>,
        pages: [],
        apiRoutes: [],
        theme: {},
    };

    await saveProjectDataToDB2(newId, fullSave);
    await saveProjectIndexToDB([meta]);

    // Clean up old localStorage keys (IDB old key left as safety net, ignored going forward)
    localStorage.removeItem(legacyStorageKey);
    localStorage.removeItem(legacyFrameworkKey);

    console.log('[Vectra] Legacy project migrated to multi-project format:', newId);
    return { id: newId, framework: legacyFramework };
};

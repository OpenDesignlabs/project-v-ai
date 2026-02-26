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

/** Opens (and upgrades if necessary) the Vectra IndexedDB database. */
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

/**
 * Async write — never blocks the main thread.
 * Safe to call every autosave tick without causing frame drops.
 */
export const saveProjectToDB = async (key: string, data: unknown): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
};

/**
 * Async read — returns `undefined` if the key doesn't exist.
 */
export const loadProjectFromDB = async <T = unknown>(key: string): Promise<T | undefined> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => { db.close(); resolve(request.result as T | undefined); };
        request.onerror = () => { db.close(); reject(request.error); };
    });
};

/**
 * Remove a single key from the store (e.g. when "New Project" is triggered).
 */
export const deleteProjectFromDB = async (key: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
};

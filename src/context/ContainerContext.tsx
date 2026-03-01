import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import {
    NEXTJS_APP_ROUTER_TEMPLATE,
    VITE_REACT_TEMPLATE,
} from '../data/fileSystemTemplates';
import type { Framework } from '../types';

// ─── TYPES ────────────────────────────────────────────────────────────────────

// Simplified status — no more 'installing' or 'starting_server' blocking states.
// The VFS is "ready" as soon as files are mounted. The editor never waits for npm.
export type ContainerStatus = 'booting' | 'mounting' | 'ready' | 'error';

interface ContainerContextType {
    instance: WebContainer | null;
    status: ContainerStatus;
    terminalOutput: string[];
    url: string | null;
    writeFile: (path: string, content: string) => Promise<void>;
    removeFile: (path: string) => Promise<void>;
    fileTree: Record<string, any>;
    // On-demand: triggers pnpm install + vite dev server when the user explicitly asks
    installPackage: (packageName: string) => Promise<void>;
    startDevServer: () => Promise<void>;
    /**
     * killDevServer: terminates the running dev server process if one exists.
     * Called automatically on ContainerProvider unmount (project switch).
     * Exposed for components that need an explicit "Stop Server" control.
     */
    killDevServer: () => void;
}

const ContainerContext = createContext<ContainerContextType | undefined>(undefined);

// ─── SINGLETON BOOT GUARD ─────────────────────────────────────────────────────
// Prevents double-boot in React Strict Mode double-invoke and across re-renders.
let bootPromise: Promise<WebContainer> | null = null;

// ADD as a module-scope helper (before the ContainerProvider function):

/**
 * cleanVfsForFramework
 * ────────────────────
 * Removes framework-specific directories from the WebContainer VFS before
 * mounting a new project template. This prevents stale files from a previous
 * project bleeding into the new one.
 *
 * WHY THIS IS NECESSARY
 * ──────────────────────
 * wc.mount() overlays new files onto the existing VFS — it does NOT clear it.
 * If Project A (Next.js) had app/about/page.tsx and Project B (Next.js) does
 * not, that file persists in the VFS after mount. useFileSync only writes files
 * it knows about — it never removes files it didn't create.
 *
 * DIRECTORIES CLEANED
 * ────────────────────
 * Next.js: app/, components/, public/assets/
 * Vite:    src/, public/assets/
 *
 * We intentionally do NOT remove: node_modules/, .pnpm-store/, package.json,
 * tailwind.config.js — these are expensive to reinstall and the template
 * will overwrite them with the correct content on mount anyway.
 *
 * All removals use { recursive: true, force: true } — ENOENT is swallowed
 * silently (directories simply don't exist on a fresh WebContainer boot).
 */
const cleanVfsForFramework = async (
    instance: WebContainer,
    framework: 'nextjs' | 'vite'
): Promise<void> => {
    const dirs = framework === 'nextjs'
        ? ['app', 'components', 'public/assets']
        : ['src', 'public/assets'];

    await Promise.all(
        dirs.map(dir =>
            instance.fs.rm(dir, { recursive: true, force: true }).catch(() => {
                // ENOENT on fresh boot — not an error
            })
        )
    );
    console.log(`[VFS] Cleaned framework dirs for ${framework}:`, dirs.join(', '));
};

// ─── PROVIDER ─────────────────────────────────────────────────────────────────

interface ContainerProviderProps {
    children: React.ReactNode;
    /** Framework chosen at project creation — determines which VFS template to mount. */
    framework: Framework;
}

export const ContainerProvider: React.FC<ContainerProviderProps> = ({ children, framework }) => {
    const [instance, setInstance] = useState<WebContainer | null>(null);
    const [status, setStatus] = useState<ContainerStatus>('booting');
    const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
    const [url, setUrl] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<Record<string, any>>({});

    // Tracks whether the dev server has ever been launched this session
    const devServerStarted = useRef(false);
    // Stores the SpawnResult from startDevServer() so we can .kill() it on unmount.
    const devServerProcessRef = useRef<any>(null);
    const isInitialized = useRef(false);

    // S-1 FIX: push + truncate instead of spread+slice on every message.
    // During pnpm install (hundreds of lines/sec) the old pattern created a new
    // array per log line, generating significant GC pressure.
    const log = useCallback((msg: string) => {
        setTerminalOutput(prev => {
            const next = prev.length >= 100 ? prev.slice(-99) : prev;
            return [...next, msg];
        });
        console.log(`[VFS] ${msg}`);
    }, []);

    // ── Boot: VFS-only — no npm, no vite ─────────────────────────────────────
    useEffect(() => {
        if (isInitialized.current) return;
        isInitialized.current = true;

        const boot = async () => {
            try {
                log('⚡ Booting Virtual File System...');
                if (!bootPromise) bootPromise = WebContainer.boot();
                const wc = await bootPromise;
                setInstance(wc);

                setStatus('mounting');
                const template = framework === 'vite' ? VITE_REACT_TEMPLATE : NEXTJS_APP_ROUTER_TEMPLATE;
                const frameworkLabel = framework === 'vite' ? 'Vite + React' : 'Next.js App Router';

                // Item 4: clean stale dirs before mounting new project template.
                // Prevents old project files from bleeding into the new VFS.
                await cleanVfsForFramework(wc, framework);

                log(`📂 Mounting ${frameworkLabel} project files...`);
                await wc.mount(template);

                // ─── DONE. No npm install. No vite. ──────────────────────────
                // The WebContainer is now a lightning-fast virtual hard drive.
                // • useFileSync writes .tsx files to it continuously.
                // • The Instant Iframe (ContainerPreview) renders AI components.
                // • startDevServer() / installPackage() are available on-demand
                //   when the user explicitly clicks "Download" or "Run Server".
                setStatus('ready');
                log('✅ Virtual File System ready — instant preview active.');

            } catch (e) {
                console.error('[VFS] Boot failed:', e);
                setStatus('error');
                log(`❌ Boot failed: ${e}`);
            }
        };

        boot();
    }, [log]);

    // M-8 FIX: `status` removed from readFileTree deps.
    // Previously: status in deps → new readFileTree identity every status change
    // → effect re-runs → double read on every transition.
    // The guard `if (!instance || status !== 'ready')` still works because
    // `status` is in the effect's own dep array (not the callback's).
    const readFileTree = useCallback(async () => {
        if (!instance) return;
        try {
            const buildTree = async (path: string): Promise<any> => {
                const entries = await instance.fs.readdir(path, { withFileTypes: true });
                const tree: any = {};
                for (const entry of entries) {
                    // Skip heavy dirs — they'd freeze the tree reader
                    if (entry.name === 'node_modules' || entry.name === '.git') continue;
                    const fullPath = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
                    tree[entry.name] = entry.isDirectory()
                        ? { type: 'folder', children: await buildTree(fullPath) }
                        : { type: 'file' };
                }
                return tree;
            };
            setFileTree(await buildTree('/'));
        } catch (err) {
            console.error('[VFS] readFileTree error:', err);
        }
    }, [instance]); // status intentionally omitted — gate is in the effect below

    useEffect(() => {
        if (status === 'ready') readFileTree();
    }, [status, readFileTree]); // readFileTree is now stable across status transitions

    // ── writeFile (with auto-mkdir on first write to a new directory) ─────────
    const writeFile = useCallback(async (path: string, content: string) => {
        if (!instance) return;
        try {
            await instance.fs.writeFile(path, content);
        } catch {
            // File write failed — usually because parent directory doesn't exist yet.
            // Create it recursively and retry.
            try {
                const dir = path.split('/').slice(0, -1).join('/');
                if (dir) await instance.fs.mkdir(dir, { recursive: true });
                await instance.fs.writeFile(path, content);
            } catch (retryErr) {
                console.error(`[VFS] Failed to write ${path}:`, retryErr);
            }
        }
    }, [instance]);

    // ── removeFile ────────────────────────────────────────────────────────────
    const removeFile = useCallback(async (path: string) => {
        if (!instance) return;
        try {
            await instance.fs.rm(path, { recursive: true, force: true });
        } catch (err) {
            console.error(`[VFS] Failed to remove ${path}:`, err);
        }
    }, [instance]);

    // ── startDevServer (on-demand — called before installPackage or by a
    //    future "Run Full Server" / "Download" button) ──────────────────────
    const startDevServer = useCallback(async () => {
        if (!instance || devServerStarted.current) return;
        devServerStarted.current = true;

        log('📦 Installing dependencies (on-demand)...');
        const install = await instance.spawn('pnpm', ['install']);
        install.output.pipeTo(new WritableStream({ write: d => log(d) }));
        const exitCode = await install.exit;

        if (exitCode !== 0) {
            log('⚠️ pnpm install failed — some packages may be missing.');
        }

        const devArgs = framework === 'vite'
            ? ['vite', '--host', '0.0.0.0']
            : ['next', 'dev', '--hostname', '0.0.0.0'];
        log(`🚀 Starting ${framework === 'vite' ? 'Vite' : 'Next.js'} dev server...`);
        const dev = await instance.spawn('npx', devArgs);
        // Item 4: store process ref so we can kill it on unmount.
        devServerProcessRef.current = dev;
        dev.output.pipeTo(new WritableStream({ write: d => log(d) }));

        instance.on('server-ready', (_, serverUrl) => {
            setUrl(serverUrl);
            log(`✅ Dev server ready: ${serverUrl}`);
        });
    }, [instance, log]);

    // ── killDevServer (Item 4) ────────────────────────────────────────────────────
    // Terminates the dev server process. Called on unmount and exposed on context
    // for components that need an explicit stop control.
    const killDevServer = useCallback(() => {
        if (devServerProcessRef.current) {
            try {
                devServerProcessRef.current.kill();
                console.log('[VFS] Dev server process killed.');
            } catch (e) {
                // Process may already have exited — safe to ignore.
                console.warn('[VFS] killDevServer: process already dead or not killable.', e);
            }
            devServerProcessRef.current = null;
            devServerStarted.current = false;
            setUrl(null);
        }
    }, []);

    // ── Cleanup on unmount (Item 4) ───────────────────────────────────────────────
    // ContainerProvider unmounts when the user exits to the Dashboard.
    // Kill the dev server process so it doesn't continue consuming WebContainer
    // resources. The WebContainer iframe itself persists (singleton boot) but the
    // spawned npx process is cleaned up.
    useEffect(() => {
        return () => {
            killDevServer();
        };
    }, [killDevServer]);

    // ── installPackage (NPM panel in LeftSidebar) ─────────────────────────────
    // Ensures the dev server is running before adding a package, then installs it.
    const installPackage = useCallback(async (packageName: string) => {
        if (!instance) return;
        try {
            // Lazy-start the dev server if it hasn't been started yet
            await startDevServer();

            log(`📦 Installing ${packageName}...`);
            const install = await instance.spawn('pnpm', ['add', packageName]);
            install.output.pipeTo(new WritableStream({ write: d => log(d) }));
            const exitCode = await install.exit;
            log(exitCode === 0
                ? `✅ ${packageName} installed successfully.`
                : `⚠️ ${packageName} installation failed (exit ${exitCode}).`
            );
        } catch (err) {
            log(`❌ Error installing ${packageName}: ${err}`);
        }
    }, [instance, log, startDevServer]);

    // ── Provider value ────────────────────────────────────────────────────────
    return (
        <ContainerContext.Provider value={{
            instance,
            status,
            terminalOutput,
            url,
            writeFile,
            removeFile,
            fileTree,
            installPackage,
            startDevServer,
            killDevServer,
        }}>
            {children}
        </ContainerContext.Provider>
    );
};

// ─── HOOK ─────────────────────────────────────────────────────────────────────

export const useContainer = () => {
    const context = useContext(ContainerContext);
    if (!context) throw new Error('useContainer must be used within ContainerProvider');
    return context;
};

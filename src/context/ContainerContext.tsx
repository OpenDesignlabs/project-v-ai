import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { VITE_REACT_TEMPLATE } from '../data/fileSystemTemplates';

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
}

const ContainerContext = createContext<ContainerContextType | undefined>(undefined);

// ─── SINGLETON BOOT GUARD ─────────────────────────────────────────────────────
// Prevents double-boot in React Strict Mode double-invoke and across re-renders.
let bootPromise: Promise<WebContainer> | null = null;

// ─── PROVIDER ─────────────────────────────────────────────────────────────────

export const ContainerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [instance, setInstance] = useState<WebContainer | null>(null);
    const [status, setStatus] = useState<ContainerStatus>('booting');
    const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
    const [url, setUrl] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<Record<string, any>>({});

    // Tracks whether the dev server has ever been launched this session
    const devServerStarted = useRef(false);
    const isInitialized = useRef(false);

    // ── Logging ──────────────────────────────────────────────────────────────
    const log = useCallback((msg: string) => {
        setTerminalOutput(prev => [...prev.slice(-100), msg]);
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
                log('📂 Mounting project files...');
                await wc.mount(VITE_REACT_TEMPLATE);

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

    // ── File tree reader ──────────────────────────────────────────────────────
    const readFileTree = useCallback(async () => {
        if (!instance || status !== 'ready') return;
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
    }, [instance, status]);

    useEffect(() => {
        if (status === 'ready') readFileTree();
    }, [status, readFileTree]);

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

        log('🚀 Starting Vite dev server...');
        const dev = await instance.spawn('pnpm', ['run', 'dev']);
        dev.output.pipeTo(new WritableStream({ write: d => log(d) }));

        instance.on('server-ready', (_, serverUrl) => {
            setUrl(serverUrl);
            log(`✅ Dev server ready: ${serverUrl}`);
        });
    }, [instance, log]);

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

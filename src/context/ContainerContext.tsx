import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { VITE_REACT_TEMPLATE } from '../data/fileSystemTemplates';

export type ContainerStatus = 'booting' | 'mounting' | 'installing' | 'starting_server' | 'ready' | 'error';

interface ContainerContextType {
    instance: WebContainer | null;
    status: ContainerStatus;
    terminalOutput: string[];
    url: string | null;
    writeFile: (path: string, content: string) => Promise<void>;
    removeFile: (path: string) => Promise<void>;
    fileTree: Record<string, any>;
    installPackage: (packageName: string) => Promise<void>;
}

const ContainerContext = createContext<ContainerContextType | undefined>(undefined);

// Global Singleton to persist across re-renders
let bootPromise: Promise<WebContainer> | null = null;

export const ContainerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [instance, setInstance] = useState<WebContainer | null>(null);
    const [status, setStatus] = useState<ContainerStatus>('booting');
    const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
    const [url, setUrl] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<Record<string, any>>({});

    // Safety guard for React Strict Mode
    const isInitialized = useRef(false);

    const log = useCallback((msg: string) => {
        setTerminalOutput(prev => [...prev.slice(-100), msg]);
        console.log(`[WebContainer] ${msg}`);
    }, []);

    useEffect(() => {
        // Prevent double-initialization
        if (isInitialized.current) return;
        isInitialized.current = true;

        const boot = async () => {
            try {
                log("⚡ Booting Kernel...");
                if (!bootPromise) bootPromise = WebContainer.boot();
                const wc = await bootPromise;
                setInstance(wc);

                setStatus('mounting');
                log("📂 Mounting File System...");
                // TEMPORARY FIX: Cast VITE_REACT_TEMPLATE to any or FileSystemTree to satisfy the type checker if needed
                // The explicit type in fileSystemTemplates.ts should handle this, but being safe.
                await wc.mount(VITE_REACT_TEMPLATE);

                setStatus('installing');
                log("📦 Installing Dependencies...");

                // Helper: run pnpm install and detect network errors in output
                const runInstall = async (): Promise<number> => {
                    const install = await wc.spawn('pnpm', ['install']);
                    install.output.pipeTo(new WritableStream({
                        write: (data) => {
                            log(data);
                            // Detect network failures early for clearer diagnosis
                            if (data.includes('ERR_SOCKET_TIMEOUT') || data.includes('META_FETCH_FAIL') || data.includes('FETCH_FAIL')) {
                                log("⚠️ Network error detected — registry.npmjs.org unreachable inside container.");
                                log("   → Check that the iframe sandbox includes allow-popups and allow-same-origin.");
                            }
                        }
                    }));
                    return install.exit;
                };

                let exitCode = await runInstall();

                // Retry once on failure — handles transient registry timeouts
                if (exitCode !== 0) {
                    log("⚠️ Install attempt 1 failed. Retrying in 3s...");
                    await new Promise(r => setTimeout(r, 3000));
                    exitCode = await runInstall();
                    if (exitCode !== 0) {
                        log("⚠️ Install attempt 2 also failed — proceeding anyway (some packages may be missing).");
                    }
                }

                setStatus('starting_server');
                log("🚀 Starting Server...");
                const dev = await wc.spawn('pnpm', ['run', 'dev']);
                dev.output.pipeTo(new WritableStream({ write: d => log(d) }));

                wc.on('server-ready', (_, url) => {
                    setUrl(url);
                    setStatus('ready');
                    log(`✅ Server Ready: ${url}`);
                });

            } catch (e) {
                console.error(e);
                setStatus('error');
                log(`❌ Error: ${e}`);
            }
        };

        boot();
    }, [log]);

    const writeFile = useCallback(async (path: string, content: string) => {
        if (!instance) return;

        try {
            await instance.fs.writeFile(path, content);
        } catch (error) {
            // Retry with directory creation
            try {
                const parts = path.split('/');
                parts.pop(); // Remove filename
                const dir = parts.join('/');
                if (dir) {
                    await instance.fs.mkdir(dir, { recursive: true });
                    await instance.fs.writeFile(path, content);
                }
            } catch (retryError) {
                console.error(`[VFS] Failed to write ${path}:`, retryError);
            }
        }
    }, [instance]);

    const removeFile = useCallback(async (path: string) => {
        if (!instance) return;
        try {
            await instance.fs.rm(path, { recursive: true, force: true });
        } catch (error) {
            console.error(`[VFS] Failed to remove ${path}:`, error);
        }
    }, [instance]);

    const installPackage = useCallback(async (packageName: string) => {
        if (!instance) return;
        try {
            log(`📦 Installing ${packageName}...`);
            const install = await instance.spawn('pnpm', ['install', packageName]);
            install.output.pipeTo(new WritableStream({ write: d => log(d) }));
            const exitCode = await install.exit;
            if (exitCode === 0) {
                log(`✅ ${packageName} installed successfully`);
            } else {
                log(`⚠️ ${packageName} installation failed`);
            }
        } catch (error) {
            log(`❌ Error installing ${packageName}: ${error}`);
        }
    }, [instance, log]);

    const readFileTree = useCallback(async () => {
        if (!instance || status !== 'ready') return;
        try {
            const buildTree = async (path: string): Promise<any> => {
                const entries = await instance.fs.readdir(path, { withFileTypes: true });
                const tree: any = {};
                for (const entry of entries) {
                    if (entry.name === 'node_modules' || entry.name === '.git') continue;
                    const fullPath = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
                    if (entry.isDirectory()) {
                        tree[entry.name] = {
                            type: 'folder',
                            children: await buildTree(fullPath)
                        };
                    } else {
                        tree[entry.name] = { type: 'file' };
                    }
                }
                return tree;
            };
            const tree = await buildTree('/');
            setFileTree(tree);
        } catch (error) {
            console.error('[VFS] Failed to read file tree:', error);
        }
    }, [instance, status]);

    useEffect(() => {
        if (status === 'ready') {
            readFileTree();
        }
    }, [status, readFileTree]);

    return (
        <ContainerContext.Provider value={{ instance, status, terminalOutput, url, writeFile, removeFile, fileTree, installPackage }}>
            {children}
        </ContainerContext.Provider>
    );
};

export const useContainer = () => {
    const context = useContext(ContainerContext);
    if (!context) throw new Error("useContainer must be used within ContainerProvider");
    return context;
};

/**
 * ─── VECTRA MCP SERVER ────────────────────────────────────────────────────────
 * MCP-1 + MCP-2 — Model Context Protocol server for Vectra.
 *
 * WebContainer Network isolation fix (MCP-WC-1):
 * ─────────────────────────────────────────────
 * Servers running inside the WebContainer are NOT reachable via `localhost:PORT`
 * from the browser. The WebContainer API fires a `server-ready` event with a
 * container-forwarded URL (e.g. https://xxx--3002.local.webcontainer.io/).
 * This is the ONLY reachable URL from the browser thread.
 *
 * We listen to `instance.on('server-ready', ...)` for port 3002 and store the
 * resulting URL in `mcpBaseUrl`. ALL subsequent fetches use this URL.
 *
 * MCP-PORT-1 [PERMANENT]:  Server port = 3002. 3000=dev, 3001=figma proxy.
 * MCP-READ-1 [PERMANENT]:  Read ops read data/project.json directly. Zero events.
 * MCP-WRITE-1 [PERMANENT]: Write ops return { __vectra_mutation__: true, op, ... }.
 *   MCPPanel dispatches vectra:mcp-command → ProjectContext applies mutations.
 * MCP-SEC-1 [PERMANENT]:   No auth token — localhost only. WebContainer isolation.
 * MCP-IDLE-1 [PERMANENT]:  Auto-exit after 30 min idle.
 * MCP-WC-1 [PERMANENT]:    Always use URL from server-ready event, never localhost:3002.
 */

import type { WebContainer } from '@webcontainer/api';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const MCP_PORT = 3002;

// Session singleton — same pattern as figmaProxy.ts
let mcpBootPromise: Promise<string> | null = null;
let mcpIsRunning = false;

// MCP-WC-1: The real reachable URL — populated from server-ready event.
// Falls back to localhost ONLY for debugging outside WebContainer.
let mcpBaseUrl = `http://localhost:${MCP_PORT}`;

export const getMcpBaseUrl = () => mcpBaseUrl;
export const getMcpHealthUrl = () => `${mcpBaseUrl}/mcp/health`;
export const getMcpSseUrl = () => `${mcpBaseUrl}/mcp/sse`;
export const getMcpPostUrl = () => `${mcpBaseUrl}/mcp/message`;

// ─── MCP TOOL SCHEMAS (MCP-2) ─────────────────────────────────────────────────

const TOOL_SCHEMAS = [
    {
        name: 'vectra_get_project',
        description: 'Get Vectra project metadata: pages list, total node count, active framework, and current theme colors. Use this first to understand project structure.',
        inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
    },
    {
        name: 'vectra_get_page',
        description: 'Get all nodes (elements) on a specific page. Returns a flat map of nodeId → node.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'Page ID from vectra_get_project. Use "page-home" for home.' },
            },
            required: ['pageId'],
        },
    },
    {
        name: 'vectra_get_element',
        description: 'Get a single element/node by ID. Returns full node with props, style, children, content.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                elementId: { type: 'string', description: 'The VectraNode ID.' },
            },
            required: ['elementId'],
        },
    },
    {
        name: 'vectra_find_elements',
        description: 'Search for elements by type or name. Returns matching nodes across the project.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                type: { type: 'string', description: 'Filter by node type: container, text, heading, button, image, input, custom_code, webpage.' },
                name: { type: 'string', description: 'Filter by name substring (case-insensitive).' },
                pageId: { type: 'string', description: 'Optional: restrict to a specific page.' },
            },
            required: [] as string[],
        },
    },
    {
        name: 'vectra_add_element',
        description: 'Add a new element to a page on the Vectra canvas.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'Target page ID.' },
                parentId: { type: 'string', description: 'Parent node ID.' },
                type: { type: 'string', description: 'Node type: container, text, heading, button, image, input, custom_code.' },
                name: { type: 'string', description: 'Layer name for the Vectra layers panel.' },
                content: { type: 'string', description: 'Text content for text/heading/button nodes.' },
                style: { type: 'object', description: 'React.CSSProperties object.' },
                className: { type: 'string', description: 'Optional Tailwind CSS class string.' },
            },
            required: ['pageId', 'parentId', 'type', 'name'],
        },
    },
    {
        name: 'vectra_update_element',
        description: "Update an existing element's properties, style, or content.",
        inputSchema: {
            type: 'object' as const,
            properties: {
                elementId: { type: 'string', description: 'ID of the element to update.' },
                name: { type: 'string', description: 'New layer name.' },
                content: { type: 'string', description: 'New text content.' },
                style: { type: 'object', description: 'Partial style object — merged over existing.' },
                className: { type: 'string', description: 'New Tailwind class string.' },
                props: { type: 'object', description: 'Additional props to merge.' },
            },
            required: ['elementId'],
        },
    },
    {
        name: 'vectra_delete_element',
        description: 'Delete an element and all children. Undoable in the Vectra editor (Cmd+Z).',
        inputSchema: {
            type: 'object' as const,
            properties: {
                elementId: { type: 'string', description: 'ID of the element to delete.' },
            },
            required: ['elementId'],
        },
    },
    {
        name: 'vectra_add_page',
        description: 'Create a new page in the Vectra project.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                name: { type: 'string', description: 'Page display name, e.g. "About Us".' },
                slug: { type: 'string', description: 'URL path, e.g. "/about". Auto-generated from name if omitted.' },
            },
            required: ['name'],
        },
    },
    {
        name: 'vectra_run_ai',
        description: "Trigger Vectra's AI generation engine with a natural language prompt.",
        inputSchema: {
            type: 'object' as const,
            properties: {
                prompt: { type: 'string', description: 'Natural language description of what to create.' },
                pageId: { type: 'string', description: 'Optional: target a specific page. Defaults to active page.' },
            },
            required: ['prompt'],
        },
    },
    {
        name: 'vectra_update_theme',
        description: "Update the project's global design theme. Changes propagate to all pages.",
        inputSchema: {
            type: 'object' as const,
            properties: {
                primary: { type: 'string', description: 'Primary brand color (hex).' },
                secondary: { type: 'string', description: 'Secondary color (hex).' },
                accent: { type: 'string', description: 'Accent color (hex).' },
                font: { type: 'string', description: 'Font family name.' },
                radius: { type: 'string', description: 'Border radius: "0px", "0.25rem", "0.5rem", "0.75rem", "1rem".' },
            },
            required: [] as string[],
        },
    },
];

// ─── SERVER SOURCE ────────────────────────────────────────────────────────────
// Written to /mcp-server.mjs in the VFS. Uses ONLY Node.js built-ins.

const buildServerSource = (): string => `
import http from 'http';
import fs from 'fs';

const PORT = ${MCP_PORT};
const PROJECT_PATHS = ['data/project.json', 'src/data/project.json'];
const IDLE_MS = 30 * 60 * 1000;

const sseClients = new Set();
let idleTimer = null;
const resetIdle = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { console.log('[mcp] Idle timeout — exiting.'); process.exit(0); }, IDLE_MS);
};
resetIdle();

const readProject = () => {
  for (const p of PROJECT_PATHS) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
  }
  return { pages: [], elements: {}, framework: 'nextjs', theme: {} };
};

const TOOLS = ${JSON.stringify(TOOL_SCHEMAS, null, 2)};

const rpcOk  = (id, result) => JSON.stringify({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, msg) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: msg } });

const executeTool = (name, args) => {
  const project = readProject();
  const { elements = {}, pages = [], theme = {}, framework = 'nextjs' } = project;

  if (name === 'vectra_get_project') {
    return { name: project.name || 'Vectra Project', framework, nodeCount: Object.keys(elements).length, pageCount: pages.length, pages: pages.map(p => ({ id: p.id, name: p.name, slug: p.slug })), theme };
  }
  if (name === 'vectra_get_page') {
    const page = pages.find(p => p.id === args.pageId);
    if (!page) return { error: 'Page "' + args.pageId + '" not found. Available: ' + pages.map(p=>p.id).join(', ') };
    const collect = (id, depth = 0) => {
      if (depth > 10) return {};
      const node = elements[id]; if (!node) return {};
      const r = { [id]: node };
      for (const cid of (node.children || [])) Object.assign(r, collect(cid, depth + 1));
      return r;
    };
    return { page, nodes: collect(page.rootId) };
  }
  if (name === 'vectra_get_element') {
    const el = elements[args.elementId];
    return el || { error: 'Element "' + args.elementId + '" not found.' };
  }
  if (name === 'vectra_find_elements') {
    let cands = Object.values(elements);
    if (args.type) cands = cands.filter(e => e.type === args.type);
    if (args.name) cands = cands.filter(e => (e.name || '').toLowerCase().includes(args.name.toLowerCase()));
    if (args.pageId) {
      const page = pages.find(p => p.id === args.pageId);
      if (page) {
        const ids = new Set();
        const walk = (id) => { if (!id || ids.has(id)) return; ids.add(id); const n = elements[id]; for (const c of (n?.children || [])) walk(c); };
        walk(page.rootId);
        cands = cands.filter(e => ids.has(e.id));
      }
    }
    return { count: cands.length, elements: cands.slice(0, 50) };
  }
  if (name === 'vectra_add_element') {
    const { pageId, parentId, type, name: elName, content, style, className } = args;
    const page = pages.find(p => p.id === pageId);
    if (!page) return { error: 'Page "' + pageId + '" not found.' };
    const newId = type.slice(0,3) + '-mcp' + Date.now().toString(36);
    return { __vectra_mutation__: true, op: 'ADD_ELEMENT', newId, parentId, element: { id: newId, type, name: elName, content: content || '', children: [], props: { className: className || '', style: { position: 'relative', width: '100%', ...(style || {}) } } } };
  }
  if (name === 'vectra_update_element') {
    if (!elements[args.elementId]) return { error: 'Element "' + args.elementId + '" not found.' };
    const { elementId, name: newName, content, style, className, props } = args;
    return { __vectra_mutation__: true, op: 'UPDATE_ELEMENT', elementId, patch: { name: newName, content, style, className, props } };
  }
  if (name === 'vectra_delete_element') {
    if (!elements[args.elementId]) return { error: 'Element "' + args.elementId + '" not found.' };
    return { __vectra_mutation__: true, op: 'DELETE_ELEMENT', elementId: args.elementId };
  }
  if (name === 'vectra_add_page') {
    const slug = args.slug || '/' + args.name.toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return { __vectra_mutation__: true, op: 'ADD_PAGE', name: args.name, slug };
  }
  if (name === 'vectra_run_ai') {
    return { __vectra_mutation__: true, op: 'RUN_AI', prompt: args.prompt, pageId: args.pageId };
  }
  if (name === 'vectra_update_theme') {
    return { __vectra_mutation__: true, op: 'UPDATE_THEME', theme: args };
  }
  return { error: 'Unknown tool: ' + name };
};

const server = http.createServer((req, res) => {
  resetIdle();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (req.method === 'GET' && req.url === '/mcp/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '1.0', port: PORT, tools: TOOLS.length }));
    return;
  }
  if (req.method === 'GET' && req.url === '/mcp/sse') {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('data: ' + JSON.stringify({ type: 'endpoint', url: '/mcp/message' }) + '\\n\\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    const ping = setInterval(() => { try { res.write(': ping\\n\\n'); } catch { clearInterval(ping); } }, 15000);
    return;
  }
  if (req.method === 'POST' && req.url === '/mcp/message') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      let rpc;
      try { rpc = JSON.parse(body); } catch { res.end(rpcErr(null, -32700, 'Parse error')); return; }
      const { id, method, params } = rpc;
      try {
        if (method === 'initialize') { res.end(rpcOk(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'vectra-mcp', version: '1.0.0' } })); return; }
        if (method === 'notifications/initialized') { res.end(rpcOk(id, {})); return; }
        if (method === 'tools/list') { res.end(rpcOk(id, { tools: TOOLS })); return; }
        if (method === 'tools/call') {
          const { name, arguments: tArgs } = params || {};
          if (!name) { res.end(rpcErr(id, -32602, 'Missing tool name')); return; }
          const result = executeTool(name, tArgs || {});
          if (result && result.__vectra_mutation__) {
            const sseData = 'data: ' + JSON.stringify(result) + '\\n\\n';
            for (const c of sseClients) { try { c.write(sseData); } catch {} }
          }
          res.end(rpcOk(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }));
          return;
        }
        if (method === 'ping') { res.end(rpcOk(id, {})); return; }
        res.end(rpcErr(id, -32601, 'Method not found: ' + method));
      } catch (e) { res.end(rpcErr(id, -32603, String(e))); }
    });
    return;
  }
  res.writeHead(404, cors); res.end('Not found');
});

server.listen(PORT, () => {
  console.log('[mcp] ✅ Vectra MCP Server on port ' + PORT);
});
`.trim();

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * checkMcpHealth — tries the container-forwarded URL, not localhost.
 */
export const checkMcpHealth = async (): Promise<{ tools: number } | null> => {
    if (!mcpIsRunning) return null;
    try {
        const res = await fetch(getMcpHealthUrl(), { signal: AbortSignal.timeout(2000) });
        if (!res.ok) { mcpIsRunning = false; return null; }
        return res.json();
    } catch {
        mcpIsRunning = false;
        return null;
    }
};

/**
 * ensureMcpServer — idempotent.
 *
 * MCP-WC-1: registers a server-ready listener for port 3002 BEFORE spawning.
 * `server-ready` fires with the container-forwarded URL — the only address
 * reachable from the browser thread. We resolve the boot promise from inside
 * that callback, not from a polling loop.
 */
export const ensureMcpServer = async (instance: WebContainer): Promise<string> => {
    // Fast path: already running and base URL is known
    const health = await checkMcpHealth();
    if (health) return mcpBaseUrl;
    if (mcpBootPromise) { await mcpBootPromise; return mcpBaseUrl; }

    mcpBootPromise = (async (): Promise<string> => {
        try {
            await instance.fs.writeFile('/mcp-server.mjs', buildServerSource());
            console.log('[mcp] mcp-server.mjs written to VFS');

            // MCP-WC-1: subscribe to server-ready BEFORE spawning
            const serverReadyPromise = new Promise<string>((resolve) => {
                instance.on('server-ready', (port, url) => {
                    if (port === MCP_PORT) {
                        console.log('[mcp] server-ready event:', port, url);
                        resolve(url);
                    }
                });
            });

            const proc = await instance.spawn('node', ['mcp-server.mjs']);
            proc.output.pipeTo(
                new WritableStream({ write: (c) => console.log('[mcp]', c) })
            ).catch(() => { /* process ended */ });

            // Race: server-ready URL vs 12s timeout
            const timeoutPromise = new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('MCP server did not fire server-ready within 12 seconds.')), 12000)
            );

            const resolvedUrl = await Promise.race([serverReadyPromise, timeoutPromise]);
            mcpBaseUrl = resolvedUrl.replace(/\/$/, ''); // strip trailing slash
            mcpIsRunning = true;
            console.log('[mcp] ✅ Base URL set to:', mcpBaseUrl);
            return mcpBaseUrl; // Explicit return makes this Promise<string>
        } catch (err) {
            mcpBootPromise = null;
            throw err;
        }
    })();

    await mcpBootPromise;
    return mcpBaseUrl;
};

/** stopMcpServer — reset singleton so next ensureMcpServer re-spawns. */
export const stopMcpServer = (): void => {
    mcpIsRunning = false;
    mcpBootPromise = null;
    mcpBaseUrl = `http://localhost:${MCP_PORT}`; // reset to default
};

// ─── IDE CONFIG GENERATORS (MCP-3) ────────────────────────────────────────────

export interface IdeConfigResult {
    config: string;
    filePath: string;
    note: string;
}

/**
 * generateIdeConfig — takes the resolved base URL so the IDE config always
 * points to the correct container-forwarded address.
 */
export const generateIdeConfig = (
    ide: 'cursor' | 'vscode' | 'windsurf' | 'claude-desktop',
    baseUrl?: string,
): IdeConfigResult => {
    const sseUrl = `${baseUrl || mcpBaseUrl}/mcp/sse`;
    const serverEntry = { vectra: { transport: 'sse', url: sseUrl } };

    switch (ide) {
        case 'cursor':
            return {
                config: JSON.stringify({ mcpServers: serverEntry }, null, 2),
                filePath: '~/.cursor/mcp.json',
                note: 'Paste into ~/.cursor/mcp.json. Restart Cursor after saving.',
            };
        case 'vscode':
            return {
                config: JSON.stringify({ mcp: { servers: serverEntry } }, null, 2),
                filePath: '.vscode/mcp.json',
                note: 'Requires VS Code 1.99+ with GitHub Copilot. Paste into .vscode/mcp.json in your project root.',
            };
        case 'windsurf':
            return {
                config: JSON.stringify({ mcpServers: serverEntry }, null, 2),
                filePath: '~/.codeium/windsurf/mcp_config.json',
                note: 'Paste into ~/.codeium/windsurf/mcp_config.json. Restart Windsurf.',
            };
        case 'claude-desktop':
            return {
                config: JSON.stringify({ mcpServers: { vectra: { transport: 'sse', url: sseUrl } } }, null, 2),
                filePath: '~/Library/Application Support/Claude/claude_desktop_config.json',
                note: 'Paste into claude_desktop_config.json. Windows: %APPDATA%\\Claude\\. Restart Claude Desktop.',
            };
    }
};

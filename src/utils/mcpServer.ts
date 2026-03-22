/* ============================================
   VECTRA CHANGE LOG
   File(s): src/utils/mcpServer.ts
   --------------------------------------------
   ADDED:     VECTRA_DOCS — comprehensive markdown reference
              MCP Resources capability (resources/list + resources/read)
              MCP Prompts capability (prompts/list + prompts/get)
              `instructions` field in initialize response — agents get
              onboarding context automatically on first connect, before
              any tool call. This is the primary "read docs first" gate.
              `vectra://docs` resource — full deep-reference documentation
              `vectra_workflow` prompt — step-by-step agent workflow guide
   MODIFIED:  initialize response → capabilities now declares resources + prompts
              notifications/initialized → no longer sends a response body
              (notifications have no id, rpcOk(undefined) was malformed JSON-RPC)
              vectra_add_element ID generation → Math.random() (collision-safe)
   PRESERVED: All existing tools, SSE broadcast, health endpoint,
              ensureMcpServer, stopMcpServer, generateIdeConfig unchanged
   RISK:      None — purely additive MCP protocol surface
   CROSS-REF: MCP-WC-1 (server-ready URL), MCP spec 2024-11-05
   ============================================ */

import type { WebContainer } from '@webcontainer/api';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const MCP_PORT = 3002;

let mcpBootPromise: Promise<string> | null = null;
let mcpIsRunning = false;
let mcpBaseUrl = `http://localhost:${MCP_PORT}`;

export const getMcpBaseUrl    = () => mcpBaseUrl;
export const getMcpHealthUrl  = () => `${mcpBaseUrl}/mcp/health`;
export const getMcpSseUrl     = () => `${mcpBaseUrl}/mcp/sse`;
export const getMcpPostUrl    = () => `${mcpBaseUrl}/mcp/message`;

// ─── DOCUMENTATION ────────────────────────────────────────────────────────────
// Exposed via resources/read and injected into initialize.instructions.
// Agents read this first to understand the data model, rules, and workflow
// before calling any mutating tools.

const VECTRA_DOCS = `
# Vectra MCP — Agent Reference Documentation

## What is Vectra?
Vectra is a visual full-stack application builder. Users design multi-page web apps
on a canvas (like Figma) and export clean Next.js 14 or Vite+React code.

This MCP server lets AI agents read and mutate the live canvas in real-time.
Every mutation you send appears instantly in the user's editor with full undo support.

---

## Data Model

### Project Structure
A Vectra project has:
- **pages** — array of Page objects (id, name, slug, rootId)
- **elements** — flat map of nodeId → VectraNode (the entire canvas tree)
- **framework** — 'nextjs' | 'vite'
- **theme** — global design tokens (colors, fonts, border-radius)

### VectraNode shape
\`\`\`json
{
  "id": "string",           // unique node ID
  "type": "string",         // see Node Types below
  "name": "string",         // display name in Layers panel
  "content": "string",      // text content for text/heading/button nodes
  "children": ["id", ...],  // ordered child node IDs
  "src": "string",          // image URL (image nodes only)
  "hidden": false,          // whether node is hidden
  "locked": false,          // whether node is locked (no drag/edit)
  "code": "string",         // raw JSX for live-compiled custom_code nodes
  "props": {
    "className": "string",          // Tailwind CSS class string
    "style": {},                    // React.CSSProperties inline styles
    "layoutMode": "canvas|flex|grid",
    "placeholder": "string",        // input nodes
    "iconName": "string"            // icon nodes
  }
}
\`\`\`

### Node Types
| type | description | has children | has content |
|---|---|---|---|
| container | Generic div/section wrapper | ✅ | ❌ |
| text | Paragraph or span | ❌ | ✅ |
| heading | h1–h3 | ❌ | ✅ |
| button | Clickable button | ❌ | ✅ |
| image | <img> element | ❌ | ❌ |
| input | Form input field | ❌ | ❌ |
| custom_code | Live-compiled JSX component | ✅ | ❌ |
| webpage | Page root — always the rootId of a page | ✅ | ❌ |

---

## ⚠️ Protected Node IDs — NEVER DELETE THESE
Deleting these will crash the editor. Always skip them:
- application-root
- page-home
- main-frame
- main-frame-desktop
- main-frame-mobile
- main-canvas

---

## Correct Agent Workflow

### Step 1 — Orient yourself (ALWAYS start here)
\`\`\`
vectra_get_project → { pages, nodeCount, framework, theme }
\`\`\`

### Step 2 — Read the target page
\`\`\`
vectra_get_page({ pageId }) → { page, nodes: { id: VectraNode } }
\`\`\`

### Step 3 — Find specific elements if needed
\`\`\`
vectra_find_elements({ type: "heading" })
vectra_find_elements({ name: "hero" })
\`\`\`

### Step 4 — Mutate
\`\`\`
vectra_add_element(...)
vectra_update_element(...)
vectra_delete_element(...)
\`\`\`

### Step 5 — Verify (optional but recommended for complex edits)
\`\`\`
vectra_get_element({ elementId }) → confirm your changes applied
\`\`\`

---

## Mutation System
When you call a mutating tool (add/update/delete), two things happen:
1. The tool returns \`{ __vectra_mutation__: true, op: "...", ... }\`
2. The server broadcasts this to the editor via Server-Sent Events
3. The editor applies the change and pushes one undo entry

The user can always Cmd+Z to undo your changes.

---

## Style System
Use **React.CSSProperties** objects for the \`style\` field.
Use **Tailwind CSS** class strings for the \`className\` field.

Style examples:
\`\`\`json
{
  "style": {
    "backgroundColor": "#1e1e2e",
    "padding": "48px 64px",
    "display": "flex",
    "flexDirection": "column",
    "gap": "24px",
    "borderRadius": "16px"
  },
  "className": "w-full max-w-5xl mx-auto"
}
\`\`\`

Avoid mixing absolute positioning (left/top) with flex/grid children — use layout containers instead.

---

## Tool Reference

### vectra_get_project
Read-only. Returns project overview. Always call this first.

### vectra_get_page({ pageId })
Read-only. Returns full node tree for a page.
- Use "page-home" for the home page
- pageId comes from vectra_get_project.pages[].id

### vectra_get_element({ elementId })
Read-only. Returns a single node.

### vectra_find_elements({ type?, name?, pageId? })
Read-only. Search elements. Returns up to 50 matches.

### vectra_add_element({ pageId, parentId, type, name, content?, style?, className? })
Mutating. Adds a new node as a child of parentId.
- type: "container" | "text" | "heading" | "button" | "image" | "input"
- parentId must exist in the target page
- Returns { __vectra_mutation__, op: "ADD_ELEMENT", newId }

### vectra_update_element({ elementId, name?, content?, style?, className?, props? })
Mutating. Partial update — only supplied fields are changed.
- style is merged over existing style (patch, not replace)
- props is merged over existing props

### vectra_delete_element({ elementId })
Mutating. Deletes a node and all its descendants.
⚠️ Never delete protected node IDs listed above.

### vectra_add_page({ name, slug? })
Mutating. Creates a new empty page.
- slug auto-generated from name if omitted (e.g. "About Us" → "/about-us")

### vectra_run_ai({ prompt, pageId? })
Triggers Vectra's built-in AI generation engine.
- Best for generating full sections ("Add a pricing section with 3 tiers")
- pageId defaults to the currently active page

### vectra_update_theme({ primary?, secondary?, accent?, font?, radius? })
Mutating. Updates global design tokens. Affects all pages.

---

## Common Mistakes to Avoid
1. **Don't skip vectra_get_project** — you need the page IDs before any other call
2. **Don't use raw Figma/absolute coordinates** — use relative flexbox layout
3. **Don't delete protected IDs** — check the protected list above
4. **Don't build deeply nested structures** — 3–4 levels max for performance
5. **Don't send invalid JSON in style** — use camelCase (backgroundColor, not background-color)
`.trim();

// ─── SHORT INSTRUCTIONS (injected into initialize response) ───────────────────
// Kept brief — this is the first thing agents see on connect.
// Points to the full docs via resources/read.

const ONBOARDING_INSTRUCTIONS = `
You are connected to the Vectra MCP Server — a live canvas editor for React/Next.js apps.

FIRST STEPS (required before mutating anything):
1. Call vectra_get_project to get page IDs and project structure
2. Call vectra_get_page({ pageId }) to read the node tree for your target page
3. Read the full documentation: resources/read with uri "vectra://docs"

KEY RULES:
- Never delete protected node IDs: application-root, page-home, main-frame, main-canvas
- Always use React.CSSProperties for style (camelCase: backgroundColor, not background-color)
- Prefer flex/grid layout over absolute positioning
- Mutations broadcast live to the editor and are undoable with Cmd+Z

10 available tools: vectra_get_project, vectra_get_page, vectra_get_element,
vectra_find_elements, vectra_add_element, vectra_update_element, vectra_delete_element,
vectra_add_page, vectra_run_ai, vectra_update_theme
`.trim();

// ─── MCP TOOL SCHEMAS ─────────────────────────────────────────────────────────

const TOOL_SCHEMAS = [
    {
        name: 'vectra_get_project',
        description: 'Get Vectra project metadata: pages list, total node count, active framework, and current theme colors. USE THIS FIRST before any other tool call.',
        inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
    },
    {
        name: 'vectra_get_page',
        description: 'Get all nodes (elements) on a specific page. Returns a flat map of nodeId → node. Use pageId from vectra_get_project. Use "page-home" for the home page.',
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
        description: 'Search for elements by type or name across the project. Returns up to 50 matching nodes.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                type: { type: 'string', description: 'Filter by node type: container, text, heading, button, image, input, custom_code, webpage.' },
                name: { type: 'string', description: 'Filter by name substring (case-insensitive).' },
                pageId: { type: 'string', description: 'Optional: restrict search to a specific page.' },
            },
            required: [] as string[],
        },
    },
    {
        name: 'vectra_add_element',
        description: 'Add a new element to a page on the Vectra canvas. NEVER use as parentId: application-root, page-home, main-frame, main-canvas.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'Target page ID (from vectra_get_project).' },
                parentId: { type: 'string', description: 'Parent node ID. Must exist on the target page.' },
                type: { type: 'string', description: 'Node type: container | text | heading | button | image | input' },
                name: { type: 'string', description: 'Layer name shown in the Vectra layers panel.' },
                content: { type: 'string', description: 'Text content for text/heading/button nodes.' },
                style: { type: 'object', description: 'React.CSSProperties object (camelCase keys).' },
                className: { type: 'string', description: 'Optional Tailwind CSS class string.' },
            },
            required: ['pageId', 'parentId', 'type', 'name'],
        },
    },
    {
        name: 'vectra_update_element',
        description: "Update an existing element's properties, style, or content. Only supplied fields are changed (partial patch).",
        inputSchema: {
            type: 'object' as const,
            properties: {
                elementId: { type: 'string', description: 'ID of the element to update.' },
                name: { type: 'string', description: 'New layer name.' },
                content: { type: 'string', description: 'New text content.' },
                style: { type: 'object', description: 'Partial style object — merged over existing style.' },
                className: { type: 'string', description: 'New Tailwind class string (replaces existing).' },
                props: { type: 'object', description: 'Additional props to merge.' },
            },
            required: ['elementId'],
        },
    },
    {
        name: 'vectra_delete_element',
        description: 'Delete an element and all its children. Undoable in the Vectra editor (Cmd+Z). NEVER delete: application-root, page-home, main-frame, main-canvas.',
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
        description: 'Create a new empty page in the Vectra project.',
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
        description: "Trigger Vectra's AI generation engine with a natural language prompt. Best for generating complete sections.",
        inputSchema: {
            type: 'object' as const,
            properties: {
                prompt: { type: 'string', description: 'Natural language description, e.g. "Add a hero section with a gradient headline and two CTA buttons".' },
                pageId: { type: 'string', description: 'Optional: target a specific page. Defaults to active page.' },
            },
            required: ['prompt'],
        },
    },
    {
        name: 'vectra_update_theme',
        description: "Update the project's global design theme. Changes propagate to all pages instantly.",
        inputSchema: {
            type: 'object' as const,
            properties: {
                primary: { type: 'string', description: 'Primary brand color (hex), e.g. "#6d28d9".' },
                secondary: { type: 'string', description: 'Secondary color (hex).' },
                accent: { type: 'string', description: 'Accent/highlight color (hex).' },
                font: { type: 'string', description: 'Font family name, e.g. "Inter".' },
                radius: { type: 'string', description: 'Border radius preset: "0px" | "0.25rem" | "0.5rem" | "0.75rem" | "1rem".' },
            },
            required: [] as string[],
        },
    },
];

// ─── MCP RESOURCE SCHEMAS ─────────────────────────────────────────────────────

const RESOURCE_SCHEMAS = [
    {
        uri: 'vectra://docs',
        name: 'Vectra MCP Documentation',
        description: 'Complete reference: data model, node types, workflow guide, tool examples, and rules. Read this before making mutations.',
        mimeType: 'text/markdown',
    },
    {
        uri: 'vectra://tools',
        name: 'Tool Schemas',
        description: 'Full JSON schemas for all 10 MCP tools.',
        mimeType: 'application/json',
    },
];

// ─── MCP PROMPT SCHEMAS ───────────────────────────────────────────────────────

const PROMPT_SCHEMAS = [
    {
        name: 'vectra_workflow',
        description: 'Step-by-step workflow prompt for agents. Injects project context and guides the agent through a safe, efficient edit session.',
        arguments: [
            {
                name: 'task',
                description: 'What you want to accomplish, e.g. "Add a pricing section to the home page".',
                required: true,
            },
        ],
    },
    {
        name: 'vectra_read_docs',
        description: 'Prompt that instructs the agent to read Vectra documentation before proceeding.',
        arguments: [],
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

const TOOLS     = ${JSON.stringify(TOOL_SCHEMAS, null, 2)};
const RESOURCES = ${JSON.stringify(RESOURCE_SCHEMAS, null, 2)};
const PROMPTS   = ${JSON.stringify(PROMPT_SCHEMAS, null, 2)};
const DOCS      = ${JSON.stringify(VECTRA_DOCS)};
const TOOL_JSON = ${JSON.stringify(JSON.stringify(TOOL_SCHEMAS, null, 2))};

const INSTRUCTIONS = ${JSON.stringify(ONBOARDING_INSTRUCTIONS)};

const PROTECTED_IDS = new Set([
  'application-root', 'page-home', 'main-frame',
  'main-frame-desktop', 'main-frame-mobile', 'main-canvas',
]);

const rpcOk  = (id, result) => JSON.stringify({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, msg) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: msg } });

const executeTool = (name, args) => {
  const project = readProject();
  const { elements = {}, pages = [], theme = {}, framework = 'nextjs' } = project;

  if (name === 'vectra_get_project') {
    return {
      name: project.name || 'Vectra Project',
      framework,
      nodeCount: Object.keys(elements).length,
      pageCount: pages.length,
      pages: pages.map(p => ({ id: p.id, name: p.name, slug: p.slug })),
      theme,
      tip: 'Next: call vectra_get_page({ pageId }) with one of the page IDs above.',
    };
  }

  if (name === 'vectra_get_page') {
    const page = pages.find(p => p.id === args.pageId);
    if (!page) return { error: 'Page "' + args.pageId + '" not found. Available: ' + pages.map(p => p.id).join(', ') };
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
    if (PROTECTED_IDS.has(parentId)) return { error: 'Cannot add children to protected node "' + parentId + '".' };
    const newId = type.slice(0, 3) + '-mcp-' + Math.random().toString(36).slice(2, 12);
    return {
      __vectra_mutation__: true,
      op: 'ADD_ELEMENT',
      newId,
      parentId,
      element: {
        id: newId, type, name: elName,
        content: content || '',
        children: [],
        props: {
          className: className || '',
          style: { position: 'relative', width: '100%', ...(style || {}) },
        },
      },
    };
  }

  if (name === 'vectra_update_element') {
    if (!elements[args.elementId]) return { error: 'Element "' + args.elementId + '" not found.' };
    const { elementId, name: newName, content, style, className, props } = args;
    return { __vectra_mutation__: true, op: 'UPDATE_ELEMENT', elementId, patch: { name: newName, content, style, className, props } };
  }

  if (name === 'vectra_delete_element') {
    if (PROTECTED_IDS.has(args.elementId)) return { error: 'Cannot delete protected node "' + args.elementId + '". Protected IDs: ' + [...PROTECTED_IDS].join(', ') };
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

// ── Resources handler ─────────────────────────────────────────────────────────

const handleResources = (method, params, id, res, cors) => {
  if (method === 'resources/list') {
    res.end(rpcOk(id, { resources: RESOURCES }));
    return true;
  }
  if (method === 'resources/read') {
    const uri = params?.uri;
    if (uri === 'vectra://docs') {
      res.end(rpcOk(id, {
        contents: [{
          uri: 'vectra://docs',
          mimeType: 'text/markdown',
          text: DOCS,
        }],
      }));
      return true;
    }
    if (uri === 'vectra://tools') {
      res.end(rpcOk(id, {
        contents: [{
          uri: 'vectra://tools',
          mimeType: 'application/json',
          text: TOOL_JSON,
        }],
      }));
      return true;
    }
    res.end(rpcErr(id, -32602, 'Resource not found: ' + uri));
    return true;
  }
  return false;
};

// ── Prompts handler ───────────────────────────────────────────────────────────

const handlePrompts = (method, params, id, res) => {
  if (method === 'prompts/list') {
    res.end(rpcOk(id, { prompts: PROMPTS }));
    return true;
  }
  if (method === 'prompts/get') {
    const name = params?.name;
    const args = params?.arguments || {};

    if (name === 'vectra_read_docs') {
      res.end(rpcOk(id, {
        description: 'Read Vectra documentation before proceeding',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Before making any changes, please read the Vectra MCP documentation by calling resources/read with uri "vectra://docs". Then confirm you understand the data model, protected node IDs, and correct workflow before proceeding.',
            },
          },
        ],
      }));
      return true;
    }

    if (name === 'vectra_workflow') {
      const task = args.task || 'perform edits';
      res.end(rpcOk(id, {
        description: 'Vectra agent workflow for: ' + task,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                'You are working with the Vectra MCP server. Your task: ' + task,
                '',
                'REQUIRED workflow — follow in order:',
                '1. Call vectra_get_project to learn the page structure',
                '2. Call vectra_get_page({ pageId }) for the relevant page',
                '3. Read docs if needed: resources/read with uri "vectra://docs"',
                '4. Make your changes using the appropriate tools',
                '5. Verify with vectra_get_element if needed',
                '',
                'Rules:',
                '- Never delete protected IDs: application-root, page-home, main-frame, main-canvas',
                '- Use React.CSSProperties camelCase for style objects',
                '- Prefer flex layout over absolute positioning',
                '- Every mutation is undoable by the user with Cmd+Z',
              ].join('\\n'),
            },
          },
        ],
      }));
      return true;
    }

    res.end(rpcErr(id, -32602, 'Prompt not found: ' + name));
    return true;
  }
  return false;
};

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  resetIdle();
  const origin = req.headers.origin || '*';
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Credentials': 'true',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (req.method === 'GET' && req.url === '/mcp/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      version: '2.0',
      port: PORT,
      tools: TOOLS.length,
      resources: RESOURCES.length,
      prompts: PROMPTS.length,
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/mcp/sse') {
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
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
        // ── MCP lifecycle ─────────────────────────────────────────────────────
        if (method === 'initialize') {
          res.end(rpcOk(id, {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools:     {},
              resources: {},
              prompts:   {},
            },
            serverInfo: { name: 'vectra-mcp', version: '2.0.0' },
            // instructions is the primary context-injection point.
            // Agents that support MCP 2024-11-05 read this before any tool call.
            instructions: INSTRUCTIONS,
          }));
          return;
        }

        // Notifications have no id — do NOT send a JSON-RPC response body.
        // Sending rpcOk(undefined, {}) produces malformed {id: undefined} JSON.
        if (method === 'notifications/initialized') {
          res.end('');
          return;
        }

        if (method === 'tools/list') {
          res.end(rpcOk(id, { tools: TOOLS }));
          return;
        }

        // Resources
        if (handleResources(method, params, id, res, cors)) return;

        // Prompts
        if (handlePrompts(method, params, id, res)) return;

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
      } catch (e) {
        res.end(rpcErr(id, -32603, String(e)));
      }
    });
    return;
  }

  res.writeHead(404, cors);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[mcp] ✅ Vectra MCP Server v2.0 on port ' + PORT);
  console.log('[mcp] Tools: ' + TOOLS.length + ' | Resources: ' + RESOURCES.length + ' | Prompts: ' + PROMPTS.length);
});
`.trim();

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export const checkMcpHealth = async (): Promise<{ tools: number; resources?: number; prompts?: number } | null> => {
    if (!mcpIsRunning) return null;
    try {
        const res = await fetch(getMcpHealthUrl(), { 
            signal: AbortSignal.timeout(2000),
            credentials: 'omit' // WebContainer public ports don't need credentials, prevents CORS strict origin fail
        });
        if (!res.ok) { mcpIsRunning = false; return null; }
        return res.json();
    } catch {
        mcpIsRunning = false;
        return null;
    }
};

/**
 * ensureMcpServer — idempotent.
 * MCP-WC-1: server-ready listener registered BEFORE spawning so the
 * container-forwarded URL is captured from the event, not polled.
 */
export const ensureMcpServer = async (instance: WebContainer): Promise<string> => {
    const health = await checkMcpHealth();
    if (health) return mcpBaseUrl;
    if (mcpBootPromise) { await mcpBootPromise; return mcpBaseUrl; }

    mcpBootPromise = (async (): Promise<string> => {
        try {
            await instance.fs.writeFile('/mcp-server.mjs', buildServerSource());
            console.log('[mcp] mcp-server.mjs written to VFS');

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

            const timeoutPromise = new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('MCP server did not fire server-ready within 12 seconds.')), 12000)
            );

            const resolvedUrl = await Promise.race([serverReadyPromise, timeoutPromise]);
            mcpBaseUrl = resolvedUrl.replace(/\/$/, '');
            mcpIsRunning = true;
            console.log('[mcp] ✅ Base URL set to:', mcpBaseUrl);
            return mcpBaseUrl;
        } catch (err) {
            mcpBootPromise = null;
            throw err;
        }
    })();

    await mcpBootPromise;
    return mcpBaseUrl;
};

export const stopMcpServer = (): void => {
    mcpIsRunning = false;
    mcpBootPromise = null;
    mcpBaseUrl = `http://localhost:${MCP_PORT}`;
};

// ─── IDE CONFIG GENERATORS ────────────────────────────────────────────────────

export interface IdeConfigResult {
    config: string;
    filePath: string;
    note: string;
}

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

// ─── EXPORT DOCS for MCPPanel display ─────────────────────────────────────────
export { VECTRA_DOCS, ONBOARDING_INSTRUCTIONS };
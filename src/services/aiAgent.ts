import type { VectraNode, VectraProject } from '../types';
import { repairJSON } from '../utils/aiHelpers';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// Dual-key architecture: splits generation and debugging traffic across
// two HF accounts to prevent one exhausting the other's rate limit.
export const AI_CONFIG = {
    useLocalHeuristics: import.meta.env.VITE_AI_USE_LOCAL_HEURISTICS !== 'false',
    // HF Router — required for :together and :cheapest model tags
    endpoint: 'https://router.huggingface.co/v1/chat/completions',

    // HYBRID MODELS
    primaryModel: 'openai/gpt-oss-20b:groq',      //'zai-org/GLM-5:zai-org',         // GLM-5 via Zhipu (GLM-4.7 provider was offline)
    debuggerModel: 'zai-org/GLM-5:zai-org',       // DeepSeek-V3.2 via Fireworks AI

    // DUAL API KEYS — split traffic, double the free quota
    primaryApiKey: import.meta.env.VITE_AI_PRIMARY_KEY || import.meta.env.VITE_AI_HF_TOKEN || '',
    debuggerApiKey: import.meta.env.VITE_AI_DEBUGGER_KEY || import.meta.env.VITE_AI_HF_TOKEN || '',
};

console.log('🤖 AI Agent ready.');
console.log(' - Primary Key (generation):', AI_CONFIG.primaryApiKey ? '✅ loaded' : '❌ not set (add VITE_AI_PRIMARY_KEY to .env)');
console.log(' - Debugger Key (SRE agent):', AI_CONFIG.debuggerApiKey ? '✅ loaded' : '❌ not set (add VITE_AI_DEBUGGER_KEY to .env)');

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface AIResponse {
    elements?: Record<string, VectraNode>;
    rootId?: string;
    action: 'create' | 'update' | 'error';
    message: string;
}

// NH-3 FIX: aligned with project-wide crypto.randomUUID() standard (M-5 / aiHelpers.ts fix).
const uid = () => `ai_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

// ─── TIER 1: LOCAL HEURISTICS (Instant, zero-cost) ───────────────────────────
const processLocalIntent = (
    prompt: string,
    currentElements: VectraProject
): AIResponse | null => {
    const p = prompt.toLowerCase();

    // 1. Color changes
    const colorMatch = p.match(/(change|make|set) (.*?) (color|background|bg) to (.*?)$/);
    if (colorMatch) {
        const targetName = colorMatch[2];
        const colorVal = colorMatch[4].trim();
        const updates: Record<string, VectraNode> = {};
        let count = 0;

        Object.values(currentElements).forEach(el => {
            if (
                el.type.includes(targetName) ||
                el.name.toLowerCase().includes(targetName) ||
                targetName === 'all'
            ) {
                updates[el.id] = {
                    ...el,
                    props: {
                        ...el.props,
                        style: {
                            ...el.props.style,
                            [el.type === 'text' || el.type === 'heading' ? 'color' : 'background']: colorVal,
                        },
                    },
                };
                count++;
            }
        });

        if (count > 0) {
            return { action: 'update', elements: updates, message: `Updated ${count} element(s).` };
        }
    }

    // 2. Text content update
    if (p.includes('change text to')) {
        const textVal = prompt.split('change text to')[1].trim();
        const textNode = Object.values(currentElements).find(
            el => el.type === 'text' || el.type === 'heading'
        );
        if (textNode) {
            return {
                action: 'update',
                elements: { [textNode.id]: { ...textNode, content: textVal } },
                message: 'Updated text content.',
            };
        }
    }

    // 3. Dark mode
    if (p.includes('dark mode') || p.includes('black background')) {
        const rootId = Object.keys(currentElements).find(
            k => currentElements[k].type === 'webpage'
        );
        if (rootId) {
            const updated = { ...currentElements[rootId] };
            updated.props.className = (updated.props.className || '') + ' bg-[#09090b] text-white';
            return {
                action: 'update',
                elements: { [rootId]: updated },
                message: 'Applied Dark Mode.',
            };
        }
    }

    return null;
};

// ─── API GATEWAY ─────────────────────────────────────────────────────────────
// Hyper-resilient wrapper with HuggingFace Router retry loop.
// The HF Router occasionally drops connections when upstream providers
// (Together, cheapest) are heavily loaded, returning 503/504 which the
// browser masks as a CORS error. This loop intercepts and retries silently.
const callDirectAPI = async (
    systemPrompt: string,
    userPrompt: string,
    model: string,
    temperature: number,
    apiKey: string
): Promise<string> => {
    if (!apiKey) {
        throw new Error(`No API Key configured for model: ${model}. Check VITE_AI_PRIMARY_KEY / VITE_AI_DEBUGGER_KEY in .env`);
    }

    console.log(`🔑 Calling AI (${model.split('/').pop()})...`);

    const MAX_RETRIES = 3;
    let retries = MAX_RETRIES;
    let lastError = '';

    while (retries > 0) {
        try {
            const res = await fetch(AI_CONFIG.endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    max_tokens: 8000,
                    temperature,
                    stream: false,
                }),
            });

            if (res.ok) {
                const data = await res.json();
                return data.choices[0]?.message?.content || '';
            }

            // HF Router / upstream provider timeout — wait and retry
            if (res.status === 503 || res.status === 504) {
                console.warn(`⏳ HF Router timeout (${res.status}) — retry ${MAX_RETRIES - retries + 1}/${MAX_RETRIES} in 5s...`);
                await new Promise(r => setTimeout(r, 5000));
                retries--;
                continue;
            }

            if (res.status === 401) throw new Error('Invalid API Key (401). Check your HF token in .env.');
            if (res.status === 429) throw new Error('Rate limit exceeded (429). Please wait and try again.');

            const errText = await res.text().catch(() => '');
            throw new Error(`API Error ${res.status}: ${errText.slice(0, 120)}`);

        } catch (err: any) {
            lastError = err.message;

            // TypeError: Failed to fetch = browser CORS panic from a 504 crash
            if (err.name === 'TypeError' || err.message.toLowerCase().includes('fetch')) {
                console.warn(`⏳ Network/CORS block (HF Router wake-up) — retry ${MAX_RETRIES - retries + 1}/${MAX_RETRIES} in 5s...`);
                await new Promise(r => setTimeout(r, 5000));
                retries--;
                continue;
            }

            // Hard errors (401, 429, parse errors) — fail immediately
            throw err;
        }
    }

    throw new Error(`AI failed after ${MAX_RETRIES} retries. Last error: ${lastError}`);
};

// ─── DIRECTION C: Canvas Context Builder ─────────────────────────────────────────────────────────────────────────
/**
 * buildCanvasContext
 * ──────────────────
 * Serializes the current active page tree into a compact human-readable
 * string for injection into the AI system prompt (Direction C).
 *
 * WHY COMPACT
 * The system prompt has a token budget. We cannot send the full VectraProject
 * (potentially 10k+ tokens). Instead we extract only what the LLM needs:
 *   - Element types, names, text presence, child counts
 *   - Tree structure up to depth 4
 * This lets AI avoid duplicating existing sections and match the existing density.
 *
 * @param elements   Full VectraProject
 * @param pageRootId Root node ID of the current page
 * @param pageName   Human name for the page
 */
const buildCanvasContext = (
    elements: VectraProject,
    pageRootId: string,
    pageName: string
): string => {
    const nodeList: string[] = [];
    const visited = new Set<string>();

    const walk = (id: string, depth: number) => {
        if (visited.has(id) || depth > 4) return;
        visited.add(id);
        const node = elements[id];
        if (!node) return;
        const typeLabel = node.type.replace(/_/g, ' ');
        const hasText = typeof node.content === 'string' && node.content.length > 0;
        const childCount = node.children?.length ?? 0;
        const indent = '  '.repeat(depth);
        nodeList.push(
            `${indent}• ${typeLabel}${node.name ? ` ("${node.name}")` : ''
            }${hasText ? ' [has text]' : ''
            }${childCount > 0 ? ` [${childCount} children]` : ''
            }`
        );
        node.children?.slice(0, 8).forEach((cid: string) => walk(cid, depth + 1));
    };

    walk(pageRootId, 0);

    const summary = nodeList.slice(0, 30).join('\n');
    const truncated = nodeList.length > 30 ? `\n  ... and ${nodeList.length - 30} more` : '';

    return [
        `Page: "${pageName}" (${visited.size} total nodes)`,
        summary + truncated,
    ].join('\n');
};

// ─── SECTION SPLITTER ────────────────────────────────────────────────────────
/**
 * extractSections
 * ───────────────
 * Splits AI-generated code into independent section functions.
 *
 * TIER 1 — // SECTION: Name  (new primary marker — section-first architecture)
 * TIER 2 — // COMPONENT: Name (legacy marker — backward compatible)
 * TIER 3 — export default function boundary split (AI ignored markers)
 * TIER 4 — whole-block fallback (single component or unrecognised format)
 *
 * Return map: sectionName → source code string (includes export default function)
 * Always also sets key 'default' to the first section for fallback injection.
 */
const extractSections = (rawCode: string): Map<string, string> => {
    const sections = new Map<string, string>();

    // ── TIER 1: // SECTION: Name ────────────────────────────────────────────
    const sectionParts = rawCode.split(/\/\/\s*SECTION:\s*(\w+)/);
    if (sectionParts.length >= 3) {
        for (let i = 1; i < sectionParts.length; i += 2) {
            const name = sectionParts[i].trim();
            const code = (sectionParts[i + 1] ?? '').trim();
            if (name && code) sections.set(name, code);
        }
        if (sections.size > 0) {
            sections.set('default', sections.values().next().value!);
            console.log(`✅ extractSections TIER-1 (// SECTION:): ${sections.size - 1} sections`);
            return sections;
        }
    }

    // ── TIER 2: // COMPONENT: Name (legacy) ─────────────────────────────────
    const componentParts = rawCode.split(/\/\/\s*COMPONENT:\s*(\w+)/);
    if (componentParts.length >= 3) {
        for (let i = 1; i < componentParts.length; i += 2) {
            const name = componentParts[i].trim();
            const code = (componentParts[i + 1] ?? '').trim();
            if (name && code) {
                const normalized = code.startsWith('export default function')
                    ? code
                    : code.replace(/^function\s+/, 'export default function ');
                sections.set(name, normalized);
            }
        }
        if (sections.size > 0) {
            sections.set('default', sections.values().next().value!);
            console.log(`✅ extractSections TIER-2 (// COMPONENT:): ${sections.size - 1} sections`);
            return sections;
        }
    }

    // ── TIER 3: export default function boundary split ───────────────────────
    const exportMatches = [...rawCode.matchAll(/export\s+default\s+function\s+(\w+)/g)];
    if (exportMatches.length >= 2) {
        const positions = exportMatches.map(m => ({ name: m[1], start: m.index! }));
        positions.forEach((pos, idx) => {
            const end = positions[idx + 1]?.start ?? rawCode.length;
            const code = rawCode.slice(pos.start, end).trim();
            if (code) sections.set(pos.name, code);
        });
        if (sections.size > 0) {
            sections.set('default', sections.values().next().value!);
            console.log(`🔧 extractSections TIER-3 (export boundary): ${sections.size - 1} sections`);
            return sections;
        }
    }

    // ── TIER 4: whole-block fallback ─────────────────────────────────────────
    const name = rawCode.match(/export\s+default\s+function\s+(\w+)/)?.[1] ?? 'Component';
    sections.set(name, rawCode.trim());
    sections.set('default', rawCode.trim());
    console.log(`🔧 extractSections TIER-4 (whole block): single section "${name}"`);
    return sections;
};

// ─── TIER 2: CLOUD LLM PROCESSOR ─────────────────────────────────────────────
/**
 * processCloudLLM — Section-First Architecture
 * ─────────────────────────────────────────────
 * Generates INDEPENDENT section components rather than one monolithic page.
 *
 * WHY SECTION-FIRST:
 *   Old (one LandingPage with inner functions):
 *     ❌ All sections compiled by ONE Babel pass — one error kills everything
 *     ❌ Cannot re-generate individual sections without regenerating the whole page
 *     ❌ GitHub export merges all sections into one opaque component
 *
 *   New (N custom_code nodes, each with independent code):
 *     ✅ Each section compiled independently — isolated error boundaries
 *     ✅ Debugger fixes one section without touching others
 *     ✅ GitHub export: import Navbar from './Navbar'; import Hero from './Hero'; etc.
 *     ✅ User can select, re-generate or inspect individual sections in the canvas
 *
 * JSON CONTRACT:
 *   rootId → "container" wrapper node, layoutMode:flex, position:relative, width:100%
 *   children → N "custom_code" nodes; name MUST match // SECTION: marker
 *   Section style → position:relative, width:100% (in-flow flex children)
 */
const processCloudLLM = async (
    prompt: string,
    _currentElements: VectraProject,
    canvasContext?: string
): Promise<AIResponse> => {

    const isPagePrompt = /page|website|portfolio|landing|blog|store|dashboard/i.test(prompt);

    const systemPrompt = `VECTRA SECTION-FIRST COMPONENT GENERATOR

OUTPUT FORMAT: Return EXACTLY 2 fenced code blocks — code first, then JSON. Zero text outside them.

${isPagePrompt ? `
══════════════════════════════════════════════════════════════════════
BLOCK 1 — SECTION CODE (FULL PAGE)

Each section is a STANDALONE React component. Sections do NOT reference each other.
Precede each section with // SECTION: ExactName (MUST match the JSON "name" field exactly).
Generate sections: Navbar, HeroSection, then 2-3 content sections, Footer.

\`\`\`jsx
// SECTION: Navbar
export default function Navbar(props) {
  return (
    <nav className="w-full px-8 py-5 flex items-center justify-between bg-slate-950 border-b border-white/10 text-white sticky top-0 z-50 backdrop-blur-md">
      <span className="font-black text-xl tracking-tight">Brand</span>
      <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
        <a href="#" className="hover:text-white transition-colors">Product</a>
        <button className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-semibold">Get Started</button>
      </div>
    </nav>
  );
}

// SECTION: HeroSection
export default function HeroSection(props) {
  return (
    <section className="w-full min-h-[700px] bg-gradient-to-br from-slate-950 via-indigo-950/20 to-black flex flex-col items-center justify-center px-8 py-24 text-white">
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="text-center">
        <h1 className="text-6xl md:text-7xl font-black tracking-tight mb-6">Build <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">Faster.</span></h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10">The visual platform for teams who ship quality products.</p>
        <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
          <button className="px-8 py-4 bg-blue-600 rounded-xl text-white font-bold text-lg hover:bg-blue-500 transition-all">Start Free Trial</button>
          <button className="px-8 py-4 rounded-xl text-white font-bold text-lg border border-white/20 hover:bg-white/5 transition-all">Watch Demo →</button>
        </div>
      </motion.div>
    </section>
  );
}

// SECTION: FeaturesSection
export default function FeaturesSection(props) {
  const features = [
    { icon: 'Zap', title: 'Instant Deploy', desc: 'Push to production in seconds' },
    { icon: 'Shield', title: 'Secure by Default', desc: 'Enterprise-grade security built in' },
    { icon: 'Globe', title: 'Global CDN', desc: 'Sub-50ms load times worldwide' },
    { icon: 'Code', title: 'Clean Export', desc: 'Own your code. Export anytime' },
  ];
  return (
    <section className="w-full py-24 bg-slate-950 text-white">
      <div className="max-w-6xl mx-auto px-8">
        <h2 className="text-4xl font-black text-center mb-16">Everything you need</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => {
            const IC = Lucide[f.icon] || Lucide.Star;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} viewport={{ once: true }}
                className="p-6 bg-white/5 border border-white/10 rounded-2xl hover:border-white/20 transition-all">
                <IC className="w-6 h-6 text-blue-400 mb-4" />
                <h3 className="text-lg font-bold mb-2">{f.title}</h3>
                <p className="text-slate-400 text-sm">{f.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// SECTION: CTASection
export default function CTASection(props) {
  return (
    <section className="w-full py-24 bg-gradient-to-br from-blue-950/50 to-slate-950 border-y border-white/10 text-white text-center px-8">
      <h2 className="text-5xl font-black mb-6">Ready to ship?</h2>
      <p className="text-slate-400 text-xl max-w-xl mx-auto mb-10">Join thousands of teams. Free to start.</p>
      <button className="px-10 py-4 bg-blue-600 rounded-xl text-white font-bold text-lg hover:bg-blue-500 transition-all">Start for free</button>
    </section>
  );
}

// SECTION: Footer
export default function Footer(props) {
  return (
    <footer className="w-full py-16 bg-slate-950 border-t border-white/10 text-slate-400 text-sm">
      <div className="max-w-6xl mx-auto px-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <span className="font-black text-white text-lg">Brand</span>
        <p>© 2024 Brand Inc. All rights reserved.</p>
      </div>
    </footer>
  );
}
\`\`\`

══════════════════════════════════════════════════════════════════════
BLOCK 2 — JSON CONFIG (FULL PAGE)

RULES: wrapper has layoutMode:flex + position:relative + width:100%. Each section: position:relative + width:100%.

\`\`\`json
{
  "rootId": "wp1",
  "elements": {
    "wp1": { "id": "wp1", "type": "container", "name": "PageWrapper", "children": ["sn1","sh1","sf1","sc1","sft"], "props": { "layoutMode": "flex", "style": { "position": "relative", "width": "100%", "display": "flex", "flexDirection": "column" } } },
    "sn1": { "id": "sn1", "type": "custom_code", "name": "Navbar", "children": [], "props": { "style": { "position": "relative", "width": "100%" } } },
    "sh1": { "id": "sh1", "type": "custom_code", "name": "HeroSection", "children": [], "props": { "style": { "position": "relative", "width": "100%" } } },
    "sf1": { "id": "sf1", "type": "custom_code", "name": "FeaturesSection", "children": [], "props": { "style": { "position": "relative", "width": "100%" } } },
    "sc1": { "id": "sc1", "type": "custom_code", "name": "CTASection", "children": [], "props": { "style": { "position": "relative", "width": "100%" } } },
    "sft": { "id": "sft", "type": "custom_code", "name": "Footer", "children": [], "props": { "style": { "position": "relative", "width": "100%" } } }
  }
}
\`\`\`
` : `
══════════════════════════════════════════════════════════════════════
BLOCK 1 — SINGLE COMPONENT

\`\`\`jsx
// SECTION: ComponentName
export default function ComponentName(props) {
  return (
    <div className="w-full p-8 bg-slate-950 text-white rounded-2xl border border-white/10">
      {/* component content */}
    </div>
  );
}
\`\`\`

══════════════════════════════════════════════════════════════════════
BLOCK 2 — JSON CONFIG (SINGLE)

\`\`\`json
{
  "rootId": "wp1",
  "elements": {
    "wp1": { "id": "wp1", "type": "container", "name": "Wrapper", "children": ["sc1"], "props": { "layoutMode": "flex", "style": { "position": "relative", "width": "100%", "display": "flex", "flexDirection": "column" } } },
    "sc1": { "id": "sc1", "type": "custom_code", "name": "ComponentName", "children": [], "props": { "style": { "position": "relative", "width": "100%" } } }
  }
}
\`\`\`
`}

══════════════════════════════════════════════════════════════════════
REACT RULES — ALL REQUIRED

- Signature: export default function SectionName(props) { ... }
- NO import statements. React, motion, Lucide, cn are globally injected.
- Icons — dot notation ONLY: <Lucide.Sparkles />
  FATAL: NEVER <Icon="Name" /> or <Lucide[name] /> in JSX.
  Dynamic icons: const IC = Lucide[item.icon] || Lucide.Star; return <IC />;
- Tailwind: standard utilities or arbitrary values bg-[#0f172a]. NEVER bg-primary.
- Framer Motion: animate ONLY opacity/scale/x/y/rotate. Glow: whileHover={{ boxShadow: '0 0 32px #3b82f6' }}
- Section roots MUST use w-full. NEVER position:absolute on section roots.
- Make it STUNNING: dark glassmorphism, gradient text, micro-animations, fully responsive.

${canvasContext ? `
══════════════════════════════════════════════════════════════════════
CURRENT CANVAS STATE
${canvasContext}
- DO NOT duplicate sections already present.
- Match existing visual style.
` : ''}`;

    let content = '';
    try {
        console.log('🤖 [Generator] Calling primary model (section-first)...');
        content = await callDirectAPI(systemPrompt, `Generate: ${prompt}`, AI_CONFIG.primaryModel, 0.65, AI_CONFIG.primaryApiKey);
    } catch (e) {
        console.error('❌ [Generator] API call failed:', e);
        return { action: 'error', message: (e as Error).message };
    }

    try {
        console.log('🔍 [Generator] Parsing section-wise output...');

        const jsxMatch = content.match(/```(?:jsx?|tsx?|javascript|react)?\s*\n([\s\S]*?)\n```/i);
        const rawReactCode = jsxMatch?.[1]?.trim() ?? '';
        if (!rawReactCode) throw new Error('No JSX code block found in AI response');

        const sectionMap = extractSections(rawReactCode);
        console.log(`✅ [Generator] Sections: [${[...sectionMap.keys()].filter(k => k !== 'default').join(', ')}]`);

        const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/i);
        let rawJson = jsonMatch?.[1]?.trim() ?? '';
        if (!rawJson) {
            const firstOpen = content.indexOf('{');
            const lastClose = content.lastIndexOf('}');
            if (firstOpen !== -1 && lastClose !== -1) rawJson = content.substring(firstOpen, lastClose + 1);
        }
        if (!rawJson) throw new Error('No JSON block found in AI response');

        let parsed: any;
        try { parsed = JSON.parse(rawJson); }
        catch { console.warn('🔧 JSON malformed — attempting repairJSON...'); parsed = JSON.parse(repairJSON(rawJson)); }
        if (!parsed?.elements || !parsed?.rootId) throw new Error('Invalid JSON structure (missing elements or rootId)');

        // Inject section code into matching custom_code nodes
        let injectedCount = 0;
        const hasMultipleSections = sectionMap.size > 2;

        for (const el of Object.values(parsed.elements) as any[]) {
            if (el.type !== 'custom_code') continue;
            let code: string | undefined;
            if (hasMultipleSections) {
                code = sectionMap.get(el.name)
                    ?? sectionMap.get([...sectionMap.keys()].find(k => k.toLowerCase() === (el.name ?? '').toLowerCase()) ?? '')
                    ?? sectionMap.get('default');
            } else {
                code = sectionMap.get('default') ?? rawReactCode;
            }
            if (code) {
                el.code = code;
                injectedCount++;
                console.log(`  ↳ Injected "${el.name}" (${code.length} chars)`);
            }
        }

        if (injectedCount === 0) throw new Error('No custom_code elements found in AI JSON');

        // Guard rail: enforce position:relative + width:100% on sections (AI-SECTION-1)
        for (const el of Object.values(parsed.elements) as any[]) {
            if (el.type === 'custom_code') {
                el.props = el.props || {};
                el.props.style = { ...el.props.style, position: 'relative', width: '100%' };
            }
            if (el.type === 'container' && (el.name === 'PageWrapper' || el.name === 'Wrapper')) {
                el.props = el.props || {};
                el.props.layoutMode = 'flex';
                el.props.style = { display: 'flex', flexDirection: 'column', ...el.props.style, position: 'relative', width: '100%' };
            }
        }

        console.log(`✅ [Generator] ${Object.keys(parsed.elements).length} node(s), ${injectedCount} section(s) injected.`);
        return { action: 'create', elements: parsed.elements, rootId: parsed.rootId, message: `Generated ${injectedCount} section${injectedCount > 1 ? 's' : ''} ✨` };

    } catch (e) {
        console.error('❌ [Generator] Parse Error:', e);
        console.error('Raw output (600 chars):', content.substring(0, 600));
        return { action: 'error', message: 'Failed to parse AI response. Please try again.' };
    }
};




// ─── TIER 3: TEMPLATE FALLBACKS ───────────────────────────────────────────────
const processTemplates = async (prompt: string): Promise<AIResponse> => {
    const p = prompt.toLowerCase();
    const rootId = uid();
    await new Promise(r => setTimeout(r, 1200));

    if (p.includes('hero')) {
        return {
            action: 'create', rootId,
            message: 'Template Fallback: Hero Section',
            elements: {
                [rootId]: {
                    id: rootId, type: 'hero_geometric', name: 'Hero',
                    props: { badge: 'VECTRA', title1: 'Build Faster', title2: 'Ship Today' },
                    children: [],
                },
            },
        };
    }

    if (p.includes('pricing')) {
        const c1 = uid(), c2 = uid();
        return {
            action: 'create', rootId,
            message: 'Template Fallback: Pricing',
            elements: {
                [rootId]: {
                    id: rootId, type: 'container', name: 'Pricing',
                    props: { className: 'grid grid-cols-2 gap-4 p-10 bg-zinc-900', layoutMode: 'grid' },
                    children: [c1, c2],
                },
                [c1]: {
                    id: c1, type: 'container', name: 'Basic',
                    props: { className: 'p-6 bg-black border border-white/10 rounded-xl' },
                    children: [],
                },
                [c2]: {
                    id: c2, type: 'container', name: 'Pro',
                    props: { className: 'p-6 bg-blue-900/20 border border-blue-500 rounded-xl' },
                    children: [],
                },
            },
        };
    }

    if (p.includes('landing') || p.includes('website')) {
        const navId = uid(), heroId = uid(), featId = uid();
        return {
            action: 'create', rootId,
            message: 'Template Fallback: Landing Page',
            elements: {
                [rootId]: {
                    id: rootId, type: 'container', name: 'Landing Page',
                    props: { className: 'bg-black min-h-screen text-white flex flex-col' },
                    children: [navId, heroId, featId],
                },
                [navId]: {
                    id: navId, type: 'container', name: 'Navbar',
                    props: { className: 'flex items-center justify-between p-6 border-b border-white/10' },
                    children: [],
                },
                [heroId]: {
                    id: heroId, type: 'hero_geometric', name: 'Hero',
                    props: { badge: 'VECTRA', title1: 'Welcome', title2: 'to Vectra' },
                    children: [],
                },
                [featId]: {
                    id: featId, type: 'container', name: 'Features',
                    props: { className: 'grid grid-cols-3 gap-8 p-20' },
                    children: [],
                },
            },
        };
    }

    return {
        action: 'error',
        message: AI_CONFIG.primaryApiKey
            ? "I couldn't process that. Try: 'hero', 'pricing', or 'landing page'."
            : 'Add VITE_AI_PRIMARY_KEY to your .env file to enable AI generation.',
    };
};

// ─── DEBUGGER AGENT (CRITIC / AUTO-FIX) ──────────────────────────────────────
// Autonomous SRE Agent — silently powers the self-healing loop.
// Uses debuggerApiKey + DeepSeek-V3 (405B class) for surgical, precise fixes.
// The SRE mindset (Root Cause Analysis, Surgical Precision, Safe Fallbacks) runs
// internally — no explanatory text is emitted to save tokens/latency.
export const fixComponentError = async (
    brokenCode: string,
    errorMessage: string,
    passedApiKey?: string
): Promise<string> => {
    // Debugger key takes priority; fall back to primary or any passed key
    const activeKey = AI_CONFIG.debuggerApiKey || passedApiKey || AI_CONFIG.primaryApiKey;

    const SYSTEM_PROMPT = `VECTRA SECTION DEBUGGER — AUTONOMOUS REPAIR AGENT

You are an expert SRE powering the self-healing loop of the Vectra canvas.
Your ONLY job: return fixed code. Zero explanation. Zero apology.

════════════════════════════════════════════════════════════════
VECTRA SECTION ARCHITECTURE — CRITICAL CONTEXT

Each component is an INDEPENDENT section rendered in isolation.
A section is NOT a full page. It is NOT a layout wrapper.
A section renders ONE semantic block: nav, hero, features grid, footer, etc.

When fixing: preserve the section's VISUAL INTENT entirely.
DO NOT: add a full-page wrapper, change the root element to a full-page div.
DO NOT: add sections from other parts of the page.
DO NOT: introduce imports or require() calls.
DO NOT: restructure into inner functions — keep it as one flat component.

════════════════════════════════════════════════════════════════
SANDBOX CONSTRAINTS — ABSOLUTE RULES

1. NO import statements of any kind. The following are globally available:
   React · useState · useEffect · useRef · useCallback · useMemo · useReducer
   motion · AnimatePresence · useAnimation · useInView · useMotionValue · useTransform
   Lucide (all icons as Lucide.X) · cn · AnimatePresence

2. ICON RULES — the most common source of render failures:
   ✅ CORRECT:   <Lucide.Star />
   ✅ CORRECT:   const IC = Lucide[item.icon] || Lucide.Star; return <IC />;
   ❌ FATAL:     <Lucide[name] />  ← bracket notation in JSX = syntax error
   ❌ FATAL:     <Icon name="Star" />  ← Icon is not defined
   ❌ FATAL:     <Icon="Star" />  ← invalid JSX attribute syntax

3. HOOKS RULES:
   ✅ useState/useEffect can only be called at the TOP LEVEL of the export default function.
   ❌ FATAL: hooks inside inner functions, map callbacks, or conditionals.
   FIX: move all useState/useEffect to the top of the component body.

4. JSX RULES:
   ✅ Return a SINGLE root element. Wrap siblings in <> </> fragments.
   ❌ FATAL: Multiple root elements without a wrapper.
   ❌ FATAL: {items.map(...)} on undefined arrays — add ?? [] guard.

5. EXPORT RULE:
   MUST end with: export default function ComponentName(props) { ... }

════════════════════════════════════════════════════════════════
COMMON ERROR PATTERNS — DIAGNOSE AND FIX

ERROR: "Lucide[x] is not a component" or blank render
  CAUSE: Dynamic icon with bracket notation in JSX
  FIX: const IC = Lucide[iconName] || Lucide.HelpCircle; return <IC ... />;

ERROR: "Cannot read properties of undefined (reading 'map')"
  CAUSE: .map() on a prop or variable that may be undefined
  FIX: Add nullish coalescing: (items ?? []).map(...)

ERROR: "Invalid hook call"
  CAUSE: useState/useEffect called inside inner function, conditional, or loop
  FIX: Move all hooks to top of the export default function body

ERROR: "Objects are not valid as a React child"
  CAUSE: Rendering a plain object { } directly in JSX
  FIX: Access a string property: {item.label} not {item}

ERROR: "Element type is invalid"
  CAUSE: Component is undefined — usually a Lucide icon or missing export
  FIX: Check icon names, ensure export default is present

════════════════════════════════════════════════════════════════
RESPONSE FORMAT — MANDATORY

Return ONLY the fixed code inside a single \`\`\`jsx block.
ZERO conversational text. ZERO diagnosis text. ZERO apologies.
The output is consumed directly by a Babel compiler — any non-code text causes a parse failure.`;

    const USER_PROMPT = `ERROR MESSAGE:\n${errorMessage}\n\nBROKEN CODE:\n\`\`\`jsx\n${brokenCode}\n\`\`\``;

    try {
        console.log('🛠️ [SRE Agent] DeepSeek-V3.2 (Fireworks) autonomous diagnosis running...');
        // temperature=0.1 → deterministic, no creative hallucination during a fix
        const content = await callDirectAPI(SYSTEM_PROMPT, USER_PROMPT, AI_CONFIG.debuggerModel, 0.1, activeKey);

        const match = content.match(/```(?:jsx?|tsx?|javascript|js|react)?\s*\n([\s\S]*?)\n```/i);
        const fixed = match ? match[1].trim() : content.trim();

        if (!fixed) throw new Error('SRE Agent returned an empty response.');
        console.log('✅ [SRE Agent] Fix received — recompiling canvas...');
        return fixed;

    } catch (err: any) {
        console.error('🔴 [SRE Agent] Failed to produce a fix:', err);
        throw new Error('Debugger AI failed to process the fix.');
    }
};

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
export const generateWithAI = async (
    prompt: string,
    currentElements: VectraProject,
    pageContext?: { pageRootId: string; pageName: string }   // Direction C
): Promise<AIResponse> => {

    // Tier 1: Local heuristics (instant, zero-cost)
    if (AI_CONFIG.useLocalHeuristics) {
        const local = processLocalIntent(prompt, currentElements);
        if (local) return local;
    }

    // Direction C: build canvas context string so LLM knows what's on screen
    const canvasContext = pageContext
        ? buildCanvasContext(currentElements, pageContext.pageRootId, pageContext.pageName)
        : undefined;

    // Tier 2: Cloud LLM generation
    const cloudResult = await processCloudLLM(prompt, currentElements, canvasContext);

    // Tier 3: Template fallback if cloud fails
    if (cloudResult.action === 'error') {
        console.warn('Cloud failed, falling back to templates...');
        return await processTemplates(prompt);
    }

    return cloudResult;
};

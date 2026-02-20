import type { VectraNode, VectraProject } from '../types';
import { repairJSON } from '../utils/aiHelpers';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// Keys are read from .env at build time via Vite's import.meta.env.
// VITE_* vars are visible in the client bundle — this is acceptable for a
// local/self-hosted dev tool. For a public SaaS, move calls server-side.
export const AI_CONFIG = {
    useLocalHeuristics: import.meta.env.VITE_AI_USE_LOCAL_HEURISTICS !== 'false',
    endpoint: import.meta.env.VITE_AI_OPENAI_BASE_URL || 'https://router.huggingface.co/v1/chat/completions',
    model: import.meta.env.VITE_AI_OPENAI_MODEL || 'zai-org/GLM-4.7-Flash:cheapest',
    apiKey: import.meta.env.VITE_AI_HF_TOKEN || '',
};

console.log('🤖 AI Agent ready. API key:', AI_CONFIG.apiKey ? '✅ loaded from .env' : '❌ not set (add VITE_AI_HF_TOKEN to .env)');

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface AIResponse {
    elements?: Record<string, VectraNode>;
    rootId?: string;
    action: 'create' | 'update' | 'error';
    message: string;
}

const uid = () => 'ai_' + Math.random().toString(36).substr(2, 9);

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

// ─── TIER 2: DIRECT API (API Key) ─────────────────────────────────────────────
const callDirectAPI = async (systemPrompt: string, userPrompt: string): Promise<string> => {
    if (!AI_CONFIG.apiKey) {
        throw new Error('No API Key configured. Please add your key in Settings → AI Key.');
    }

    console.log('🔑 Calling AI via API Key...');

    const res = await fetch(AI_CONFIG.endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${AI_CONFIG.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: AI_CONFIG.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: 16000,
            temperature: 0.2,
            stream: false,
        }),
    });

    if (!res.ok) {
        // Specific guidance for the most common errors
        if (res.status === 401) throw new Error('Invalid API Key (401). Please check your key in Settings.');
        if (res.status === 429) throw new Error('Rate limit exceeded (429). Please wait and try again.');
        const errText = await res.text().catch(() => '');
        throw new Error(`API Error ${res.status}: ${errText.slice(0, 120)}`);
    }

    const data = await res.json();
    return data.choices[0]?.message?.content || '';
};

// ─── TIER 2: CLOUD LLM PROCESSOR ─────────────────────────────────────────────
const processCloudLLM = async (
    prompt: string,
    _currentElements: VectraProject
): Promise<AIResponse> => {

    // ── PROMPT ────────────────────────────────────────────────────────────────
    // Two-block strategy: AI writes JSX in a ```jsx block and a tiny JSON config
    // in a ```json block. We extract them separately and inject the code string
    // programmatically — no JSON escaping required, ever.
    const systemPrompt = `VECTRA UI ENGINE — You MUST return EXACTLY two code blocks. Nothing else.

BLOCK 1 — Raw React code (no imports needed):
\`\`\`jsx
export default function ComponentName(props) {
  // your full component here
}
\`\`\`

BLOCK 2 — Tiny JSON config only (no "code" field — I inject it programmatically):
\`\`\`json
{
  "rootId": "custom_1",
  "elements": {
    "custom_1": { "id": "custom_1", "type": "custom_code", "name": "Component Name", "props": {}, "children": [] }
  }
}
\`\`\`

[REACT RULES — ALL REQUIRED]
- Signature MUST be: export default function ComponentName(props) { ... }
- NO import statements. React, motion, Lucide, cn are global.
- Icons: const Icon = Lucide[name] || Lucide.HelpCircle; then <Icon /> — NEVER <Lucide[name] />
- Tailwind: standard utilities or arbitrary values bg-[#0f172a]. NEVER custom tokens (bg-primary).
- Framer: ONLY animate opacity/scale/x/y/rotate. NEVER animate Tailwind class strings (crashes).
  Colors → Tailwind hover: classes. Glow → whileHover={{ boxShadow: '0 0 20px #3b82f6' }}
- Stagger lists: transition={{ delay: i * 0.1 }}
- whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} on all cards & buttons.

[DESIGN]
- Dark glassmorphism: bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl
- Background: min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950/20 to-black
- Headers: tracking-tight font-bold. Body: text-slate-400 leading-relaxed.
- Fully responsive: sm: md: lg: prefixes on all layouts.
- Default for vague prompts: stunning Hero section + Feature grid below it.`;

    let content = '';

    try {
        console.log('🔑 Calling AI Code Generator...');
        content = await callDirectAPI(systemPrompt, `Build: ${prompt}`);
    } catch (e) {
        console.error('❌ AI API call failed:', e);
        return { action: 'error', message: (e as Error).message };
    }

    // ── Parse: Two-Block Extraction ───────────────────────────────────────────
    try {
        console.log('🤖 AI Response received. Extracting blocks...');

        // Step 1 — Extract the JSX/JS code block
        // Regex handles: trailing spaces after language tag, all common language variants, case-insensitive
        const jsxMatch = content.match(/```(?:jsx?|tsx?|javascript|react)?\s*\n([\s\S]*?)\n```/i);
        const rawReactCode = jsxMatch?.[1]?.trim() ?? '';

        // Step 2 — Extract the JSON config block
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
        let rawJson = jsonMatch?.[1]?.trim() ?? '';

        // Fallback: if the AI forgot the ```json fence, grab the first { ... }
        if (!rawJson) {
            const firstOpen = content.indexOf('{');
            const lastClose = content.lastIndexOf('}');
            if (firstOpen !== -1 && lastClose !== -1) {
                rawJson = content.substring(firstOpen, lastClose + 1);
            }
        }

        if (!rawJson) throw new Error('No JSON block found in AI response');
        if (!rawReactCode) throw new Error('No JSX code block found in AI response');

        console.log(`✅ Extracted JSX (${rawReactCode.length} chars) + JSON config`);

        // Step 3 — Parse the JSON config (no code string inside, so nothing to escape)
        let parsed: any;
        try {
            parsed = JSON.parse(rawJson);
        } catch {
            console.warn('🔧 JSON malformed — attempting repairJSON...');
            parsed = JSON.parse(repairJSON(rawJson));
        }

        if (!parsed?.elements || !parsed?.rootId) {
            throw new Error('Invalid JSON structure (missing elements or rootId)');
        }

        // Step 4 — Inject the React code string programmatically (zero escaping needed)
        let injected = false;
        const rootEl = parsed.elements[parsed.rootId];
        if (rootEl?.type === 'custom_code') {
            rootEl.code = rawReactCode;
            injected = true;
        } else {
            // Fallback: scan tree for any custom_code element
            for (const el of Object.values(parsed.elements) as any[]) {
                if (el.type === 'custom_code') {
                    el.code = rawReactCode;
                    injected = true;
                    break;
                }
            }
        }

        if (!injected) throw new Error("AI JSON contained no 'custom_code' element — cannot inject code");

        console.log(`✅ Generated ${Object.keys(parsed.elements).length} element(s) — code injected safely`);
        return {
            action: 'create',
            elements: parsed.elements,
            rootId: parsed.rootId,
            message: 'Generated with AI 🔑',
        };

    } catch (e) {
        console.error('❌ Parse Error:', e);
        console.error('Raw AI output (first 600 chars):', content.substring(0, 600));
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
        message: AI_CONFIG.apiKey
            ? "I couldn't process that. Try: 'hero', 'pricing', or 'landing page'."
            : 'Add VITE_HF_TOKEN to your .env file to enable AI generation.',
    };
};

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
export const generateWithAI = async (
    prompt: string,
    currentElements: VectraProject
): Promise<AIResponse> => {

    // Tier 1: Local heuristics (instant, zero-cost)
    if (AI_CONFIG.useLocalHeuristics) {
        const local = processLocalIntent(prompt, currentElements);
        if (local) return local;
    }

    // Tier 2: API Key cloud generation
    const cloudResult = await processCloudLLM(prompt, currentElements);

    // Tier 3: Template fallback if cloud fails
    if (cloudResult.action === 'error') {
        console.warn('Cloud failed, falling back to templates...');
        return await processTemplates(prompt);
    }

    return cloudResult;
};

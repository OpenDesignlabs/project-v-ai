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
    primaryModel: 'zai-org/GLM-4.7-Flash:zai-org',                      // GLM-5 via Zhipu (GLM-4.7 provider was offline)
    debuggerModel: 'meta-llama/Llama-3.1-8B-Instruct:scaleway',       // DeepSeek-V3.2 via Fireworks AI

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

// ─── TIER 2: CLOUD LLM PROCESSOR ─────────────────────────────────────────────
const processCloudLLM = async (
    prompt: string,
    _currentElements: VectraProject
): Promise<AIResponse> => {

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
- Icons — dot notation ONLY: <Lucide.Sparkles />
  FATAL ERROR: NEVER write <Icon="Name" /> or <Icon name="Name" /> — invalid JSX, crashes compiler.
  FATAL ERROR: NEVER write <Lucide[item.icon] /> — bracket notation in JSX is FORBIDDEN.
  For dynamic icons in loops: const IC = Lucide[item.icon] || Lucide.HelpCircle; then <IC />
- Tailwind: standard utilities or arbitrary values bg-[#0f172a]. NEVER custom tokens (bg-primary).
- Framer: ONLY animate opacity/scale/x/y/rotate. NEVER animate Tailwind class strings (crashes).
  Colors → Tailwind hover: classes. Glow → whileHover={{ boxShadow: '0 0 20px #3b82f6' }}
- Stagger lists: transition={{ delay: i * 0.1 }}
- whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} on all cards & buttons.

[LAYOUT RULES]
- ALWAYS use relative block or flex flow for the outermost container: <main className="w-full min-h-screen flex flex-col">
- NEVER use position:absolute or position:fixed on the root wrapper — the page will not scroll.
- Sections stack vertically in normal document flow. Each section: w-full, no fixed height.

[DESIGN]
- Dark glassmorphism: bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl
- Background: min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950/20 to-black
- Headers: tracking-tight font-bold. Body: text-slate-400 leading-relaxed.
- Fully responsive: sm: md: lg: prefixes on all layouts.
- Default for vague prompts: stunning Hero section + Feature grid below it.`;

    let content = '';

    try {
        console.log('🔑 Calling AI Code Generator (primary key)...');
        content = await callDirectAPI(systemPrompt, `Build: ${prompt}`, AI_CONFIG.primaryModel, 0.6, AI_CONFIG.primaryApiKey);
    } catch (e) {
        console.error('❌ AI API call failed:', e);
        return { action: 'error', message: (e as Error).message };
    }

    // ── Parse: Two-Block Extraction ───────────────────────────────────────────
    try {
        console.log('🤖 AI Response received. Extracting blocks...');

        const jsxMatch = content.match(/```(?:jsx?|tsx?|javascript|react)?\s*\n([\s\S]*?)\n```/i);
        const rawReactCode = jsxMatch?.[1]?.trim() ?? '';

        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/i);
        let rawJson = jsonMatch?.[1]?.trim() ?? '';

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

        let injected = false;
        const rootEl = parsed.elements[parsed.rootId];
        if (rootEl?.type === 'custom_code') {
            rootEl.code = rawReactCode;
            injected = true;
        } else {
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

    const SYSTEM_PROMPT = `You are an elite Senior Software Reliability Engineer and Expert Debugger powering the autonomous self-healing loop of the Vectra Visual Builder.
Your sole purpose is to diagnose and resolve React render errors, Babel compilation failures, and runtime exceptions with surgical precision. You operate purely on evidence.

[CORE DEBUGGING DIRECTIVES]
1. Root Cause Analysis: Trace the data flow backwards from the crash point. Determine if the error is a data issue, undefined prop, syntax mismatch, or invalid React hook usage. Do not just patch symptoms; resolve the root cause.
2. Surgical Precision: Make the minimal necessary changes to resolve the issue. Do not rewrite entire functions or change the architectural intent/design unless fundamentally broken.
3. Safe Fallbacks: Check for undefined props, invalid loops, or unhandled null states. Add safe optional chaining (?.), nullish coalescing (??), or simple fallback UI guards where appropriate.

[VECTRA SANDBOX CONSTRAINTS — CRITICAL]
This code executes in a specialised CommonJS sandbox. You MUST obey:
1. NO import statements. React, Lucide, motion, AnimatePresence, and cn are globally injected.
2. Icon Syntax — dot notation only: <Lucide.Sparkles />
   FATAL: NEVER <Icon="Name" /> or <Icon name="Name" />
   FATAL: NEVER <Lucide[name] /> in JSX. Assign first: const Ic = Lucide[name] || Lucide.HelpCircle; then <Ic />
3. The component MUST have a default export: export default function ComponentName(props) { ... }
4. Hooks available globally: useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext.
5. Framer Motion globals: motion, AnimatePresence, useAnimation, useInView, useMotionValue, useTransform.

[RESPONSE FORMAT — MANDATORY]
You are an automated background service. Execute your diagnostic loop INTERNALLY.
Return ONLY the raw fixed code inside a single \`\`\`jsx block.
Provide ZERO conversational text, diagnoses, explanations, or apologies.`;

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
    currentElements: VectraProject
): Promise<AIResponse> => {

    // Tier 1: Local heuristics (instant, zero-cost)
    if (AI_CONFIG.useLocalHeuristics) {
        const local = processLocalIntent(prompt, currentElements);
        if (local) return local;
    }

    // Tier 2: Cloud LLM generation
    const cloudResult = await processCloudLLM(prompt, currentElements);

    // Tier 3: Template fallback if cloud fails
    if (cloudResult.action === 'error') {
        console.warn('Cloud failed, falling back to templates...');
        return await processTemplates(prompt);
    }

    return cloudResult;
};

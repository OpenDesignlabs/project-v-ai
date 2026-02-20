// Quick test to verify AI integration end-to-end
// Open browser console and run: testAIIntegration()

window.testAIIntegration = async function () {
    console.log("🧪 Testing AI Integration...\n");

    // 1. Test AI Service directly
    console.log("Step 1: Testing AI Service (aiAgent.ts)");
    const { generateWithAI } = await import('./src/services/aiAgent.ts');
    const mockElements = {
        "root": { id: "root", type: "webpage", name: "Home", props: {}, children: [] }
    };

    const result = await generateWithAI("create a dark portfolio page", mockElements);
    console.log("✅ AI Service Result:", result);

    if (result.action === 'create' && result.elements) {
        console.log("✅ Elements generated:", Object.keys(result.elements).length);
        console.log("✅ Root ID:", result.rootId);
        console.log("\n📦 Generated Elements:");
        Object.values(result.elements).forEach(el => {
            console.log(`  - ${el.name} (${el.type})`);
        });
    }

    // 2. Test EditorContext integration
    console.log("\n\nStep 2: Testing EditorContext Integration");
    console.log("Open Magic Bar (Ctrl+K) and type: 'create a hero section'");
    console.log("Watch the console for these logs:");
    console.log("  🎨 AI Agent processing: ...");
    console.log("  ✨ Creating new elements...");
    console.log("  📌 Attaching to page: ...");
    console.log("  ✅ Canvas updated with X new elements");

    console.log("\n✅ Test complete! Try the Magic Bar now.");
};

console.log("🎯 Test function loaded! Run: testAIIntegration()");

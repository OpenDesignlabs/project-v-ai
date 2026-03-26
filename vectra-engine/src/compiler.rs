// ══════════════════════════════════════════════════════════════════════════════
// compiler.rs  —  §3 SwcCompiler  §13 CodeSanitizer  §14 ComponentAnalyzer  §15 CodeWrapper
// ══════════════════════════════════════════════════════════════════════════════
//
//  §3  SwcCompiler   — TSX→JS (full + minified), JSX validation
//  §13 CodeSanitizer — sanitize_code (import strip, quote fix, icon JSX)
//                      check_sandbox_violations (eval, fetch, localStorage…)
//  §14 ComponentAnalyzer — detect_component_name, detect_default_export,
//                          is_valid_react_component, generate_component_id,
//                          get_detection_preview
//  §15 CodeWrapper   — to_pascal_case, wrap_component_next, wrap_component_vite

use wasm_bindgen::prelude::*;
use swc_core::common::{
    comments::SingleThreadedComments, sync::Lrc,
    FileName, Globals, Mark, SourceMap, GLOBALS, Spanned,
};
use swc_core::ecma::{
    codegen::{text_writer::JsWriter, Config, Emitter},
    parser::{lexer::Lexer, Parser, StringInput, Syntax, TsConfig},
    transforms::{
        react::{react, Options as ReactOptions, Runtime},
        typescript::strip,
    },
    visit::FoldWith,
};
use crate::state::uuid_hex;

// ── §3 SwcCompiler ────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct SwcCompiler;

#[wasm_bindgen]
impl SwcCompiler {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SwcCompiler { SwcCompiler }

    /// Full TSX → ES5/CJS compilation. Used by compiler.worker.ts.
    pub fn compile(&self, code: String) -> Result<String, JsValue> {
        compile_internal(code, false)
    }

    /// Minified TSX → ES5/CJS. ~35% smaller output for ZIP export.
    pub fn compile_minified(&self, code: String) -> Result<String, JsValue> {
        compile_internal(code, true)
    }

    /// Parse-only validation. Returns "" if clean or "line:col — parse error".
    pub fn validate_jsx(&self, code: String) -> String {
        let globals = Globals::new();
        let cm: Lrc<SourceMap> = Default::default();
        GLOBALS.set(&globals, || {
            let fm = cm.new_source_file(FileName::Custom("c.tsx".into()), code);
            let lex = Lexer::new(
                Syntax::Typescript(TsConfig { tsx: true, decorators: true, ..Default::default() }),
                Default::default(), StringInput::from(&*fm), None,
            );
            match Parser::new_from(lex).parse_program() {
                Ok(_)  => "".into(),
                Err(e) => {
                    let loc = cm.lookup_char_pos(e.span().lo);
                    format!("{}:{} — parse error", loc.line, loc.col.0 + 1)
                }
            }
        })
    }
}

/// Free-function alias used by legacy call sites.
#[wasm_bindgen]
pub fn compile_component(code: String) -> Result<String, JsValue> {
    SwcCompiler::new().compile(code)
}

fn compile_internal(code: String, minify: bool) -> Result<String, JsValue> {
    let globals  = Globals::new();
    let cm: Lrc<SourceMap> = Default::default();
    let comments = SingleThreadedComments::default();
    GLOBALS.set(&globals, || {
        let fm  = cm.new_source_file(FileName::Custom("c.tsx".into()), code);
        let lex = Lexer::new(
            Syntax::Typescript(TsConfig { tsx: true, decorators: true, ..Default::default() }),
            Default::default(), StringInput::from(&*fm), Some(&comments),
        );
        let program = Parser::new_from(lex).parse_program().map_err(|e| {
            let loc = cm.lookup_char_pos(e.span().lo);
            JsValue::from_str(&format!("Parse error at {}:{}", loc.line, loc.col.0 + 1))
        })?;
        let mark = Mark::new();
        let mut p = program.fold_with(&mut strip(mark));
        p = p.fold_with(&mut react::<SingleThreadedComments>(
            cm.clone(), Some(comments.clone()),
            ReactOptions { runtime: Some(Runtime::Classic), ..Default::default() },
            mark, Mark::new(),
        ));
        let mut buf = vec![];
        {
            let mut em = Emitter {
                cfg: Config::default().with_minify(minify),
                cm: cm.clone(), comments: Some(&comments),
                wr: JsWriter::new(cm, "\n", &mut buf, None),
            };
            em.emit_program(&p).map_err(|_| JsValue::from_str("Emit Error"))?;
        }
        String::from_utf8(buf).map_err(|_| JsValue::from_str("UTF-8 Error"))
    })
}

// ── §13 CodeSanitizer ─────────────────────────────────────────────────────────

/// Clean AI-generated component code before compilation or embedding.
/// Stages: strip imports → normalise quotes → fix Icon JSX → remove </Icon>.
/// Mirrors: `codeSanitizer.sanitizeCode(code)`
#[wasm_bindgen]
pub fn sanitize_code(code: String) -> String {
    let mut s = code;

    // Stage 1: Strip ES imports line-by-line
    s = strip_imports(&s);

    // Stage 2: Normalise smart quotes + zero-width chars
    s = s
        .replace('\u{201C}', "\"").replace('\u{201D}', "\"")
        .replace('\u{2018}', "'").replace('\u{2019}', "'")
        .replace('\u{200B}', "").replace('\u{200C}', "")
        .replace('\u{200D}', "").replace('\u{FEFF}', "");

    // Stage 3: Fix static Icon JSX: <Icon name="Star" /> → <Lucide.Star />
    s = fix_icon_static(&s);

    // Stage 4: Fix dynamic bracket: <Lucide[name]> → <DynamicIcon name={name}>
    s = fix_lucide_bracket(&s);
    s = s.replace("</Lucide[", "</DynamicIcon>");

    // Stage 5: Fix dynamic prop: <Icon name={x} /> → <DynamicIcon name={x} />
    s = fix_icon_dynamic(&s);

    // Stage 6: Remove orphaned </Icon>
    s = s.replace("</Icon>", "");

    s.trim().to_string()
}

/// Check for browser-unsafe patterns. Returns first violation name or "".
/// Mirrors: `SANDBOX_BLOCKED_PATTERNS.find(p => p.test(code))`
#[wasm_bindgen]
pub fn check_sandbox_violations(code: &str) -> String {
    const CHECKS: &[(&str, &str)] = &[
        ("eval(",            "eval("),
        ("new Function(",    "new Function("),
        ("document.cookie",  "document.cookie"),
        ("localStorage",     "localStorage"),
        ("sessionStorage",   "sessionStorage"),
        ("indexedDB",        "indexedDB"),
        ("fetch(",           "fetch("),
        ("XMLHttpRequest",   "XMLHttpRequest"),
        ("importScripts(",   "importScripts("),
        ("sendBeacon",       "sendBeacon"),
        ("window.open(",     "window.open("),
        ("location.href",    "location.href"),
        ("location.replace", "location.replace"),
        ("location.assign",  "location.assign"),
    ];
    for (pat, label) in CHECKS {
        if code.contains(pat) { return label.to_string(); }
    }
    String::new()
}

// ── §13 Internal helpers ──────────────────────────────────────────────────────

fn strip_imports(s: &str) -> String {
    let lines: Vec<&str> = s.split('\n').collect();
    let mut out = Vec::with_capacity(lines.len());
    for line in lines {
        let t = line.trim_start();
        if (t.starts_with("import ") || t.starts_with("import{"))
            && (t.contains(" from ") || t.contains('"') || t.contains('\''))
            && (t.ends_with(';') || t.ends_with('\'') || t.ends_with('"'))
        {
            continue; // skip import line
        }
        out.push(line);
    }
    out.join("\n")
}

fn fix_icon_static(s: &str) -> String {
    // <Icon name="Star" /> → <Lucide.Star
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Find "<Icon " or "<Icon="
        if i + 5 < bytes.len() && &bytes[i..i+5] == b"<Icon" && (bytes[i+5] == b' ' || bytes[i+5] == b'=' || bytes[i+5] == b'\n') {
            // Find name= attribute
            if let Some(rel) = s[i..].find("name=\"").or_else(|| s[i..].find("name='")) {
                let attr_start = i + rel + 6;
                let quote = bytes[i + rel + 5];
                if let Some(end_rel) = s[attr_start..].find(quote as char) {
                    let name = &s[attr_start..attr_start + end_rel];
                    out.push_str("<Lucide.");
                    out.push_str(name);
                    // Skip past the attribute in input
                    i = attr_start + end_rel + 1;
                    continue;
                }
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn fix_lucide_bracket(s: &str) -> String {
    // <Lucide[expr]> → <DynamicIcon name={expr}>
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(idx) = rest.find("<Lucide[") {
        out.push_str(&rest[..idx]);
        let after = &rest[idx + 8..]; // skip "<Lucide["
        if let Some(close) = after.find(']') {
            let expr = &after[..close];
            out.push_str("<DynamicIcon name={");
            out.push_str(expr);
            out.push('}');
            out.push('>');
            rest = &after[close + 1..]; // skip "]"
            // skip '>' if present
            if rest.starts_with('>') { rest = &rest[1..]; }
        } else {
            out.push_str("<Lucide[");
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

fn fix_icon_dynamic(s: &str) -> String {
    // <Icon name={expr} → <DynamicIcon name={expr}
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(idx) = rest.find("<Icon ") {
        let after = &rest[idx + 6..];
        if after.starts_with("name={") || after.starts_with("icon={") || after.starts_with("component={") {
            out.push_str(&rest[..idx]);
            out.push_str("<DynamicIcon ");
            rest = after;
        } else {
            out.push_str(&rest[..idx + 6]);
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

// ── §14 ComponentAnalyzer ─────────────────────────────────────────────────────

/// Detect the exported component name from React source code.
/// Mirrors: `detectComponentName(code, filename)` in importHelpers.ts
#[wasm_bindgen]
pub fn detect_component_name(code: &str, filename: &str) -> String {
    for prefix in &["export default function ", "export const ", "export function ", "function "] {
        if let Some(idx) = code.find(prefix) {
            let rest = &code[idx + prefix.len()..];
            let name: String = rest.chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if !name.is_empty() && name.chars().next().map(|c| c.is_alphabetic()).unwrap_or(false) {
                return name;
            }
        }
    }
    if let Some(idx) = code.find("const ") {
        let rest = &code[idx + 6..];
        let name: String = rest.chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() && name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
            return name;
        }
    }
    if !filename.is_empty() {
        let base = filename.split('.').next().unwrap_or("");
        let cleaned: String = base.chars().filter(|c| c.is_alphanumeric()).collect();
        if !cleaned.is_empty() { return cleaned; }
    }
    "CustomComponent".to_string()
}

/// Returns true if the code uses a default export.
/// Mirrors: `detectDefaultExport(code)` in importHelpers.ts
#[wasm_bindgen]
pub fn detect_default_export(code: &str) -> bool {
    code.contains("export default function ")
        || code.contains("export default class ")
        || code.contains("export default (")
        || code.trim().rfind("export default ").map(|idx| {
            code.trim()[idx + 15..].trim_start().chars().next()
                .map(|c| c.is_alphabetic()).unwrap_or(false)
        }).unwrap_or(false)
}

/// Returns true if the code looks like a valid React component.
/// Mirrors: `isValidReactComponent(code)` in importHelpers.ts
#[wasm_bindgen]
pub fn is_valid_react_component(code: &str) -> bool {
    let has_react = code.contains("from 'react'") || code.contains("from \"react\"");
    let has_jsx = code.as_bytes().windows(2).any(|w| w[0] == b'<' && w[1].is_ascii_alphabetic());
    let has_export = code.contains("export ");
    has_jsx || (has_react && has_export)
}

/// Generate a collision-proof registry ID: "custom-{kebab}-{8hex}".
/// Mirrors: `generateComponentId(name)` in importHelpers.ts
#[wasm_bindgen]
pub fn generate_component_id(name: &str) -> String {
    let kebab: String = name.chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-");
    let kebab = kebab.trim_matches('-').to_string();
    let suffix = &uuid_hex()[..8];
    format!("custom-{}-{}", if kebab.is_empty() { "component".to_string() } else { kebab }, suffix)
}

/// Build detection preview JSON for ImportModal.
/// Returns `{ name, isDefault, importStatement, importPath }` or "".
/// Mirrors: `getDetectionPreview(code, filename)` in importHelpers.ts
#[wasm_bindgen]
pub fn get_detection_preview(code: &str, filename: &str) -> String {
    if code.trim().is_empty() { return String::new(); }
    let name        = detect_component_name(code, filename);
    let is_default  = detect_default_export(code);
    let import_path = format!("./components/{}", name);
    let import_stmt = if is_default {
        format!("import {} from '{}'", name, import_path)
    } else {
        format!("import {{ {} }} from '{}'", name, import_path)
    };
    serde_json::json!({
        "name": name, "isDefault": is_default,
        "importStatement": import_stmt, "importPath": import_path,
    }).to_string()
}

// ── §15 CodeWrapper + PascalCase ──────────────────────────────────────────────

/// Convert a raw name to PascalCase component name.
/// Mirrors: `toPascalCase` in useFileSync.ts AND `toPascalCaseGen` in codeGenerator.ts
#[wasm_bindgen]
pub fn to_pascal_case(raw: &str) -> String {
    let cleaned: String = raw.chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect();
    let pascal: String = cleaned.split_whitespace()
        .map(|w| { let mut ch = w.chars(); ch.next().map(|f| f.to_uppercase().collect::<String>() + ch.as_str()).unwrap_or_default() })
        .collect();
    if pascal.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) || pascal.is_empty() {
        format!("Component{}", pascal)
    } else {
        pascal
    }
}

/// Wrap for Next.js App Router: 'use client' + React/Lucide/Motion imports.
/// Mirrors: `wrapWithImportsNext(rawCode)` in useFileSync.ts
#[wasm_bindgen]
pub fn wrap_component_next(raw_code: &str) -> String {
    format!(
        "'use client';\n\nimport React, {{ useState, useEffect, useRef }} from 'react';\nimport * as Lucide from 'lucide-react';\nimport {{ motion, AnimatePresence }} from 'framer-motion';\nimport {{ cn }} from '@/lib/utils';\n\n/* \u{2500}\u{2500}\u{2500} Auto-generated by Vectra AI \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} */\n{}\n",
        raw_code
    )
}

/// Wrap for Vite/React: React/Lucide/Motion imports, no 'use client'.
/// Mirrors: `wrapWithImportsVite(rawCode)` in useFileSync.ts
#[wasm_bindgen]
pub fn wrap_component_vite(raw_code: &str) -> String {
    format!(
        "import React, {{ useState, useEffect, useRef }} from 'react';\nimport * as Lucide from 'lucide-react';\nimport {{ motion, AnimatePresence }} from 'framer-motion';\nimport {{ cn }} from '../lib/utils';\n\n/* \u{2500}\u{2500}\u{2500} Auto-generated by Vectra AI \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} */\n{}\n",
        raw_code
    )
}

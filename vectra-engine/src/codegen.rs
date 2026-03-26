// ══════════════════════════════════════════════════════════════════════════════
// codegen.rs  —  §7 ReactCodegen  +  §17 collect_stack_on_mobile_ids / slug_to_next_path
// ══════════════════════════════════════════════════════════════════════════════
//
//  §7  generate_react_code — node-tree → React JSX exporter
//      Walks the VectraProject flat map from a root ID and emits JSX.
//      Used by codeGenerator.ts generateCode() fast-path.
//
//  §17 collect_stack_on_mobile_ids — tree walk for stackOnMobile:true nodes
//      Mirrors collectStackOnMobileIds() in codeGenerator.ts
//
//  §17 slug_to_next_path — URL slug → Next.js App Router file path
//      "/" → "app/page.tsx", "/about" → "app/about/page.tsx"

use std::collections::{HashMap, HashSet};
use std::fmt::Write as FmtWrite;
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── §7 Types ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct VectraNode {
    pub id:       String,
    pub children: Option<Vec<String>>,
    #[serde(flatten)]
    pub other:    HashMap<String, Value>,
}

// ── §7 generate_react_code ────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn generate_react_code(project_val: JsValue, root_id: String) -> Result<String, JsValue> {
    let project: HashMap<String, VectraNode> = serde_wasm_bindgen::from_value(project_val)?;
    let mut export_root = root_id.clone();
    if let Some(n) = project.get(&root_id) {
        if n.other.get("type").and_then(|v| v.as_str()) == Some("page") {
            if let Some(c) = &n.children { if !c.is_empty() { export_root = c[0].clone(); } }
        }
    }
    let mut icons = HashSet::new();
    collect_icons(&project, &export_root, &mut icons);

    let mut code = String::new();
    code.push_str("import React from 'react';\n");
    if !icons.is_empty() {
        let mut list: Vec<&String> = icons.iter().collect(); list.sort();
        let _ = writeln!(code, "import {{ {} }} from 'lucide-react';",
            list.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "));
    }
    let name = project.get(&export_root)
        .and_then(|n| n.other.get("name").and_then(|v| v.as_str()))
        .unwrap_or("MyComponent")
        .replace(|c: char| !c.is_alphanumeric(), "");
    let _ = writeln!(code, "\nexport default function {}() {{\n  return (", name);
    gen_node_rec(&project, &export_root, &mut code, 2, None);
    code.push_str("  );\n}\n");
    Ok(code)
}

fn collect_icons(p: &HashMap<String, VectraNode>, id: &str, icons: &mut HashSet<String>) {
    let Some(n) = p.get(id) else { return };
    if n.other.get("type").and_then(|v| v.as_str()) == Some("icon") {
        if let Some(name) = n.other.get("props")
            .and_then(|p| p.get("iconName")).and_then(|v| v.as_str())
        {
            icons.insert(name.to_string());
        }
    }
    if let Some(ch) = &n.children { for c in ch { collect_icons(p, c, icons); } }
}

fn gen_node_rec(p: &HashMap<String, VectraNode>, id: &str, buf: &mut String, indent: usize, _parent: Option<&str>) {
    let Some(n) = p.get(id) else { return };
    let sp = "  ".repeat(indent);
    let nt    = n.other.get("type").and_then(|v| v.as_str()).unwrap_or("div");
    let props = n.other.get("props");
    let content = n.other.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let cls = props.and_then(|p| p.get("className")).and_then(|v| v.as_str()).unwrap_or("");
    let ps = if cls.is_empty() { String::new() } else { format!(" className=\"{}\"", cls) };
    let tag = match nt {
        "text"|"paragraph" => "p", "heading" => "h1", "button" => "button",
        "image" => "img", "input" => "input", "canvas"|"webpage" => "main", _ => "div",
    };
    if matches!(tag, "img"|"input") { let _ = writeln!(buf, "{}<{}{} />", sp, tag, ps); return; }
    let mut cb = String::new();
    if !content.is_empty() { cb.push_str(content); }
    if let Some(ch) = &n.children { for c in ch { gen_node_rec(p, c, &mut cb, indent+1, Some(id)); } }
    if cb.is_empty() { let _ = writeln!(buf, "{}<{}{} />", sp, tag, ps); }
    else if cb.contains('\n') { let _ = writeln!(buf, "{}<{}{}>\n{}{}</{}>", sp, tag, ps, cb, sp, tag); }
    else { let _ = writeln!(buf, "{}<{}{}>{}</{}>", sp, tag, ps, cb, tag); }
}

// ── §17 collect_stack_on_mobile_ids ──────────────────────────────────────────

/// Walk project subtree, return IDs where props.stackOnMobile === true.
/// Mirrors: `codeGenerator.collectStackOnMobileIds(project, nodeId)`
#[wasm_bindgen]
pub fn collect_stack_on_mobile_ids(project_json: String, root_id: String) -> Result<String, JsValue> {
    let project: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[codegen] parse: {}", e)))?;

    let mut result: Vec<String> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();

    walk_mobile(&project, &root_id, &mut visited, &mut result);

    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn walk_mobile(
    project: &HashMap<String, Value>,
    node_id: &str,
    visited:  &mut HashSet<String>,
    result:   &mut Vec<String>,
) {
    if !visited.insert(node_id.to_string()) { return; }
    let Some(node) = project.get(node_id) else { return };

    let stack_on_mobile = node
        .get("props").and_then(|p| p.get("stackOnMobile"))
        .and_then(|v| v.as_bool()).unwrap_or(false);
    if stack_on_mobile { result.push(node_id.to_string()); }

    if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
        for child in children {
            if let Some(cid) = child.as_str() { walk_mobile(project, cid, visited, result); }
        }
    }
}

// ── §17 slug_to_next_path ────────────────────────────────────────────────────

/// Convert URL slug → Next.js App Router file path.
/// "/" → "app/page.tsx", "/about" → "app/about/page.tsx"
/// Mirrors: `codeGenerator.slugToNextPath(slug)`
#[wasm_bindgen]
pub fn slug_to_next_path(slug: &str) -> String {
    if slug == "/" { return "app/page.tsx".to_string(); }
    let clean = slug.trim_start_matches('/').trim_end_matches('/');
    if clean.is_empty() { return "app/page.tsx".to_string(); }
    format!("app/{}/page.tsx", clean)
}

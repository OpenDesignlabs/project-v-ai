// ══════════════════════════════════════════════════════════════════════════════
// ai.rs  —  §9 JsonRepair  +  §10 AIMerger
// ══════════════════════════════════════════════════════════════════════════════
//
//  §9  repair_json — 4-stage AI JSON fixer
//      Stage 0: single-quote → double-quote
//      Stage 1: trailing comma stripping (iterative)
//      Stage 2: truncated "code" string → inject closure
//      Stage 3: bracket/brace auto-close
//
//  §10 sanitize_ai_elements — remap IDs + stamp aiSource on custom_code nodes
//      merge_ai_content — sanitize then merge into live project

use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use serde_json::{json, Value};
use crate::state::uuid_hex;

// ── §9 repair_json ────────────────────────────────────────────────────────────

/// Fix malformed / truncated AI JSON. 4-stage pipeline.
/// Mirrors: `aiHelpers.repairJSON(jsonStr)`
#[wasm_bindgen]
pub fn repair_json(json_str: String) -> String {
    let mut s = json_str.trim().to_string();

    // ── Stage 0: single-quote normalisation ─────────────────────────────────
    {
        let mut out = String::with_capacity(s.len());
        let bytes = s.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'\'' {
                let prev_non_ws = out.trim_end().as_bytes().last().copied().unwrap_or(0);
                if matches!(prev_non_ws, b'{' | b'[' | b',' | b':' | 0) {
                    out.push('"');
                    i += 1;
                    while i < bytes.len() && bytes[i] != b'\'' {
                        if bytes[i] == b'"' { out.push('\\'); }
                        out.push(bytes[i] as char);
                        i += 1;
                    }
                    out.push('"');
                    i += 1;
                    continue;
                }
            }
            out.push(bytes[i] as char);
            i += 1;
        }
        s = out;
    }

    // ── Stage 1: trailing comma stripping (iterative until stable) ───────────
    loop {
        let next = {
            let mut n = String::with_capacity(s.len());
            let bytes = s.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                if bytes[i] == b',' {
                    let mut j = i + 1;
                    while j < bytes.len() && matches!(bytes[j], b' '|b'\n'|b'\r'|b'\t') { j += 1; }
                    if j < bytes.len() && (bytes[j] == b'}' || bytes[j] == b']') {
                        i = j; continue;
                    }
                }
                n.push(bytes[i] as char);
                i += 1;
            }
            n
        };
        if next == s { break; }
        s = next;
    }

    // ── Stage 2: truncated "code" string detection ───────────────────────────
    if let Some(code_key_idx) = s.rfind("\"code\"") {
        let after_colon = s[code_key_idx + 6..].find(':').map(|i| code_key_idx + 6 + i + 1);
        if let Some(start) = after_colon {
            if let Some(open_q) = s[start..].find('"') {
                let value_start = start + open_q + 1;
                let bytes = s.as_bytes();
                let mut in_str = true; let mut escaped = false;
                for i in value_start..bytes.len() {
                    if escaped { escaped = false; continue; }
                    if bytes[i] == b'\\' { escaped = true; continue; }
                    if bytes[i] == b'"' { in_str = false; break; }
                }
                if in_str { s.push_str("</div>}\""); }
            }
        }
    }

    // ── Stage 3: bracket/brace auto-close ───────────────────────────────────
    let mut open_braces:   i32 = 0;
    let mut open_brackets: i32 = 0;
    let mut in_string = false; let mut escaped = false;
    for b in s.bytes() {
        if escaped { escaped = false; continue; }
        if b == b'\\' { escaped = true; continue; }
        if b == b'"'  { in_string = !in_string; continue; }
        if in_string  { continue; }
        match b {
            b'{' => open_braces   += 1, b'}' => open_braces   -= 1,
            b'[' => open_brackets += 1, b']' => open_brackets -= 1,
            _ => {}
        }
    }
    if open_brackets > 0 { for _ in 0..open_brackets { s.push(']'); } }
    if open_braces   > 0 { for _ in 0..open_braces   { s.push('}'); } }

    s
}

// ── §10 AIMerger ──────────────────────────────────────────────────────────────

/// Sanitize AI-generated elements: remap IDs + stamp aiSource.
/// Mirrors: `aiHelpers.sanitizeAIElements(elements, rootId, aiMeta)`
#[wasm_bindgen]
pub fn sanitize_ai_elements(
    elements_json: String,
    root_id:       String,
    // Optional JSON: { "prompt": "...", "model": "..." } — pass "" to skip
    ai_meta_json:  String,
) -> Result<String, JsValue> {
    let elements: HashMap<String, Value> = serde_json::from_str(&elements_json)
        .map_err(|e| JsValue::from_str(&format!("[ai] parse elements: {}", e)))?;

    let ai_meta: Option<(String, String)> = if ai_meta_json.trim().is_empty() { None }
    else {
        serde_json::from_str::<Value>(&ai_meta_json).ok().and_then(|v| {
            let prompt = v.get("prompt")?.as_str()?.to_string();
            let model  = v.get("model")?.as_str()?.to_string();
            Some((prompt, model))
        })
    };

    let now_ms = js_sys::Date::now() as u64;
    let mut id_map: HashMap<String, String> = HashMap::new();
    for old_id in elements.keys() {
        id_map.insert(old_id.clone(), format!("ai_{}", &uuid_hex()[..12]));
    }

    let mut sanitized: HashMap<String, Value> = HashMap::new();
    let mut ai_stamped = 0usize;

    for (old_id, node) in &elements {
        let new_id = id_map[old_id].clone();
        let mut node_clone = node.clone();
        if let Some(obj) = node_clone.as_object_mut() {
            obj.insert("id".into(), Value::String(new_id.clone()));
            if let Some(children) = obj.get_mut("children") {
                if let Some(arr) = children.as_array_mut() {
                    *arr = arr.iter().map(|c| {
                        c.as_str().and_then(|cid| id_map.get(cid))
                            .map(|nid| Value::String(nid.clone()))
                            .unwrap_or_else(|| c.clone())
                    }).collect();
                }
            }
            let node_type = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let has_code  = obj.get("code").map(|c| !c.is_null()).unwrap_or(false);
            if node_type == "custom_code" && has_code {
                if let Some((ref prompt, ref model)) = ai_meta {
                    let section_name = obj.get("name").and_then(|n| n.as_str()).unwrap_or("Section").to_string();
                    obj.insert("aiSource".into(), json!({
                        "prompt": prompt, "sectionName": section_name,
                        "model": model,   "generatedAt": now_ms,
                    }));
                    ai_stamped += 1;
                }
            }
        }
        sanitized.insert(new_id, node_clone);
    }

    let new_root_id = id_map.get(&root_id).cloned().unwrap_or(root_id);
    let result = json!({
        "sanitizedElements": sanitized,
        "newRootId": new_root_id,
        "stats": { "totalElements": sanitized.len(), "aiStamped": ai_stamped },
    });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Full merge: sanitize AI elements then attach to project.
/// Mirrors: `aiHelpers.mergeAIContent(project, pageRootId, aiElements, aiRootId, isFullPage, aiMeta)`
#[wasm_bindgen]
pub fn merge_ai_content(
    project_json:     String,
    page_root_id:     String,
    ai_elements_json: String,
    ai_root_id:       String,
    is_full_page:     bool,
    ai_meta_json:     String,
) -> Result<String, JsValue> {
    let san_result_json = sanitize_ai_elements(ai_elements_json, ai_root_id, ai_meta_json)?;
    let san_result: Value = serde_json::from_str(&san_result_json)
        .map_err(|e| JsValue::from_str(&format!("[ai] parse san result: {}", e)))?;

    let sanitized_elements = san_result.get("sanitizedElements")
        .ok_or_else(|| JsValue::from_str("[ai] missing sanitizedElements"))?;
    let new_root_id = san_result.get("newRootId").and_then(|v| v.as_str())
        .ok_or_else(|| JsValue::from_str("[ai] missing newRootId"))?.to_string();

    let mut project: serde_json::Map<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[ai] parse project: {}", e)))?;

    if let Some(san_map) = sanitized_elements.as_object() {
        for (k, v) in san_map { project.insert(k.clone(), v.clone()); }
    }

    let page_root = project.get_mut(&page_root_id)
        .ok_or_else(|| JsValue::from_str(&format!("[ai] page root not found: {}", page_root_id)))?;
    if let Some(obj) = page_root.as_object_mut() {
        if is_full_page {
            obj.insert("children".into(), json!([new_root_id]));
        } else {
            let mut children: Vec<Value> = obj.get("children")
                .and_then(|c| c.as_array()).cloned().unwrap_or_default();
            children.push(Value::String(new_root_id));
            obj.insert("children".into(), Value::Array(children));
        }
    }
    serde_json::to_string(&project).map_err(|e| JsValue::from_str(&e.to_string()))
}

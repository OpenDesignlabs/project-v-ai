// ══════════════════════════════════════════════════════════════════════════════
// state.rs  —  §2 HistoryManager  +  §8 TreeManager  +  §17 structural_key
// ══════════════════════════════════════════════════════════════════════════════
//
//  §2  HistoryManager — LZ4-compressed undo/redo (VecDeque, O(1) ops)
//      FNV-1a dedup skips consecutive identical states before compression.
//      LZ4 is 5-10× faster than gzip; old gzip frames are auto-decoded.
//
//  §8  TreeManager — delete_subtree, clone_subtree, find_parent, build_parent_map
//      All take the full project as a JSON string, return JSON.
//      Single boundary crossing — no intermediate JS marshalling.
//
//  §17 compute_structural_key — topology fingerprint for parentMap gating.
//      Only changes when nodes are added/moved/removed, not on style edits.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::prelude::*;
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use flate2::read::GzDecoder;

// ── Shared utility — used by state, ai, codegen, figma ───────────────────────

/// Generate 32 lowercase hex chars using getrandom (RFC 4122 style).
pub(crate) fn uuid_hex() -> String {
    let mut buf = [0u8; 16];
    getrandom::fill(&mut buf).unwrap_or(());
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

// ── §2 HistoryManager — compression internals ────────────────────────────────

const CODEC_LZ4:  u8 = 0x4C;
const CODEC_GZIP: u8 = 0x47;

struct Frame { data: Vec<u8>, hash: u64 }

fn fnv1a(s: &str) -> u64 {
    const O: u64 = 14695981039346656037;
    const P: u64 = 1099511628211;
    let mut h = O;
    for b in s.bytes() { h ^= b as u64; h = h.wrapping_mul(P); }
    h
}

fn compress_lz4(d: &str) -> Vec<u8> {
    let b = d.as_bytes(); let ol = b.len() as u32;
    let p = lz4_flex::compress(b);
    let mut o = Vec::with_capacity(1+4+p.len());
    o.push(CODEC_LZ4); o.extend_from_slice(&ol.to_le_bytes()); o.extend_from_slice(&p); o
}

fn decompress_lz4(p: &[u8]) -> Option<String> {
    if p.len() < 4 { return None; }
    let ol = u32::from_le_bytes(p[..4].try_into().ok()?) as usize;
    String::from_utf8(lz4_flex::decompress(&p[4..], ol).ok()?).ok()
}

fn decompress_frame(f: &Frame) -> Option<String> {
    if f.data.is_empty() { return None; }
    match f.data[0] {
        CODEC_LZ4  => decompress_lz4(&f.data[1..]),
        CODEC_GZIP => {
            let mut d = GzDecoder::new(&f.data[1..]);
            let mut s = String::new();
            d.read_to_string(&mut s).ok()?;
            Some(s)
        }
        _ => None,
    }
}

fn make_frame(s: &str) -> Frame { Frame { data: compress_lz4(s), hash: fnv1a(s) } }

// ── §2 HistoryManager ─────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct HistoryStats {
    pub count: usize, pub current_index: usize,
    pub memory_bytes: usize, pub avg_frame_kb: f64,
    pub can_undo: bool, pub can_redo: bool,
}

#[wasm_bindgen]
pub struct HistoryManager {
    stack:         VecDeque<Frame>,
    current_index: usize,
    max_history:   usize,
}

#[wasm_bindgen]
impl HistoryManager {
    #[wasm_bindgen(constructor)]
    pub fn new(initial: String) -> HistoryManager {
        HistoryManager {
            stack:         VecDeque::from([make_frame(&initial)]),
            current_index: 0,
            max_history:   80,
        }
    }

    pub fn push_state(&mut self, state: String) {
        let h = fnv1a(&state);
        if self.stack.get(self.current_index).map_or(false, |f| f.hash == h) { return; }
        self.stack.truncate(self.current_index + 1);
        self.stack.push_back(make_frame(&state));
        self.current_index += 1;
        if self.stack.len() > self.max_history {
            self.stack.pop_front();
            self.current_index -= 1;
        }
    }

    pub fn undo(&mut self) -> Option<String> {
        if self.current_index == 0 { return None; }
        self.current_index -= 1;
        decompress_frame(&self.stack[self.current_index])
    }

    pub fn redo(&mut self) -> Option<String> {
        if self.current_index >= self.stack.len() - 1 { return None; }
        self.current_index += 1;
        decompress_frame(&self.stack[self.current_index])
    }

    pub fn undo_steps(&mut self, steps: usize) -> Option<String> {
        self.current_index = self.current_index.saturating_sub(steps);
        decompress_frame(&self.stack[self.current_index])
    }

    pub fn can_undo(&self)  -> bool { self.current_index > 0 }
    pub fn can_redo(&self)  -> bool { self.current_index < self.stack.len() - 1 }
    pub fn get_memory_usage(&self) -> usize { self.stack.iter().map(|f| f.data.len()).sum() }

    pub fn set_max_history(&mut self, n: usize) {
        self.max_history = n.max(2);
        while self.stack.len() > self.max_history {
            self.stack.pop_front();
            if self.current_index > 0 { self.current_index -= 1; }
        }
    }

    pub fn clear_future(&mut self) { self.stack.truncate(self.current_index + 1); }

    pub fn get_stats(&self) -> String {
        let m = self.get_memory_usage(); let c = self.stack.len();
        serde_json::to_string(&HistoryStats {
            count: c, current_index: self.current_index, memory_bytes: m,
            avg_frame_kb: if c > 0 { (m as f64 / c as f64) / 1024.0 } else { 0.0 },
            can_undo: self.can_undo(), can_redo: self.can_redo(),
        }).unwrap_or_default()
    }
}

// ── §8 TreeManager — shared helpers ──────────────────────────────────────────

/// IDs that can never be deleted (structural roots).
const PROTECTED_IDS: &[&str] = &[
    "root", "application-root", "page-home", "page-1",
    "main-frame", "main-frame-desktop", "main-frame-mobile", "main-canvas",
];

pub(crate) fn is_protected(id: &str) -> bool { PROTECTED_IDS.contains(&id) }

/// Iterative DFS — collect id + all descendant IDs.
pub(crate) fn collect_subtree(nodes: &HashMap<String, Value>, root_id: &str) -> HashSet<String> {
    let mut result = HashSet::new();
    let mut stack = vec![root_id.to_string()];
    while let Some(id) = stack.pop() {
        if result.insert(id.clone()) {
            if let Some(node) = nodes.get(&id) {
                if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
                    for child in children {
                        if let Some(cid) = child.as_str() { stack.push(cid.to_string()); }
                    }
                }
            }
        }
    }
    result
}

// ── §8 Public WASM exports ────────────────────────────────────────────────────

/// Delete a node and its entire subtree. Returns updated project JSON.
/// Mirrors: `treeUtils.deleteNodeRecursive(elements, id)`
#[wasm_bindgen]
pub fn delete_subtree(project_json: String, node_id: String) -> Result<String, JsValue> {
    if is_protected(&node_id) {
        return Err(JsValue::from_str(&format!("[tree] cannot delete protected node: {}", node_id)));
    }
    let mut nodes: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[tree] parse: {}", e)))?;
    if !nodes.contains_key(&node_id) {
        return Err(JsValue::from_str(&format!("[tree] node not found: {}", node_id)));
    }
    let to_delete = collect_subtree(&nodes, &node_id);
    for id in &to_delete { nodes.remove(id); }
    for (_, node) in nodes.iter_mut() {
        if let Some(children) = node.get_mut("children").and_then(|c| c.as_array_mut()) {
            if children.iter().any(|c| c.as_str() == Some(&node_id)) {
                children.retain(|c| c.as_str() != Some(&node_id));
                break;
            }
        }
    }
    serde_json::to_string(&nodes).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Collect all descendant IDs of a node (excluding root itself).
/// Mirrors: `treeUtils.getAllDescendants(elements, nodeId)`
#[wasm_bindgen]
pub fn collect_subtree_ids(project_json: String, root_id: String) -> Result<String, JsValue> {
    let nodes: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[tree] parse: {}", e)))?;
    let mut ids = collect_subtree(&nodes, &root_id);
    ids.remove(&root_id);
    let vec: Vec<String> = ids.into_iter().collect();
    serde_json::to_string(&vec).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Find the parent ID of a node in O(N).
/// Mirrors: `parentMap.get(id)` in ProjectContext
#[wasm_bindgen]
pub fn find_parent(project_json: String, node_id: String) -> Result<String, JsValue> {
    let nodes: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[tree] parse: {}", e)))?;
    for (parent_id, node) in &nodes {
        if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
            if children.iter().any(|c| c.as_str() == Some(&node_id)) {
                return Ok(parent_id.clone());
            }
        }
    }
    Ok(String::new())
}

/// Build full parent map: { childId → parentId } for every node.
/// Mirrors: `parentMap` useMemo in ProjectContext
#[wasm_bindgen]
pub fn build_parent_map(project_json: String) -> Result<String, JsValue> {
    let nodes: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[tree] parse: {}", e)))?;
    let mut map: HashMap<String, String> = HashMap::new();
    for (parent_id, node) in &nodes {
        if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
            for child in children {
                if let Some(cid) = child.as_str() {
                    map.insert(cid.to_string(), parent_id.clone());
                }
            }
        }
    }
    serde_json::to_string(&map).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Deep-clone a subtree with fresh UUIDs.
/// Returns `{ newNodes: {...}, rootId: "new-root-id" }` as JSON.
/// Mirrors: `templateUtils.instantiateTemplate(rootId, elements)`
#[wasm_bindgen]
pub fn clone_subtree(project_json: String, root_id: String) -> Result<String, JsValue> {
    let nodes: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[tree] parse: {}", e)))?;
    let mut all = collect_subtree(&nodes, &root_id);
    all.insert(root_id.clone());
    let mut id_map: HashMap<String, String> = HashMap::new();
    for old_id in &all {
        id_map.insert(old_id.clone(), format!("el-{}", &uuid_hex()[..12]));
    }
    let mut new_nodes: HashMap<String, Value> = HashMap::new();
    for old_id in &all {
        let new_id = id_map[old_id].clone();
        if let Some(node) = nodes.get(old_id) {
            let mut cloned = node.clone();
            if let Some(obj) = cloned.as_object_mut() {
                obj.insert("id".into(), Value::String(new_id.clone()));
                if let Some(children) = obj.get_mut("children") {
                    if let Some(arr) = children.as_array_mut() {
                        *arr = arr.iter().map(|c| {
                            c.as_str().and_then(|cid| id_map.get(cid))
                                .map(|new_cid| Value::String(new_cid.clone()))
                                .unwrap_or_else(|| c.clone())
                        }).collect();
                    }
                }
            }
            new_nodes.insert(new_id, cloned);
        }
    }
    let new_root_id = id_map[&root_id].clone();
    let result = json!({ "newNodes": new_nodes, "rootId": new_root_id });
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

// ── §17 compute_structural_key ────────────────────────────────────────────────

/// Compute a deterministic topology fingerprint of the element tree.
/// Only changes when nodes are added/removed/reparented — NOT on style edits.
/// Mirrors: `structuralKey` useMemo in ProjectContext.tsx
#[wasm_bindgen]
pub fn compute_structural_key(project_json: String) -> Result<String, JsValue> {
    let project: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[state] parse: {}", e)))?;
    let mut node_ids: Vec<String> = project.keys().cloned().collect();
    node_ids.sort();
    let mut parts: Vec<String> = Vec::with_capacity(node_ids.len());
    for id in &node_ids {
        let node = &project[id];
        let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let children: Vec<&str> = node
            .get("children").and_then(|c| c.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        parts.push(format!("{}:{}:[{}]", id, node_type, children.join(",")));
    }
    Ok(parts.join("|"))
}

use std::collections::{HashMap, HashSet};
use std::io::prelude::*;
use std::fmt::Write as FmtWrite; // aliased to avoid ambiguity with io::Write from prelude
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use flate2::{Compression, write::GzEncoder, read::GzDecoder};

// SWC Imports
use swc_core::common::{
    sync::Lrc,
    FileName, SourceMap, Globals, GLOBALS, Mark,
    comments::SingleThreadedComments // Fix: Explicit comments type
};
use swc_core::ecma::{
    codegen::{text_writer::JsWriter, Emitter, Config},
    parser::{lexer::Lexer, Parser, StringInput, Syntax, TsConfig},
    transforms::{
        react::{react, Options as ReactOptions, Runtime},
        typescript::strip,
    },
    visit::FoldWith,
};

#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    Ok(())
}

// ============================================
// PRIORITY 1: LAYOUT ENGINE (Retained Mode)
// ============================================
// calculate_snapping() free function REMOVED (Phase 7):
//   It serialized all N siblings on every pointer-move (60fps).
//   Replaced by LayoutEngine.update_rects() (once on drag-start)
//   + LayoutEngine.query_snapping() (5 scalars at 60fps).
// Rect struct REMOVED — only LayoutEngine's SimpleRect is needed.

#[derive(Serialize, Deserialize)]
pub struct Guide {
    pub orientation: String,
    pub pos: f64,
    pub start: f64,
    pub end: f64,
    pub guide_type: String,
}

#[derive(Serialize, Deserialize)]
pub struct SnapResult {
    pub x: f64,
    pub y: f64,
    pub guides: Vec<Guide>,
}

// ============================================
// RETAINED-MODE LAYOUT ENGINE (Phase 5 + Phase 9 Spatial Hash)
// ============================================
//
// Phase 5: push sibling rects ONCE on drag-start (update_rects), query
//          with 5 scalars at 60fps (query_snapping) — no large data per frame.
//
// Phase 9: Spatial Hash Grid — O(N) → O(1) for dense canvases.
//   update_rects now buckets each rect into 100px × 100px grid cells.
//   query_snapping only checks rects in the cells that overlap the
//   (threshold-expanded) bounding box of the dragged element.
//
//   Collision: a rect spanning multiple cells appears in multiple buckets.
//   We use a HashSet<usize> to deduplicate indices before testing, so each
//   sibling is snapped against at most once per query call.

/// Lightweight rect — no id needed for snap queries.
#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct SimpleRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[wasm_bindgen]
pub struct LayoutEngine {
    /// Canonical sibling list — populated once per drag-start.
    rects: Vec<SimpleRect>,
    /// Spatial hash: grid cell (gx, gy) → list of rect indices in that cell.
    grid: HashMap<(i32, i32), Vec<usize>>,
    /// Width/height of each grid cell in canvas pixels.
    cell_size: f64,
}

#[wasm_bindgen]
impl LayoutEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> LayoutEngine {
        LayoutEngine {
            rects:     Vec::new(),
            grid:      HashMap::new(),
            cell_size: 100.0, // 100 px buckets — good balance for typical canvas densities
        }
    }

    /// Push sibling rects into Wasm memory and rebuild the spatial hash.
    /// Call ONCE on drag-start (pointer-down). O(N) serde + O(N×k) grid cost,
    /// where k = number of cells each rect occupies (usually 1–4).
    pub fn update_rects(&mut self, rects_val: JsValue) -> Result<(), JsValue> {
        let rects: Vec<SimpleRect> = serde_wasm_bindgen::from_value(rects_val)?;
        self.rects = rects;

        // ── Dynamic cell-size heuristic ────────────────────────────────────────
        // Goal: ~3–5 sibling rects per cell on average so the hash gives O(1)
        // lookups without excessive bucket collisions.
        //   avg_dim  = mean of (width + height) / 2 across all rects
        //   cell_size = avg_dim × 1.5, clamped to [50px, 500px]
        //
        // Without this, a canvas full of 16px icons would put everything in one
        // cell (100px >> 16px), making the hash degenerate to O(N).
        let count = self.rects.len();
        if count > 0 {
            let total_dim: f64 = self.rects.iter().map(|r| r.w + r.h).sum();
            let avg_dim = total_dim / (count as f64 * 2.0);
            self.cell_size = (avg_dim * 1.5).max(50.0).min(500.0);
        }

        // Rebuild spatial hash with the (possibly updated) cell_size
        self.grid.clear();
        for (idx, r) in self.rects.iter().enumerate() {
            let gx_min = (r.x           / self.cell_size).floor() as i32;
            let gx_max = ((r.x + r.w)   / self.cell_size).floor() as i32;
            let gy_min = (r.y           / self.cell_size).floor() as i32;
            let gy_max = ((r.y + r.h)   / self.cell_size).floor() as i32;
            for gx in gx_min..=gx_max {
                for gy in gy_min..=gy_max {
                    self.grid.entry((gx, gy)).or_default().push(idx);
                }
            }
        }
        Ok(())
    }

    /// Fast snap query — only 5 scalar args cross the Wasm boundary.
    /// Phase 9: resolves only rects in nearby grid cells (O(k²) cells,
    /// typically 1–4 cells for threshold=5px and cell_size=100px).
    pub fn query_snapping(
        &self,
        current_x: f64,
        current_y: f64,
        width: f64,
        height: f64,
        threshold: f64,
    ) -> Result<JsValue, JsValue> {
        let mut new_x = current_x;
        let mut new_y = current_y;
        let mut guides: Vec<Guide> = Vec::with_capacity(2);
        let mut snapped_x = false;
        let mut snapped_y = false;

        // Determine which grid cells overlap the threshold-expanded bounding box
        let gx_min = ((current_x - threshold)          / self.cell_size).floor() as i32;
        let gx_max = ((current_x + width + threshold)  / self.cell_size).floor() as i32;
        let gy_min = ((current_y - threshold)          / self.cell_size).floor() as i32;
        let gy_max = ((current_y + height + threshold) / self.cell_size).floor() as i32;

        // Collect unique candidate indices (a rect spanning multiple cells
        // appears in multiple buckets; deduplicate to snap against it only once)
        let mut seen: HashSet<usize> = HashSet::new();
        let mut candidates: Vec<usize> = Vec::new();
        for gx in gx_min..=gx_max {
            for gy in gy_min..=gy_max {
                if let Some(indices) = self.grid.get(&(gx, gy)) {
                    for &idx in indices {
                        if seen.insert(idx) {
                            candidates.push(idx);
                        }
                    }
                }
            }
        }

        // Identical 9-point snap math as the Phase 5 linear scan,
        // but now only over the O(1) candidates near the dragged element.
        for idx in candidates {
            let sib = &self.rects[idx];

            // ── X axis: 9 alignment pairs (left/center/right of each vs each) ──
            if !snapped_x {
                let x_points = [
                    (new_x,               sib.x),
                    (new_x,               sib.x + sib.w / 2.0),
                    (new_x,               sib.x + sib.w),
                    (new_x + width / 2.0, sib.x),
                    (new_x + width / 2.0, sib.x + sib.w / 2.0),
                    (new_x + width / 2.0, sib.x + sib.w),
                    (new_x + width,       sib.x),
                    (new_x + width,       sib.x + sib.w / 2.0),
                    (new_x + width,       sib.x + sib.w),
                ];
                for (t, s) in x_points.iter() {
                    if (t - s).abs() < threshold {
                        new_x += s - t;
                        snapped_x = true;
                        guides.push(Guide {
                            orientation: "vertical".into(),
                            pos:   *s,
                            start: new_y.min(sib.y),
                            end:   (new_y + height).max(sib.y + sib.h),
                            guide_type: "align".into(),
                        });
                        break;
                    }
                }
            }

            // ── Y axis: 9 alignment pairs (top/middle/bottom of each vs each) ──
            if !snapped_y {
                let y_points = [
                    (new_y,                sib.y),
                    (new_y,                sib.y + sib.h / 2.0),
                    (new_y,                sib.y + sib.h),
                    (new_y + height / 2.0, sib.y),
                    (new_y + height / 2.0, sib.y + sib.h / 2.0),
                    (new_y + height / 2.0, sib.y + sib.h),
                    (new_y + height,       sib.y),
                    (new_y + height,       sib.y + sib.h / 2.0),
                    (new_y + height,       sib.y + sib.h),
                ];
                for (t, s) in y_points.iter() {
                    if (t - s).abs() < threshold {
                        new_y += s - t;
                        snapped_y = true;
                        guides.push(Guide {
                            orientation: "horizontal".into(),
                            pos:   *s,
                            start: new_x.min(sib.x),
                            end:   (new_x + width).max(sib.x + sib.w),
                            guide_type: "align".into(),
                        });
                        break;
                    }
                }
            }

            // Both axes snapped — no need to check remaining candidates
            if snapped_x && snapped_y { break; }
        }

        Ok(serde_wasm_bindgen::to_value(&SnapResult { x: new_x, y: new_y, guides })?)
    }
}

// ============================================
// PRIORITY 2: TREE MANAGER
// ============================================
// delete_node()        REMOVED (Phase 7) — migrated to treeUtils.ts
// instantiate_template() REMOVED (Phase 7) — migrated to templateUtils.ts
// Both functions serialized the entire project on every call (CRUD Bridge Tax).
// The TypeScript versions operate on the JS object directly — zero serde cost.
//
// VectraNode is kept because generate_react_code (code export) still needs it.
// The flatten + other pattern is intentional: the Vectra node schema is open
// (arbitrary props), so we cannot use explicit fields without breaking the exporter.

#[derive(Serialize, Deserialize, Clone)]
pub struct VectraNode {
    pub id: String,
    pub children: Option<Vec<String>>,
    #[serde(flatten)]
    pub other: HashMap<String, Value>,
}


// ============================================
// PRIORITY 3: HISTORY MANAGER (Compressed)
// ============================================
// Phase 8: Instead of storing 50 raw JSON strings (~2MB each = ~100MB total),
// we gzip each snapshot to ~100KB. The uncompressed string only exists for the
// duration of compress() / decompress() — never in long-lived heap memory.
//
// API surface deliberately UNCHANGED from the uncompressed version:
//   • new(String)           → HistoryManager  (infallible — compress is infallible on valid UTF-8)
//   • push_state(String)    → void            (TS catch block unchanged)
//   • undo() / redo()       → Option<String>  (JS sees undefined on None — TS check unchanged)
//   • can_undo() / can_redo() → bool          (kept; the Phase 8 proposal accidentally omitted them)
//   • get_memory_usage()    → usize           (new: diagnostic, bytes of compressed data in RAM)

/// Compress a UTF-8 string to gzip bytes.
/// Infallible for all valid UTF-8 inputs — returns empty Vec on IO error (should never happen).
fn compress_state(data: &str) -> Vec<u8> {
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    if enc.write_all(data.as_bytes()).is_ok() {
        enc.finish().unwrap_or_default()
    } else {
        Vec::new()
    }
}

/// Decompress gzip bytes back to a UTF-8 String.
/// Returns None if the data is corrupted (extremely unlikely in practice).
fn decompress_state(data: &[u8]) -> Option<String> {
    if data.is_empty() { return None; }
    let mut dec = GzDecoder::new(data);
    let mut s = String::new();
    dec.read_to_string(&mut s).ok()?;
    Some(s)
}

#[wasm_bindgen]
pub struct HistoryManager {
    /// Compressed gzip snapshots — typically ~100KB each vs ~2MB uncompressed.
    stack: Vec<Vec<u8>>,
    current_index: usize,
    max_history: usize,
}

#[wasm_bindgen]
impl HistoryManager {
    #[wasm_bindgen(constructor)]
    pub fn new(initial: String) -> HistoryManager {
        HistoryManager {
            stack: vec![compress_state(&initial)],
            current_index: 0,
            max_history: 50,
        }
    }

    /// Compress and push a new snapshot.  Truncates the redo stack first.
    pub fn push_state(&mut self, state: String) {
        if self.current_index < self.stack.len() - 1 {
            self.stack.truncate(self.current_index + 1);
        }
        self.stack.push(compress_state(&state));
        self.current_index += 1;
        if self.stack.len() > self.max_history {
            self.stack.remove(0);
            self.current_index -= 1;
        }
    }

    /// Step one entry back and return the decompressed JSON string.
    pub fn undo(&mut self) -> Option<String> {
        if self.current_index > 0 {
            self.current_index -= 1;
            decompress_state(&self.stack[self.current_index])
        } else {
            None
        }
    }

    /// Step one entry forward and return the decompressed JSON string.
    pub fn redo(&mut self) -> Option<String> {
        if self.current_index < self.stack.len() - 1 {
            self.current_index += 1;
            decompress_state(&self.stack[self.current_index])
        } else {
            None
        }
    }

    pub fn can_undo(&self) -> bool { self.current_index > 0 }
    pub fn can_redo(&self) -> bool { self.current_index < self.stack.len() - 1 }

    /// Diagnostic: total bytes of compressed data currently held in memory.
    /// In a browser devtools console: `wasmModule.historyManager.get_memory_usage()`
    pub fn get_memory_usage(&self) -> usize {
        self.stack.iter().map(|v| v.len()).sum()
    }
}

// ============================================
// PRIORITY 4: CODE EXPORT
// ============================================

#[wasm_bindgen]
pub fn generate_react_code(project_val: JsValue, root_id: String) -> Result<String, JsValue> {
    let project: HashMap<String, VectraNode> = serde_wasm_bindgen::from_value(project_val)?;
    
    let mut export_root = root_id.clone();
    if let Some(node) = project.get(&root_id) {
        if node.other.get("type").and_then(|v| v.as_str()) == Some("page") {
            if let Some(c) = &node.children { if !c.is_empty() { export_root = c[0].clone(); } }
        }
    }

    let mut icons = std::collections::HashSet::new();
    collect_icons(&project, &export_root, &mut icons);

    let mut code = String::new();
    code.push_str("import React from 'react';\n");
    if !icons.is_empty() {
        let list: Vec<&String> = icons.iter().collect();
        code.push_str(&format!("import {{ {} }} from 'lucide-react';\n", list.iter().map(|s| s.as_str()).collect::<Vec<&str>>().join(", ")));
    }

    let name = project.get(&export_root).and_then(|n| n.other.get("name").and_then(|v| v.as_str())).unwrap_or("MyComponent").replace(|c: char| !c.is_alphanumeric(), "");
    code.push_str(&format!("\nexport default function {}() {{\n  return (\n", name));
    generate_node_recursive(&project, &export_root, &mut code, 2, None);
    code.push_str("  );\n}");

    Ok(code)
}

fn collect_icons(project: &HashMap<String, VectraNode>, id: &String, icons: &mut std::collections::HashSet<String>) {
    if let Some(node) = project.get(id) {
        if let Some(props) = node.other.get("props") {
            if let Some(icon) = props.get("iconName").and_then(|v| v.as_str()) { icons.insert(icon.to_string()); }
        }
        if let Some(children) = &node.children {
            for c in children { collect_icons(project, c, icons); }
        }
    }
}

// ── generate_node_recursive (buffer-based, Phase 9) ─────────────────────────
// Phase 9 change: converted from return-String to &mut String buffer.
//   Before: each recursive call allocates a new String, then the parent does
//           child_code.push_str(&generate_node_recursive(...)) — 1 alloc per node.
//   After:  writes directly into the shared buffer — 0 allocs per node.
//
// ALL existing logic preserved:
//   • hidden-node skip       • layoutMode flex injection
//   • icon special-case      • image/input self-close
//   • content + children mix • multi-line vs inline child detection
fn generate_node_recursive(
    project: &HashMap<String, VectraNode>,
    id: &String,
    buf: &mut String,
    indent: usize,
    _parent: Option<&str>,
) {
    let node = match project.get(id) { Some(n) => n, None => return };
    if node.other.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false) { return; }

    let sp = "  ".repeat(indent);
    let type_str = node.other.get("type").and_then(|v| v.as_str()).unwrap_or("div");
    let content  = node.other.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let props    = node.other.get("props").unwrap_or(&Value::Null);

    let mut cls = props.get("className").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if props.get("layoutMode").and_then(|v| v.as_str()) == Some("flex") && !cls.contains("flex") {
        cls.insert_str(0, "flex ");
    }

    // Build props attribute string into a local buffer (avoids repeated allocs)
    let mut props_str = String::new();
    if !cls.is_empty() {
        let _ = write!(props_str, " className=\"{}\"", cls.trim());
    }

    // Icon special-case: emit as a self-closing JSX component
    if type_str == "icon" {
        let name = props.get("iconName").and_then(|v| v.as_str()).unwrap_or("Star");
        let size = props.get("iconSize").and_then(|v| v.as_u64()).unwrap_or(24);
        let _ = write!(buf, "{}<{}{} size={{{}}} />\n", sp, name, props_str, size);
        return;
    }

    let tag = match type_str {
        "text" => "p", "heading" => "h1", "button" => "button",
        "image" => "img", "input" => "input",
        "canvas" | "webpage" => "main", _ => "div"
    };

    // Self-closing void elements
    if matches!(tag, "image" | "input") {
        let _ = write!(buf, "{}<{}{} />\n", sp, tag, props_str);
        return;
    }

    // Collect children into a temporary buffer first so we can decide
    // whether to emit a single-line or multi-line element.
    let mut child_buf = String::new();
    if !content.is_empty() { child_buf.push_str(content); }
    if let Some(children) = &node.children {
        if !children.is_empty() {
            if !content.is_empty() { child_buf.push('\n'); }
            for c in children {
                generate_node_recursive(project, c, &mut child_buf, indent + 1, None);
            }
            if !child_buf.trim().is_empty() && !content.is_empty() {
                child_buf.push_str(&sp);
            }
        }
    }

    if child_buf.is_empty() {
        let _ = write!(buf, "{}<{}{} />\n", sp, tag, props_str);
    } else if child_buf.contains('\n') {
        let _ = write!(buf, "{}<{}{}>\n{}{}</{}>\n", sp, tag, props_str, child_buf, sp, tag);
    } else {
        let _ = write!(buf, "{}<{}{}>{}</{}>\n", sp, tag, props_str, child_buf, tag);
    }
}

// ============================================
// PRIORITY 5: LIVE COMPILER (SWC)
// ============================================
// STABILITY NOTE (Phase 6 fix):
// We previously stored `Globals` as a struct field to reuse the SWC string
// interner across calls (avoiding repeated allocator init).
//
// In the `wasm32-unknown-unknown` no_threads target, swc_core's GLOBALS is a
// thread-local backed by a spin-lock. Storing a Globals inside a wasm_bindgen
// struct and then calling GLOBALS.set() inside compile() causes the lock to be
// acquired twice on the same "thread" (WASM is single-threaded, but the lock
// is not re-entrant). Result: "cannot recursively acquire mutex" panic.
//
// Fix: SwcCompiler is a zero-sized unit struct. Each compile() call creates a
// fresh Globals — the lock is acquired, the full transform runs, and it is
// released before the next call. Cost: one alloc per compile (~negligible vs
// the 5–50ms parse + transform time).
//
// SourceMap remains local per compile (intentional): reusing it would cause
// unbounded ghost-file accumulation as every new_source_file() is permanent.

#[wasm_bindgen]
pub struct SwcCompiler; // Zero-sized — no persistent state, no mutex risk

#[wasm_bindgen]
impl SwcCompiler {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SwcCompiler {
        SwcCompiler
    }

    /// Compile TSX/JSX source → plain JS (React.createElement calls).
    /// Creates a fresh Globals per call to avoid WASM mutex re-entrancy panics.
    pub fn compile(&self, code: String) -> Result<String, JsValue> {
        // Fresh Globals every time — the only safe approach in wasm no_threads
        let globals = Globals::new();
        let cm: Lrc<SourceMap> = Default::default();
        let comments = SingleThreadedComments::default();

        GLOBALS.set(&globals, || {
            let syntax = Syntax::Typescript(TsConfig {
                tsx: true,
                decorators: true,
                ..Default::default()
            });

            let fm = cm.new_source_file(
                FileName::Custom("component.tsx".into()),
                code,
            );

            let lexer = Lexer::new(
                syntax,
                Default::default(),
                StringInput::from(&*fm),
                Some(&comments),
            );

            let mut parser = Parser::new_from(lexer);
            let program = parser
                .parse_program()
                .map_err(|_| JsValue::from_str("Parse Error"))?;

            // Strip TypeScript types
            let mark = Mark::new();
            let mut program = program.fold_with(&mut strip(mark));

            // Transform JSX → React.createElement
            let react_options = ReactOptions {
                runtime: Some(Runtime::Classic),
                ..Default::default()
            };
            program = program.fold_with(&mut react::<SingleThreadedComments>(
                cm.clone(),
                Some(comments.clone()),
                react_options,
                mark,
                Mark::new(),
            ));

            // Emit JS
            let mut buf = vec![];
            {
                let mut emitter = Emitter {
                    cfg: Config::default().with_minify(false),
                    cm: cm.clone(),
                    comments: Some(&comments),
                    wr: JsWriter::new(cm, "\n", &mut buf, None),
                };
                emitter
                    .emit_program(&program)
                    .map_err(|_| JsValue::from_str("Emit Error"))?;
            }

            Ok(String::from_utf8(buf)
                .map_err(|_| JsValue::from_str("UTF8 Error"))?)
        })
    }
}

/// Free-function shim kept for backward compatibility while callers migrate
/// to the `SwcCompiler` struct. Delegates to a temporary instance.
/// DEPRECATED: Prefer `new SwcCompiler().compile(code)` in TypeScript.
#[wasm_bindgen]
pub fn compile_component(code: String) -> Result<String, JsValue> {
    SwcCompiler::new().compile(code)
}

// ============================================
// PRIORITY 6: RESPONSIVE GRID CONVERTER (Phase F2)
// ============================================
//
// absolute_to_grid() transforms a set of absolutely-positioned canvas nodes
// into a CSS Grid layout descriptor.
//
// ALGORITHM OVERVIEW
// ──────────────────
// 1. Collect all X breakpoints (each node's left and left+width).
//    Collect all Y breakpoints (each node's top and top+height).
// 2. Sort and deduplicate both lists using a snap tolerance (SNAP_TOL = 4px).
//    Adjacent coordinates within tolerance are merged to their group mean.
//    This handles the common case where elements were dragged to "almost"
//    the same position and should share a grid line.
// 3. Consecutive breakpoint pairs define tracks:
//      col_widths[i]  = x_breaks[i+1] - x_breaks[i]
//      row_heights[i] = y_breaks[i+1] - y_breaks[i]
// 4. For each node, find its start/end coordinates in the breakpoint arrays.
//    CSS Grid is 1-based: array_index + 1 = CSS line number.
//    Both start and end use the same formula — the end is already exclusive
//    because it points to the line AFTER the last occupied track.
// 5. Serialize as JSON and return. TypeScript parses with JSON.parse().
//
// TIME COMPLEXITY
// ────────────────
// O(N log N) for sorting. O(N) for deduplication and placement.
// Typical canvas has N < 100 nodes — this runs in microseconds.
//
// SNAP TOLERANCE
// ──────────────
// 4px chosen to handle Vectra drag precision without merging intentionally
// separate tracks. A hero and a navbar that differ by 2px in top coordinate
// will correctly share a row boundary. Two cards at 100px and 108px apart
// will correctly produce separate tracks.

/// Snap tolerance in canvas pixels. Adjacent coordinates within this
/// distance are merged to a single canonical grid line.
const SNAP_TOL: f64 = 4.0;

/// Input geometry for a single canvas node.
/// The caller (TypeScript) strips style strings to plain numbers before calling.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridInputNode {
    pub id: String,
    /// Left position in canvas pixels (parsed from style.left).
    pub x: f64,
    /// Top position in canvas pixels (parsed from style.top).
    pub y: f64,
    /// Width in canvas pixels (parsed from style.width).
    pub w: f64,
    /// Height in canvas pixels (parsed from style.height).
    pub h: f64,
}

/// CSS Grid placement for a single node.
/// All indices are 1-based CSS line numbers.
/// col_end and row_end are EXCLUSIVE (standard CSS grid-column / grid-row syntax).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridItem {
    pub id: String,
    /// CSS: grid-column-start
    pub col_start: usize,
    /// CSS: grid-column-end (exclusive — the line after the last occupied track)
    pub col_end: usize,
    /// CSS: grid-row-start
    pub row_start: usize,
    /// CSS: grid-row-end (exclusive)
    pub row_end: usize,
}

/// Complete grid layout descriptor — the full output of absolute_to_grid().
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridLayout {
    /// CSS grid-template-columns value, e.g. "120px 360px 240px"
    pub template_columns: String,
    /// CSS grid-template-rows value, e.g. "80px 640px 60px"
    pub template_rows: String,
    /// Column track widths in raw pixels (parallel to template_columns tokens).
    /// Exposed so TypeScript can optionally convert to fr units.
    pub col_widths_px: Vec<f64>,
    /// Row track heights in raw pixels (parallel to template_rows tokens).
    pub row_heights_px: Vec<f64>,
    /// Per-node grid placements, in the same order as the input nodes array.
    pub items: Vec<GridItem>,
}

/// Deduplicate a list of f64 coordinates with snap tolerance.
///
/// Algorithm:
///   1. Sort the input.
///   2. Walk left-to-right, accumulating a "group" of values that are all
///      within SNAP_TOL of the running group mean.
///   3. When a value falls outside the tolerance, seal the current group
///      (push its mean to output) and start a new group.
///
/// Using the running group mean (not pairwise distance to the first element)
/// prevents drift: if 10 values cluster between 99px and 107px, the mean
/// stays accurate and no value escapes the tolerance band.
fn dedup_coords(mut coords: Vec<f64>) -> Vec<f64> {
    if coords.is_empty() {
        return coords;
    }
    coords.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let mut result: Vec<f64> = Vec::with_capacity(coords.len());
    let mut group_sum: f64 = coords[0];
    let mut group_count: usize = 1;

    for &val in &coords[1..] {
        let group_mean = group_sum / group_count as f64;
        if (val - group_mean).abs() <= SNAP_TOL {
            group_sum += val;
            group_count += 1;
        } else {
            result.push(group_sum / group_count as f64);
            group_sum = val;
            group_count = 1;
        }
    }
    result.push(group_sum / group_count as f64);
    result
}

/// Return the index of the coordinate in `breaks` nearest to `target`.
///
/// Because `breaks` is produced by `dedup_coords` and the input coordinates
/// came from the same source data, the nearest element should always be
/// within SNAP_TOL. The linear scan is acceptable: N < 100 in all real cases.
fn find_coord_idx(breaks: &[f64], target: f64) -> usize {
    breaks
        .iter()
        .enumerate()
        .min_by(|(_, &a), (_, &b)| {
            let da = (a - target).abs();
            let db = (b - target).abs();
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(i, _)| i)
        .unwrap_or(0)
}

/// Convert a set of absolutely-positioned canvas nodes into a CSS Grid layout.
///
/// # Arguments
/// * `nodes_json`    — JSON-encoded `Vec<GridInputNode>`. All coordinates must
///                     be plain numbers (no "px" suffix). The TypeScript caller
///                     is responsible for stripping units before serializing.
/// * `canvas_width`  — Pixel width of the parent canvas frame. Currently unused
///                     in track-size computation (tracks use px, not fr), but
///                     passed for future fr-unit conversion support.
///
/// # Returns
/// JSON-encoded `GridLayout` on success, or a `JsValue` error string on failure.
///
/// # CSS Line Numbering
/// CSS Grid is 1-based. Array index 0 in `x_breaks` = CSS line 1.
/// `col_start = find_coord_idx(x_breaks, node.x) + 1`
/// `col_end   = find_coord_idx(x_breaks, node.x + node.w) + 1`
/// The end index is already the exclusive boundary because `node.x + node.w`
/// maps to the line AFTER the last occupied track — adding another +1 would
/// be wrong and produce a one-track-too-wide result.
#[wasm_bindgen]
pub fn absolute_to_grid(nodes_json: String, _canvas_width: f64) -> Result<String, JsValue> {
    let nodes: Vec<GridInputNode> = serde_json::from_str(&nodes_json)
        .map_err(|e| JsValue::from_str(&format!("[absolute_to_grid] Parse error: {}", e)))?;

    if nodes.is_empty() {
        return Err(JsValue::from_str("[absolute_to_grid] No nodes provided"));
    }

    // ── Step 1: Collect all coordinate breakpoints ────────────────────────────
    let mut x_raw: Vec<f64> = Vec::with_capacity(nodes.len() * 2);
    let mut y_raw: Vec<f64> = Vec::with_capacity(nodes.len() * 2);

    for node in &nodes {
        x_raw.push(node.x);
        x_raw.push(node.x + node.w);
        y_raw.push(node.y);
        y_raw.push(node.y + node.h);
    }

    // ── Step 2: Deduplicate with snap tolerance → canonical grid lines ─────────
    let x_breaks = dedup_coords(x_raw);
    let y_breaks = dedup_coords(y_raw);

    // Guard: need at least 2 lines per axis to form 1 track
    if x_breaks.len() < 2 || y_breaks.len() < 2 {
        return Err(JsValue::from_str(
            "[absolute_to_grid] Degenerate layout: all nodes share the same coordinate",
        ));
    }

    // ── Step 3: Compute track sizes ───────────────────────────────────────────
    // Each consecutive pair of lines defines one track.
    // Round to integers; clamp to 1px minimum to prevent zero-width ghost tracks.
    let col_widths: Vec<f64> = x_breaks
        .windows(2)
        .map(|w| (w[1] - w[0]).round().max(1.0))
        .collect();

    let row_heights: Vec<f64> = y_breaks
        .windows(2)
        .map(|w| (w[1] - w[0]).round().max(1.0))
        .collect();

    // ── Step 4: Build CSS template strings ────────────────────────────────────
    let template_columns = col_widths
        .iter()
        .map(|&w| format!("{}px", w as i64))
        .collect::<Vec<_>>()
        .join(" ");

    let template_rows = row_heights
        .iter()
        .map(|&h| format!("{}px", h as i64))
        .collect::<Vec<_>>()
        .join(" ");

    // ── Step 5: Assign grid placements ────────────────────────────────────────
    // CSS line number = array index + 1  (1-based, no extra offset on end)
    let items: Vec<GridItem> = nodes
        .iter()
        .map(|node| {
            let col_start = find_coord_idx(&x_breaks, node.x) + 1;
            let col_end   = find_coord_idx(&x_breaks, node.x + node.w) + 1;
            let row_start = find_coord_idx(&y_breaks, node.y) + 1;
            let row_end   = find_coord_idx(&y_breaks, node.y + node.h) + 1;
            GridItem {
                id: node.id.clone(),
                col_start,
                col_end,
                row_start,
                row_end,
            }
        })
        .collect();

    // ── Step 6: Serialize and return ──────────────────────────────────────────
    serde_json::to_string(&GridLayout {
        template_columns,
        template_rows,
        col_widths_px: col_widths,
        row_heights_px: row_heights,
        items,
    })
    .map_err(|e| JsValue::from_str(&format!("[absolute_to_grid] Serialize error: {}", e)))
}


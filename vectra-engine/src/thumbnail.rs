// ══════════════════════════════════════════════════════════════════════════════
// thumbnail.rs  —  §12 ThumbnailEngine
// ══════════════════════════════════════════════════════════════════════════════
//
//  generate_thumbnail — 300×180 SVG wireframe of the first page's canvas.
//  Walks the element tree, draws coloured rects per node type.
//  Runs entirely in WASM during autosave — never blocks the main thread.
//  Mirrors: `generateThumbnail.generateLayoutThumbnail(elements, pages)`

use std::collections::HashMap;
use std::fmt::Write as FmtWrite;
use wasm_bindgen::prelude::*;
use serde_json::Value;

const THUMB_W: f64 = 300.0;
const THUMB_H: f64 = 180.0;

fn thumb_color(node_type: &str) -> &'static str {
    match node_type {
        "navbar"                                  => "#1d4ed8",
        "hero"|"hero_geometric"|"hero_modern"     => "#7c3aed",
        "text"|"heading"|"paragraph"              => "#3b82f6",
        "link"                                    => "#38bdf8",
        "image"|"video"                           => "#10b981",
        "button"                                  => "#8b5cf6",
        "input"                                   => "#a78bfa",
        "section"|"container"|"stack_v"|"stack_h" => "#27272a",
        "card"                                    => "#3f3f46",
        "grid"                                    => "#18181b",
        "feature_hover"|"features_section"        => "#4f46e5",
        "pricing"                                 => "#0891b2",
        "icon"                                    => "#71717a",
        _                                         => "#52525b",
    }
}

fn px_val(v: Option<&Value>) -> f64 {
    v.and_then(|x| x.as_f64())
     .or_else(|| v.and_then(|x| x.as_str())
         .and_then(|s| s.trim_end_matches("px").parse().ok()))
     .unwrap_or(0.0)
}

fn thumb_empty() -> String {
    let (bg, c1, c2) = ("#0a0a0b", "#27272a", "#18181b");
    let (w, h) = (THUMB_W as i32, THUMB_H as i32);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\">\n\
  <rect width=\"{w}\" height=\"{h}\" fill=\"{bg}\"/>\n\
  <rect x=\"20\" y=\"30\" width=\"{w1}\" height=\"16\" rx=\"4\" fill=\"{c1}\"/>\n\
  <rect x=\"20\" y=\"56\" width=\"{w2}\" height=\"8\"  rx=\"3\" fill=\"{c2}\"/>\n\
  <rect x=\"20\" y=\"72\" width=\"{w3}\" height=\"8\"  rx=\"3\" fill=\"{c2}\"/>\n\
  <rect x=\"20\" y=\"100\" width=\"{w1}\" height=\"50\" rx=\"4\" fill=\"{c2}\"/>\n\
</svg>",
        w=w, h=h, bg=bg, c1=c1, c2=c2,
        w1=w-40, w2=w-80, w3=w-100,
    )
}

/// Generate a 300×180 SVG wireframe thumbnail string.
/// `project_json`: full VectraProject
/// `pages_json`:   Page[] array (needs `[{id, rootId}]`)
#[wasm_bindgen]
pub fn generate_thumbnail(project_json: String, pages_json: String) -> String {
    let project: HashMap<String, Value> = match serde_json::from_str(&project_json) {
        Ok(p) => p, Err(_) => return thumb_empty(),
    };
    let pages: Vec<Value> = match serde_json::from_str(&pages_json) {
        Ok(p) => p, Err(_) => return thumb_empty(),
    };

    let primary_page = pages.iter()
        .find(|p| p.get("id").and_then(|i| i.as_str()) == Some("page-home"))
        .or_else(|| pages.first());
    let primary_page = match primary_page { Some(p) => p, None => return thumb_empty() };

    let root_id = primary_page.get("rootId").or_else(|| primary_page.get("id"))
        .and_then(|v| v.as_str()).unwrap_or("");
    let page_root  = match project.get(root_id)     { Some(p) => p, None => return thumb_empty() };
    let page_children = page_root.get("children").and_then(|c| c.as_array()).map(|a| a.as_slice()).unwrap_or(&[]);
    if page_children.is_empty() { return thumb_empty(); }

    let canvas_frame_id = page_children.iter()
        .find(|cid| cid.as_str().and_then(|id| project.get(id))
            .and_then(|n| n.get("type")).and_then(|t| t.as_str())
            .map(|t| t == "webpage" || t == "canvas").unwrap_or(false))
        .or_else(|| page_children.first())
        .and_then(|v| v.as_str()).unwrap_or("");
    let canvas_frame = match project.get(canvas_frame_id) { Some(f) => f, None => return thumb_empty() };

    let frame_style = canvas_frame.get("props").and_then(|p| p.get("style"));
    let canvas_w = px_val(frame_style.and_then(|s| s.get("width"))).max(100.0).max(1440.0);
    let canvas_h = {
        let h = px_val(frame_style.and_then(|s| s.get("height")))
            .max(px_val(frame_style.and_then(|s| s.get("minHeight")))).max(100.0);
        if h < 100.0 { 900.0 } else { h }
    };

    let scale   = (THUMB_W / canvas_w).min(THUMB_H / canvas_h);
    let scaled_h = canvas_h * scale;
    let offset_y = ((THUMB_H - scaled_h) / 2.0).max(0.0);

    let child_ids = canvas_frame.get("children").and_then(|c| c.as_array()).cloned().unwrap_or_default();
    if child_ids.is_empty() { return thumb_empty(); }

    let mut rects_svg = String::new();
    for cid_val in &child_ids {
        let cid  = match cid_val.as_str() { Some(id) => id, None => continue };
        let node = match project.get(cid)  { Some(n) => n,  None => continue };
        if node.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false) { continue; }

        let style = node.get("props").and_then(|p| p.get("style"));
        let raw_x = px_val(style.and_then(|s| s.get("left")));
        let raw_y = px_val(style.and_then(|s| s.get("top")));
        let raw_w = px_val(style.and_then(|s| s.get("width"))).max(1.0);
        let raw_h = px_val(style.and_then(|s| s.get("height")))
            .max(px_val(style.and_then(|s| s.get("minHeight")))).max(1.0);

        let cx = (raw_x * scale).round().max(0.0).min(THUMB_W - 2.0);
        let cy = (raw_y * scale + offset_y).round().max(0.0).min(THUMB_H - 1.0);
        let cw = (raw_w * scale).round().max(2.0).min(THUMB_W - cx);
        let ch = (raw_h * scale).round().max(1.0).min(THUMB_H - cy);
        if cw <= 0.0 || ch <= 0.0 { continue; }

        let fill = thumb_color(node.get("type").and_then(|t| t.as_str()).unwrap_or("_default"));

        if ch < 6.0 {
            let _ = write!(rects_svg,
                "  <rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\" opacity=\"0.6\"/>\n",
                cx as i32, cy as i32, cw as i32, ch.max(2.0) as i32, fill);
        } else {
            let rx = (cw / 8.0).floor().min(2.0) as i32;
            let _ = write!(rects_svg,
                "  <rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\" rx=\"{}\" opacity=\"0.75\"/>\n",
                cx as i32, cy as i32, cw as i32, ch as i32, fill, rx);
        }
    }

    if rects_svg.is_empty() { return thumb_empty(); }

    let (bg_col, line_col) = ("#0a0a0b", "#ffffff");
    let (w, h) = (THUMB_W as i32, THUMB_H as i32);
    let (hy, hx) = ((THUMB_H / 2.0) as i32, (THUMB_W / 2.0) as i32);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\">\n\
  <rect width=\"{w}\" height=\"{h}\" fill=\"{bg}\"/>\n\
  <line x1=\"0\" y1=\"{hy}\" x2=\"{w}\" y2=\"{hy}\" stroke=\"{lc}\" stroke-opacity=\"0.03\" stroke-width=\"1\"/>\n\
  <line x1=\"{hx}\" y1=\"0\" x2=\"{hx}\" y2=\"{h}\" stroke=\"{lc}\" stroke-opacity=\"0.03\" stroke-width=\"1\"/>\n\
{rects}</svg>",
        w=w, h=h, bg=bg_col, lc=line_col, hy=hy, hx=hx, rects=rects_svg,
    )
}

// ══════════════════════════════════════════════════════════════════════════════
// figma.rs  —  §16 FigmaConverter
// ══════════════════════════════════════════════════════════════════════════════
//
//  transform_figma_frame — Figma REST API node JSON → VectraProject
//
//  Covers (FIG-COORD-1 compliant):
//  • Absolute → relative coordinates for all children
//  • SOLID fills → backgroundColor / color
//  • GRADIENT_LINEAR/RADIAL → background: linear-gradient(...)
//  • IMAGE fills → marks as 'image' + tracks imageFillNodeIds
//  • Stroke → border shorthand
//  • cornerRadius + rectangleCornerRadii → border-radius
//  • DROP_SHADOW / INNER_SHADOW → box-shadow
//  • Auto-layout (H/V) → flexbox with gap, padding, alignment
//  • TEXT nodes → 'text' or 'heading' + typography styles
//  • ELLIPSE → borderRadius: 50%
//  • Depth collapse at MAX_DEPTH (8)
//  • Invisible / unsupported node skipping
//
//  Returns JSON: { nodes, rootId, imageFillNodeIds, imageFillMap, warnings }

use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::state::uuid_hex;

const MAX_DEPTH: usize = 8;

// ── Figma input types (minimal Figma v1 REST API subset) ─────────────────────

#[derive(Serialize, Deserialize, Clone, Default)]
struct FigmaColor { r: f64, g: f64, b: f64, a: f64 }

#[derive(Serialize, Deserialize, Clone, Default)]
struct FigmaBBox { x: f64, y: f64, width: f64, height: f64 }

#[derive(Serialize, Deserialize, Clone)]
struct FigmaGradientStop { position: f64, color: FigmaColor }

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FigmaPaint {
    #[serde(rename = "type")]  paint_type:    String,
    color:         Option<FigmaColor>,
    opacity:       Option<f64>,
    #[serde(rename = "imageRef")] image_ref: Option<String>,
    visible:       Option<bool>,
    gradient_stops: Option<Vec<FigmaGradientStop>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FigmaTypeStyle {
    font_family:           Option<String>,
    font_weight:           Option<f64>,
    font_size:             Option<f64>,
    text_align_horizontal: Option<String>,
    letter_spacing:        Option<f64>,
    line_height_px:        Option<f64>,
    italic:                Option<bool>,
    text_decoration:       Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FigmaEffect {
    #[serde(rename = "type")] effect_type: String,
    visible: Option<bool>,
    radius:  Option<f64>,
    color:   Option<FigmaColor>,
    offset:  Option<HashMap<String, f64>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FigmaNode {
    id:   String, name: String,
    #[serde(rename = "type")] node_type: String,
    visible:    Option<bool>,
    opacity:    Option<f64>,
    characters: Option<String>,
    children:   Option<Vec<FigmaNode>>,
    absolute_bounding_box: Option<FigmaBBox>,
    fills:   Option<Vec<FigmaPaint>>,
    strokes: Option<Vec<FigmaPaint>>,
    stroke_weight:           Option<f64>,
    corner_radius:           Option<f64>,
    rectangle_corner_radii:  Option<Vec<f64>>,
    layout_mode:             Option<String>,
    primary_axis_align_items: Option<String>,
    counter_axis_align_items: Option<String>,
    item_spacing:  Option<f64>,
    padding_top:   Option<f64>, padding_right:  Option<f64>,
    padding_bottom: Option<f64>, padding_left:  Option<f64>,
    clips_content: Option<bool>,
    effects: Option<Vec<FigmaEffect>>,
    style:   Option<FigmaTypeStyle>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FigmaConvertResult {
    nodes:                HashMap<String, Value>,
    root_id:              String,
    image_fill_node_ids:  Vec<String>,
    image_fill_map:       HashMap<String, String>,
    warnings:             Vec<String>,
}

struct FigmaCtx {
    node_map:            HashMap<String, Value>,
    image_fill_node_ids: Vec<String>,
    image_fill_map:      HashMap<String, String>,
    warnings:            Vec<String>,
}

// ── Color helpers ─────────────────────────────────────────────────────────────

fn figma_color_css(c: &FigmaColor, opacity_override: Option<f64>) -> String {
    let (r, g, b) = ((c.r*255.0).round() as u8, (c.g*255.0).round() as u8, (c.b*255.0).round() as u8);
    let a = opacity_override.unwrap_or(c.a);
    if a >= 1.0 { format!("rgb({}, {}, {})", r, g, b) }
    else        { format!("rgba({}, {}, {}, {:.3})", r, g, b, a) }
}

fn extract_gradient(paint: &FigmaPaint) -> Option<String> {
    let stops = paint.gradient_stops.as_ref()?.iter()
        .map(|s| format!("{} {}%", figma_color_css(&s.color, None), (s.position*100.0).round() as i32))
        .collect::<Vec<_>>().join(", ");
    if stops.is_empty() { return None; }
    match paint.paint_type.as_str() {
        "GRADIENT_LINEAR" => Some(format!("linear-gradient(135deg, {})", stops)),
        "GRADIENT_RADIAL" => Some(format!("radial-gradient(circle, {})", stops)),
        _ => None,
    }
}

fn extract_fill(fills: &Option<Vec<FigmaPaint>>, node_opacity: f64) -> Option<String> {
    let fills = fills.as_ref()?;
    for f in fills {
        if f.paint_type == "SOLID" && f.visible != Some(false) {
            if let Some(c) = &f.color {
                let eff = (f.opacity.unwrap_or(1.0) * node_opacity).min(1.0);
                return Some(figma_color_css(c, if eff < 1.0 { Some(eff) } else { None }));
            }
        }
    }
    for f in fills {
        if (f.paint_type == "GRADIENT_LINEAR" || f.paint_type == "GRADIENT_RADIAL") && f.visible != Some(false) {
            if let Some(g) = extract_gradient(f) { return Some(g); }
        }
    }
    None
}

fn extract_stroke(strokes: &Option<Vec<FigmaPaint>>, weight: Option<f64>) -> Option<String> {
    let w = weight?; let strokes = strokes.as_ref()?;
    for s in strokes {
        if s.paint_type == "SOLID" && s.visible != Some(false) {
            if let Some(c) = &s.color { return Some(format!("{}px solid {}", w as i32, figma_color_css(c, None))); }
        }
    }
    None
}

fn extract_shadow(effects: &Option<Vec<FigmaEffect>>) -> Option<String> {
    let effects = effects.as_ref()?;
    let shadows: Vec<String> = effects.iter()
        .filter(|e| (e.effect_type == "DROP_SHADOW" || e.effect_type == "INNER_SHADOW") && e.visible != Some(false))
        .filter_map(|e| {
            let c = e.color.as_ref()?;
            let ox = e.offset.as_ref().and_then(|o| o.get("x")).copied().unwrap_or(0.0);
            let oy = e.offset.as_ref().and_then(|o| o.get("y")).copied().unwrap_or(0.0);
            let r  = e.radius.unwrap_or(0.0);
            let inset = if e.effect_type == "INNER_SHADOW" { " inset" } else { "" };
            Some(format!("{}px {}px {}px {}{}", ox as i32, oy as i32, r as i32, figma_color_css(c, None), inset))
        }).collect();
    if shadows.is_empty() { None } else { Some(shadows.join(", ")) }
}

fn extract_border_radius(node: &FigmaNode) -> Option<String> {
    if let Some(radii) = &node.rectangle_corner_radii {
        if radii.len() == 4 && radii.iter().any(|&r| r > 0.0) {
            let [tl, tr, br, bl] = [radii[0] as i32, radii[1] as i32, radii[2] as i32, radii[3] as i32];
            if tl == tr && tr == br && br == bl { return Some(format!("{}px", tl)); }
            return Some(format!("{}px {}px {}px {}px", tl, tr, br, bl));
        }
    }
    node.corner_radius.filter(|&r| r > 0.0).map(|r| format!("{}px", r as i32))
}

fn extract_text_styles(style: &FigmaTypeStyle) -> HashMap<String, Value> {
    let mut m: HashMap<String, Value> = HashMap::new();
    if let Some(ref ff) = style.font_family { m.insert("fontFamily".into(), Value::String(ff.clone())); }
    if let Some(fw) = style.font_weight    { m.insert("fontWeight".into(), json!(fw as i32)); }
    if let Some(fs) = style.font_size      { m.insert("fontSize".into(),   Value::String(format!("{}px", fs as i32))); }
    if let Some(ls) = style.letter_spacing  { m.insert("letterSpacing".into(), Value::String(format!("{}px", ls))); }
    if let Some(lh) = style.line_height_px  { m.insert("lineHeight".into(),   Value::String(format!("{}px", lh as i32))); }
    if style.italic == Some(true)            { m.insert("fontStyle".into(),   Value::String("italic".into())); }
    if let Some(ref ta) = style.text_align_horizontal {
        let align = match ta.as_str() { "CENTER" => "center", "RIGHT" => "right", "JUSTIFIED" => "justify", _ => "left" };
        m.insert("textAlign".into(), Value::String(align.into()));
    }
    if let Some(ref td) = style.text_decoration {
        if td != "NONE" {
            m.insert("textDecoration".into(), Value::String(if td == "STRIKETHROUGH" { "line-through".into() } else { "underline".into() }));
        }
    }
    m
}

// ── Core recursive transform ──────────────────────────────────────────────────

fn figma_node_to_vectra(node: &FigmaNode, parent_box: &FigmaBBox, depth: usize, ctx: &mut FigmaCtx) -> Option<String> {
    if node.visible == Some(false) { return None; }

    const SKIP: &[&str] = &["BOOLEAN_OPERATION","SLICE","CONNECTOR","STICKY","SHAPE_WITH_TEXT","CODE_BLOCK","STAMP","WIDGET","EMBED","LINK_UNFURL","MEDIA","SECTION"];
    const RENDERABLE: &[&str] = &["FRAME","GROUP","COMPONENT","COMPONENT_SET","INSTANCE","RECTANGLE","ELLIPSE","LINE","VECTOR","STAR","POLYGON","TEXT"];
    if SKIP.contains(&node.node_type.as_str()) { return None; }
    if !RENDERABLE.contains(&node.node_type.as_str()) {
        ctx.warnings.push(format!("Skipped unsupported type: {} (\"{}\")", node.node_type, node.name));
        return None;
    }

    if depth > MAX_DEPTH {
        if let Some(text) = &node.characters {
            let t = text.trim();
            if !t.is_empty() {
                let id = format!("txt_{}", &uuid_hex()[..8]);
                ctx.node_map.insert(id.clone(), json!({
                    "id": id, "type": "text",
                    "name": format!("{} (collapsed)", node.name),
                    "content": &t[..t.len().min(500)],
                    "children": [], "props": { "style": { "position": "relative", "width": "100%" } }
                }));
                return Some(id);
            }
        }
        return None;
    }

    let bbox    = node.absolute_bounding_box.as_ref();
    let left    = bbox.map(|b| (b.x - parent_box.x).round() as i32).unwrap_or(0);
    let top     = bbox.map(|b| (b.y - parent_box.y).round() as i32).unwrap_or(0);
    let width   = bbox.map(|b| b.width.round().max(1.0) as i32).unwrap_or(100);
    let height  = bbox.map(|b| b.height.round().max(1.0) as i32).unwrap_or(40);
    let node_opacity = node.opacity.unwrap_or(1.0);

    let (node_type, content): (&str, Option<String>) = if node.node_type == "TEXT" {
        let size = node.style.as_ref().and_then(|s| s.font_size).unwrap_or(0.0);
        (if size >= 20.0 { "heading" } else { "text" }, node.characters.clone())
    } else { ("container", None) };

    let mut style: HashMap<String, Value> = HashMap::new();
    style.insert("position".into(), json!("absolute"));
    style.insert("left".into(),  json!(format!("{}px", left)));
    style.insert("top".into(),   json!(format!("{}px", top)));
    style.insert("width".into(), json!(format!("{}px", width)));
    style.insert("height".into(),json!(format!("{}px", height)));
    if node_opacity < 1.0 { style.insert("opacity".into(), json!(node_opacity)); }
    if node.node_type == "ELLIPSE" { style.insert("borderRadius".into(), json!("50%")); }

    let has_image_fill = node.fills.as_ref()
        .map(|f| f.iter().any(|p| p.paint_type == "IMAGE" && p.visible != Some(false)))
        .unwrap_or(false);

    if !has_image_fill {
        if let Some(bg) = extract_fill(&node.fills, node_opacity) {
            let key = if bg.starts_with("linear-gradient") || bg.starts_with("radial-gradient") { "background" } else { "backgroundColor" };
            style.insert(key.into(), json!(bg));
        }
    }
    if let Some(border) = extract_stroke(&node.strokes, node.stroke_weight) { style.insert("border".into(), json!(border)); }
    if node.node_type != "ELLIPSE" {
        if let Some(br) = extract_border_radius(node) { style.insert("borderRadius".into(), json!(br)); }
    }
    if let Some(shadow) = extract_shadow(&node.effects) { style.insert("boxShadow".into(), json!(shadow)); }
    if node.clips_content == Some(true) { style.insert("overflow".into(), json!("hidden")); }

    if let Some(ref lm) = node.layout_mode {
        if lm == "HORIZONTAL" || lm == "VERTICAL" {
            style.insert("display".into(), json!("flex"));
            style.insert("flexDirection".into(), json!(if lm == "HORIZONTAL" { "row" } else { "column" }));
            if let Some(gap) = node.item_spacing { style.insert("gap".into(), json!(format!("{}px", gap as i32))); }
            let (pt, pr, pb, pl) = (node.padding_top.unwrap_or(0.0) as i32, node.padding_right.unwrap_or(0.0) as i32,
                                    node.padding_bottom.unwrap_or(0.0) as i32, node.padding_left.unwrap_or(0.0) as i32);
            if pt > 0 || pr > 0 || pb > 0 || pl > 0 { style.insert("padding".into(), json!(format!("{}px {}px {}px {}px", pt, pr, pb, pl))); }
            let primary = node.primary_axis_align_items.as_deref().unwrap_or("MIN");
            let counter = node.counter_axis_align_items.as_deref().unwrap_or("MIN");
            let jc = match primary { "CENTER" => "center", "MAX" => "flex-end", "SPACE_BETWEEN" => "space-between", _ => "flex-start" };
            let ai = match counter { "CENTER" => "center", "MAX" => "flex-end", _ => "flex-start" };
            if lm == "HORIZONTAL" { style.insert("justifyContent".into(), json!(jc)); style.insert("alignItems".into(), json!(ai)); }
            else                  { style.insert("alignItems".into(), json!(jc));     style.insert("justifyContent".into(), json!(ai)); }
        }
    }

    if node_type == "text" || node_type == "heading" {
        if let Some(ref ts) = node.style { for (k, v) in extract_text_styles(ts) { style.insert(k, v); } }
        if let Some(color) = extract_fill(&node.fills, node_opacity) { style.insert("color".into(), json!(color)); }
        style.remove("backgroundColor");
    }

    let vectra_id   = format!("{}_{}", &node_type[..3], &uuid_hex()[..8]);
    let actual_type = if has_image_fill { "image" } else { node_type };
    let mut vnode: HashMap<String, Value> = HashMap::new();
    vnode.insert("id".into(),       json!(vectra_id));
    vnode.insert("type".into(),     json!(actual_type));
    vnode.insert("name".into(),     json!(&node.name[..node.name.len().min(60)]));
    vnode.insert("children".into(), json!([] as [&str; 0]));
    vnode.insert("props".into(),    json!({ "style": style }));
    if let Some(c) = content { vnode.insert("content".into(), json!(&c[..c.len().min(2000)])); }

    if has_image_fill {
        ctx.image_fill_node_ids.push(node.id.clone());
        ctx.image_fill_map.insert(vectra_id.clone(), node.id.clone());
        vnode.insert("src".into(), json!(""));
    }

    if !has_image_fill && node_type == "container" {
        if let Some(children) = &node.children {
            let child_box = bbox.unwrap_or(parent_box);
            let child_ids: Vec<String> = children.iter()
                .filter_map(|child| figma_node_to_vectra(child, child_box, depth+1, ctx))
                .collect();
            vnode.insert("children".into(), json!(child_ids));
        }
    }

    ctx.node_map.insert(vectra_id.clone(), Value::Object(vnode.into_iter().collect()));
    Some(vectra_id)
}

// ── Public WASM export ────────────────────────────────────────────────────────

/// Transform a Figma frame → VectraProject element map.
/// `frame_json`: JSON of a single Figma FRAME node.
/// `import_mode`: "page" | "component"
/// Returns JSON: { nodes, rootId, imageFillNodeIds, imageFillMap, warnings }
/// Mirrors: `transformFigmaFrame(frame, importMode)` in figmaImporter.ts
#[wasm_bindgen]
pub fn transform_figma_frame(frame_json: String, import_mode: String) -> Result<String, JsValue> {
    let frame: FigmaNode = serde_json::from_str(&frame_json)
        .map_err(|e| JsValue::from_str(&format!("[figma] parse: {}", e)))?;

    let mut ctx = FigmaCtx {
        node_map: HashMap::new(), image_fill_node_ids: Vec::new(),
        image_fill_map: HashMap::new(), warnings: Vec::new(),
    };

    let bbox = frame.absolute_bounding_box.clone()
        .unwrap_or(FigmaBBox { x: 0.0, y: 0.0, width: 1440.0, height: 900.0 });
    let (width, height) = (bbox.width.round() as i32, bbox.height.round() as i32);

    let child_ids: Vec<String> = frame.children.as_ref()
        .map(|children| children.iter()
            .filter_map(|child| figma_node_to_vectra(child, &bbox, 1, &mut ctx))
            .collect())
        .unwrap_or_default();

    let root_id   = format!("root_{}", &uuid_hex()[..8]);
    let bg        = extract_fill(&frame.fills, 1.0).unwrap_or_else(|| "#ffffff".to_string());
    let root_type = if import_mode == "page" { "webpage" } else { "container" };

    ctx.node_map.insert(root_id.clone(), json!({
        "id": root_id, "type": root_type, "name": frame.name,
        "children": child_ids,
        "props": { "layoutMode": "canvas", "style": {
            "position": "relative",
            "width": format!("{}px", width),
            "minHeight": format!("{}px", height),
            "backgroundColor": bg,
        }}
    }));

    serde_json::to_string(&FigmaConvertResult {
        nodes: ctx.node_map, root_id,
        image_fill_node_ids: ctx.image_fill_node_ids,
        image_fill_map: ctx.image_fill_map,
        warnings: ctx.warnings,
    }).map_err(|e| JsValue::from_str(&e.to_string()))
}

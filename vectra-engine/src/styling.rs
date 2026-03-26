// ══════════════════════════════════════════════════════════════════════════════
// styling.rs  —  §4 ColorEngine  +  §5 TailwindOptimizer  +  §11 CSSGenerator
// ══════════════════════════════════════════════════════════════════════════════
//
//  §4  ColorEngine — HSL/RGB/Hex transforms, WCAG contrast, palettes
//  §5  TailwindOptimizer — deduplicate_classes, sort_tailwind_classes
//  §11 CSSGenerator — build_breakpoint_css, build_mobile_css, serialize_style_object

use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;
use serde_json::Value;

// ── §4 Color helpers (pub(crate) so figma.rs can use them) ───────────────────

pub(crate) fn parse_hex(hex: &str) -> Result<(u8, u8, u8), JsValue> {
    let h = hex.trim().trim_start_matches('#');
    let full = if h.len() == 3 {
        let c: Vec<char> = h.chars().collect();
        format!("{0}{0}{1}{1}{2}{2}", c[0], c[1], c[2])
    } else { h.to_string() };
    if full.len() != 6 { return Err(JsValue::from_str("bad hex")); }
    Ok((
        u8::from_str_radix(&full[0..2], 16).map_err(|_| JsValue::from_str("r"))?,
        u8::from_str_radix(&full[2..4], 16).map_err(|_| JsValue::from_str("g"))?,
        u8::from_str_radix(&full[4..6], 16).map_err(|_| JsValue::from_str("b"))?,
    ))
}

pub(crate) fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let (rf, gf, bf) = (r as f64/255.0, g as f64/255.0, b as f64/255.0);
    let max = rf.max(gf).max(bf); let min = rf.min(gf).min(bf);
    let d = max - min; let l = (max + min) / 2.0;
    if d < 1e-10 { return (0.0, 0.0, l * 100.0); }
    let s = d / (1.0 - (2.0 * l - 1.0).abs());
    let h = if max == rf { 60.0 * (((gf-bf)/d) % 6.0) }
            else if max == gf { 60.0 * ((bf-rf)/d + 2.0) }
            else { 60.0 * ((rf-gf)/d + 4.0) };
    let h = if h < 0.0 { h + 360.0 } else { h };
    (h, s * 100.0, l * 100.0)
}

pub(crate) fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let (s, l) = (s/100.0, l/100.0);
    let c = (1.0 - (2.0*l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h/60.0) % 2.0 - 1.0).abs());
    let m = l - c/2.0;
    let (r, g, b) = match (h/60.0) as u32 {
        0 => (c,x,0.0), 1 => (x,c,0.0), 2 => (0.0,c,x),
        3 => (0.0,x,c), 4 => (x,0.0,c), _ => (c,0.0,x),
    };
    (((r+m)*255.0).round() as u8, ((g+m)*255.0).round() as u8, ((b+m)*255.0).round() as u8)
}

fn rel_lum(r: u8, g: u8, b: u8) -> f64 {
    let lin = |c: u8| { let v = c as f64/255.0; if v <= 0.03928 { v/12.92 } else { ((v+0.055)/1.055).powf(2.4) } };
    0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b)
}

// ── §4 ColorEngine ────────────────────────────────────────────────────────────

#[wasm_bindgen] pub struct ColorEngine;

#[wasm_bindgen]
impl ColorEngine {
    #[wasm_bindgen(constructor)] pub fn new() -> ColorEngine { ColorEngine }

    pub fn hex_to_hsl(&self, hex: String) -> Result<String, JsValue> {
        let (r,g,b) = parse_hex(&hex)?;
        let (h,s,l) = rgb_to_hsl(r,g,b);
        Ok(format!("{:.1},{:.1},{:.1}", h, s, l))
    }

    pub fn hsl_to_hex(&self, h: f64, s: f64, l: f64) -> String {
        let (r,g,b) = hsl_to_rgb(h,s,l);
        format!("#{:02x}{:02x}{:02x}", r, g, b)
    }

    pub fn adjust_lightness(&self, hex: String, delta: f64) -> Result<String, JsValue> {
        let (r,g,b) = parse_hex(&hex)?;
        let (h,s,l) = rgb_to_hsl(r,g,b);
        let (nr,ng,nb) = hsl_to_rgb(h, s, (l+delta).clamp(0.0, 100.0));
        Ok(format!("#{:02x}{:02x}{:02x}", nr, ng, nb))
    }

    pub fn adjust_saturation(&self, hex: String, delta: f64) -> Result<String, JsValue> {
        let (r,g,b) = parse_hex(&hex)?;
        let (h,s,l) = rgb_to_hsl(r,g,b);
        let (nr,ng,nb) = hsl_to_rgb(h, (s+delta).clamp(0.0, 100.0), l);
        Ok(format!("#{:02x}{:02x}{:02x}", nr, ng, nb))
    }

    pub fn mix_colors(&self, hex1: String, hex2: String, t: f64) -> Result<String, JsValue> {
        let (r1,g1,b1) = parse_hex(&hex1)?;
        let (r2,g2,b2) = parse_hex(&hex2)?;
        let lp = |a: u8, b: u8| (a as f64 + (b as f64 - a as f64)*t).round() as u8;
        Ok(format!("#{:02x}{:02x}{:02x}", lp(r1,r2), lp(g1,g2), lp(b1,b2)))
    }

    pub fn get_contrast_ratio(&self, fg: String, bg: String) -> Result<f64, JsValue> {
        let (r1,g1,b1) = parse_hex(&fg)?;
        let (r2,g2,b2) = parse_hex(&bg)?;
        let (l1, l2) = (rel_lum(r1,g1,b1), rel_lum(r2,g2,b2));
        let (li, dk) = if l1 > l2 { (l1, l2) } else { (l2, l1) };
        Ok((li + 0.05) / (dk + 0.05))
    }

    pub fn is_accessible(&self, fg: String, bg: String) -> Result<bool, JsValue> {
        Ok(self.get_contrast_ratio(fg, bg)? >= 4.5)
    }

    pub fn suggest_accessible_fg(&self, bg: String) -> Result<String, JsValue> {
        let br = self.get_contrast_ratio("#000000".into(), bg.clone())?;
        let wr = self.get_contrast_ratio("#ffffff".into(), bg)?;
        Ok(if wr > br { "#ffffff".into() } else { "#000000".into() })
    }

    pub fn generate_scale(&self, hex: String, steps: u32) -> Result<String, JsValue> {
        let steps = steps.max(3).min(20) as usize;
        let (r,g,b) = parse_hex(&hex)?;
        let (h,s,_) = rgb_to_hsl(r,g,b);
        let sc: Vec<String> = (0..steps).map(|i| {
            let t = i as f64 / (steps-1) as f64;
            let l = 95.0 - t*85.0;
            let (nr,ng,nb) = hsl_to_rgb(h, s, l);
            format!("#{:02x}{:02x}{:02x}", nr, ng, nb)
        }).collect();
        serde_json::to_string(&sc).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn complement(&self, hex: String) -> Result<String, JsValue> {
        let (r,g,b) = parse_hex(&hex)?;
        let (h,s,l) = rgb_to_hsl(r,g,b);
        let (nr,ng,nb) = hsl_to_rgb((h+180.0) % 360.0, s, l);
        Ok(format!("#{:02x}{:02x}{:02x}", nr, ng, nb))
    }
}

// ── §5 TailwindOptimizer ──────────────────────────────────────────────────────

const CONFLICT_PREFIXES: &[&str] = &[
    "p-","px-","py-","pt-","pr-","pb-","pl-",
    "m-","mx-","my-","mt-","mr-","mb-","ml-",
    "w-","h-","min-w-","max-w-","min-h-","max-h-",
    "flex-","grid-cols-","grid-rows-","col-span-","row-span-",
    "gap-","gap-x-","gap-y-","top-","right-","bottom-","left-","inset-","z-",
    "text-","font-","leading-","tracking-","line-clamp-",
    "bg-","border-","rounded-","shadow-","opacity-",
    "ring-","ring-offset-","scale-","rotate-","translate-x-","translate-y-",
    "duration-","ease-",
];

#[wasm_bindgen]
pub fn deduplicate_classes(classes: String) -> String {
    let tokens: Vec<&str> = classes.split_whitespace().collect();
    if tokens.is_empty() { return String::new(); }
    let mut last_in_group: HashMap<&str, usize> = HashMap::new();
    for (i, &t) in tokens.iter().enumerate() {
        let bare = if let Some(p) = t.rfind(':') { &t[p+1..] } else { t };
        for &pfx in CONFLICT_PREFIXES {
            if bare.starts_with(pfx) { last_in_group.insert(pfx, i); break; }
        }
    }
    let mut seen = HashSet::new(); let mut out: Vec<&str> = Vec::new();
    for (i, &t) in tokens.iter().enumerate() {
        let bare = if let Some(p) = t.rfind(':') { &t[p+1..] } else { t };
        let mut shadowed = false;
        for &pfx in CONFLICT_PREFIXES {
            if bare.starts_with(pfx) {
                if last_in_group.get(pfx).copied() != Some(i) { shadowed = true; }
                break;
            }
        }
        if !shadowed && seen.insert(t) { out.push(t); }
    }
    out.join(" ")
}

#[wasm_bindgen]
pub fn sort_tailwind_classes(classes: String) -> String {
    let weight = |cls: &str| -> u32 {
        let b = if let Some(p) = cls.rfind(':') { &cls[p+1..] } else { cls };
        if matches!(b,"block"|"inline"|"inline-block"|"flex"|"grid"|"hidden"|"contents") { return 10; }
        if b.starts_with("flex-") || b.starts_with("grid-") { return 15; }
        if b.starts_with("col-")  || b.starts_with("row-")  { return 16; }
        if matches!(b,"static"|"relative"|"absolute"|"fixed"|"sticky") { return 20; }
        if b.starts_with("top-")||b.starts_with("right-")||b.starts_with("bottom-")||b.starts_with("left-")||b.starts_with("inset-") { return 21; }
        if b.starts_with("z-")   { return 22; }
        if b.starts_with("w-")   || b.starts_with("h-")   { return 30; }
        if b.starts_with("min-") || b.starts_with("max-") { return 31; }
        if b.starts_with('p') && (b.starts_with("p-")||b.starts_with("px-")||b.starts_with("py-")||b.starts_with("pt-")||b.starts_with("pr-")||b.starts_with("pb-")||b.starts_with("pl-")) { return 40; }
        if b.starts_with('m') && (b.starts_with("m-")||b.starts_with("mx-")||b.starts_with("my-")||b.starts_with("mt-")||b.starts_with("mr-")||b.starts_with("mb-")||b.starts_with("ml-")) { return 41; }
        if b.starts_with("gap-") { return 42; }
        if b.starts_with("text-")||b.starts_with("font-")||b.starts_with("leading-")||b.starts_with("tracking-") { return 50; }
        if b.starts_with("bg-")||b.starts_with("from-")||b.starts_with("via-")||b.starts_with("to-") { return 60; }
        if b.starts_with("border") { return 70; } if b.starts_with("rounded") { return 71; }
        if b.starts_with("shadow")||b.starts_with("ring") { return 80; }
        if b.starts_with("opacity-")||b.starts_with("blur") { return 81; }
        if b.starts_with("transition")||b.starts_with("duration-")||b.starts_with("ease-") { return 90; }
        if b.starts_with("scale-")||b.starts_with("rotate-")||b.starts_with("translate-") { return 91; }
        if cls.contains(':') { return 200; }
        100
    };
    let mut tokens: Vec<&str> = classes.split_whitespace().collect();
    tokens.sort_by_key(|t| weight(t));
    tokens.join(" ")
}

// ── §11 CSSGenerator ──────────────────────────────────────────────────────────

/// Convert camelCase CSS property to kebab-case.
pub(crate) fn camel_to_kebab(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for c in s.chars() {
        if c.is_uppercase() { out.push('-'); out.push(c.to_lowercase().next().unwrap()); }
        else { out.push(c); }
    }
    out
}

/// Generate @media breakpoint CSS for tablet + mobile overrides.
/// Mirrors: `codeGenerator.buildBreakpointCSS(project, nodeIds)`
#[wasm_bindgen]
pub fn build_breakpoint_css(project_json: String, node_ids_json: String) -> Result<String, JsValue> {
    let project: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[css] parse project: {}", e)))?;
    let node_ids: Vec<String> = serde_json::from_str(&node_ids_json)
        .map_err(|e| JsValue::from_str(&format!("[css] parse ids: {}", e)))?;
    let mut tablet_rules: Vec<String> = Vec::new();
    let mut mobile_rules: Vec<String> = Vec::new();
    for id in &node_ids {
        let node = match project.get(id) { Some(n) => n, None => continue };
        let breakpoints = match node.get("props").and_then(|p| p.get("breakpoints")) {
            Some(b) => b, None => continue,
        };
        for (bp_key, rules) in [("tablet", &mut tablet_rules), ("mobile", &mut mobile_rules)] {
            if let Some(bp_obj) = breakpoints.get(bp_key).and_then(|b| b.as_object()) {
                if !bp_obj.is_empty() {
                    let decls: Vec<String> = bp_obj.iter()
                        .map(|(k,v)| format!("    {}: {} !important;", camel_to_kebab(k), v.as_str().unwrap_or(&v.to_string())))
                        .collect();
                    rules.push(format!("  [data-vid=\"{}\"] {{\n{}\n  }}", id, decls.join("\n")));
                }
            }
        }
    }
    let mut parts: Vec<String> = Vec::new();
    if !tablet_rules.is_empty() { parts.push(format!("@media (max-width: 1024px) {{\n{}\n}}", tablet_rules.join("\n"))); }
    if !mobile_rules.is_empty() { parts.push(format!("@media (max-width: 768px) {{\n{}\n}}", mobile_rules.join("\n"))); }
    Ok(parts.join("\n\n"))
}

/// Generate canvas-frame + stack-on-mobile media query block.
/// Mirrors: `codeGenerator.buildMobileCSS(hasMobileNodes)`
#[wasm_bindgen]
pub fn build_mobile_css(has_mobile_nodes: bool) -> String {
    let mut parts = vec![
        "@media (max-width: 768px) {".to_string(),
        "  /* Layer 1: Canvas frame scrolls horizontally on small screens */".to_string(),
        "  .vectra-canvas-frame {".to_string(),
        "    overflow-x: auto;".to_string(),
        "    -webkit-overflow-scrolling: touch;".to_string(),
        "  }".to_string(),
    ];
    if has_mobile_nodes {
        parts.extend([
            "  /* Layer 2: Stack-on-Mobile */".to_string(),
            "  .vectra-stack-mobile {".to_string(),
            "    position: relative !important;".to_string(),
            "    left: auto !important; top: auto !important;".to_string(),
            "    right: auto !important; bottom: auto !important;".to_string(),
            "    width: 100% !important; max-width: 100% !important;".to_string(),
            "    height: auto !important; min-height: 0 !important;".to_string(),
            "  }".to_string(),
        ]);
    }
    parts.push("}".to_string());
    parts.join("\n")
}

/// Serialize React style object { camelCase: value } → CSS declaration string.
/// Mirrors: `codeGenerator.serializeStyle(styleObj)`
#[wasm_bindgen]
pub fn serialize_style_object(style_json: String) -> Result<String, JsValue> {
    const UNITLESS: &[&str] = &[
        "fontWeight","opacity","zIndex","flexGrow","flexShrink",
        "order","scale","lineHeight","aspectRatio","columns",
    ];
    let obj: serde_json::Map<String, Value> = serde_json::from_str(&style_json)
        .map_err(|e| JsValue::from_str(&format!("[css] parse style: {}", e)))?;
    let mut parts: Vec<String> = Vec::new();
    for (k, v) in &obj {
        let css_prop = camel_to_kebab(k);
        let css_val = match v {
            Value::Number(n) => {
                let num = n.as_f64().unwrap_or(0.0);
                if UNITLESS.contains(&k.as_str()) || num == 0.0 { format!("{}", num) }
                else { format!("{}px", num) }
            }
            Value::String(s) => s.clone(),
            _ => v.to_string(),
        };
        parts.push(format!("{}: {}", css_prop, css_val));
    }
    Ok(parts.join("; "))
}

use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use serde_json::Value;

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
// PRIORITY 1: LAYOUT ENGINE (Snapping)
// ============================================

#[derive(Serialize, Deserialize)]
pub struct Rect {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

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

#[wasm_bindgen]
pub fn calculate_snapping(
    target_val: JsValue, 
    candidates_val: JsValue,
    delta_x: f64,
    delta_y: f64,
    threshold: f64
) -> Result<JsValue, JsValue> {
    let target: Rect = serde_wasm_bindgen::from_value(target_val)?;
    let siblings: Vec<Rect> = serde_wasm_bindgen::from_value(candidates_val)?;

    let mut new_x = target.x + delta_x;
    let mut new_y = target.y + delta_y;
    let mut guides: Vec<Guide> = Vec::with_capacity(2);

    let mut snapped_x = false;
    let mut snapped_y = false;

    let target_w = target.w;
    let target_h = target.h;

    for sib in siblings {
        // X Axis
        if !snapped_x {
            let x_points = [
                (new_x, sib.x), (new_x, sib.x + sib.w / 2.0), (new_x, sib.x + sib.w),
                (new_x + target_w / 2.0, sib.x), (new_x + target_w / 2.0, sib.x + sib.w / 2.0), (new_x + target_w / 2.0, sib.x + sib.w),
                (new_x + target_w, sib.x), (new_x + target_w, sib.x + sib.w / 2.0), (new_x + target_w, sib.x + sib.w),
            ];
            for (t, s) in x_points.iter() {
                if (t - s).abs() < threshold {
                    new_x += s - t;
                    snapped_x = true;
                    guides.push(Guide { orientation: "vertical".into(), pos: *s, start: new_y.min(sib.y), end: (new_y + target_h).max(sib.y + sib.h), guide_type: "align".into() });
                    break;
                }
            }
        }
        // Y Axis
        if !snapped_y {
            let y_points = [
                (new_y, sib.y), (new_y, sib.y + sib.h / 2.0), (new_y, sib.y + sib.h),
                (new_y + target_h / 2.0, sib.y), (new_y + target_h / 2.0, sib.y + sib.h / 2.0), (new_y + target_h / 2.0, sib.y + sib.h),
                (new_y + target_h, sib.y), (new_y + target_h, sib.y + sib.h / 2.0), (new_y + target_h, sib.y + sib.h),
            ];
            for (t, s) in y_points.iter() {
                if (t - s).abs() < threshold {
                    new_y += s - t;
                    snapped_y = true;
                    guides.push(Guide { orientation: "horizontal".into(), pos: *s, start: new_x.min(sib.x), end: (new_x + target_w).max(sib.x + sib.w), guide_type: "align".into() });
                    break;
                }
            }
        }
        if snapped_x && snapped_y { break; }
    }

    Ok(serde_wasm_bindgen::to_value(&SnapResult { x: new_x, y: new_y, guides })?)
}

// ============================================
// PRIORITY 2: TREE MANAGER
// ============================================

#[derive(Serialize, Deserialize, Clone)]
pub struct VectraNode {
    pub id: String,
    pub children: Option<Vec<String>>,
    #[serde(flatten)]
    pub other: HashMap<String, Value>,
}

#[derive(Serialize)]
pub struct TemplateResult {
    pub new_nodes: HashMap<String, VectraNode>,
    pub root_id: String,
}

#[wasm_bindgen]
pub fn delete_node(project_val: JsValue, node_id: String) -> Result<JsValue, JsValue> {
    let mut project: HashMap<String, VectraNode> = serde_wasm_bindgen::from_value(project_val)?;
    
    // Unlink
    let mut parent_id_found = None;
    for (id, node) in &project {
        if let Some(children) = &node.children {
            if children.contains(&node_id) {
                parent_id_found = Some(id.clone());
                break;
            }
        }
    }
    if let Some(pid) = parent_id_found {
        if let Some(parent) = project.get_mut(&pid) {
            if let Some(children) = &mut parent.children {
                children.retain(|c| c != &node_id);
            }
        }
    }

    // Collect
    let mut to_delete = Vec::new();
    let mut stack = vec![node_id];
    while let Some(curr) = stack.pop() {
        to_delete.push(curr.clone());
        if let Some(node) = project.get(&curr) {
            if let Some(children) = &node.children {
                stack.extend(children.clone());
            }
        }
    }

    // Delete
    for id in to_delete { project.remove(&id); }

    Ok(serde_wasm_bindgen::to_value(&project)?)
}

#[wasm_bindgen]
pub fn instantiate_template(template_nodes_val: JsValue, root_id: String) -> Result<JsValue, JsValue> {
    let template_nodes: HashMap<String, VectraNode> = serde_wasm_bindgen::from_value(template_nodes_val)?;
    let mut id_map = HashMap::new();
    let mut new_nodes = HashMap::new();

    let mut stack = vec![root_id.clone()];
    let mut descendants = Vec::new();
    while let Some(curr) = stack.pop() {
        descendants.push(curr.clone());
        if let Some(node) = template_nodes.get(&curr) {
            if let Some(children) = &node.children {
                stack.extend(children.clone());
            }
        }
    }

    for old_id in &descendants {
        let rnd = (js_sys::Math::random() * 10000.0).floor() as u32;
        id_map.insert(old_id.clone(), format!("el-{}-{}", js_sys::Date::now() as u64, rnd));
    }

    for old_id in descendants {
        if let Some(old_node) = template_nodes.get(&old_id) {
            let mut new_node = old_node.clone();
            if let Some(nid) = id_map.get(&old_id) { new_node.id = nid.clone(); }
            if let Some(children) = &mut new_node.children {
                *children = children.iter().filter_map(|c| id_map.get(c).cloned()).collect();
            }
            new_nodes.insert(new_node.id.clone(), new_node);
        }
    }

    Ok(serde_wasm_bindgen::to_value(&TemplateResult {
        new_nodes,
        root_id: id_map.get(&root_id).unwrap_or(&root_id).to_string(),
    })?)
}

// ============================================
// PRIORITY 3: HISTORY MANAGER
// ============================================

#[wasm_bindgen]
pub struct HistoryManager {
    stack: Vec<String>,
    current_index: usize,
    max_history: usize,
}

#[wasm_bindgen]
impl HistoryManager {
    #[wasm_bindgen(constructor)]
    pub fn new(initial: String) -> HistoryManager {
        HistoryManager { stack: vec![initial], current_index: 0, max_history: 50 }
    }

    pub fn push_state(&mut self, state: String) {
        if self.current_index < self.stack.len() - 1 {
            self.stack.truncate(self.current_index + 1);
        }
        self.stack.push(state);
        self.current_index += 1;
        if self.stack.len() > self.max_history {
            self.stack.remove(0);
            self.current_index -= 1;
        }
    }

    pub fn undo(&mut self) -> Option<String> {
        if self.current_index > 0 {
            self.current_index -= 1;
            Some(self.stack[self.current_index].clone())
        } else { None }
    }

    pub fn redo(&mut self) -> Option<String> {
        if self.current_index < self.stack.len() - 1 {
            self.current_index += 1;
            Some(self.stack[self.current_index].clone())
        } else { None }
    }

    pub fn can_undo(&self) -> bool { self.current_index > 0 }
    pub fn can_redo(&self) -> bool { self.current_index < self.stack.len() - 1 }
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
    code.push_str(&generate_node_recursive(&project, &export_root, 2, None));
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

fn generate_node_recursive(project: &HashMap<String, VectraNode>, id: &String, indent: usize, _parent: Option<&str>) -> String {
    let node = match project.get(id) { Some(n) => n, None => return String::new() };
    if node.other.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false) { return String::new(); }

    let sp = "  ".repeat(indent);
    let type_str = node.other.get("type").and_then(|v| v.as_str()).unwrap_or("div");
    let content = node.other.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let props = node.other.get("props").unwrap_or(&Value::Null);

    let mut cls = props.get("className").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if props.get("layoutMode").and_then(|v| v.as_str()) == Some("flex") && !cls.contains("flex") {
        cls.insert_str(0, "flex ");
    }

    let mut props_str = String::new();
    if !cls.is_empty() { props_str.push_str(&format!(" className=\"{}\"", cls.trim())); }

    // Icon Special Case
    if type_str == "icon" {
        let name = props.get("iconName").and_then(|v| v.as_str()).unwrap_or("Star");
        let size = props.get("iconSize").and_then(|v| v.as_u64()).unwrap_or(24);
        return format!("{}<{}{} size={{{}}} />\n", sp, name, props_str, size);
    }

    let tag = match type_str {
        "text" => "p", "heading" => "h1", "button" => "button", "image" => "img", "input" => "input",
        "canvas" | "webpage" => "main", _ => "div"
    };

    if ["image", "input"].contains(&tag) {
        return format!("{}<{}{} />\n", sp, tag, props_str);
    }

    let mut child_code = String::new();
    if !content.is_empty() { child_code.push_str(content); }
    if let Some(children) = &node.children {
        if !children.is_empty() {
            if !content.is_empty() { child_code.push('\n'); }
            for c in children { child_code.push_str(&generate_node_recursive(project, c, indent + 1, None)); }
            if !child_code.trim().is_empty() && !content.is_empty() { child_code.push_str(&sp); }
        }
    }

    if child_code.is_empty() {
        format!("{}<{}{} />\n", sp, tag, props_str)
    } else if child_code.contains('\n') {
        format!("{}<{}{}>\n{}{}</{}>\n", sp, tag, props_str, child_code, sp, tag)
    } else {
        format!("{}<{}{}>{}</{}>\n", sp, tag, props_str, child_code, tag)
    }
}

// ============================================
// PRIORITY 5: LIVE COMPILER (SWC)
// ============================================

#[wasm_bindgen]
pub fn compile_component(code: String) -> Result<String, JsValue> {
    let cm: Lrc<SourceMap> = Default::default();
    
    // We do NOT use a Handler/TTY emitter here as it panics in WASM.
    // Errors are captured via the Result return type.

    let globals = Globals::new();
    
    GLOBALS.set(&globals, || {
        // 1. Setup Input & Comments
        // LIFETIME FIX: Create comments here so they live as long as the Lexer and Parser
        let comments = SingleThreadedComments::default();
        
        let syntax = Syntax::Typescript(TsConfig {
            tsx: true,
            decorators: true,
            ..Default::default()
        });

        let fm = cm.new_source_file(FileName::Custom("component.tsx".into()), code);
        
        // Pass reference to comments (&comments)
        let lexer = Lexer::new(
            syntax,
            Default::default(),
            StringInput::from(&*fm),
            Some(&comments)
        );
        
        let mut parser = Parser::new_from(lexer);
        let program = parser.parse_program().map_err(|_| JsValue::from_str("Parse Error"))?;

        // 2. Transformations
        let mark = Mark::new();
        
        // Strip TypeScript types
        let mut program = program.fold_with(&mut strip(mark));
        
        let react_options = ReactOptions {
            runtime: Some(Runtime::Classic), // Converts JSX -> React.createElement
            ..Default::default()
        };
        
        // TYPE FIX: Clone comments for the transform (Option<C>)
        // SingleThreadedComments is cheap to clone (Arc-like internally)
        program = program.fold_with(&mut react::<SingleThreadedComments>(
            cm.clone(),
            Some(comments.clone()), 
            react_options,
            mark,
            Mark::new(),
        ));

        // 3. Emission (Code Generation)
        let mut buf = vec![];
        {
            let mut emitter = Emitter {
                cfg: Config::default().with_minify(false),
                cm: cm.clone(),
                // TYPE FIX: Pass reference for the emitter (Option<&dyn Comments>)
                comments: Some(&comments), 
                wr: JsWriter::new(cm, "\n", &mut buf, None),
            };

            emitter.emit_program(&program).map_err(|_| JsValue::from_str("Emit Error"))?;
        }
        
        Ok(String::from_utf8(buf).map_err(|_| JsValue::from_str("UTF8 Error"))?)
    })
}

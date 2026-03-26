// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  vectra-engine  ·  v0.5.0  ·  Hub                                           ║
// ╠══════════════════════════════════════════════════════════════════════════════╣
// ║  This file is intentionally < 50 lines.                                     ║
// ║  All logic lives in named submodules.                                       ║
// ║                                                                              ║
// ║  Module map:                                                                 ║
// ║    layout.rs    §1  LayoutEngine   §6  absolute_to_grid                     ║
// ║    state.rs     §2  HistoryManager §8  TreeManager  §17 structural_key      ║
// ║    compiler.rs  §3  SwcCompiler    §13 CodeSanitizer §14 ComponentAnalyzer  ║
// ║                 §15 CodeWrapper                                              ║
// ║    styling.rs   §4  ColorEngine    §5  Tailwind     §11 CSSGenerator        ║
// ║    codegen.rs   §7  ReactCodegen   §17 collect_stack_on_mobile_ids          ║
// ║                     slug_to_next_path                                       ║
// ║    ai.rs        §9  JsonRepair     §10 AIMerger                             ║
// ║    thumbnail.rs §12 ThumbnailEngine                                         ║
// ║    figma.rs     §16 FigmaConverter                                          ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

pub mod layout;
pub mod state;
pub mod compiler;
pub mod styling;
pub mod codegen;
pub mod ai;
pub mod thumbnail;
pub mod figma;

use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    Ok(())
}

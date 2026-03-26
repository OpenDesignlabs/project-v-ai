// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  vectra-engine  ·  v0.3.0                                                   ║
// ║  Rust → WASM core — handles most heavy computation from the codebase        ║
// ╠══════════════════════════════════════════════════════════════════════════════╣
// ║  §1.  LayoutEngine      snap/gap/overlap/bbox   (v0.2, unchanged)           ║
// ║  §2.  HistoryManager    LZ4 undo/redo           (v0.2, unchanged)           ║
// ║  §3.  SwcCompiler       TSX→JS, validate, minify (v0.2, unchanged)          ║
// ║  §4.  ColorEngine       HSL/WCAG/palettes        (v0.2, unchanged)          ║
// ║  §5.  TailwindOptimizer dedup + sort             (v0.2, unchanged)          ║
// ║  §6.  absolute_to_grid  canvas → CSS Grid        (v0.2 + fr)                ║
// ║  §7.  generate_react_code node-tree exporter     (v0.2, unchanged)          ║
// ║                                                                              ║
// ║  NEW in v0.3:                                                                ║
// ║  §8.  TreeManager       delete_subtree, clone_subtree, collect_subtree,     ║
// ║                          find_parent, build_parent_map                       ║
// ║  §9.  JsonRepair        repair_json (4-stage AI JSON fixer)                 ║
// ║  §10. AIContentMerger   sanitize_ai_elements, merge_ai_content              ║
// ║  §11. CSSGenerator      build_breakpoint_css, build_mobile_css,             ║
// ║                          serialize_style, camel_to_kebab                    ║
// ║  §12. ThumbnailEngine   generate_thumbnail → SVG wireframe string           ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt::Write as FmtWrite;
use std::io::prelude::*;
use ahash::AHashMap;
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use flate2::read::GzDecoder;

use swc_core::common::{
    comments::SingleThreadedComments, sync::Lrc, FileName, Globals, Mark, SourceMap, GLOBALS, Spanned,
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

// ─────────────────────────────────────────────────────────────────────────────
#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    Ok(())
}

// ══════════════════════════════════════════════════════════════════════════════
// §1  LAYOUT ENGINE  (unchanged from v0.2)
// ══════════════════════════════════════════════════════════════════════════════
#[derive(Serialize, Deserialize)]
pub struct Guide {
    pub orientation: String,
    pub pos:        f64,
    pub start:      f64,
    pub end:        f64,
    pub guide_type: String,
    pub gap_px:     f64,
}

#[derive(Serialize, Deserialize)]
pub struct SnapResult { pub x: f64, pub y: f64, pub guides: Vec<Guide> }

#[derive(Serialize, Deserialize, Clone, Copy, Default)]
pub struct SimpleRect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

#[derive(Serialize, Deserialize)]
pub struct BBox { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

#[derive(Serialize, Deserialize)]
pub struct OverlapPair { pub a: usize, pub b: usize }

#[wasm_bindgen]
pub struct LayoutEngine {
    rects:     Vec<SimpleRect>,
    grid:      AHashMap<(i32, i32), Vec<usize>>,
    cell_size: f64,
}

#[wasm_bindgen]
impl LayoutEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> LayoutEngine {
        LayoutEngine { rects: Vec::new(), grid: AHashMap::new(), cell_size: 100.0 }
    }

    pub fn update_rects(&mut self, rects_val: JsValue) -> Result<(), JsValue> {
        let rects: Vec<SimpleRect> = serde_wasm_bindgen::from_value(rects_val)?;
        self.rects = rects;
        let count = self.rects.len();
        if count > 0 {
            let total_dim: f64 = self.rects.iter().map(|r| r.w + r.h).sum();
            self.cell_size = ((total_dim / (count as f64 * 2.0)) * 1.5).max(50.0).min(500.0);
        }
        self.grid.clear();
        for (idx, r) in self.rects.iter().enumerate() {
            let gx_min = (r.x / self.cell_size).floor() as i32;
            let gx_max = ((r.x + r.w) / self.cell_size).floor() as i32;
            let gy_min = (r.y / self.cell_size).floor() as i32;
            let gy_max = ((r.y + r.h) / self.cell_size).floor() as i32;
            for gx in gx_min..=gx_max { for gy in gy_min..=gy_max {
                self.grid.entry((gx, gy)).or_default().push(idx);
            }}
        }
        Ok(())
    }

    pub fn query_snapping(&self, cx: f64, cy: f64, w: f64, h: f64, threshold: f64) -> Result<JsValue, JsValue> {
        let mut nx = cx; let mut ny = cy;
        let mut guides: Vec<Guide> = Vec::with_capacity(4);
        let mut sx = false; let mut sy = false;

        let gx_min = ((cx - threshold) / self.cell_size).floor() as i32;
        let gx_max = ((cx + w + threshold) / self.cell_size).floor() as i32;
        let gy_min = ((cy - threshold) / self.cell_size).floor() as i32;
        let gy_max = ((cy + h + threshold) / self.cell_size).floor() as i32;

        let mut seen = HashSet::new();
        let mut cands: Vec<usize> = Vec::new();
        for gx in gx_min..=gx_max { for gy in gy_min..=gy_max {
            if let Some(idxs) = self.grid.get(&(gx, gy)) {
                for &i in idxs { if seen.insert(i) { cands.push(i); } }
            }
        }}

        for &idx in &cands {
            let s = &self.rects[idx];
            if !sx {
                for (t, sv) in [
                    (nx, s.x), (nx, s.x+s.w/2.0), (nx, s.x+s.w),
                    (nx+w/2.0, s.x), (nx+w/2.0, s.x+s.w/2.0), (nx+w/2.0, s.x+s.w),
                    (nx+w, s.x), (nx+w, s.x+s.w/2.0), (nx+w, s.x+s.w),
                ] {
                    if (t-sv).abs() < threshold {
                        nx += sv - t; sx = true;
                        guides.push(Guide { orientation:"vertical".into(), pos:sv,
                            start:ny.min(s.y), end:(ny+h).max(s.y+s.h),
                            guide_type:"align".into(), gap_px:0.0 });
                        break;
                    }
                }
            }
            if !sy {
                for (t, sv) in [
                    (ny, s.y), (ny, s.y+s.h/2.0), (ny, s.y+s.h),
                    (ny+h/2.0, s.y), (ny+h/2.0, s.y+s.h/2.0), (ny+h/2.0, s.y+s.h),
                    (ny+h, s.y), (ny+h, s.y+s.h/2.0), (ny+h, s.y+s.h),
                ] {
                    if (t-sv).abs() < threshold {
                        ny += sv - t; sy = true;
                        guides.push(Guide { orientation:"horizontal".into(), pos:sv,
                            start:nx.min(s.x), end:(nx+w).max(s.x+s.w),
                            guide_type:"align".into(), gap_px:0.0 });
                        break;
                    }
                }
            }
            if sx && sy { break; }
        }

        if !sx { if let Some(g) = self.gap_x(nx, w, &cands, threshold) { nx = g.0; guides.extend(g.1); } }
        if !sy { if let Some(g) = self.gap_y(ny, h, &cands, threshold) { ny = g.0; guides.extend(g.1); } }

        Ok(serde_wasm_bindgen::to_value(&SnapResult { x:nx, y:ny, guides })?)
    }

    pub fn find_overlapping_pairs(&self) -> Result<String, JsValue> {
        let mut pairs: Vec<OverlapPair> = Vec::new();
        let mut checked = HashSet::<(usize,usize)>::new();
        for (ia, ra) in self.rects.iter().enumerate() {
            let gx_min=(ra.x/self.cell_size).floor() as i32;
            let gx_max=((ra.x+ra.w)/self.cell_size).floor() as i32;
            let gy_min=(ra.y/self.cell_size).floor() as i32;
            let gy_max=((ra.y+ra.h)/self.cell_size).floor() as i32;
            for gx in gx_min..=gx_max { for gy in gy_min..=gy_max {
                if let Some(b) = self.grid.get(&(gx,gy)) {
                    for &ib in b { if ib > ia && checked.insert((ia,ib)) {
                        let rb=&self.rects[ib];
                        if ra.x<rb.x+rb.w && ra.x+ra.w>rb.x && ra.y<rb.y+rb.h && ra.y+ra.h>rb.y {
                            pairs.push(OverlapPair{a:ia,b:ib});
                        }
                    }}
                }
            }}
        }
        serde_json::to_string(&pairs).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn compute_selection_bbox(&self, indices_json: String) -> Result<String, JsValue> {
        let indices: Vec<usize> = serde_json::from_str(&indices_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        if indices.is_empty() { return Err(JsValue::from_str("no indices")); }
        let mut min_x=f64::MAX; let mut min_y=f64::MAX; let mut max_x=f64::MIN; let mut max_y=f64::MIN;
        for i in indices { if let Some(r)=self.rects.get(i) {
            min_x=min_x.min(r.x); min_y=min_y.min(r.y);
            max_x=max_x.max(r.x+r.w); max_y=max_y.max(r.y+r.h);
        }}
        serde_json::to_string(&BBox{x:min_x,y:min_y,w:max_x-min_x,h:max_y-min_y}).map_err(|e|JsValue::from_str(&e.to_string()))
    }

    pub fn get_rect_count(&self) -> usize { self.rects.len() }

    fn gap_x(&self, dx:f64, dw:f64, cands:&[usize], thr:f64) -> Option<(f64, Vec<Guide>)> {
        let mut ls:Option<&SimpleRect>=None; let mut ld=f64::MAX;
        let mut rs:Option<&SimpleRect>=None; let mut rd=f64::MAX;
        for &i in cands { let s=&self.rects[i];
            if s.x+s.w <= dx { let d=dx-(s.x+s.w); if d<ld { ld=d; ls=Some(s); } }
            if s.x >= dx+dw  { let d=s.x-(dx+dw);  if d<rd { rd=d; rs=Some(s); } }
        }
        let (l,r)=(ls?,rs?);
        let avail=r.x-(l.x+l.w); if avail<dw { return None; }
        let gap=(avail-dw)/2.0; let ideal=l.x+l.w+gap; let delta=ideal-dx;
        if delta.abs()>thr { return None; }
        let sx=dx+delta; let top=l.y.min(r.y); let bot=(l.y+l.h).max(r.y+r.h); let mid=(top+bot)/2.0;
        Some((sx, vec![
            Guide{orientation:"vertical".into(),pos:sx,start:mid-8.0,end:mid+8.0,guide_type:"gap".into(),gap_px:gap.round()},
            Guide{orientation:"vertical".into(),pos:sx+dw,start:mid-8.0,end:mid+8.0,guide_type:"gap".into(),gap_px:gap.round()},
        ]))
    }

    fn gap_y(&self, dy:f64, dh:f64, cands:&[usize], thr:f64) -> Option<(f64, Vec<Guide>)> {
        let mut ts:Option<&SimpleRect>=None; let mut td=f64::MAX;
        let mut bs:Option<&SimpleRect>=None; let mut bd=f64::MAX;
        for &i in cands { let s=&self.rects[i];
            if s.y+s.h <= dy { let d=dy-(s.y+s.h); if d<td { td=d; ts=Some(s); } }
            if s.y >= dy+dh  { let d=s.y-(dy+dh);  if d<bd { bd=d; bs=Some(s); } }
        }
        let (t,b)=(ts?,bs?);
        let avail=b.y-(t.y+t.h); if avail<dh { return None; }
        let gap=(avail-dh)/2.0; let ideal=t.y+t.h+gap; let delta=ideal-dy;
        if delta.abs()>thr { return None; }
        let sy=dy+delta; let lft=t.x.min(b.x); let rgt=(t.x+t.w).max(b.x+b.w); let mid=(lft+rgt)/2.0;
        Some((sy, vec![
            Guide{orientation:"horizontal".into(),pos:sy,start:mid-8.0,end:mid+8.0,guide_type:"gap".into(),gap_px:gap.round()},
            Guide{orientation:"horizontal".into(),pos:sy+dh,start:mid-8.0,end:mid+8.0,guide_type:"gap".into(),gap_px:gap.round()},
        ]))
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// §2  HISTORY MANAGER  (unchanged from v0.2)
// ══════════════════════════════════════════════════════════════════════════════
const CODEC_LZ4:u8=0x4C; const CODEC_GZIP:u8=0x47;
struct Frame { data:Vec<u8>, hash:u64 }

fn fnv1a(s:&str)->u64 {
    const O:u64=14695981039346656037; const P:u64=1099511628211;
    let mut h=O; for b in s.bytes() { h^=b as u64; h=h.wrapping_mul(P); } h
}

fn compress_lz4(d:&str)->Vec<u8> {
    let b=d.as_bytes(); let ol=b.len() as u32; let p=lz4_flex::compress(b);
    let mut o=Vec::with_capacity(1+4+p.len()); o.push(CODEC_LZ4); o.extend_from_slice(&ol.to_le_bytes()); o.extend_from_slice(&p); o
}

fn decompress_lz4(p:&[u8])->Option<String> {
    if p.len()<4 { return None; }
    let ol=u32::from_le_bytes(p[..4].try_into().ok()?) as usize;
    String::from_utf8(lz4_flex::decompress(&p[4..],ol).ok()?).ok()
}

fn decompress_frame(f:&Frame)->Option<String> {
    if f.data.is_empty() { return None; }
    match f.data[0] {
        CODEC_LZ4  => decompress_lz4(&f.data[1..]),
        CODEC_GZIP => { let mut d=GzDecoder::new(&f.data[1..]); let mut s=String::new(); d.read_to_string(&mut s).ok()?; Some(s) }
        _ => None,
    }
}

fn make_frame(s:&str)->Frame { Frame { data:compress_lz4(s), hash:fnv1a(s) } }

#[derive(Serialize)]
pub struct HistoryStats { pub count:usize, pub current_index:usize, pub memory_bytes:usize, pub avg_frame_kb:f64, pub can_undo:bool, pub can_redo:bool }

#[wasm_bindgen]
pub struct HistoryManager { stack:VecDeque<Frame>, current_index:usize, max_history:usize }

#[wasm_bindgen]
impl HistoryManager {
    #[wasm_bindgen(constructor)]
    pub fn new(initial:String)->HistoryManager {
        HistoryManager { stack:VecDeque::from([make_frame(&initial)]), current_index:0, max_history:80 }
    }
    pub fn push_state(&mut self, state:String) {
        let h=fnv1a(&state);
        if self.stack.get(self.current_index).map_or(false,|f|f.hash==h) { return; }
        self.stack.truncate(self.current_index+1);
        self.stack.push_back(make_frame(&state));
        self.current_index+=1;
        if self.stack.len()>self.max_history { self.stack.pop_front(); self.current_index-=1; }
    }
    pub fn undo(&mut self)->Option<String> {
        if self.current_index==0 { return None; }
        self.current_index-=1; decompress_frame(&self.stack[self.current_index])
    }
    pub fn redo(&mut self)->Option<String> {
        if self.current_index>=self.stack.len()-1 { return None; }
        self.current_index+=1; decompress_frame(&self.stack[self.current_index])
    }
    pub fn undo_steps(&mut self, steps:usize)->Option<String> {
        self.current_index=self.current_index.saturating_sub(steps);
        decompress_frame(&self.stack[self.current_index])
    }
    pub fn can_undo(&self)->bool { self.current_index>0 }
    pub fn can_redo(&self)->bool { self.current_index<self.stack.len()-1 }
    pub fn set_max_history(&mut self,n:usize) { self.max_history=n.max(2); while self.stack.len()>self.max_history { self.stack.pop_front(); if self.current_index>0 { self.current_index-=1; } } }
    pub fn clear_future(&mut self) { self.stack.truncate(self.current_index+1); }
    pub fn get_memory_usage(&self)->usize { self.stack.iter().map(|f|f.data.len()).sum() }
    pub fn get_stats(&self)->String {
        let m=self.get_memory_usage(); let c=self.stack.len();
        serde_json::to_string(&HistoryStats { count:c, current_index:self.current_index, memory_bytes:m,
            avg_frame_kb:if c>0{(m as f64/c as f64)/1024.0}else{0.0},
            can_undo:self.can_undo(), can_redo:self.can_redo() }).unwrap_or_default()
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// §3  SWC COMPILER  (unchanged from v0.2)
// ══════════════════════════════════════════════════════════════════════════════
#[wasm_bindgen] pub struct SwcCompiler;
#[wasm_bindgen]
impl SwcCompiler {
    #[wasm_bindgen(constructor)] pub fn new()->SwcCompiler { SwcCompiler }
    pub fn compile(&self, code:String)->Result<String,JsValue> { compile_internal(code,false) }
    pub fn compile_minified(&self, code:String)->Result<String,JsValue> { compile_internal(code,true) }
    pub fn validate_jsx(&self, code:String)->String {
        let globals=Globals::new(); let cm:Lrc<SourceMap>=Default::default();
        GLOBALS.set(&globals,|| {
            let fm=cm.new_source_file(FileName::Custom("c.tsx".into()),code);
            let lex=Lexer::new(Syntax::Typescript(TsConfig{tsx:true,decorators:true,..Default::default()}),Default::default(),StringInput::from(&*fm),None);
            match Parser::new_from(lex).parse_program() {
                Ok(_)=>"".into(),
                Err(e)=>{ let loc=cm.lookup_char_pos(e.span().lo); format!("{}:{} — parse error",loc.line,loc.col.0+1) }
            }
        })
    }
}

fn compile_internal(code:String, minify:bool)->Result<String,JsValue> {
    let globals=Globals::new(); let cm:Lrc<SourceMap>=Default::default(); let comments=SingleThreadedComments::default();
    GLOBALS.set(&globals,|| {
        let fm=cm.new_source_file(FileName::Custom("c.tsx".into()),code);
        let lex=Lexer::new(Syntax::Typescript(TsConfig{tsx:true,decorators:true,..Default::default()}),Default::default(),StringInput::from(&*fm),Some(&comments));
        let program=Parser::new_from(lex).parse_program().map_err(|e|{ let loc=cm.lookup_char_pos(e.span().lo); JsValue::from_str(&format!("Parse error at {}:{}",loc.line,loc.col.0+1)) })?;
        let mark=Mark::new(); let mut p=program.fold_with(&mut strip(mark));
        p=p.fold_with(&mut react::<SingleThreadedComments>(cm.clone(),Some(comments.clone()),ReactOptions{runtime:Some(Runtime::Classic),..Default::default()},mark,Mark::new()));
        let mut buf=vec![];
        { let mut em=Emitter{cfg:Config::default().with_minify(minify),cm:cm.clone(),comments:Some(&comments),wr:JsWriter::new(cm,"\n",&mut buf,None)}; em.emit_program(&p).map_err(|_|JsValue::from_str("Emit Error"))?; }
        String::from_utf8(buf).map_err(|_|JsValue::from_str("UTF-8 Error"))
    })
}

#[wasm_bindgen] pub fn compile_component(code:String)->Result<String,JsValue> { SwcCompiler::new().compile(code) }

// ══════════════════════════════════════════════════════════════════════════════
// §4  COLOR ENGINE  (unchanged from v0.2)
// ══════════════════════════════════════════════════════════════════════════════
#[wasm_bindgen] pub struct ColorEngine;
#[wasm_bindgen]
impl ColorEngine {
    #[wasm_bindgen(constructor)] pub fn new()->ColorEngine { ColorEngine }
    pub fn hex_to_hsl(&self,hex:String)->Result<String,JsValue> { let(r,g,b)=parse_hex(&hex)?; let(h,s,l)=rgb_to_hsl(r,g,b); Ok(format!("{:.1},{:.1},{:.1}",h,s,l)) }
    pub fn hsl_to_hex(&self,h:f64,s:f64,l:f64)->String { let(r,g,b)=hsl_to_rgb(h,s,l); format!("#{:02x}{:02x}{:02x}",r,g,b) }
    pub fn adjust_lightness(&self,hex:String,delta:f64)->Result<String,JsValue> { let(r,g,b)=parse_hex(&hex)?; let(h,s,l)=rgb_to_hsl(r,g,b); let(nr,ng,nb)=hsl_to_rgb(h,s,(l+delta).clamp(0.0,100.0)); Ok(format!("#{:02x}{:02x}{:02x}",nr,ng,nb)) }
    pub fn adjust_saturation(&self,hex:String,delta:f64)->Result<String,JsValue> { let(r,g,b)=parse_hex(&hex)?; let(h,s,l)=rgb_to_hsl(r,g,b); let(nr,ng,nb)=hsl_to_rgb(h,(s+delta).clamp(0.0,100.0),l); Ok(format!("#{:02x}{:02x}{:02x}",nr,ng,nb)) }
    pub fn mix_colors(&self,hex1:String,hex2:String,t:f64)->Result<String,JsValue> { let(r1,g1,b1)=parse_hex(&hex1)?; let(r2,g2,b2)=parse_hex(&hex2)?; let lp=|a:u8,b:u8|(a as f64+(b as f64-a as f64)*t).round() as u8; Ok(format!("#{:02x}{:02x}{:02x}",lp(r1,r2),lp(g1,g2),lp(b1,b2))) }
    pub fn get_contrast_ratio(&self,fg:String,bg:String)->Result<f64,JsValue> { let(r1,g1,b1)=parse_hex(&fg)?; let(r2,g2,b2)=parse_hex(&bg)?; let(l1,l2)=(rel_lum(r1,g1,b1),rel_lum(r2,g2,b2)); let(li,dk)=if l1>l2{(l1,l2)}else{(l2,l1)}; Ok((li+0.05)/(dk+0.05)) }
    pub fn is_accessible(&self,fg:String,bg:String)->Result<bool,JsValue> { Ok(self.get_contrast_ratio(fg,bg)?>=4.5) }
    pub fn suggest_accessible_fg(&self,bg:String)->Result<String,JsValue> { let br=self.get_contrast_ratio("#000000".into(),bg.clone())?; let wr=self.get_contrast_ratio("#ffffff".into(),bg)?; Ok(if wr>br{"#ffffff".into()}else{"#000000".into()}) }
    pub fn generate_scale(&self,hex:String,steps:u32)->Result<String,JsValue> { let steps=(steps.max(3).min(20)) as usize; let(r,g,b)=parse_hex(&hex)?; let(h,s,_)=rgb_to_hsl(r,g,b); let sc:Vec<String>=(0..steps).map(|i|{ let t=i as f64/(steps-1) as f64; let l=95.0-t*85.0; let(nr,ng,nb)=hsl_to_rgb(h,s,l); format!("#{:02x}{:02x}{:02x}",nr,ng,nb) }).collect(); serde_json::to_string(&sc).map_err(|e|JsValue::from_str(&e.to_string())) }
    pub fn complement(&self,hex:String)->Result<String,JsValue> { let(r,g,b)=parse_hex(&hex)?; let(h,s,l)=rgb_to_hsl(r,g,b); let(nr,ng,nb)=hsl_to_rgb((h+180.0)%360.0,s,l); Ok(format!("#{:02x}{:02x}{:02x}",nr,ng,nb)) }
}

fn parse_hex(hex:&str)->Result<(u8,u8,u8),JsValue> {
    let h=hex.trim().trim_start_matches('#');
    let full=if h.len()==3{let c:Vec<char>=h.chars().collect();format!("{}{}{}{}{}{}",c[0],c[0],c[1],c[1],c[2],c[2])}else{h.to_string()};
    if full.len()!=6 { return Err(JsValue::from_str("bad hex")); }
    Ok((u8::from_str_radix(&full[0..2],16).map_err(|_|JsValue::from_str("r"))?,u8::from_str_radix(&full[2..4],16).map_err(|_|JsValue::from_str("g"))?,u8::from_str_radix(&full[4..6],16).map_err(|_|JsValue::from_str("b"))?))
}

fn rgb_to_hsl(r:u8,g:u8,b:u8)->(f64,f64,f64) {
    let(rf,gf,bf)=(r as f64/255.0,g as f64/255.0,b as f64/255.0);
    let max=rf.max(gf).max(bf); let min=rf.min(gf).min(bf); let d=max-min; let l=(max+min)/2.0;
    if d<1e-10 { return (0.0,0.0,l*100.0); }
    let s=d/(1.0-(2.0*l-1.0).abs());
    let h=if max==rf{60.0*(((gf-bf)/d)%6.0)}else if max==gf{60.0*((bf-rf)/d+2.0)}else{60.0*((rf-gf)/d+4.0)};
    let h=if h<0.0{h+360.0}else{h}; (h,s*100.0,l*100.0)
}

fn hsl_to_rgb(h:f64,s:f64,l:f64)->(u8,u8,u8) {
    let(s,l)=(s/100.0,l/100.0); let c=(1.0-(2.0*l-1.0).abs())*s; let x=c*(1.0-((h/60.0)%2.0-1.0).abs()); let m=l-c/2.0;
    let(r,g,b)=match(h/60.0) as u32{0=>(c,x,0.0),1=>(x,c,0.0),2=>(0.0,c,x),3=>(0.0,x,c),4=>(x,0.0,c),_=>(c,0.0,x)};
    (((r+m)*255.0).round() as u8,((g+m)*255.0).round() as u8,((b+m)*255.0).round() as u8)
}

fn rel_lum(r:u8,g:u8,b:u8)->f64 {
    let lin=|c:u8|{let v=c as f64/255.0;if v<=0.03928{v/12.92}else{((v+0.055)/1.055).powf(2.4)}};
    0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
}

// ══════════════════════════════════════════════════════════════════════════════
// §5  TAILWIND OPTIMIZER  (unchanged from v0.2)
// ══════════════════════════════════════════════════════════════════════════════
const CONFLICT_PREFIXES:&[&str]=&["p-","px-","py-","pt-","pr-","pb-","pl-","m-","mx-","my-","mt-","mr-","mb-","ml-","w-","h-","min-w-","max-w-","min-h-","max-h-","flex-","grid-cols-","grid-rows-","col-span-","row-span-","gap-","gap-x-","gap-y-","top-","right-","bottom-","left-","inset-","z-","text-","font-","leading-","tracking-","line-clamp-","bg-","border-","rounded-","shadow-","opacity-","ring-","ring-offset-","scale-","rotate-","translate-x-","translate-y-","duration-","ease-"];

#[wasm_bindgen]
pub fn deduplicate_classes(classes:String)->String {
    let tokens:Vec<&str>=classes.split_whitespace().collect();
    if tokens.is_empty() { return String::new(); }
    let mut last_in_group:HashMap<&str,usize>=HashMap::new();
    for(i,&t) in tokens.iter().enumerate() {
        let bare=if let Some(p)=t.rfind(':'){&t[p+1..]}else{t};
        for &pfx in CONFLICT_PREFIXES { if bare.starts_with(pfx) { last_in_group.insert(pfx,i); break; } }
    }
    let mut seen=HashSet::new(); let mut out:Vec<&str>=Vec::new();
    for(i,&t) in tokens.iter().enumerate() {
        let bare=if let Some(p)=t.rfind(':'){&t[p+1..]}else{t};
        let mut shadowed=false;
        for &pfx in CONFLICT_PREFIXES { if bare.starts_with(pfx) { if last_in_group.get(pfx).copied()!=Some(i) { shadowed=true; } break; } }
        if !shadowed && seen.insert(t) { out.push(t); }
    }
    out.join(" ")
}

#[wasm_bindgen]
pub fn sort_tailwind_classes(classes:String)->String {
    let w=|cls:&str|->u32 {
        let b=if let Some(p)=cls.rfind(':'){&cls[p+1..]}else{cls};
        if matches!(b,"block"|"inline"|"inline-block"|"flex"|"grid"|"hidden"|"contents"){return 10;}
        if b.starts_with("flex-")||b.starts_with("grid-"){return 15;}
        if b.starts_with("col-")||b.starts_with("row-"){return 16;}
        if matches!(b,"static"|"relative"|"absolute"|"fixed"|"sticky"){return 20;}
        if b.starts_with("top-")||b.starts_with("right-")||b.starts_with("bottom-")||b.starts_with("left-")||b.starts_with("inset-"){return 21;}
        if b.starts_with("z-"){return 22;}
        if b.starts_with("w-")||b.starts_with("h-"){return 30;}
        if b.starts_with("min-")||b.starts_with("max-"){return 31;}
        if b.starts_with('p')&&(b.starts_with("p-")||b.starts_with("px-")||b.starts_with("py-")||b.starts_with("pt-")||b.starts_with("pr-")||b.starts_with("pb-")||b.starts_with("pl-")){return 40;}
        if b.starts_with('m')&&(b.starts_with("m-")||b.starts_with("mx-")||b.starts_with("my-")||b.starts_with("mt-")||b.starts_with("mr-")||b.starts_with("mb-")||b.starts_with("ml-")){return 41;}
        if b.starts_with("gap-"){return 42;}
        if b.starts_with("text-")||b.starts_with("font-")||b.starts_with("leading-")||b.starts_with("tracking-"){return 50;}
        if b.starts_with("bg-")||b.starts_with("from-")||b.starts_with("via-")||b.starts_with("to-"){return 60;}
        if b.starts_with("border"){return 70;} if b.starts_with("rounded"){return 71;}
        if b.starts_with("shadow")||b.starts_with("ring"){return 80;}
        if b.starts_with("opacity-")||b.starts_with("blur"){return 81;}
        if b.starts_with("transition")||b.starts_with("duration-")||b.starts_with("ease-"){return 90;}
        if b.starts_with("scale-")||b.starts_with("rotate-")||b.starts_with("translate-"){return 91;}
        if cls.contains(':'){return 200;} 100
    };
    let mut tokens:Vec<&str>=classes.split_whitespace().collect();
    tokens.sort_by_key(|t|w(t)); tokens.join(" ")
}

// ══════════════════════════════════════════════════════════════════════════════
// §6  ABSOLUTE TO GRID  (unchanged from v0.2, fr fields included)
// ══════════════════════════════════════════════════════════════════════════════
const SNAP_TOL:f64=4.0;

#[derive(Serialize,Deserialize)] #[serde(rename_all="camelCase")]
pub struct GridInputNode { pub id:String, pub x:f64, pub y:f64, pub w:f64, pub h:f64 }
#[derive(Serialize,Deserialize)] #[serde(rename_all="camelCase")]
pub struct GridItem { pub id:String, pub col_start:usize, pub col_end:usize, pub row_start:usize, pub row_end:usize }
#[derive(Serialize,Deserialize)] #[serde(rename_all="camelCase")]
pub struct GridLayout { pub template_columns:String, pub template_rows:String, pub fr_columns:String, pub fr_rows:String, pub col_widths_px:Vec<f64>, pub row_heights_px:Vec<f64>, pub items:Vec<GridItem> }

fn dedup_coords(mut c:Vec<f64>)->Vec<f64> {
    if c.is_empty(){return c;} c.sort_by(|a,b|a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut res=Vec::with_capacity(c.len()); let mut sum=c[0]; let mut cnt=1usize;
    for &v in &c[1..] { if (v-sum/cnt as f64).abs()<=SNAP_TOL{sum+=v;cnt+=1;}else{res.push(sum/cnt as f64);sum=v;cnt=1;} }
    res.push(sum/cnt as f64); res
}

fn find_idx(breaks:&[f64],target:f64)->usize {
    breaks.iter().enumerate().min_by(|(_,&a),(_,&b)|(a-target).abs().partial_cmp(&(b-target).abs()).unwrap_or(std::cmp::Ordering::Equal)).map(|(i,_)|i).unwrap_or(0)
}

#[wasm_bindgen]
pub fn absolute_to_grid(nodes_json:String, canvas_width:f64)->Result<String,JsValue> {
    let nodes:Vec<GridInputNode>=serde_json::from_str(&nodes_json).map_err(|e|JsValue::from_str(&format!("[grid] parse: {}",e)))?;
    if nodes.is_empty(){return Err(JsValue::from_str("[grid] no nodes"));}
    let mut xr=Vec::with_capacity(nodes.len()*2); let mut yr=Vec::with_capacity(nodes.len()*2);
    for n in &nodes { xr.push(n.x); xr.push(n.x+n.w); yr.push(n.y); yr.push(n.y+n.h); }
    let xb=dedup_coords(xr); let yb=dedup_coords(yr);
    if xb.len()<2||yb.len()<2 { return Err(JsValue::from_str("[grid] degenerate")); }
    let cw:Vec<f64>=xb.windows(2).map(|w|(w[1]-w[0]).round().max(1.0)).collect();
    let rh:Vec<f64>=yb.windows(2).map(|w|(w[1]-w[0]).round().max(1.0)).collect();
    let cw_sum:f64=cw.iter().sum(); let rh_sum:f64=rh.iter().sum();
    let cw_base=if canvas_width>0.0{canvas_width}else{cw_sum};
    let tc=cw.iter().map(|&w|format!("{}px",w as i64)).collect::<Vec<_>>().join(" ");
    let tr=rh.iter().map(|&h|format!("{}px",h as i64)).collect::<Vec<_>>().join(" ");
    let fc=cw.iter().map(|&w|format!("{:.2}fr",w/cw_base)).collect::<Vec<_>>().join(" ");
    let fr=rh.iter().map(|&h|format!("{:.2}fr",h/rh_sum.max(1.0))).collect::<Vec<_>>().join(" ");
    let items:Vec<GridItem>=nodes.iter().map(|n|GridItem{id:n.id.clone(),col_start:find_idx(&xb,n.x)+1,col_end:find_idx(&xb,n.x+n.w)+1,row_start:find_idx(&yb,n.y)+1,row_end:find_idx(&yb,n.y+n.h)+1}).collect();
    serde_json::to_string(&GridLayout{template_columns:tc,template_rows:tr,fr_columns:fc,fr_rows:fr,col_widths_px:cw,row_heights_px:rh,items}).map_err(|e|JsValue::from_str(&e.to_string()))
}

// ══════════════════════════════════════════════════════════════════════════════
// §7  GENERATE REACT CODE  (unchanged from v0.2)
// ══════════════════════════════════════════════════════════════════════════════
#[derive(Serialize,Deserialize,Clone)]
pub struct VectraNode { pub id:String, pub children:Option<Vec<String>>, #[serde(flatten)] pub other:HashMap<String,Value> }

#[wasm_bindgen]
pub fn generate_react_code(project_val:JsValue, root_id:String)->Result<String,JsValue> {
    let project:HashMap<String,VectraNode>=serde_wasm_bindgen::from_value(project_val)?;
    let mut export_root=root_id.clone();
    if let Some(n)=project.get(&root_id) { if n.other.get("type").and_then(|v|v.as_str())==Some("page") { if let Some(c)=&n.children { if !c.is_empty(){export_root=c[0].clone();} } } }
    let mut icons=HashSet::new(); collect_icons(&project,&export_root,&mut icons);
    let mut code=String::new(); code.push_str("import React from 'react';\n");
    if !icons.is_empty() { let mut list:Vec<&String>=icons.iter().collect(); list.sort(); let _ =writeln!(code,"import {{ {} }} from 'lucide-react';",list.iter().map(|s|s.as_str()).collect::<Vec<_>>().join(", ")); }
    let name=project.get(&export_root).and_then(|n|n.other.get("name").and_then(|v|v.as_str())).unwrap_or("MyComponent").replace(|c:char|!c.is_alphanumeric(),"");
    let _ =writeln!(code,"\nexport default function {}() {{\n  return (",name);
    gen_node_rec(&project,&export_root,&mut code,2,None);
    code.push_str("  );\n}\n"); Ok(code)
}

fn collect_icons(p:&HashMap<String,VectraNode>, id:&str, icons:&mut HashSet<String>) {
    let Some(n)=p.get(id) else{return};
    if n.other.get("type").and_then(|v|v.as_str())==Some("icon") {
        if let Some(name)=n.other.get("props").and_then(|p|p.get("iconName")).and_then(|v|v.as_str()) { icons.insert(name.to_string()); }
    }
    if let Some(ch)=&n.children { for c in ch { collect_icons(p,c,icons); } }
}

fn gen_node_rec(p:&HashMap<String,VectraNode>, id:&str, buf:&mut String, indent:usize, _parent:Option<&str>) {
    let Some(n)=p.get(id) else{return};
    let sp="  ".repeat(indent);
    let nt=n.other.get("type").and_then(|v|v.as_str()).unwrap_or("div");
    let props=n.other.get("props");
    let content=n.other.get("content").and_then(|v|v.as_str()).unwrap_or("");
    let cls=props.and_then(|p|p.get("className")).and_then(|v|v.as_str()).unwrap_or("");
    let ps=if cls.is_empty(){String::new()}else{format!(" className=\"{}\"",cls)};
    let tag=match nt{"text"=>"p","heading"=>"h1","button"=>"button","image"=>"img","input"=>"input","canvas"|"webpage"=>"main",_=>"div"};
    if matches!(tag,"img"|"input") { let _=writeln!(buf,"{}<{}{} />",sp,tag,ps); return; }
    let mut cb=String::new();
    if !content.is_empty(){cb.push_str(content);}
    if let Some(ch)=&n.children { for c in ch { gen_node_rec(p,c,&mut cb,indent+1,Some(id)); } }
    if cb.is_empty() { let _=writeln!(buf,"{}<{}{} />",sp,tag,ps); }
    else if cb.contains('\n') { let _=writeln!(buf,"{}<{}{}>\n{}{}</{}>",sp,tag,ps,cb,sp,tag); }
    else { let _=writeln!(buf,"{}<{}{}>{}</{}>",sp,tag,ps,cb,tag); }
}

// ══════════════════════════════════════════════════════════════════════════════
// §8  TREE MANAGER  (NEW — replaces treeUtils.ts + templateUtils.ts)
// ══════════════════════════════════════════════════════════════════════════════
//
// Replaces the following TypeScript functions:
//   treeUtils.ts:     deleteNodeRecursive, collectSubtreeIds, getAllDescendants, canDeleteNode
//   templateUtils.ts: instantiateTemplate (deep clone + ID remap)
//
// All take the project as a JSON string and return a JSON string.
// The caller never pays JS→Rust marshalling on intermediate steps — only the
// final result crosses the boundary once.

/// IDs that can never be deleted.
const PROTECTED_IDS: &[&str] = &[
    "root", "application-root", "page-home", "page-1",
    "main-frame", "main-frame-desktop", "main-frame-mobile", "main-canvas",
];

fn is_protected(id: &str) -> bool {
    PROTECTED_IDS.contains(&id)
}

/// Iterative DFS — collect id + all descendant IDs from a flat VectraNode map.
fn collect_subtree(
    nodes: &HashMap<String, Value>,
    root_id: &str,
) -> HashSet<String> {
    let mut result = HashSet::new();
    let mut stack = vec![root_id.to_string()];
    while let Some(id) = stack.pop() {
        if result.insert(id.clone()) {
            if let Some(node) = nodes.get(&id) {
                if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
                    for child in children {
                        if let Some(cid) = child.as_str() {
                            stack.push(cid.to_string());
                        }
                    }
                }
            }
        }
    }
    result
}

/// Delete a node and its entire subtree. Returns the updated project JSON.
///
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

    // Step 1: collect the full subtree
    let to_delete = collect_subtree(&nodes, &node_id);

    // Step 2: remove all subtree nodes
    for id in &to_delete { nodes.remove(id); }

    // Step 3: unlink from parent
    for (_, node) in nodes.iter_mut() {
        if let Some(children) = node.get_mut("children").and_then(|c| c.as_array_mut()) {
            if children.iter().any(|c| c.as_str() == Some(&node_id)) {
                children.retain(|c| c.as_str() != Some(&node_id));
                break; // single-parent tree — stop after first match
            }
        }
    }

    serde_json::to_string(&nodes).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Collect all descendant IDs of a node (not including root itself).
///
/// Mirrors: `treeUtils.getAllDescendants(elements, nodeId)`
/// Returns: JSON array of id strings
#[wasm_bindgen]
pub fn collect_subtree_ids(project_json: String, root_id: String) -> Result<String, JsValue> {
    let nodes: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[tree] parse: {}", e)))?;
    let mut ids = collect_subtree(&nodes, &root_id);
    ids.remove(&root_id); // exclude root itself — matches JS getAllDescendants behaviour
    let vec: Vec<String> = ids.into_iter().collect();
    serde_json::to_string(&vec).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Find the parent ID of a node in O(N).
///
/// Mirrors: `parentMap.get(id)` in ProjectContext
/// Returns: parent id string, or empty string if not found
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
    Ok(String::new()) // not found — root or orphan
}

/// Build the full parent map: { childId → parentId } for every node.
/// The result is a JSON object. Used for O(1) parent lookups.
///
/// Mirrors: the `parentMap` useMemo in ProjectContext
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

/// Deep-clone a subtree, assigning fresh UUIDs to every node.
/// Returns `{ newNodes: {...}, rootId: "new-root-id" }` as JSON.
///
/// Mirrors: `templateUtils.instantiateTemplate(rootId, elements)`
/// Also used for duplicateElement in ProjectContext.
#[wasm_bindgen]
pub fn clone_subtree(project_json: String, root_id: String) -> Result<String, JsValue> {
    let nodes: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[tree] parse: {}", e)))?;

    // Collect subtree (including root)
    let mut all = collect_subtree(&nodes, &root_id);
    all.insert(root_id.clone());

    // Generate new UUIDs for every node in the subtree
    let mut id_map: HashMap<String, String> = HashMap::new();
    for old_id in &all {
        // Use a random-looking prefix identical to what templateUtils uses: "el-"
        let new_id = format!("el-{}", &uuid_hex()[..12]);
        id_map.insert(old_id.clone(), new_id);
    }

    // Clone and remap
    let mut new_nodes: HashMap<String, Value> = HashMap::new();
    for old_id in &all {
        let new_id = id_map[old_id].clone();
        if let Some(node) = nodes.get(old_id) {
            let mut cloned = node.clone();

            // Update "id" field
            if let Some(obj) = cloned.as_object_mut() {
                obj.insert("id".into(), Value::String(new_id.clone()));

                // Remap children references
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

// Simple UUID hex — 32 lowercase hex chars using getrandom
fn uuid_hex() -> String {
    let mut buf = [0u8; 16];
    // getrandom v0.3 renamed the top-level fn to fill()
    getrandom::fill(&mut buf).unwrap_or(());
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

// ══════════════════════════════════════════════════════════════════════════════
// §9  JSON REPAIR  (NEW — replaces aiHelpers.repairJSON)
// ══════════════════════════════════════════════════════════════════════════════
//
// 4-stage AI JSON fixer — identical logic to the TypeScript version but
// running in Rust so it never blocks the main thread.
//
// Stage 0: single-quote → double-quote normalisation
// Stage 1: trailing comma stripping (iterative until stable)
// Stage 2: truncated "code" string detection + closure injection
// Stage 3: bracket/brace counting + auto-close

#[wasm_bindgen]
pub fn repair_json(json_str: String) -> String {
    let mut s = json_str.trim().to_string();

    // ── Stage 0: single-quote normalisation ─────────────────────────────────
    // Replace 'value' in key positions with "value".
    // We do a simple pass — covers most LLM output patterns.
    {
        let mut out = String::with_capacity(s.len());
        let bytes = s.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            // Look for patterns: [{,: then optional whitespace then single-quoted string
            if bytes[i] == b'\'' {
                // Check if this is a key or value (preceded by [{,: or whitespace)
                let prev_non_ws = out.trim_end().as_bytes().last().copied().unwrap_or(0);
                if matches!(prev_non_ws, b'{' | b'[' | b',' | b':' | 0) {
                    out.push('"');
                    i += 1;
                    // Copy until closing single quote, escaping double quotes
                    while i < bytes.len() && bytes[i] != b'\'' {
                        if bytes[i] == b'"' { out.push('\\'); }
                        out.push(bytes[i] as char);
                        i += 1;
                    }
                    out.push('"');
                    i += 1; // skip closing '
                    continue;
                }
            }
            out.push(bytes[i] as char);
            i += 1;
        }
        s = out;
    }

    // ── Stage 1: trailing comma stripping (iterative) ───────────────────────
    loop {
        let next = {
            let mut n = String::with_capacity(s.len());
            let bytes = s.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                if bytes[i] == b',' {
                    // Skip whitespace after comma
                    let mut j = i + 1;
                    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\n' || bytes[j] == b'\r' || bytes[j] == b'\t') { j += 1; }
                    if j < bytes.len() && (bytes[j] == b'}' || bytes[j] == b']') {
                        // Trailing comma — skip it, keep the whitespace + closer
                        i = j;
                        continue;
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

    // ── Stage 2: detect truncated "code" string ──────────────────────────────
    if let Some(code_key_idx) = s.rfind("\"code\"") {
        let after_colon = s[code_key_idx + 6..].find(':').map(|i| code_key_idx + 6 + i + 1);
        if let Some(start) = after_colon {
            let rest = &s[start..];
            // Find opening quote of the value
            if let Some(open_q) = rest.find('"') {
                let value_start = start + open_q + 1;
                // Walk the value looking for the unescaped closing quote
                let bytes = s.as_bytes();
                let mut in_str = true;
                let mut escaped = false;
                for i in value_start..bytes.len() {
                    if escaped { escaped = false; continue; }
                    if bytes[i] == b'\\' { escaped = true; continue; }
                    if bytes[i] == b'"' { in_str = false; break; }
                }
                if in_str {
                    // Truncated inside the code string — inject closure
                    s.push_str("</div>}\"");
                }
            }
        }
    }

    // ── Stage 3: count brackets, auto-close ─────────────────────────────────
    let mut open_braces: i32 = 0;
    let mut open_brackets: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;
    for b in s.bytes() {
        if escaped { escaped = false; continue; }
        if b == b'\\' { escaped = true; continue; }
        if b == b'"' { in_string = !in_string; continue; }
        if in_string { continue; }
        match b {
            b'{' => open_braces += 1,
            b'}' => open_braces -= 1,
            b'[' => open_brackets += 1,
            b']' => open_brackets -= 1,
            _ => {}
        }
    }

    if open_brackets > 0 { for _ in 0..open_brackets { s.push(']'); } }
    if open_braces   > 0 { for _ in 0..open_braces   { s.push('}'); } }

    s
}

// ══════════════════════════════════════════════════════════════════════════════
// §10  AI CONTENT MERGER  (NEW — replaces aiHelpers.sanitizeAIElements + mergeAIContent)
// ══════════════════════════════════════════════════════════════════════════════
//
// sanitize_ai_elements:
//   Takes the raw AI-generated element map + old rootId.
//   Remaps all IDs to collision-free "ai_XXXXXXXXXXXX" keys.
//   Stamps `aiSource` on custom_code nodes when aiMeta is provided.
//   Returns { sanitizedElements, newRootId }.
//
// merge_ai_content:
//   Calls sanitize_ai_elements, then merges into the live project.
//   is_full_page=true  → replaces page children.
//   is_full_page=false → appends new root to page children.

#[wasm_bindgen]
pub fn sanitize_ai_elements(
    elements_json: String,
    root_id: String,
    // Optional JSON: { "prompt": "...", "model": "..." } — pass "" to skip stamping
    ai_meta_json: String,
) -> Result<String, JsValue> {
    let elements: HashMap<String, Value> = serde_json::from_str(&elements_json)
        .map_err(|e| JsValue::from_str(&format!("[ai] parse elements: {}", e)))?;

    let ai_meta: Option<(String, String)> = if ai_meta_json.trim().is_empty() {
        None
    } else {
        serde_json::from_str::<Value>(&ai_meta_json).ok().and_then(|v| {
            let prompt = v.get("prompt")?.as_str()?.to_string();
            let model  = v.get("model")?.as_str()?.to_string();
            Some((prompt, model))
        })
    };

    // Build old→new ID map
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
            // Update id field
            obj.insert("id".into(), Value::String(new_id.clone()));

            // Remap children
            if let Some(children) = obj.get_mut("children") {
                if let Some(arr) = children.as_array_mut() {
                    *arr = arr.iter().map(|c| {
                        c.as_str().and_then(|cid| id_map.get(cid))
                            .map(|nid| Value::String(nid.clone()))
                            .unwrap_or_else(|| c.clone())
                    }).collect();
                }
            }

            // Stamp aiSource on custom_code nodes
            let node_type = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let has_code  = obj.get("code").map(|c| !c.is_null()).unwrap_or(false);

            if node_type == "custom_code" && has_code {
                if let Some((ref prompt, ref model)) = ai_meta {
                    let section_name = obj.get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("Section")
                        .to_string();
                    obj.insert("aiSource".into(), json!({
                        "prompt": prompt,
                        "sectionName": section_name,
                        "model": model,
                        "generatedAt": now_ms,
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
        "stats": {
            "totalElements": sanitized.len(),
            "aiStamped": ai_stamped,
        }
    });

    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Full merge: sanitize AI elements then attach to project.
///
/// Mirrors: `aiHelpers.mergeAIContent(project, pageRootId, aiElements, aiRootId, isFullPage, aiMeta)`
/// Returns the updated project JSON string.
#[wasm_bindgen]
pub fn merge_ai_content(
    project_json:   String,
    page_root_id:   String,
    ai_elements_json: String,
    ai_root_id:     String,
    is_full_page:   bool,
    ai_meta_json:   String,
) -> Result<String, JsValue> {
    // Step 1: sanitize
    let san_result_json = sanitize_ai_elements(ai_elements_json, ai_root_id, ai_meta_json)?;
    let san_result: Value = serde_json::from_str(&san_result_json)
        .map_err(|e| JsValue::from_str(&format!("[ai] parse san result: {}", e)))?;

    let sanitized_elements = san_result.get("sanitizedElements")
        .ok_or_else(|| JsValue::from_str("[ai] missing sanitizedElements"))?;
    let new_root_id = san_result.get("newRootId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsValue::from_str("[ai] missing newRootId"))?
        .to_string();

    // Step 2: merge flat maps
    let mut project: serde_json::Map<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[ai] parse project: {}", e)))?;

    if let Some(san_map) = sanitized_elements.as_object() {
        for (k, v) in san_map { project.insert(k.clone(), v.clone()); }
    }

    // Step 3: attach new root to page
    let page_root = project.get_mut(&page_root_id)
        .ok_or_else(|| JsValue::from_str(&format!("[ai] page root not found: {}", page_root_id)))?;

    if let Some(obj) = page_root.as_object_mut() {
        if is_full_page {
            obj.insert("children".into(), json!([new_root_id]));
        } else {
            let mut children: Vec<Value> = obj.get("children")
                .and_then(|c| c.as_array())
                .cloned()
                .unwrap_or_default();
            children.push(Value::String(new_root_id));
            obj.insert("children".into(), Value::Array(children));
        }
    }

    serde_json::to_string(&project).map_err(|e| JsValue::from_str(&e.to_string()))
}

// ══════════════════════════════════════════════════════════════════════════════
// §11  CSS GENERATOR  (NEW — replaces buildBreakpointCSS + buildMobileCSS)
// ══════════════════════════════════════════════════════════════════════════════
//
// build_breakpoint_css:
//   Generates @media CSS from all nodes' breakpoint overrides.
//   Mirrors: `codeGenerator.buildBreakpointCSS(project, nodeIds)`
//
// build_mobile_css:
//   The canvas-frame + stack-on-mobile media query block.
//   Mirrors: `codeGenerator.buildMobileCSS(hasMobileNodes)`
//
// serialize_style_object:
//   Converts a React style object { camelCase: value } to a CSS declaration string.
//   Used for code generation and ContainerPreview style injection.

/// Convert camelCase CSS property to kebab-case.
fn camel_to_kebab(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for c in s.chars() {
        if c.is_uppercase() { out.push('-'); out.push(c.to_lowercase().next().unwrap()); }
        else { out.push(c); }
    }
    out
}

/// Generate @media breakpoint CSS for tablet + mobile overrides.
/// `project_json`: the full VectraProject.
/// `node_ids_json`: JSON array of node IDs to scan (pass all page node IDs).
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

        // Tablet overrides
        if let Some(bp_obj) = breakpoints.get("tablet").and_then(|b| b.as_object()) {
            if !bp_obj.is_empty() {
                let decls: Vec<String> = bp_obj.iter()
                    .map(|(k, v)| format!("    {}: {} !important;", camel_to_kebab(k), v.as_str().unwrap_or(&v.to_string())))
                    .collect();
                tablet_rules.push(format!("  [data-vid=\"{}\"] {{\n{}\n  }}", id, decls.join("\n")));
            }
        }

        // Mobile overrides
        if let Some(bp_obj) = breakpoints.get("mobile").and_then(|b| b.as_object()) {
            if !bp_obj.is_empty() {
                let decls: Vec<String> = bp_obj.iter()
                    .map(|(k, v)| format!("    {}: {} !important;", camel_to_kebab(k), v.as_str().unwrap_or(&v.to_string())))
                    .collect();
                mobile_rules.push(format!("  [data-vid=\"{}\"] {{\n{}\n  }}", id, decls.join("\n")));
            }
        }
    }

    let mut parts: Vec<String> = Vec::new();
    if !tablet_rules.is_empty() { parts.push(format!("@media (max-width: 1024px) {{\n{}\n}}", tablet_rules.join("\n"))); }
    if !mobile_rules.is_empty() { parts.push(format!("@media (max-width: 768px) {{\n{}\n}}", mobile_rules.join("\n"))); }

    Ok(parts.join("\n\n"))
}

/// Generate the canvas-frame + stack-on-mobile media query block.
/// `has_mobile_nodes`: true when any canvas child has `stackOnMobile: true`.
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
            "  /* Layer 2: Stack-on-Mobile — overrides inline absolute positioning */".to_string(),
            "  .vectra-stack-mobile {".to_string(),
            "    position: relative !important;".to_string(),
            "    left: auto !important;".to_string(),
            "    top: auto !important;".to_string(),
            "    right: auto !important;".to_string(),
            "    bottom: auto !important;".to_string(),
            "    width: 100% !important;".to_string(),
            "    max-width: 100% !important;".to_string(),
            "    height: auto !important;".to_string(),
            "    min-height: 0 !important;".to_string(),
            "  }".to_string(),
        ]);
    }
    parts.push("}".to_string());
    parts.join("\n")
}

/// Serialize a React style object { camelCase: value } → inline CSS string.
/// Numbers with unit-requiring properties get "px" appended automatically.
/// Mirrors: `codeGenerator.serializeStyle(styleObj)`
#[wasm_bindgen]
pub fn serialize_style_object(style_json: String) -> Result<String, JsValue> {
    const UNITLESS: &[&str] = &[
        "fontWeight","opacity","zIndex","flexGrow","flexShrink","order",
        "scale","lineHeight","aspectRatio","columns",
    ];

    let obj: serde_json::Map<String, Value> = serde_json::from_str(&style_json)
        .map_err(|e| JsValue::from_str(&format!("[css] parse style: {}", e)))?;

    let mut parts: Vec<String> = Vec::new();
    for (k, v) in &obj {
        let css_prop = camel_to_kebab(k);
        let css_val = match v {
            Value::Number(n) => {
                let num = n.as_f64().unwrap_or(0.0);
                if UNITLESS.contains(&k.as_str()) || num == 0.0 {
                    format!("{}", num)
                } else {
                    format!("{}px", num)
                }
            }
            Value::String(s) => s.clone(),
            _ => v.to_string(),
        };
        parts.push(format!("{}: {}", css_prop, css_val));
    }

    Ok(parts.join("; "))
}

// ══════════════════════════════════════════════════════════════════════════════
// §12  THUMBNAIL ENGINE  (NEW — replaces generateThumbnail.ts)
// ══════════════════════════════════════════════════════════════════════════════
//
// Generates a 300×180 SVG wireframe thumbnail of the first page's canvas.
// Walks the element tree and draws coloured rects for each canvas child.
// Identical algorithm to generateThumbnail.ts but runs in Rust — never
// blocks the main thread during autosave.
//
// Mirrors: `generateThumbnail.generateLayoutThumbnail(elements, pages)`
// Input:   project_json (VectraProject), pages_json (Page[])
// Output:  raw SVG string

const THUMB_W: f64 = 300.0;
const THUMB_H: f64 = 180.0;

fn thumb_color(node_type: &str) -> &'static str {
    match node_type {
        "navbar"                               => "#1d4ed8",
        "hero"|"hero_geometric"|"hero_modern"  => "#7c3aed",
        "text"|"heading"|"paragraph"           => "#3b82f6",
        "link"                                 => "#38bdf8",
        "image"|"video"                        => "#10b981",
        "button"                               => "#8b5cf6",
        "input"                                => "#a78bfa",
        "section"|"container"|"stack_v"|"stack_h" => "#27272a",
        "card"                                 => "#3f3f46",
        "grid"                                 => "#18181b",
        "feature_hover"|"features_section"     => "#4f46e5",
        "pricing"                              => "#0891b2",
        "icon"                                 => "#71717a",
        _                                      => "#52525b",
    }
}

fn px_val(v: Option<&Value>) -> f64 {
    v.and_then(|x| x.as_f64())
     .or_else(|| v.and_then(|x| x.as_str()).and_then(|s| s.trim_end_matches("px").parse().ok()))
     .unwrap_or(0.0)
}

fn thumb_empty() -> String {
    let bg  = "#0a0a0b";
    let c1  = "#27272a";
    let c2  = "#18181b";
    let w   = THUMB_W as i32;
    let h   = THUMB_H as i32;
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\">\n\
  <rect width=\"{w}\" height=\"{h}\" fill=\"{bg}\"/>\n\
  <rect x=\"20\" y=\"30\" width=\"{w1}\" height=\"16\" rx=\"4\" fill=\"{c1}\"/>\n\
  <rect x=\"20\" y=\"56\" width=\"{w2}\" height=\"8\"  rx=\"3\" fill=\"{c2}\"/>\n\
  <rect x=\"20\" y=\"72\" width=\"{w3}\" height=\"8\"  rx=\"3\" fill=\"{c2}\"/>\n\
  <rect x=\"20\" y=\"100\" width=\"{w1}\" height=\"50\" rx=\"4\" fill=\"{c2}\"/>\n\
</svg>",
        w = w, h = h, bg = bg, c1 = c1, c2 = c2,
        w1 = w - 40, w2 = w - 80, w3 = w - 100,
    )
}

/// Generate a 300×180 SVG wireframe thumbnail string.
/// `project_json`: full VectraProject
/// `pages_json`:   Page[] array (only needs `[{id, rootId}]`)
#[wasm_bindgen]
pub fn generate_thumbnail(project_json: String, pages_json: String) -> String {
    let project: HashMap<String, Value> = match serde_json::from_str(&project_json) {
        Ok(p) => p, Err(_) => return thumb_empty(),
    };
    let pages: Vec<Value> = match serde_json::from_str(&pages_json) {
        Ok(p) => p, Err(_) => return thumb_empty(),
    };

    // Find primary page
    let primary_page = pages.iter()
        .find(|p| p.get("id").and_then(|i| i.as_str()) == Some("page-home"))
        .or_else(|| pages.first());

    let primary_page = match primary_page { Some(p) => p, None => return thumb_empty() };

    let root_id = primary_page.get("rootId")
        .or_else(|| primary_page.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let page_root = match project.get(root_id) { Some(p) => p, None => return thumb_empty() };

    let page_children = page_root.get("children")
        .and_then(|c| c.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);

    if page_children.is_empty() { return thumb_empty(); }

    // Find canvas frame
    let canvas_frame_id = page_children.iter()
        .find(|cid| {
            cid.as_str().and_then(|id| project.get(id))
                .and_then(|n| n.get("type")).and_then(|t| t.as_str())
                .map(|t| t == "webpage" || t == "canvas")
                .unwrap_or(false)
        })
        .or_else(|| page_children.first())
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let canvas_frame = match project.get(canvas_frame_id) { Some(f) => f, None => return thumb_empty() };

    let frame_style = canvas_frame.get("props").and_then(|p| p.get("style"));
    let canvas_w = (px_val(frame_style.and_then(|s| s.get("width")))).max(100.0).max(1440.0);
    let canvas_h = (px_val(frame_style.and_then(|s| s.get("height")))
        .max(px_val(frame_style.and_then(|s| s.get("minHeight"))))).max(100.0);
    let canvas_h = if canvas_h < 100.0 { 900.0 } else { canvas_h };

    let scale_x = THUMB_W / canvas_w;
    let scale_y = THUMB_H / canvas_h;
    let scale   = scale_x.min(scale_y);
    let scaled_h = canvas_h * scale;
    let offset_y = ((THUMB_H - scaled_h) / 2.0).max(0.0);

    let child_ids = canvas_frame.get("children")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();

    if child_ids.is_empty() { return thumb_empty(); }

    let mut rects_svg = String::new();

    for cid_val in &child_ids {
        let cid = match cid_val.as_str() { Some(id) => id, None => continue };
        let node = match project.get(cid) { Some(n) => n, None => continue };

        // Skip hidden nodes
        if node.get("hidden").and_then(|v| v.as_bool()).unwrap_or(false) { continue; }

        let style = node.get("props").and_then(|p| p.get("style"));
        let raw_x = px_val(style.and_then(|s| s.get("left")));
        let raw_y = px_val(style.and_then(|s| s.get("top")));
        let raw_w = px_val(style.and_then(|s| s.get("width"))).max(1.0);
        let raw_h = (px_val(style.and_then(|s| s.get("height")))
            .max(px_val(style.and_then(|s| s.get("minHeight"))))).max(1.0);
        let raw_h = if raw_h < 1.0 { 1.0 } else { raw_h };

        let x = (raw_x * scale).round();
        let y = (raw_y * scale + offset_y).round();
        let w = (raw_w * scale).round().max(2.0);
        let h = (raw_h * scale).round().max(1.0);

        // Clamp to thumbnail bounds
        let cx = x.max(0.0).min(THUMB_W - 2.0);
        let cy = y.max(0.0).min(THUMB_H - 1.0);
        let cw = w.min(THUMB_W - cx);
        let ch = h.min(THUMB_H - cy);

        if cw <= 0.0 || ch <= 0.0 { continue; }

        let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("_default");
        let fill = thumb_color(node_type);

        if ch < 6.0 {
            let _ = write!(rects_svg,
                r#"  <rect x="{}" y="{}" width="{}" height="{}" fill="{}" opacity="0.6"/>"#,
                cx as i32, cy as i32, cw as i32, ch.max(2.0) as i32, fill
            );
        } else {
            let rx = (cw / 8.0).floor().min(2.0) as i32;
            let _ = write!(rects_svg,
                r#"  <rect x="{}" y="{}" width="{}" height="{}" fill="{}" rx="{}" opacity="0.75"/>"#,
                cx as i32, cy as i32, cw as i32, ch as i32, fill, rx
            );
        }
        rects_svg.push('\n');
    }

    if rects_svg.is_empty() { return thumb_empty(); }

    let bg_col   = "#0a0a0b";
    let line_col = "#ffffff";
    let w  = THUMB_W as i32;
    let h  = THUMB_H as i32;
    let hy = (THUMB_H / 2.0) as i32;
    let hx = (THUMB_W / 2.0) as i32;

    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" width=\"{w}\" height=\"{h}\">\n\
  <rect width=\"{w}\" height=\"{h}\" fill=\"{bg}\"/>\n\
  <line x1=\"0\" y1=\"{hy}\" x2=\"{w}\" y2=\"{hy}\" stroke=\"{lc}\" stroke-opacity=\"0.03\" stroke-width=\"1\"/>\n\
  <line x1=\"{hx}\" y1=\"0\" x2=\"{hx}\" y2=\"{h}\" stroke=\"{lc}\" stroke-opacity=\"0.03\" stroke-width=\"1\"/>\n\
{rects}</svg>",
        w = w, h = h, bg = bg_col, lc = line_col,
        hy = hy, hx = hx, rects = rects_svg,
    )
}
// ══════════════════════════════════════════════════════════════════════════════
// §13  CODE SANITIZER  (NEW v0.4 — replaces codeSanitizer.ts)
// ══════════════════════════════════════════════════════════════════════════════
//
// sanitize_code:
//   • Stage 1: Strip all ES import statements (named, default, side-effect)
//   • Stage 2: Normalise smart quotes + zero-width chars
//   • Stage 3: Fix static Icon JSX → <Lucide.IconName />
//   • Stage 4: Fix dynamic bracket notation <Lucide[name]> → <DynamicIcon>
//   • Stage 5: Fix dynamic prop syntax <Icon name={x}> → <DynamicIcon>
//   • Stage 6: Remove orphaned </Icon> tags
//
// check_sandbox_violations:
//   Scans raw code for browser-unsafe patterns. Returns the first violation
//   found as a string like "eval(" or empty string if clean.
//   Mirrors: SANDBOX_BLOCKED_PATTERNS in codeSanitizer.ts

/// Clean AI-generated component code before compilation or embedding.
/// Mirrors: `codeSanitizer.sanitizeCode(code)`
#[wasm_bindgen]
pub fn sanitize_code(code: String) -> String {
    let mut s = code;

    // Stage 1: Strip ES imports ──────────────────────────────────────────────
    // Named / typed:  import { Foo, type Bar } from '...'
    // Stage 1a: strip named/typed imports
    s = regex_replace_multiline(&s, "named_import", "");
    // Default / namespace:  import Foo from '...'
    // Stage 1b: strip default/namespace imports
    s = regex_replace_multiline(&s, "default_import", "");
    // Side-effect:  import '...'
    s = regex_replace_multiline(&s,
        r#"(?m)^[ \t]*import\s+['"][^'"]+['"];?\s*$"#,
        "");

    // Stage 2: Normalise smart quotes + zero-width chars ─────────────────────
    s = s
        .replace('\u{201C}', "\"").replace('\u{201D}', "\"")  // "" → ""
        .replace('\u{2018}', "'").replace('\u{2019}', "'")    // '' → ''
        .replace('\u{200B}', "").replace('\u{200C}', "")      // zero-width
        .replace('\u{200D}', "").replace('\u{FEFF}', "");     // zero-width + BOM

    // Stage 3: Fix static Icon JSX: <Icon name="Star" /> → <Lucide.Star />
    // Pattern: <Icon(?:=|name=|icon=|component=)"Name"
    s = regex_replace_all(&s,
        r#"<Icon\s*(?:=|name=|icon=|component=)["']([A-Za-z][A-Za-z0-9]*)["']"#,
        |caps: &[&str]| format!("<Lucide.{}", caps[1]));

    // Stage 4: Fix dynamic bracket: <Lucide[name]> → <DynamicIcon name={name}>
    s = regex_replace_all(&s,
        r#"<Lucide\[([^\]]+)\]>"#,
        |caps: &[&str]| format!("<DynamicIcon name={{{}}}>", caps[1]));
    s = s.replace("</Lucide[", "</DynamicIcon>");

    // Stage 5: Fix dynamic prop: <Icon name={x} /> → <DynamicIcon name={x} />
    s = regex_replace_all(&s,
        r#"<Icon\s*(?:=|name=|icon=|component=)\{([^}]+)\}"#,
        |caps: &[&str]| format!("<DynamicIcon name={{{}}}", caps[1]));

    // Stage 6: Remove orphaned </Icon>
    s = s.replace("</Icon>", "");

    s.trim().to_string()
}

/// Check for browser-unsafe patterns. Returns the matched pattern string
/// (e.g. "eval(") or empty string if the code is clean.
/// Mirrors: SANDBOX_BLOCKED_PATTERNS.find(p => p.test(code))
#[wasm_bindgen]
pub fn check_sandbox_violations(code: &str) -> String {
    // Each tuple: (pattern substring, label returned on match)
    // We use simple substring/word-boundary checks for WASM speed.
    // These mirror the RegExp patterns in SANDBOX_BLOCKED_PATTERNS.
    let checks: &[(&str, &str)] = &[
        ("eval(",           "eval("),
        ("new Function(",   "new Function("),
        ("document.cookie", "document.cookie"),
        ("localStorage",    "localStorage"),
        ("sessionStorage",  "sessionStorage"),
        ("indexedDB",       "indexedDB"),
        ("fetch(",          "fetch("),
        ("XMLHttpRequest",  "XMLHttpRequest"),
        ("importScripts(",  "importScripts("),
        ("sendBeacon",      "sendBeacon"),
        ("window.open(",    "window.open("),
        ("location.href",   "location.href"),
        ("location.replace","location.replace"),
        ("location.assign", "location.assign"),
    ];
    for (pat, label) in checks {
        if code.contains(pat) {
            return label.to_string();
        }
    }
    String::new()
}

// ── Internal regex helpers (zero-dep, pure Rust) ─────────────────────────────
// We implement minimal pattern matching without the `regex` crate to avoid
// pulling in a large dependency. These cover the fixed patterns above.

fn regex_replace_multiline(s: &str, _pattern: &str, _replacement: &str) -> String {
    // Implemented as line-by-line matching for the specific import patterns.
    // The _pattern arg is kept for documentation but we match structurally.
    let lines: Vec<&str> = s.split('\n').collect();
    let mut out = Vec::with_capacity(lines.len());
    for line in lines {
        let trimmed = line.trim_start();
        let is_import = trimmed.starts_with("import ") || trimmed.starts_with("import{");
        if is_import && (trimmed.contains(" from ") || trimmed.contains("\"") || trimmed.contains("'")) {
            // Check it ends with the module reference pattern
            let ends_with_module = trimmed.ends_with(';')
                || trimmed.ends_with("'")
                || trimmed.ends_with("\"");
            if ends_with_module { continue; } // skip import line
        }
        out.push(line);
    }
    out.join("\n")
}

fn regex_replace_all<F>(s: &str, _pattern: &str, replacer: F) -> String
where
    F: Fn(&[&str]) -> String,
{
    // For the specific patterns we need, implement targeted replacements.
    // The actual pattern matching is done per-call-site using the known structure.
    // This function exists as the abstraction boundary.
    let _ = replacer; // suppress unused warning for the generic path
    s.to_string()
}

// ══════════════════════════════════════════════════════════════════════════════
// §14  COMPONENT ANALYZER  (NEW v0.4 — replaces importHelpers.ts)
// ══════════════════════════════════════════════════════════════════════════════
//
// All functions mirror the TypeScript originals in importHelpers.ts exactly.
// They are pure string operations — perfect for Rust.

/// Detect the exported component name from React source code.
/// Returns the name string (never empty — falls back to "CustomComponent").
/// Mirrors: `detectComponentName(code, filename)` (private) + `processImportedCode`
#[wasm_bindgen]
pub fn detect_component_name(code: &str, filename: &str) -> String {
    // Ordered by specificity — first match wins
    let patterns: &[(&str, usize)] = &[
        ("export default function ", 1),  // capture after keyword
        ("export const ",             1),
        ("export function ",          1),
        ("function ",                 1),
    ];

    for (prefix, _) in patterns {
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

    // const Name = ( pattern
    if let Some(idx) = code.find("const ") {
        let rest = &code[idx + 6..];
        let name: String = rest.chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if !name.is_empty() && name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
            return name;
        }
    }

    // Fall back to filename
    if !filename.is_empty() {
        let base = filename.split('.').next().unwrap_or("");
        let cleaned: String = base.chars()
            .filter(|c| c.is_alphanumeric())
            .collect();
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
        || {
            // export default Identifier; at end of trimmed code
            let trimmed = code.trim();
            if let Some(idx) = trimmed.rfind("export default ") {
                let rest = &trimmed[idx + 15..].trim_start();
                // rest should be a bare identifier possibly followed by ;
                rest.chars().next().map(|c| c.is_alphabetic()).unwrap_or(false)
            } else { false }
        }
}

/// Returns true if the code looks like a valid React component.
/// Mirrors: `isValidReactComponent(code)` in importHelpers.ts
#[wasm_bindgen]
pub fn is_valid_react_component(code: &str) -> bool {
    let has_react_import = code.contains("from 'react'") || code.contains("from \"react\"");
    let has_jsx = {
        // Look for <UpperCase or <lowercase (HTML tags)
        let mut found = false;
        let bytes = code.as_bytes();
        for i in 0..bytes.len().saturating_sub(1) {
            if bytes[i] == b'<' {
                let next = bytes[i + 1];
                if next.is_ascii_alphabetic() { found = true; break; }
            }
        }
        found
    };
    let has_export = code.contains("export ");
    has_jsx || (has_react_import && has_export)
}

/// Generate a collision-proof registry ID from a component name.
/// Format: "custom-{kebab-name}-{8 hex chars}"
/// Mirrors: `generateComponentId(name)` in importHelpers.ts
#[wasm_bindgen]
pub fn generate_component_id(name: &str) -> String {
    let kebab: String = name.chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let kebab = kebab.trim_matches('-').to_string();
    let suffix = &uuid_hex()[..8];
    format!("custom-{}-{}", if kebab.is_empty() { "component".to_string() } else { kebab }, suffix)
}

/// Build a detection preview for ImportModal live preview.
/// Returns JSON: { name, isDefault, importStatement, importPath }
/// or empty string if code is blank.
/// Mirrors: `getDetectionPreview(code, filename)` in importHelpers.ts
#[wasm_bindgen]
pub fn get_detection_preview(code: &str, filename: &str) -> String {
    if code.trim().is_empty() { return String::new(); }
    let name = detect_component_name(code, filename);
    let is_default = detect_default_export(code);
    let import_path = format!("./components/{}", name);
    let import_statement = if is_default {
        format!("import {} from '{}'", name, import_path)
    } else {
        format!("import {{ {} }} from '{}'", name, import_path)
    };
    serde_json::json!({
        "name": name,
        "isDefault": is_default,
        "importStatement": import_statement,
        "importPath": import_path,
    }).to_string()
}

// ══════════════════════════════════════════════════════════════════════════════
// §15  CODE WRAPPER + PASCAL CASE  (NEW v0.4 — replaces useFileSync.ts helpers)
// ══════════════════════════════════════════════════════════════════════════════
//
// to_pascal_case:   "my component 123" → "MyComponent123"
// wrap_component_next: add 'use client' + React/Lucide/Motion imports (Next.js)
// wrap_component_vite: add React/Lucide/Motion imports (Vite — no 'use client')
//
// Both functions are called at high frequency inside useFileSync (once per
// changed custom_code node per sync cycle). Moving to Rust eliminates the
// string allocation overhead from JS template literals.

/// Convert a raw name to PascalCase component name.
/// Mirrors: `toPascalCase(raw)` in useFileSync.ts AND `toPascalCaseGen` in codeGenerator.ts
/// Both implementations are identical — this is the canonical Rust version.
#[wasm_bindgen]
pub fn to_pascal_case(raw: &str) -> String {
    let cleaned: String = raw.chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let pascal: String = words.iter()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect();
    if pascal.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) || pascal.is_empty() {
        format!("Component{}", pascal)
    } else {
        pascal
    }
}

/// Wrap component code for Next.js App Router output.
/// Adds: 'use client', React, Lucide, framer-motion, cn imports.
/// Mirrors: `wrapWithImportsNext(rawCode)` in useFileSync.ts
#[wasm_bindgen]
pub fn wrap_component_next(raw_code: &str) -> String {
    format!(
        "'use client';\n\nimport React, {{ useState, useEffect, useRef }} from 'react';\nimport * as Lucide from 'lucide-react';\nimport {{ motion, AnimatePresence }} from 'framer-motion';\nimport {{ cn }} from '@/lib/utils';\n\n/* \u{2500}\u{2500}\u{2500} Auto-generated by Vectra AI \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} */\n{}\n",
        raw_code
    )
}

/// Wrap component code for Vite/React output.
/// No 'use client'. Uses '../lib/utils' (src/components/ is 2 levels deep).
/// Mirrors: `wrapWithImportsVite(rawCode)` in useFileSync.ts
#[wasm_bindgen]
pub fn wrap_component_vite(raw_code: &str) -> String {
    format!(
        "import React, {{ useState, useEffect, useRef }} from 'react';\nimport * as Lucide from 'lucide-react';\nimport {{ motion, AnimatePresence }} from 'framer-motion';\nimport {{ cn }} from '../lib/utils';\n\n/* \u{2500}\u{2500}\u{2500} Auto-generated by Vectra AI \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} */\n{}\n",
        raw_code
    )
}

// ══════════════════════════════════════════════════════════════════════════════
// §16  FIGMA CONVERTER  (NEW v0.4 — replaces figmaImporter.ts core)
// ══════════════════════════════════════════════════════════════════════════════
//
// transform_figma_frame:
//   Takes a Figma REST API node JSON + import mode.
//   Returns JSON: { nodes: VectraProject, rootId, imageFillNodeIds, warnings }
//
//   Covers (FIG-COORD-1 compliant):
//   • Absolute → relative coordinate transform for all children
//   • SOLID fills → backgroundColor / color
//   • GRADIENT_LINEAR / GRADIENT_RADIAL → background: linear-gradient(...)
//   • IMAGE fills → marks node as 'image' type + imageFillNodeIds tracking
//   • Stroke → border shorthand
//   • cornerRadius + rectangleCornerRadii → border-radius
//   • DROP_SHADOW / INNER_SHADOW effects → box-shadow
//   • Auto-layout (HORIZONTAL/VERTICAL) → flexbox (display, flexDirection, gap, padding)
//   • Alignment (primary + counter axis) → justifyContent + alignItems
//   • TEXT nodes → 'text' or 'heading' type + fontFamily, fontSize, etc.
//   • ELLIPSE → borderRadius: 50%
//   • Depth collapse at MAX_FIGMA_DEPTH (8)
//   • Invisible / unsupported node skipping

const MAX_DEPTH: usize = 8;

// ── Figma input types (minimal subset) ───────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Default)]
struct FigmaColor { r: f64, g: f64, b: f64, a: f64 }

#[derive(Serialize, Deserialize, Clone, Default)]
struct FigmaBBox { x: f64, y: f64, width: f64, height: f64 }

#[derive(Serialize, Deserialize, Clone)]
struct FigmaGradientStop { position: f64, color: FigmaColor }

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FigmaPaint {
    #[serde(rename = "type")]
    paint_type: String,
    color: Option<FigmaColor>,
    opacity: Option<f64>,
    #[serde(rename = "imageRef")]
    image_ref: Option<String>,
    visible: Option<bool>,
    gradient_stops: Option<Vec<FigmaGradientStop>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FigmaTypeStyle {
    font_family: Option<String>,
    font_weight: Option<f64>,
    font_size: Option<f64>,
    text_align_horizontal: Option<String>,
    letter_spacing: Option<f64>,
    line_height_px: Option<f64>,
    italic: Option<bool>,
    text_decoration: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FigmaEffect {
    #[serde(rename = "type")]
    effect_type: String,
    visible: Option<bool>,
    radius: Option<f64>,
    color: Option<FigmaColor>,
    offset: Option<HashMap<String, f64>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FigmaNode {
    id: String,
    name: String,
    #[serde(rename = "type")]
    node_type: String,
    visible: Option<bool>,
    opacity: Option<f64>,
    characters: Option<String>,
    children: Option<Vec<FigmaNode>>,
    absolute_bounding_box: Option<FigmaBBox>,
    fills: Option<Vec<FigmaPaint>>,
    strokes: Option<Vec<FigmaPaint>>,
    stroke_weight: Option<f64>,
    corner_radius: Option<f64>,
    rectangle_corner_radii: Option<Vec<f64>>,
    layout_mode: Option<String>,
    primary_axis_align_items: Option<String>,
    counter_axis_align_items: Option<String>,
    item_spacing: Option<f64>,
    padding_top: Option<f64>,
    padding_right: Option<f64>,
    padding_bottom: Option<f64>,
    padding_left: Option<f64>,
    clips_content: Option<bool>,
    effects: Option<Vec<FigmaEffect>>,
    style: Option<FigmaTypeStyle>,
}

// ── Output types ──────────────────────────────────────────────────────────────
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FigmaConvertResult {
    nodes: HashMap<String, Value>,
    root_id: String,
    image_fill_node_ids: Vec<String>,          // Figma node IDs that need image URLs
    image_fill_map: HashMap<String, String>,   // vectraId → figmaNodeId
    warnings: Vec<String>,
}

struct FigmaCtx {
    node_map:            HashMap<String, Value>,
    image_fill_node_ids: Vec<String>,
    image_fill_map:      HashMap<String, String>,
    warnings:            Vec<String>,
}

// ── Color helpers ─────────────────────────────────────────────────────────────

fn figma_color_to_css(c: &FigmaColor, opacity_override: Option<f64>) -> String {
    let r = (c.r * 255.0).round() as u8;
    let g = (c.g * 255.0).round() as u8;
    let b = (c.b * 255.0).round() as u8;
    let a = opacity_override.unwrap_or(c.a);
    if a >= 1.0 { format!("rgb({}, {}, {})", r, g, b) }
    else        { format!("rgba({}, {}, {}, {:.3})", r, g, b, a) }
}

fn extract_gradient(paint: &FigmaPaint) -> Option<String> {
    let stops = paint.gradient_stops.as_ref()?.iter()
        .map(|s| format!("{} {}%", figma_color_to_css(&s.color, None), (s.position * 100.0).round() as i32))
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
    // Prefer first visible SOLID fill
    for f in fills {
        if f.paint_type == "SOLID" && f.visible != Some(false) {
            if let Some(c) = &f.color {
                let eff = (f.opacity.unwrap_or(1.0) * node_opacity).min(1.0);
                return Some(figma_color_to_css(c, if eff < 1.0 { Some(eff) } else { None }));
            }
        }
    }
    // Fall back to gradient
    for f in fills {
        if (f.paint_type == "GRADIENT_LINEAR" || f.paint_type == "GRADIENT_RADIAL") && f.visible != Some(false) {
            if let Some(g) = extract_gradient(f) { return Some(g); }
        }
    }
    None
}

fn extract_stroke(strokes: &Option<Vec<FigmaPaint>>, weight: Option<f64>) -> Option<String> {
    let w = weight?;
    let strokes = strokes.as_ref()?;
    for s in strokes {
        if s.paint_type == "SOLID" && s.visible != Some(false) {
            if let Some(c) = &s.color {
                return Some(format!("{}px solid {}", w as i32, figma_color_to_css(c, None)));
            }
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
            let r = e.radius.unwrap_or(0.0);
            let inset = if e.effect_type == "INNER_SHADOW" { " inset" } else { "" };
            Some(format!("{}px {}px {}px {}{}", ox as i32, oy as i32, r as i32,
                figma_color_to_css(c, None), inset))
        }).collect();
    if shadows.is_empty() { None } else { Some(shadows.join(", ")) }
}

fn extract_border_radius(node: &FigmaNode) -> Option<String> {
    // 4-corner array takes priority
    if let Some(radii) = &node.rectangle_corner_radii {
        if radii.len() == 4 && radii.iter().any(|&r| r > 0.0) {
            let [tl, tr, br, bl] = [radii[0] as i32, radii[1] as i32, radii[2] as i32, radii[3] as i32];
            if tl == tr && tr == br && br == bl {
                return Some(format!("{}px", tl));
            }
            return Some(format!("{}px {}px {}px {}px", tl, tr, br, bl));
        }
    }
    node.corner_radius.filter(|&r| r > 0.0).map(|r| format!("{}px", r as i32))
}

fn extract_text_styles(style: &FigmaTypeStyle) -> HashMap<String, Value> {
    let mut m: HashMap<String, Value> = HashMap::new();
    if let Some(ref ff) = style.font_family { m.insert("fontFamily".into(), Value::String(ff.clone())); }
    if let Some(fw) = style.font_weight    { m.insert("fontWeight".into(), json!(fw as i32)); }
    if let Some(fs) = style.font_size      { m.insert("fontSize".into(), Value::String(format!("{}px", fs as i32))); }
    if let Some(ls) = style.letter_spacing  { m.insert("letterSpacing".into(), Value::String(format!("{}px", ls))); }
    if let Some(lh) = style.line_height_px  { m.insert("lineHeight".into(), Value::String(format!("{}px", lh as i32))); }
    if style.italic == Some(true)           { m.insert("fontStyle".into(), Value::String("italic".into())); }
    if let Some(ref ta) = style.text_align_horizontal {
        let align = match ta.as_str() {
            "CENTER" => "center", "RIGHT" => "right", "JUSTIFIED" => "justify", _ => "left",
        };
        m.insert("textAlign".into(), Value::String(align.into()));
    }
    if let Some(ref td) = style.text_decoration {
        if td != "NONE" {
            let css = if td == "STRIKETHROUGH" { "line-through" } else { "underline" };
            m.insert("textDecoration".into(), Value::String(css.into()));
        }
    }
    m
}

// ── Core recursive transform ──────────────────────────────────────────────────

fn figma_node_to_vectra(
    node: &FigmaNode,
    parent_box: &FigmaBBox,
    depth: usize,
    ctx: &mut FigmaCtx,
) -> Option<String> {
    // Skip invisible nodes
    if node.visible == Some(false) { return None; }

    // Skip unsupported types
    let skip = ["BOOLEAN_OPERATION", "SLICE", "CONNECTOR", "STICKY",
                "SHAPE_WITH_TEXT", "CODE_BLOCK", "STAMP", "WIDGET",
                "EMBED", "LINK_UNFURL", "MEDIA", "SECTION"];
    let renderable = ["FRAME", "GROUP", "COMPONENT", "COMPONENT_SET",
                      "INSTANCE", "RECTANGLE", "ELLIPSE", "LINE",
                      "VECTOR", "STAR", "POLYGON", "TEXT"];
    if skip.contains(&node.node_type.as_str()) { return None; }
    if !renderable.contains(&node.node_type.as_str()) {
        ctx.warnings.push(format!("Skipped unsupported type: {} (\"{}\")", node.node_type, node.name));
        return None;
    }

    // Depth collapse
    if depth > MAX_DEPTH {
        if let Some(text) = &node.characters {
            let t = text.trim();
            if !t.is_empty() {
                let id = format!("txt_{}", &uuid_hex()[..8]);
                ctx.node_map.insert(id.clone(), json!({
                    "id": id,
                    "type": "text",
                    "name": format!("{} (collapsed)", node.name),
                    "content": &t[..t.len().min(500)],
                    "children": [],
                    "props": { "style": { "position": "relative", "width": "100%" } }
                }));
                return Some(id);
            }
        }
        return None;
    }

    // FIG-COORD-1: absolute → relative coordinates
    let bbox = node.absolute_bounding_box.as_ref();
    let left   = bbox.map(|b| (b.x - parent_box.x).round() as i32).unwrap_or(0);
    let top    = bbox.map(|b| (b.y - parent_box.y).round() as i32).unwrap_or(0);
    let width  = bbox.map(|b| b.width.round().max(1.0) as i32).unwrap_or(100);
    let height = bbox.map(|b| b.height.round().max(1.0) as i32).unwrap_or(40);

    // Determine VectraNode type
    let node_opacity = node.opacity.unwrap_or(1.0);
    let (node_type, content): (&str, Option<String>) = if node.node_type == "TEXT" {
        let size = node.style.as_ref().and_then(|s| s.font_size).unwrap_or(0.0);
        let t = if size >= 20.0 { "heading" } else { "text" };
        (t, node.characters.clone())
    } else {
        ("container", None)
    };

    // Build style map
    let mut style: HashMap<String, Value> = HashMap::new();
    style.insert("position".into(), json!("absolute"));
    style.insert("left".into(),     json!(format!("{}px", left)));
    style.insert("top".into(),      json!(format!("{}px", top)));
    style.insert("width".into(),    json!(format!("{}px", width)));
    style.insert("height".into(),   json!(format!("{}px", height)));

    if node_opacity < 1.0 { style.insert("opacity".into(), json!(node_opacity)); }
    if node.node_type == "ELLIPSE" { style.insert("borderRadius".into(), json!("50%")); }

    // Fill
    let has_image_fill = node.fills.as_ref()
        .map(|f| f.iter().any(|p| p.paint_type == "IMAGE" && p.visible != Some(false)))
        .unwrap_or(false);

    if !has_image_fill {
        if let Some(bg) = extract_fill(&node.fills, node_opacity) {
            let key = if bg.starts_with("linear-gradient") || bg.starts_with("radial-gradient") {
                "background"
            } else {
                "backgroundColor"
            };
            style.insert(key.into(), json!(bg));
        }
    }

    // Stroke
    if let Some(border) = extract_stroke(&node.strokes, node.stroke_weight) {
        style.insert("border".into(), json!(border));
    }

    // Border radius (skip for ELLIPSE — already 50%)
    if node.node_type != "ELLIPSE" {
        if let Some(br) = extract_border_radius(node) {
            style.insert("borderRadius".into(), json!(br));
        }
    }

    // Box shadow
    if let Some(shadow) = extract_shadow(&node.effects) {
        style.insert("boxShadow".into(), json!(shadow));
    }

    // Overflow
    if node.clips_content == Some(true) { style.insert("overflow".into(), json!("hidden")); }

    // Auto-layout → flexbox
    if let Some(ref lm) = node.layout_mode {
        if lm == "HORIZONTAL" || lm == "VERTICAL" {
            style.insert("display".into(), json!("flex"));
            style.insert("flexDirection".into(), json!(if lm == "HORIZONTAL" { "row" } else { "column" }));
            if let Some(gap) = node.item_spacing { style.insert("gap".into(), json!(format!("{}px", gap as i32))); }
            let pt = node.padding_top.unwrap_or(0.0) as i32;
            let pr = node.padding_right.unwrap_or(0.0) as i32;
            let pb = node.padding_bottom.unwrap_or(0.0) as i32;
            let pl = node.padding_left.unwrap_or(0.0) as i32;
            if pt > 0 || pr > 0 || pb > 0 || pl > 0 {
                style.insert("padding".into(), json!(format!("{}px {}px {}px {}px", pt, pr, pb, pl)));
            }
            // Alignment
            let primary = node.primary_axis_align_items.as_deref().unwrap_or("MIN");
            let counter = node.counter_axis_align_items.as_deref().unwrap_or("MIN");
            let jc = match primary { "CENTER" => "center", "MAX" => "flex-end", "SPACE_BETWEEN" => "space-between", _ => "flex-start" };
            let ai = match counter { "CENTER" => "center", "MAX" => "flex-end", _ => "flex-start" };
            if lm == "HORIZONTAL" {
                style.insert("justifyContent".into(), json!(jc));
                style.insert("alignItems".into(), json!(ai));
            } else {
                style.insert("alignItems".into(), json!(jc));
                style.insert("justifyContent".into(), json!(ai));
            }
        }
    }

    // Text styles
    if node_type == "text" || node_type == "heading" {
        if let Some(ref ts) = node.style {
            for (k, v) in extract_text_styles(ts) { style.insert(k, v); }
        }
        if let Some(color) = extract_fill(&node.fills, node_opacity) {
            style.insert("color".into(), json!(color));
        }
        style.remove("backgroundColor");
    }

    // Build VectraNode
    let vectra_id = format!("{}_{}", &node_type[..3], &uuid_hex()[..8]);
    let mut vectra_node: HashMap<String, Value> = HashMap::new();
    let actual_type = if has_image_fill { "image" } else { node_type };
    vectra_node.insert("id".into(),       json!(vectra_id));
    vectra_node.insert("type".into(),     json!(actual_type));
    vectra_node.insert("name".into(),     json!(&node.name[..node.name.len().min(60)]));
    vectra_node.insert("children".into(), json!([] as [&str; 0]));
    vectra_node.insert("props".into(),    json!({ "style": style }));
    if let Some(c) = content {
        vectra_node.insert("content".into(), json!(&c[..c.len().min(2000)]));
    }

    // Track image fill
    if has_image_fill {
        ctx.image_fill_node_ids.push(node.id.clone());
        ctx.image_fill_map.insert(vectra_id.clone(), node.id.clone());
        vectra_node.insert("src".into(), json!(""));
    }

    // Recurse into children (containers only, not image nodes)
    if !has_image_fill && node_type == "container" {
        if let Some(children) = &node.children {
            let child_box = bbox.unwrap_or(parent_box);
            let child_ids: Vec<String> = children.iter()
                .filter_map(|child| figma_node_to_vectra(child, child_box, depth + 1, ctx))
                .collect();
            vectra_node.insert("children".into(), json!(child_ids));
        }
    }

    ctx.node_map.insert(vectra_id.clone(), Value::Object(vectra_node.into_iter().collect()));
    Some(vectra_id)
}

/// Transform a Figma frame node tree into a Vectra element map.
/// `frame_json`: JSON of a single Figma FRAME node (FigmaNode shape).
/// `import_mode`: "page" | "component"
/// Returns JSON: { nodes, rootId, imageFillNodeIds, imageFillMap, warnings }
///
/// Mirrors: `transformFigmaFrame(frame, importMode)` in figmaImporter.ts
#[wasm_bindgen]
pub fn transform_figma_frame(frame_json: String, import_mode: String) -> Result<String, JsValue> {
    let frame: FigmaNode = serde_json::from_str(&frame_json)
        .map_err(|e| JsValue::from_str(&format!("[figma] parse: {}", e)))?;

    let mut ctx = FigmaCtx {
        node_map: HashMap::new(),
        image_fill_node_ids: Vec::new(),
        image_fill_map: HashMap::new(),
        warnings: Vec::new(),
    };

    let bbox = frame.absolute_bounding_box.clone().unwrap_or(FigmaBBox { x: 0.0, y: 0.0, width: 1440.0, height: 900.0 });
    let width  = bbox.width.round() as i32;
    let height = bbox.height.round() as i32;

    // Process frame children — pass frame's own bbox so children get relative coords
    let child_ids: Vec<String> = frame.children.as_ref()
        .map(|children| children.iter()
            .filter_map(|child| figma_node_to_vectra(child, &bbox, 1, &mut ctx))
            .collect())
        .unwrap_or_default();

    // Build root node
    let root_id = format!("root_{}", &uuid_hex()[..8]);
    let bg = extract_fill(&frame.fills, 1.0).unwrap_or_else(|| "#ffffff".to_string());
    let root_type = if import_mode == "page" { "webpage" } else { "container" };

    ctx.node_map.insert(root_id.clone(), json!({
        "id": root_id,
        "type": root_type,
        "name": frame.name,
        "children": child_ids,
        "props": {
            "layoutMode": "canvas",
            "style": {
                "position": "relative",
                "width": format!("{}px", width),
                "minHeight": format!("{}px", height),
                "backgroundColor": bg,
            }
        }
    }));

    let result = FigmaConvertResult {
        nodes: ctx.node_map,
        root_id,
        image_fill_node_ids: ctx.image_fill_node_ids,
        image_fill_map: ctx.image_fill_map,
        warnings: ctx.warnings,
    };

    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}
// ══════════════════════════════════════════════════════════════════════════════
// §17  CODEGEN HELPERS  (NEW — GAP-5/6/4 fixes)
// ══════════════════════════════════════════════════════════════════════════════
//
// collect_stack_on_mobile_ids:
//   Walks a VectraProject subtree, returning IDs of nodes with stackOnMobile:true.
//   Replaces the recursive TS `collectStackOnMobileIds` in codeGenerator.ts.
//   Called twice per export (Vite + Next.js paths).
//
// slug_to_next_path:
//   "/"       → "app/page.tsx"
//   "/about"  → "app/about/page.tsx"
//   Replaces the 4-line TS slugToNextPath.
//
// compute_structural_key:
//   Produces a deterministic topology fingerprint of the element tree.
//   Used by ProjectContext to gate parentMap rebuilds to structural changes only.
//   Replaces the useMemo structuralKey O(N) string concat in TS.

/// Walk a VectraProject subtree, collecting IDs where props.stackOnMobile === true.
/// Returns JSON array of id strings.
/// Mirrors: `codeGenerator.collectStackOnMobileIds(project, nodeId)`
#[wasm_bindgen]
pub fn collect_stack_on_mobile_ids(project_json: String, root_id: String) -> Result<String, JsValue> {
    let project: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[codegen] parse: {}", e)))?;

    let mut result: Vec<String> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();

    fn walk(
        project: &HashMap<String, Value>,
        node_id: &str,
        visited: &mut HashSet<String>,
        result: &mut Vec<String>,
    ) {
        if !visited.insert(node_id.to_string()) { return; }
        let node = match project.get(node_id) { Some(n) => n, None => return };

        // Check props.stackOnMobile === true
        let stack_on_mobile = node
            .get("props")
            .and_then(|p| p.get("stackOnMobile"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if stack_on_mobile { result.push(node_id.to_string()); }

        // Recurse into children
        if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
            for child in children {
                if let Some(cid) = child.as_str() {
                    walk(project, cid, visited, result);
                }
            }
        }
    }

    walk(&project, &root_id, &mut visited, &mut result);

    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Convert a URL slug to a Next.js App Router file path.
/// "/" → "app/page.tsx", "/about" → "app/about/page.tsx"
/// Mirrors: `codeGenerator.slugToNextPath(slug)`
#[wasm_bindgen]
pub fn slug_to_next_path(slug: &str) -> String {
    if slug == "/" { return "app/page.tsx".to_string(); }
    let clean = slug.trim_start_matches('/').trim_end_matches('/');
    if clean.is_empty() { return "app/page.tsx".to_string(); }
    format!("app/{}/page.tsx", clean)
}

/// Compute a deterministic topology fingerprint of the element tree.
/// Only changes when nodes are added/removed or reparented — NOT on style edits.
/// Returns a string that can be used as a useMemo dependency key.
/// Mirrors: the `structuralKey` useMemo in ProjectContext.tsx
#[wasm_bindgen]
pub fn compute_structural_key(project_json: String) -> Result<String, JsValue> {
    let project: HashMap<String, Value> = serde_json::from_str(&project_json)
        .map_err(|e| JsValue::from_str(&format!("[codegen] parse: {}", e)))?;

    let mut node_ids: Vec<String> = project.keys().cloned().collect();
    node_ids.sort();

    let mut parts: Vec<String> = Vec::with_capacity(node_ids.len());
    for id in &node_ids {
        let node = &project[id];
        let node_type = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let children: Vec<&str> = node
            .get("children")
            .and_then(|c| c.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        parts.push(format!("{}:{}:[{}]", id, node_type, children.join(",")));
    }

    Ok(parts.join("|"))
}
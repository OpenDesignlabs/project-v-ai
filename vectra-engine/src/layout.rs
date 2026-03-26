// ══════════════════════════════════════════════════════════════════════════════
// layout.rs  —  §1 LayoutEngine  +  §6 absolute_to_grid
// ══════════════════════════════════════════════════════════════════════════════
//
//  §1  LayoutEngine — retained-mode snap/gap/overlap/bbox
//      Maintains a spatial hash grid of all canvas rects.
//      Called at 60fps during drag; must be zero-allocation on the hot path.
//
//  §6  absolute_to_grid — canvas → CSS Grid converter
//      Converts absolute-positioned nodes to a CSS grid template.
//      Returns px + fr unit strings for the Header "Convert to Grid" feature.

use std::collections::{HashMap, HashSet};
use ahash::AHashMap;
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

// ── §1 Types ──────────────────────────────────────────────────────────────────

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

// ── §1 LayoutEngine ───────────────────────────────────────────────────────────

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
        let indices: Vec<usize> = serde_json::from_str(&indices_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        if indices.is_empty() { return Err(JsValue::from_str("no indices")); }
        let mut min_x=f64::MAX; let mut min_y=f64::MAX;
        let mut max_x=f64::MIN; let mut max_y=f64::MIN;
        for i in indices { if let Some(r)=self.rects.get(i) {
            min_x=min_x.min(r.x); min_y=min_y.min(r.y);
            max_x=max_x.max(r.x+r.w); max_y=max_y.max(r.y+r.h);
        }}
        serde_json::to_string(&BBox{x:min_x,y:min_y,w:max_x-min_x,h:max_y-min_y})
            .map_err(|e|JsValue::from_str(&e.to_string()))
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

// ── §6 absolute_to_grid ───────────────────────────────────────────────────────

const SNAP_TOL: f64 = 4.0;

#[derive(Serialize,Deserialize)] #[serde(rename_all="camelCase")]
pub struct GridInputNode { pub id:String, pub x:f64, pub y:f64, pub w:f64, pub h:f64 }

#[derive(Serialize,Deserialize)] #[serde(rename_all="camelCase")]
pub struct GridItem {
    pub id:String, pub col_start:usize, pub col_end:usize,
    pub row_start:usize, pub row_end:usize,
}

#[derive(Serialize,Deserialize)] #[serde(rename_all="camelCase")]
pub struct GridLayout {
    pub template_columns:String, pub template_rows:String,
    pub fr_columns:String,       pub fr_rows:String,
    pub col_widths_px:Vec<f64>,  pub row_heights_px:Vec<f64>,
    pub items:Vec<GridItem>,
}

fn dedup_coords(mut c: Vec<f64>) -> Vec<f64> {
    if c.is_empty() { return c; }
    c.sort_by(|a,b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut res = Vec::with_capacity(c.len());
    let mut sum = c[0]; let mut cnt = 1usize;
    for &v in &c[1..] {
        if (v - sum/cnt as f64).abs() <= SNAP_TOL { sum += v; cnt += 1; }
        else { res.push(sum/cnt as f64); sum = v; cnt = 1; }
    }
    res.push(sum/cnt as f64);
    res
}

fn find_idx(breaks: &[f64], target: f64) -> usize {
    breaks.iter().enumerate()
        .min_by(|(_,&a),(_,&b)| (a-target).abs().partial_cmp(&(b-target).abs())
            .unwrap_or(std::cmp::Ordering::Equal))
        .map(|(i,_)| i).unwrap_or(0)
}

#[wasm_bindgen]
pub fn absolute_to_grid(nodes_json: String, canvas_width: f64) -> Result<String, JsValue> {
    let nodes: Vec<GridInputNode> = serde_json::from_str(&nodes_json)
        .map_err(|e| JsValue::from_str(&format!("[grid] parse: {}", e)))?;
    if nodes.is_empty() { return Err(JsValue::from_str("[grid] no nodes")); }
    let mut xr = Vec::with_capacity(nodes.len()*2);
    let mut yr = Vec::with_capacity(nodes.len()*2);
    for n in &nodes { xr.push(n.x); xr.push(n.x+n.w); yr.push(n.y); yr.push(n.y+n.h); }
    let xb = dedup_coords(xr); let yb = dedup_coords(yr);
    if xb.len()<2 || yb.len()<2 { return Err(JsValue::from_str("[grid] degenerate")); }
    let cw: Vec<f64> = xb.windows(2).map(|w| (w[1]-w[0]).round().max(1.0)).collect();
    let rh: Vec<f64> = yb.windows(2).map(|w| (w[1]-w[0]).round().max(1.0)).collect();
    let cw_sum: f64 = cw.iter().sum(); let rh_sum: f64 = rh.iter().sum();
    let cw_base = if canvas_width > 0.0 { canvas_width } else { cw_sum };
    let tc = cw.iter().map(|&w| format!("{}px", w as i64)).collect::<Vec<_>>().join(" ");
    let tr = rh.iter().map(|&h| format!("{}px", h as i64)).collect::<Vec<_>>().join(" ");
    let fc = cw.iter().map(|&w| format!("{:.2}fr", w/cw_base)).collect::<Vec<_>>().join(" ");
    let fr = rh.iter().map(|&h| format!("{:.2}fr", h/rh_sum.max(1.0))).collect::<Vec<_>>().join(" ");
    let items: Vec<GridItem> = nodes.iter().map(|n| GridItem {
        id: n.id.clone(),
        col_start: find_idx(&xb, n.x)+1,   col_end: find_idx(&xb, n.x+n.w)+1,
        row_start: find_idx(&yb, n.y)+1,   row_end: find_idx(&yb, n.y+n.h)+1,
    }).collect();
    serde_json::to_string(&GridLayout {
        template_columns:tc, template_rows:tr,
        fr_columns:fc, fr_rows:fr,
        col_widths_px:cw, row_heights_px:rh, items,
    }).map_err(|e| JsValue::from_str(&e.to_string()))
}

use crate::models::AnchorPosition;

// Native mathematical helper to find the exact closest anchor and its strict position
pub fn get_closest_anchor(node_x: f64, node_y: f64, node_w: f64, node_h: f64, mouse_x: f64, mouse_y: f64) -> (f64, f64, AnchorPosition) {
    let cx = node_x + node_w / 2.0;
    let cy = node_y + node_h / 2.0;
    
    // STRICT MICRO-STEP 5A.2: Bind the mathematical coordinates to the specific AnchorPosition
    let points = [
        (cx, node_y, AnchorPosition::Top),               
        (cx, node_y + node_h, AnchorPosition::Bottom),      
        (node_x, cy, AnchorPosition::Left),               
        (node_x + node_w, cy, AnchorPosition::Right),      
    ];
    
    let mut min_dist = f64::MAX;
    let mut best_pt = points[0];
    
    for p in points.iter() {
        let dx = mouse_x - p.0;
        let dy = mouse_y - p.1;
        let dist = dx * dx + dy * dy;
        if dist < min_dist {
            min_dist = dist;
            best_pt = *p;
        }
    }
    best_pt
}

// Hit detection math: Shortest distance from a point to a straight line segment
pub fn dist_to_segment(px: f64, py: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    let l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    if l2 == 0.0 { return ((px - x1) * (px - x1) + (py - y1) * (py - y1)).sqrt(); }
    let mut t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = t.max(0.0).min(1.0);
    let proj_x = x1 + t * (x2 - x1);
    let proj_y = y1 + t * (y2 - y1);
    ((px - proj_x) * (px - proj_x) + (py - proj_y) * (py - proj_y)).sqrt()
}

// STRICT MICRO-STEP 6A: New universal path hit-detection for orthogonal lines
pub fn dist_to_path(px: f64, py: f64, path: &[(f64, f64)]) -> f64 {
    let mut min_dist = f64::MAX;
    if path.len() < 2 { return min_dist; }
    for i in 0..path.len() - 1 {
        let p1 = path[i];
        let p2 = path[i + 1];
        let dist = dist_to_segment(px, py, p1.0, p1.1, p2.0, p2.1);
        if dist < min_dist { min_dist = dist; }
    }
    min_dist
}

// STRICT MICRO-STEP 6A: True Orthogonal / Manhattan Routing Mathematics
#[allow(clippy::too_many_arguments)]
pub fn calculate_orthogonal_routing(
    s_x: f64, s_y: f64, s_w: f64, s_h: f64, s_anchor: AnchorPosition,
    t_x: f64, t_y: f64, t_w: f64, t_h: f64, t_anchor: AnchorPosition,
) -> Vec<(f64, f64)> {
    let mut pts = Vec::new();

    let p_start = match s_anchor {
        AnchorPosition::Left => (s_x, s_y + s_h / 2.0),
        AnchorPosition::Right => (s_x + s_w, s_y + s_h / 2.0),
        AnchorPosition::Top => (s_x + s_w / 2.0, s_y),
        AnchorPosition::Bottom => (s_x + s_w / 2.0, s_y + s_h),
        _ => (s_x + s_w / 2.0, s_y + s_h / 2.0),
    };

    let p_end = match t_anchor {
        AnchorPosition::Left => (t_x, t_y + t_h / 2.0),
        AnchorPosition::Right => (t_x + t_w, t_y + t_h / 2.0),
        AnchorPosition::Top => (t_x + t_w / 2.0, t_y),
        AnchorPosition::Bottom => (t_x + t_w / 2.0, t_y + t_h),
        _ => (t_x + t_w / 2.0, t_y + t_h / 2.0),
    };

    pts.push(p_start);

    let offset = 40.0;

    let p1 = match s_anchor {
        AnchorPosition::Left => (p_start.0 - offset, p_start.1),
        AnchorPosition::Right => (p_start.0 + offset, p_start.1),
        AnchorPosition::Top => (p_start.0, p_start.1 - offset),
        AnchorPosition::Bottom => (p_start.0, p_start.1 + offset),
        _ => p_start,
    };

    let p2 = match t_anchor {
        AnchorPosition::Left => (p_end.0 - offset, p_end.1),
        AnchorPosition::Right => (p_end.0 + offset, p_end.1),
        AnchorPosition::Top => (p_end.0, p_end.1 - offset),
        AnchorPosition::Bottom => (p_end.0, p_end.1 + offset),
        _ => p_end,
    };

    pts.push(p1);

    let is_start_horizontal = matches!(s_anchor, AnchorPosition::Left | AnchorPosition::Right | AnchorPosition::Center);
    let is_end_horizontal = matches!(t_anchor, AnchorPosition::Left | AnchorPosition::Right | AnchorPosition::Center);

    if is_start_horizontal && is_end_horizontal {
        let mid_x = (p1.0 + p2.0) / 2.0;
        pts.push((mid_x, p1.1));
        pts.push((mid_x, p2.1));
    } else if !is_start_horizontal && !is_end_horizontal {
        let mid_y = (p1.1 + p2.1) / 2.0;
        pts.push((p1.0, mid_y));
        pts.push((p2.0, mid_y));
    } else {
        if is_start_horizontal {
            pts.push((p2.0, p1.1));
        } else {
            pts.push((p1.0, p2.1));
        }
    }

    pts.push(p2);
    pts.push(p_end);

    let mut deduplicated: Vec<(f64, f64)> = Vec::new();
    for pt in pts {
        if let Some(last) = deduplicated.last() {
            if (last.0 - pt.0).abs() < 1.0 && (last.1 - pt.1).abs() < 1.0 {
                continue;
            }
        }
        deduplicated.push(pt);
    }

    deduplicated
}
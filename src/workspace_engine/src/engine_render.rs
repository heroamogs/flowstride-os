use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use crate::WorkspaceEngine;
use crate::models::{ExecutionStatus, WorkspaceMode};
use crate::math::calculate_orthogonal_routing;
use crate::render::{
    calculate_wrapped_text_height, draw_orthogonal_arrow, draw_rounded_rect,
    draw_straight_arrow, wrap_canvas_text,
};

impl WorkspaceEngine {
    // STRICT MICRO STEP 1: Safely isolated rendering implementation
    pub(crate) fn execute_render(&mut self) -> Result<(), JsValue> {
        let window = web_sys::window().ok_or("Security Alert: No global window exists")?;
        let document = window.document().ok_or("Security Alert: No document found on window")?;
        
        let canvas = document
            .get_element_by_id(&self.canvas_id)
            .ok_or("Security Alert: Target canvas ID not found in the DOM")?;

        let canvas_element = canvas
            .dyn_into::<web_sys::HtmlCanvasElement>()
            .map_err(|_| "Security Alert: Target element is not a valid HTMLCanvasElement")?;

        canvas_element.set_width((self.canvas_width as f64 * self.dpr) as u32);
        canvas_element.set_height((self.canvas_height as f64 * self.dpr) as u32);

        let context = canvas_element
            .get_context("2d")?
            .ok_or("Security Alert: 2D Context not available")?
            .dyn_into::<web_sys::CanvasRenderingContext2d>()
            .map_err(|_| "Security Alert: Failed to cast to CanvasRenderingContext2d")?;

        context.scale(self.dpr * self.zoom, self.dpr * self.zoom)?;

        let end_x = self.canvas_width as f64 / self.zoom;
        let end_y = self.canvas_height as f64 / self.zoom;

        // STRICT MICRO STEP: Calculate dynamic bounds including title wrap
        for node in self.nodes.iter_mut() {
            context.set_font("bold 16px sans-serif");
            let title_height = calculate_wrapped_text_height(
                &context,
                &node.title,
                node.width - 40.0,
                22.0
            )?;

            context.set_font("14px sans-serif");
            let desc_height = calculate_wrapped_text_height(
                &context, 
                &node.description, 
                node.width - 40.0, 
                20.0
            )?;
            
            let dynamic_desc_start_y = 64.0 + title_height + 6.0;
            let total_height = dynamic_desc_start_y + desc_height + 28.0;
            node.height = f64::max(160.0, total_height);
        }

        context.set_font("16px sans-serif");
        for text in self.texts.iter_mut() {
            let text_height = calculate_wrapped_text_height(
                &context,
                &text.content,
                text.width,
                22.0
            )?;
            text.height = f64::max(22.0, text_height);
        }

        context.set_fill_style(&JsValue::from_str(if self.mode == WorkspaceMode::Execution { "#0f172a" } else { "#f8f9fa" })); 
        context.fill_rect(0.0, 0.0, end_x, end_y);

        let dot_spacing = 25.0; 
        let dot_radius = 1.2;
        context.set_fill_style(&JsValue::from_str(if self.mode == WorkspaceMode::Execution { "#334155" } else { "#e1e4e8" }));

        let start_x = (self.pan_offset_x % dot_spacing + dot_spacing) % dot_spacing;
        let start_y = (self.pan_offset_y % dot_spacing + dot_spacing) % dot_spacing;

        let mut x = start_x;
        while x < end_x {
            let mut y = start_y;
            while y < end_y {
                context.begin_path();
                context.arc(x, y, dot_radius, 0.0, std::f64::consts::PI * 2.0)?;
                context.fill();
                y += dot_spacing;
            }
            x += dot_spacing;
        }

        if let Some(snap_x) = self.snap_line_x {
            let render_x = snap_x + self.pan_offset_x;
            context.begin_path();
            context.set_stroke_style(&JsValue::from_str("rgba(239, 68, 68, 0.5)")); 
            context.set_line_width(1.0);
            context.move_to(render_x, 0.0);
            context.line_to(render_x, end_y);
            context.stroke();
        }

        if let Some(snap_y) = self.snap_line_y {
            let render_y = snap_y + self.pan_offset_y;
            context.begin_path();
            context.set_stroke_style(&JsValue::from_str("rgba(239, 68, 68, 0.5)"));
            context.set_line_width(1.0);
            context.move_to(0.0, render_y);
            context.line_to(end_x, render_y);
            context.stroke();
        }
        
        let dash_array = js_sys::Array::new();
        dash_array.push(&JsValue::from_f64(6.0));
        dash_array.push(&JsValue::from_f64(6.0));
        
        let empty_dash = js_sys::Array::new();

        for group in &self.groups {
            let render_x = group.x + self.pan_offset_x;
            let render_y = group.y + self.pan_offset_y;
            
            context.set_line_dash(&dash_array)?;
            let border_color = if group.is_active { "#6366f1" } else { "#a5b4fc" };
            context.set_stroke_style(&JsValue::from_str(border_color));
            context.set_line_width(2.0);
            
            draw_rounded_rect(&context, render_x, render_y, group.width, group.height, 12.0);
            context.stroke();
            
            context.set_line_dash(&empty_dash)?;
            
            context.set_font("bold 12px sans-serif");
            let title_metrics = context.measure_text(&group.title)?;
            let tab_width = title_metrics.width() + 24.0;
            
            context.set_fill_style(&JsValue::from_str(if self.mode == WorkspaceMode::Execution { "#0f172a" } else { "#f8f9fa" }));
            context.fill_rect(render_x + 20.0, render_y - 14.0, tab_width, 28.0);
            
            context.set_fill_style(&JsValue::from_str("#64748b"));
            context.set_text_align("center");
            context.set_text_baseline("middle");
            context.fill_text(&group.title.to_uppercase(), render_x + 20.0 + (tab_width / 2.0), render_y)?;
            
            let x_center = render_x + group.width;
            let y_center = render_y;
            
            context.begin_path();
            context.arc(x_center, y_center, 10.0, 0.0, std::f64::consts::PI * 2.0)?;
            context.set_fill_style(&JsValue::from_str(if self.mode == WorkspaceMode::Execution { "#0f172a" } else { "#ffffff" }));
            context.fill();
            
            context.set_stroke_style(&JsValue::from_str("#fee2e2"));
            context.set_line_width(1.0);
            context.stroke();
            
            context.begin_path();
            context.move_to(x_center - 3.0, y_center - 3.0);
            context.line_to(x_center + 3.0, y_center + 3.0);
            context.move_to(x_center + 3.0, y_center - 3.0);
            context.line_to(x_center - 3.0, y_center + 3.0);
            context.set_stroke_style(&JsValue::from_str("#ef4444"));
            context.set_line_width(1.5);
            context.stroke();
            
            context.set_line_dash(&dash_array)?;
        }

        if self.is_drawing_group {
            let start_x = self.drawing_group_start_x + self.pan_offset_x;
            let start_y = self.drawing_group_start_y + self.pan_offset_y;
            let current_x = self.drawing_group_current_x + self.pan_offset_x;
            let current_y = self.drawing_group_current_y + self.pan_offset_y;
            
            let x = start_x.min(current_x);
            let y = start_y.min(current_y);
            let w = (start_x - current_x).abs();
            let h = (start_y - current_y).abs();
            
            context.set_line_dash(&dash_array)?;
            context.set_stroke_style(&JsValue::from_str("rgba(99, 102, 241, 0.6)"));
            context.set_line_width(2.0);
            
            draw_rounded_rect(&context, x, y, w, h, 12.0);
            context.stroke();
        }

        context.set_line_dash(&empty_dash)?;

        for arrow in &self.arrows {
            let (is_routed, path) = self.get_arrow_routing_points(arrow);
            
            let mut is_path_active = arrow.is_active;
            if !is_path_active {
                if arrow.start_node_id > 0 {
                    if let Some(s) = self.nodes.iter().find(|n| n.id == arrow.start_node_id) {
                        if s.is_active { is_path_active = true; }
                    }
                }
                if arrow.end_node_id > 0 {
                    if let Some(t) = self.nodes.iter().find(|n| n.id == arrow.end_node_id) {
                        if t.is_active { is_path_active = true; }
                    }
                }
            }
            
            let path_color = if self.mode == WorkspaceMode::Execution {
                "#475569" 
            } else if arrow.is_active { 
                "#0969da" 
            } else if is_path_active { 
                "#6366f1" 
            } else { 
                "#cbd5e1" 
            };

            if is_routed {
                let panned_path: Vec<(f64, f64)> = path.iter().map(|p| (p.0 + self.pan_offset_x, p.1 + self.pan_offset_y)).collect();
                draw_orthogonal_arrow(&context, &panned_path, path_color, false)?;
            } else {
                draw_straight_arrow(
                    &context, 
                    path[0].0 + self.pan_offset_x, path[0].1 + self.pan_offset_y, 
                    path[1].0 + self.pan_offset_x, path[1].1 + self.pan_offset_y, 
                    path_color, false
                )?;
            }
        }

        if self.is_drawing_arrow {
            if self.drawing_source_node_id > 0 || self.hovered_anchor_node_id > 0 {
                let (source_x, source_y, source_w, source_h) = if self.drawing_source_node_id > 0 {
                    if let Some(s) = self.nodes.iter().find(|n| n.id == self.drawing_source_node_id) {
                        (s.x, s.y, s.width, s.height)
                    } else { (self.drawing_start_x, self.drawing_start_y, 0.0, 0.0) }
                } else { (self.drawing_start_x, self.drawing_start_y, 0.0, 0.0) };

                let (target_x, target_y, target_w, target_h) = if self.hovered_anchor_node_id > 0 && self.hovered_anchor_node_id != self.drawing_source_node_id {
                    if let Some(t) = self.nodes.iter().find(|n| n.id == self.hovered_anchor_node_id) {
                        (t.x, t.y, t.width, t.height)
                    } else { (self.drawing_end_x, self.drawing_end_y, 0.0, 0.0) }
                } else { (self.drawing_end_x, self.drawing_end_y, 0.0, 0.0) };

                let current_end_anchor = if self.hovered_anchor_node_id > 0 && self.hovered_anchor_node_id != self.drawing_source_node_id {
                    self.hovered_anchor_pos
                } else {
                    crate::models::AnchorPosition::Center
                };

                let path = calculate_orthogonal_routing(
                    source_x, source_y, source_w, source_h, self.drawing_start_anchor,
                    target_x, target_y, target_w, target_h, current_end_anchor
                );
                
                let panned_path: Vec<(f64, f64)> = path.iter().map(|p| (p.0 + self.pan_offset_x, p.1 + self.pan_offset_y)).collect();
                
                draw_orthogonal_arrow(
                    &context, 
                    &panned_path,
                    "rgba(99, 102, 241, 0.6)", true
                )?;
            } else {
                let start_render_x = self.drawing_start_x + self.pan_offset_x;
                let start_render_y = self.drawing_start_y + self.pan_offset_y;
                let end_render_x = self.drawing_end_x + self.pan_offset_x;
                let end_render_y = self.drawing_end_y + self.pan_offset_y;

                draw_straight_arrow(
                    &context, 
                    start_render_x, start_render_y, 
                    end_render_x, end_render_y, 
                    "rgba(99, 102, 241, 0.6)", true
                )?;
            }
        }

        // Render Nodes securely
        for node in &self.nodes {
            let render_x = node.x + self.pan_offset_x;
            let render_y = node.y + self.pan_offset_y;

            context.set_shadow_color("rgba(0, 0, 0, 0.05)");
            context.set_shadow_blur(4.0);
            context.set_shadow_offset_y(2.0);

            let mut border_color = if node.is_active { "#0969da" } else { "#e1e4e8" };
            let mut step_box_color = if node.is_active { "#0969da" } else { "#f6f8fa" };
            let mut step_text_color = if node.is_active { "#ffffff" } else { "#57606a" };
            let mut node_bg_color = "#ffffff";
            let mut title_color = "#24292f";
            let mut desc_color = "#57606a";
            
            let mut draw_icon = false;
            let mut icon_type = 0; 

            let is_hovered = self.hovered_anchor_node_id == node.id && self.mode == WorkspaceMode::Design;

            if self.mode == WorkspaceMode::Execution {
                node_bg_color = "#0f172a";
                title_color = "#f8fafc";
                desc_color = "#cbd5e1";
                
                match node.execution_status {
                    ExecutionStatus::Current => {
                        border_color = "#9333ea";
                        step_box_color = "#9333ea";
                        step_text_color = "#ffffff";
                    }
                    ExecutionStatus::Passed => {
                        border_color = "#16a34a";
                        step_text_color = "#16a34a"; 
                        draw_icon = true;
                        icon_type = 1;
                    }
                    ExecutionStatus::Failed => {
                        border_color = "#dc2626";
                        step_text_color = "#dc2626"; 
                        draw_icon = true;
                        icon_type = 2;
                    }
                    ExecutionStatus::Blocked => {
                        border_color = "#d97706";
                        step_text_color = "#d97706"; 
                        draw_icon = true;
                        icon_type = 3;
                    }
                    ExecutionStatus::Skipped => {
                        border_color = "#475569";
                        step_text_color = "#475569"; 
                        draw_icon = true;
                        icon_type = 4;
                    }
                    ExecutionStatus::Pending => {
                        border_color = "#334155";
                        step_box_color = "#1e293b";
                        step_text_color = "#94a3b8";
                    }
                }
            } else {
                if node.is_active || is_hovered {
                    border_color = "#0969da";
                    if node.is_active {
                        step_box_color = "#0969da";
                        step_text_color = "#ffffff";
                    }
                }
            }

            context.set_fill_style(&JsValue::from_str(node_bg_color));
            context.fill_rect(render_x, render_y, node.width, node.height);

            context.set_shadow_color("transparent");
            context.set_shadow_blur(0.0);
            context.set_shadow_offset_y(0.0);

            context.set_stroke_style(&JsValue::from_str(border_color));
            context.set_line_width(if node.is_active || is_hovered || (self.mode == WorkspaceMode::Execution && node.execution_status == ExecutionStatus::Current) { 2.0 } else { 1.0 });
            context.stroke_rect(render_x, render_y, node.width, node.height);

            if is_hovered {
                let anchor_rx = self.hovered_anchor_x + self.pan_offset_x;
                let anchor_ry = self.hovered_anchor_y + self.pan_offset_y;
                
                context.begin_path();
                context.arc(anchor_rx, anchor_ry, 4.5, 0.0, std::f64::consts::PI * 2.0)?;
                context.set_fill_style(&JsValue::from_str("#475569")); 
                context.fill();
            }

            if draw_icon {
                let cx = render_x + 33.0;
                let cy = render_y + 33.0;
                
                context.begin_path();
                context.arc(cx, cy, 12.0, 0.0, std::f64::consts::PI * 2.0)?;
                context.set_stroke_style(&JsValue::from_str(step_text_color));
                context.set_line_width(2.0);
                context.stroke();

                context.begin_path();
                if icon_type == 1 { 
                    context.move_to(cx - 4.0, cy);
                    context.line_to(cx - 1.0, cy + 4.0);
                    context.line_to(cx + 5.0, cy - 4.0);
                } else if icon_type == 2 { 
                    context.move_to(cx - 4.0, cy - 4.0);
                    context.line_to(cx + 4.0, cy + 4.0);
                    context.move_to(cx + 4.0, cy - 4.0);
                    context.line_to(cx - 4.0, cy + 4.0);
                } else if icon_type == 3 { 
                    context.move_to(cx - 5.0, cy);
                    context.line_to(cx + 5.0, cy);
                } else if icon_type == 4 { 
                    context.move_to(cx - 5.0, cy);
                    context.line_to(cx + 5.0, cy);
                    context.move_to(cx + 1.0, cy - 4.0);
                    context.line_to(cx + 5.0, cy);
                    context.move_to(cx + 1.0, cy + 4.0);
                    context.line_to(cx + 5.0, cy);
                }
                context.stroke();

                context.set_fill_style(&JsValue::from_str(step_text_color));
                context.set_font("bold 13px sans-serif");
                context.set_text_align("left");
                context.set_text_baseline("middle");

                let status_text = if icon_type == 1 {
                    "PASS"
                } else if icon_type == 2 {
                    "FAIL"
                } else if icon_type == 3 {
                    "BLOCKED"
                } else {
                    "SKIP"
                };

                context.fill_text(status_text, cx + 22.0, cy)?;
                
            } else {
                context.set_fill_style(&JsValue::from_str(step_box_color));
                context.fill_rect(render_x + 20.0, render_y + 20.0, 26.0, 26.0);

                context.set_fill_style(&JsValue::from_str(step_text_color));
                context.set_font("bold 13px sans-serif");
                context.set_text_align("center");
                context.set_text_baseline("middle");
                
                context.fill_text(&node.visual_step, render_x + 33.0, render_y + 33.0)?;
            }

            if node.is_active && self.mode == WorkspaceMode::Design {
                let menu_cx = render_x + node.width - 20.0;
                let menu_cy = render_y + 20.0;
                
                context.set_fill_style(&JsValue::from_str("#0969da"));
                
                for i in -1..=1 {
                    context.begin_path();
                    context.arc(menu_cx + (i as f64 * 5.0), menu_cy, 1.5, 0.0, std::f64::consts::PI * 2.0)?;
                    context.fill();
                }
            }

            // STRICT MICRO STEP: Secure dynamic placement of title and description based on wrap height
            context.set_fill_style(&JsValue::from_str(title_color));
            context.set_font("bold 16px sans-serif");
            context.set_text_align("left");
            context.set_text_baseline("top");
            wrap_canvas_text(&context, &node.title, render_x + 20.0, render_y + 64.0, node.width - 40.0, 22.0)?;

            let title_height = calculate_wrapped_text_height(
                &context,
                &node.title,
                node.width - 40.0,
                22.0
            )?;
            let dynamic_desc_y = render_y + 64.0 + title_height + 6.0;

            context.set_fill_style(&JsValue::from_str(desc_color));
            context.set_font("14px sans-serif");
            wrap_canvas_text(&context, &node.description, render_x + 20.0, dynamic_desc_y, node.width - 40.0, 20.0)?;
        }

        context.set_line_dash(&empty_dash)?;
        for text in &self.texts {
            let render_x = text.x + self.pan_offset_x;
            let render_y = text.y + self.pan_offset_y;

            if text.is_active && self.mode == WorkspaceMode::Design {
                context.set_stroke_style(&JsValue::from_str("#0969da"));
                context.set_line_width(1.0);
                context.stroke_rect(render_x - 8.0, render_y - 8.0, text.width + 16.0, text.height + 16.0);

                let cy = render_y + (text.height / 2.0);
                context.set_fill_style(&JsValue::from_str("#ffffff"));
                
                context.begin_path();
                context.arc(render_x - 8.0, cy, 4.0, 0.0, std::f64::consts::PI * 2.0)?;
                context.fill();
                context.stroke();
                
                context.begin_path();
                context.arc(render_x + text.width + 8.0, cy, 4.0, 0.0, std::f64::consts::PI * 2.0)?;
                context.fill();
                context.stroke();
            }

            let text_color = if self.mode == WorkspaceMode::Execution { "#cbd5e1" } else { "#24292f" };
            context.set_fill_style(&JsValue::from_str(text_color));
            context.set_font("16px sans-serif");
            context.set_text_align("left");
            context.set_text_baseline("top");
            
            wrap_canvas_text(&context, &text.content, render_x, render_y, text.width, 22.0)?;
        }

        if self.nodes.is_empty() && self.groups.is_empty() && self.texts.is_empty() {
            context.set_fill_style(&JsValue::from_str("#8b949e"));
            context.set_font("14px sans-serif");
            context.set_text_align("center");
            context.set_text_baseline("middle");
            
            let mode_text = if self.mode == WorkspaceMode::Design {
                "NATIVE CANVAS READY: DESIGN MODE"
            } else {
                "NATIVE CANVAS READY: EXECUTION MODE"
            };

            context.fill_text(
                mode_text,
                end_x / 2.0,
                end_y / 2.0,
            )?;
        }

        Ok(())
    }
}
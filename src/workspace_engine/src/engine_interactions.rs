use wasm_bindgen::prelude::*;

use crate::WorkspaceEngine;
use crate::models::{AnchorPosition, QaArrow, QaGroup, WorkspaceMode};
use crate::math::{dist_to_path, get_closest_anchor};

#[wasm_bindgen]
impl WorkspaceEngine {
    // --- SECURE GROUP DRAWING PIPELINE ---

    pub fn begin_group_draw(&mut self, click_x: f64, click_y: f64) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }
        self.is_drawing_group = true;
        
        self.drawing_group_start_x = click_x - self.pan_offset_x;
        self.drawing_group_start_y = click_y - self.pan_offset_y;
        self.drawing_group_current_x = self.drawing_group_start_x;
        self.drawing_group_current_y = self.drawing_group_start_y;
        
        for n in self.nodes.iter_mut() { n.is_active = false; }
        for a in self.arrows.iter_mut() { a.is_active = false; }
        for g in self.groups.iter_mut() { g.is_active = false; }
        for t in self.texts.iter_mut() { t.is_active = false; }
        
        true
    }

    pub fn update_group_draw(&mut self, cursor_x: f64, cursor_y: f64) {
        if self.is_drawing_group {
            self.drawing_group_current_x = cursor_x - self.pan_offset_x;
            self.drawing_group_current_y = cursor_y - self.pan_offset_y;
        }
    }

    pub fn complete_group_draw(&mut self, drop_x: f64, drop_y: f64, default_title: String) -> u32 {
        if !self.is_drawing_group { return 0; }
        
        let end_x = drop_x - self.pan_offset_x;
        let end_y = drop_y - self.pan_offset_y;
        
        let x = self.drawing_group_start_x.min(end_x);
        let y = self.drawing_group_start_y.min(end_y);
        let width = (self.drawing_group_start_x - end_x).abs();
        let height = (self.drawing_group_start_y - end_y).abs();
        
        self.is_drawing_group = false;
        
        if width > 50.0 && height > 50.0 {
            self.save_history_snapshot();

            let new_group = QaGroup {
                id: self.next_group_id,
                x,
                y,
                width,
                height,
                title: default_title,
                is_active: true,
            };
            self.groups.push(new_group);
            self.next_group_id += 1;
            return self.next_group_id - 1;
        }
        
        0
    }

    pub fn cancel_group_draw(&mut self) {
        self.is_drawing_group = false;
    }

    // --- STRICT INDEPENDENT GROUP DELETION ---
    pub fn check_group_delete_click(&mut self, click_x: f64, click_y: f64) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }
        
        let world_x = click_x - self.pan_offset_x;
        let world_y = click_y - self.pan_offset_y;
        
        let mut group_to_delete = 0;
        
        for group in self.groups.iter().rev() {
            let x_center = group.x + group.width;
            let y_center = group.y;
            
            let dx = world_x - x_center;
            let dy = world_y - y_center;
            let dist_squared = dx * dx + dy * dy;
            
            if dist_squared <= 144.0 {
                group_to_delete = group.id;
                break;
            }
        }
        
        if group_to_delete > 0 {
            self.save_history_snapshot();

            self.groups.retain(|g| g.id != group_to_delete);
            return true; 
        }
        
        false
    }

    // --- STRICT INDEPENDENT GROUP DRAGGING ---
    pub fn begin_group_drag(&mut self, click_x: f64, click_y: f64) -> u32 {
        if self.mode != WorkspaceMode::Design { return 0; }
        let world_x = click_x - self.pan_offset_x;
        let world_y = click_y - self.pan_offset_y;

        let mut hit_group_id = 0;
        
        for group in self.groups.iter().rev() {
            if world_x >= group.x && world_x <= (group.x + group.width) &&
               world_y >= group.y && world_y <= (group.y + group.height) {
                hit_group_id = group.id;
                break;
            }
        }

        if hit_group_id > 0 {
            self.save_history_snapshot();

            self.is_dragging_group_entity = true;
            self.dragged_group_id = hit_group_id;
            
            for n in self.nodes.iter_mut() { n.is_active = false; }
            for a in self.arrows.iter_mut() { a.is_active = false; }
            for t in self.texts.iter_mut() { t.is_active = false; }
            
            self.group_drag_initial_nodes.clear();

            let mut group_x = 0.0;
            let mut group_y = 0.0;
            let mut group_w = 0.0;
            let mut group_h = 0.0;

            for g in self.groups.iter_mut() { 
                g.is_active = g.id == hit_group_id; 
                if g.id == hit_group_id {
                    self.drag_start_group_x = g.x;
                    self.drag_start_group_y = g.y;
                    self.drag_start_mouse_x = world_x;
                    self.drag_start_mouse_y = world_y;
                    group_x = g.x;
                    group_y = g.y;
                    group_w = g.width;
                    group_h = g.height;
                }
            }

            for node in &self.nodes {
                let cx = node.x + (node.width / 2.0);
                let cy = node.y + (node.height / 2.0);
                if cx >= group_x && cx <= (group_x + group_w) &&
                   cy >= group_y && cy <= (group_y + group_h) {
                    self.group_drag_initial_nodes.push((node.id, node.x, node.y)); 
                }
            }
            
            return hit_group_id;
        }

        0
    }

    pub fn update_group_drag(&mut self, mouse_x: f64, mouse_y: f64) {
        if !self.is_dragging_group_entity || self.mode != WorkspaceMode::Design { return; }

        let world_x = mouse_x - self.pan_offset_x;
        let world_y = mouse_y - self.pan_offset_y;

        let delta_x = world_x - self.drag_start_mouse_x;
        let delta_y = world_y - self.drag_start_mouse_y;

        let new_x = self.drag_start_group_x + delta_x;
        let new_y = self.drag_start_group_y + delta_y;

        if let Some(group) = self.groups.iter_mut().find(|g| g.id == self.dragged_group_id) {
            group.x = new_x;
            group.y = new_y;
        }

        let initial_nodes = self.group_drag_initial_nodes.clone();
        for (node_id, start_x, start_y) in initial_nodes {
            if let Some(node) = self.nodes.iter_mut().find(|n| n.id == node_id) {
                node.x = start_x + delta_x;
                node.y = start_y + delta_y;
            }
        }
    }

    pub fn end_group_drag(&mut self) {
        self.is_dragging_group_entity = false;
        self.dragged_group_id = 0;
        self.group_drag_initial_nodes.clear();
    }

    // --- HOVER PIPELINE MATHEMATICS ---

    pub fn update_hover_cursor(&mut self, cursor_x: f64, cursor_y: f64) {
        let world_x = cursor_x - self.pan_offset_x;
        let world_y = cursor_y - self.pan_offset_y;

        self.hovered_anchor_node_id = 0;
        self.hovered_anchor_pos = AnchorPosition::Center;

        for node in self.nodes.iter().rev() {
            if world_x >= node.x - 10.0 && world_x <= (node.x + node.width + 10.0) &&
               world_y >= node.y - 10.0 && world_y <= (node.y + node.height + 10.0) {
                
                self.hovered_anchor_node_id = node.id;
                let (ax, ay, apos) = get_closest_anchor(node.x, node.y, node.width, node.height, world_x, world_y);
                self.hovered_anchor_x = ax;
                self.hovered_anchor_y = ay;
                self.hovered_anchor_pos = apos;
                break;
            }
        }
    }

    // --- ARROW DRAWING & SNAPPING METHODS ---

    pub fn begin_connection(&mut self, click_x: f64, click_y: f64) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }
        self.update_hover_cursor(click_x, click_y);
        self.is_drawing_arrow = true;
        
        if self.hovered_anchor_node_id > 0 {
            self.drawing_start_x = self.hovered_anchor_x;
            self.drawing_start_y = self.hovered_anchor_y;
            self.drawing_source_node_id = self.hovered_anchor_node_id;
            self.drawing_start_anchor = self.hovered_anchor_pos; 
        } else {
            self.drawing_start_x = click_x - self.pan_offset_x;
            self.drawing_start_y = click_y - self.pan_offset_y;
            self.drawing_source_node_id = 0;
            self.drawing_start_anchor = AnchorPosition::Center;
        }
        
        self.drawing_end_x = self.drawing_start_x;
        self.drawing_end_y = self.drawing_start_y;
        true
    }

    pub fn update_connection_cursor(&mut self, cursor_x: f64, cursor_y: f64) {
        if self.is_drawing_arrow {
            self.update_hover_cursor(cursor_x, cursor_y);

            if self.hovered_anchor_node_id > 0 {
                self.drawing_end_x = self.hovered_anchor_x;
                self.drawing_end_y = self.hovered_anchor_y;
            } else {
                self.drawing_end_x = cursor_x - self.pan_offset_x;
                self.drawing_end_y = cursor_y - self.pan_offset_y;
            }
        }
    }

    pub fn complete_connection(&mut self, drop_x: f64, drop_y: f64) -> bool {
        if !self.is_drawing_arrow { return false; }
        
        self.update_hover_cursor(drop_x, drop_y);

        let final_end_x = if self.hovered_anchor_node_id > 0 { self.hovered_anchor_x } else { drop_x - self.pan_offset_x };
        let final_end_y = if self.hovered_anchor_node_id > 0 { self.hovered_anchor_y } else { drop_y - self.pan_offset_y };
        let final_target_id = self.hovered_anchor_node_id;
        
        let final_end_anchor = if self.hovered_anchor_node_id > 0 { self.hovered_anchor_pos } else { AnchorPosition::Center };

        let dx = final_end_x - self.drawing_start_x;
        let dy = final_end_y - self.drawing_start_y;
        let distance = (dx * dx + dy * dy).sqrt();

        if self.drawing_source_node_id > 0 && final_target_id > 0 {
            if self.drawing_source_node_id == final_target_id {
                self.cancel_connection();
                return false;
            }
            if self.arrows.iter().any(|a| a.start_node_id == self.drawing_source_node_id && a.end_node_id == final_target_id) {
                self.cancel_connection();
                return false;
            }
        }

        if distance > 10.0 || (self.drawing_source_node_id > 0 && final_target_id > 0 && self.drawing_source_node_id != final_target_id) {
            self.save_history_snapshot();

            self.arrows.push(QaArrow {
                id: self.next_arrow_id,
                start_x: self.drawing_start_x,
                start_y: self.drawing_start_y,
                end_x: final_end_x,
                end_y: final_end_y,
                start_node_id: self.drawing_source_node_id, 
                end_node_id: final_target_id,
                start_anchor: self.drawing_start_anchor, 
                end_anchor: final_end_anchor,            
                is_active: false,
            });
            self.next_arrow_id += 1;
            self.cancel_connection();
            return true;
        }

        self.cancel_connection();
        false
    }

    pub fn cancel_connection(&mut self) {
        self.is_drawing_arrow = false;
        self.drawing_source_node_id = 0;
    }

    // --- SECURE SELECTION & HIT DETECTION ---

    pub fn begin_node_drag(&mut self, click_x: f64, click_y: f64) -> u32 {
        if self.mode != WorkspaceMode::Design { return 0; }
        
        self.hovered_anchor_node_id = 0;
        self.hovered_anchor_x = 0.0;
        self.hovered_anchor_y = 0.0;
        self.hovered_anchor_pos = AnchorPosition::Center;

        let world_x = click_x - self.pan_offset_x;
        let world_y = click_y - self.pan_offset_y;

        // STRICT MICRO STEP: Decouple hit detection from mutation to satisfy Borrow Checker
        let mut hit_node_id = 0;
        let mut hit_node_cx = 0.0;
        let mut hit_node_cy = 0.0;
        let mut hit_node_x = 0.0;
        let mut hit_node_y = 0.0;

        for node in self.nodes.iter().rev() {
            if world_x >= node.x && world_x <= (node.x + node.width) &&
               world_y >= node.y && world_y <= (node.y + node.height) {
                hit_node_id = node.id;
                hit_node_cx = node.x + (node.width / 2.0);
                hit_node_cy = node.y + (node.height / 2.0);
                hit_node_x = node.x;
                hit_node_y = node.y;
                break;
            }
        }

        if hit_node_id > 0 {
            let mut parent_group_id = 0;
            for group in self.groups.iter().rev() {
                if hit_node_cx >= group.x && hit_node_cx <= (group.x + group.width) &&
                   hit_node_cy >= group.y && hit_node_cy <= (group.y + group.height) {
                    parent_group_id = group.id;
                    break;
                }
            }

            if parent_group_id > 0 {
                // Now we securely trigger the snapshot without borrowing conflicts
                self.save_history_snapshot();

                self.is_dragging_group_entity = true;
                self.dragged_group_id = parent_group_id;
                self.group_drag_initial_nodes.clear();

                let mut group_x = 0.0;
                let mut group_y = 0.0;
                let mut group_w = 0.0;
                let mut group_h = 0.0;

                for n in self.nodes.iter_mut() { n.is_active = n.id == hit_node_id; }
                for a in self.arrows.iter_mut() { a.is_active = false; }
                for g in self.groups.iter_mut() { 
                    g.is_active = g.id == parent_group_id;
                    if g.id == parent_group_id {
                        self.drag_start_group_x = g.x;
                        self.drag_start_group_y = g.y;
                        self.drag_start_mouse_x = world_x;
                        self.drag_start_mouse_y = world_y;
                        group_x = g.x;
                        group_y = g.y;
                        group_w = g.width;
                        group_h = g.height;
                    }
                }
                for t in self.texts.iter_mut() { t.is_active = false; } 

                for n in &self.nodes {
                    let n_cx = n.x + (n.width / 2.0);
                    let n_cy = n.y + (n.height / 2.0);
                    if n_cx >= group_x && n_cx <= (group_x + group_w) &&
                       n_cy >= group_y && n_cy <= (group_y + group_h) {
                        self.group_drag_initial_nodes.push((n.id, n.x, n.y)); 
                    }
                }

                return hit_node_id;
            } else {
                self.save_history_snapshot();

                self.is_dragging_node = true;
                self.dragged_node_id = hit_node_id;
                self.drag_start_node_x = hit_node_x;
                self.drag_start_node_y = hit_node_y;
                self.drag_start_mouse_x = world_x;
                self.drag_start_mouse_y = world_y;
                
                for n in self.nodes.iter_mut() { n.is_active = n.id == hit_node_id; }
                for a in self.arrows.iter_mut() { a.is_active = false; }
                for g in self.groups.iter_mut() { g.is_active = false; }
                for t in self.texts.iter_mut() { t.is_active = false; } 
                
                return hit_node_id;
            }
        }
        
        let mut hit_arrow_id = 0;
        for arrow in self.arrows.iter().rev() {
            let (_, path) = self.get_arrow_routing_points(arrow);
            let dist = dist_to_path(world_x, world_y, &path);
            if dist < 8.0 {
                hit_arrow_id = arrow.id;
                break;
            }
        }

        if hit_arrow_id > 0 {
            for n in self.nodes.iter_mut() { n.is_active = false; }
            for a in self.arrows.iter_mut() { a.is_active = a.id == hit_arrow_id; }
            for g in self.groups.iter_mut() { g.is_active = false; }
            for t in self.texts.iter_mut() { t.is_active = false; } 
            return 0; 
        }

        for n in self.nodes.iter_mut() { n.is_active = false; }
        for a in self.arrows.iter_mut() { a.is_active = false; }
        for g in self.groups.iter_mut() { g.is_active = false; }
        for t in self.texts.iter_mut() { t.is_active = false; } 
        0
    }

    pub fn update_node_drag(&mut self, mouse_x: f64, mouse_y: f64) {
        if !self.is_dragging_node || self.mode != WorkspaceMode::Design { return; }

        let world_x = mouse_x - self.pan_offset_x;
        let world_y = mouse_y - self.pan_offset_y;

        let delta_x = world_x - self.drag_start_mouse_x;
        let delta_y = world_y - self.drag_start_mouse_y;

        let mut new_x = self.drag_start_node_x + delta_x;
        let mut new_y = self.drag_start_node_y + delta_y;

        self.snap_line_x = None;
        self.snap_line_y = None;

        let snap_threshold = 8.0;
        let mut dragged_width = 320.0;
        let mut dragged_height = 160.0;

        if let Some(n) = self.nodes.iter().find(|n| n.id == self.dragged_node_id) {
            dragged_width = n.width;
            dragged_height = n.height;
        }

        for node in self.nodes.iter() {
            if node.id == self.dragged_node_id { continue; }

            if (new_y - node.y).abs() < snap_threshold {
                new_y = node.y;
                self.snap_line_y = Some(node.y);
            } else if ((new_y + dragged_height) - (node.y + node.height)).abs() < snap_threshold {
                new_y = node.y + node.height - dragged_height;
                self.snap_line_y = Some(node.y + node.height);
            } else if ((new_y + dragged_height / 2.0) - (node.y + node.height / 2.0)).abs() < snap_threshold {
                new_y = node.y + node.height / 2.0 - dragged_height / 2.0;
                self.snap_line_y = Some(node.y + node.height / 2.0);
            }

            if (new_x - node.x).abs() < snap_threshold {
                new_x = node.x;
                self.snap_line_x = Some(node.x);
            } else if ((new_x + dragged_width) - (node.x + node.width)).abs() < snap_threshold {
                new_x = node.x + node.width - dragged_width;
                self.snap_line_x = Some(node.x + node.width);
            } else if ((new_x + dragged_width / 2.0) - (node.x + node.width / 2.0)).abs() < snap_threshold {
                new_x = node.x + node.width / 2.0 - dragged_width / 2.0;
                self.snap_line_x = Some(node.x + node.width / 2.0);
            }
        }

        if let Some(node) = self.nodes.iter_mut().find(|n| n.id == self.dragged_node_id) {
            node.x = new_x;
            node.y = new_y;
        }
    }

    pub fn end_node_drag(&mut self) {
        self.is_dragging_node = false;
        self.dragged_node_id = 0;
        self.snap_line_x = None;
        self.snap_line_y = None;
        self.hovered_anchor_node_id = 0;
        self.hovered_anchor_x = 0.0;
        self.hovered_anchor_y = 0.0;
        self.hovered_anchor_pos = AnchorPosition::Center;
    }

    // --- TEXT RESIZE HIT DETECTION & PHYSICS ---
    
    pub fn check_text_resize_handle(&self, click_x: f64, click_y: f64) -> u8 {
        if self.mode != WorkspaceMode::Design { return 0; }
        let world_x = click_x - self.pan_offset_x;
        let world_y = click_y - self.pan_offset_y;

        for text in self.texts.iter().rev() {
            if text.is_active {
                let cy = text.y + (text.height / 2.0);
                let left_x = text.x - 8.0;
                let right_x = text.x + text.width + 8.0;

                if world_x >= left_x - 10.0 && world_x <= left_x + 10.0 && world_y >= cy - 15.0 && world_y <= cy + 15.0 {
                    return 1; 
                }
                
                if world_x >= right_x - 10.0 && world_x <= right_x + 10.0 && world_y >= cy - 15.0 && world_y <= cy + 15.0 {
                    return 2; 
                }
            }
        }
        0
    }

    pub fn begin_text_resize(&mut self, click_x: f64, click_y: f64) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }
        let world_x = click_x - self.pan_offset_x;
        let world_y = click_y - self.pan_offset_y;

        // STRICT MICRO STEP: Decouple hit detection from mutation to satisfy Borrow Checker
        let mut hit_text_id = 0;
        let mut hit_edge = 0;
        let mut hit_text_x = 0.0;
        let mut hit_text_width = 0.0;

        for text in self.texts.iter().rev() {
            if text.is_active {
                let cy = text.y + (text.height / 2.0);
                let left_x = text.x - 8.0;
                let right_x = text.x + text.width + 8.0;
                
                if world_x >= left_x - 10.0 && world_x <= left_x + 10.0 && world_y >= cy - 15.0 && world_y <= cy + 15.0 { 
                    hit_edge = 1; 
                } else if world_x >= right_x - 10.0 && world_x <= right_x + 10.0 && world_y >= cy - 15.0 && world_y <= cy + 15.0 { 
                    hit_edge = 2; 
                }

                if hit_edge > 0 {
                    hit_text_id = text.id;
                    hit_text_x = text.x;
                    hit_text_width = text.width;
                    break;
                }
            }
        }

        if hit_edge > 0 {
            self.save_history_snapshot();

            self.is_resizing_text = true;
            self.resized_text_id = hit_text_id;
            self.resized_text_edge = hit_edge;
            self.resize_start_mouse_x = world_x;
            self.resize_start_text_x = hit_text_x;
            self.resize_start_text_width = hit_text_width;
            return true;
        }

        false
    }

    // STRICT MICRO STEP: Suppress unused variable warning for mouse_y
    pub fn update_text_resize(&mut self, mouse_x: f64, _mouse_y: f64) {
        if !self.is_resizing_text || self.mode != WorkspaceMode::Design { return; }
        
        let world_x = mouse_x - self.pan_offset_x;
        let delta_x = world_x - self.resize_start_mouse_x;

        if let Some(text) = self.texts.iter_mut().find(|t| t.id == self.resized_text_id) {
            if self.resized_text_edge == 1 {
                let mut new_width = self.resize_start_text_width - delta_x;
                let mut new_x = self.resize_start_text_x + delta_x;
                
                if new_width < 50.0 { 
                    new_x = self.resize_start_text_x + (self.resize_start_text_width - 50.0);
                    new_width = 50.0; 
                }
                text.x = new_x;
                text.width = new_width;
                
            } else if self.resized_text_edge == 2 {
                let mut new_width = self.resize_start_text_width + delta_x;
                if new_width < 50.0 { new_width = 50.0; }
                text.width = new_width;
            }
        }
    }

    pub fn end_text_resize(&mut self) {
        self.is_resizing_text = false;
        self.resized_text_id = 0;
        self.resized_text_edge = 0;
    }

    pub fn begin_text_drag(&mut self, click_x: f64, click_y: f64) -> u32 {
        if self.mode != WorkspaceMode::Design { return 0; }
        
        let world_x = click_x - self.pan_offset_x;
        let world_y = click_y - self.pan_offset_y;

        // STRICT MICRO STEP: Decouple hit detection from mutation to satisfy Borrow Checker
        let mut hit_text_id = 0;
        let mut hit_text_x = 0.0;
        let mut hit_text_y = 0.0;

        for text in self.texts.iter().rev() {
            if world_x >= text.x && world_x <= (text.x + text.width) &&
               world_y >= text.y && world_y <= (text.y + text.height) {
                hit_text_id = text.id;
                hit_text_x = text.x;
                hit_text_y = text.y;
                break;
            }
        }

        if hit_text_id > 0 {
            self.save_history_snapshot();

            self.is_dragging_text = true;
            self.dragged_text_id = hit_text_id;
            self.drag_start_text_x = hit_text_x;
            self.drag_start_text_y = hit_text_y;
            self.drag_start_mouse_x = world_x;
            self.drag_start_mouse_y = world_y;
            
            for n in self.nodes.iter_mut() { n.is_active = false; }
            for a in self.arrows.iter_mut() { a.is_active = false; }
            for g in self.groups.iter_mut() { g.is_active = false; }
            for t in self.texts.iter_mut() { t.is_active = t.id == hit_text_id; }
            
            return hit_text_id;
        }
        
        0
    }

    pub fn update_text_drag(&mut self, mouse_x: f64, mouse_y: f64) {
        if !self.is_dragging_text || self.mode != WorkspaceMode::Design { return; }

        let world_x = mouse_x - self.pan_offset_x;
        let world_y = mouse_y - self.pan_offset_y;

        let delta_x = world_x - self.drag_start_mouse_x;
        let delta_y = world_y - self.drag_start_mouse_y;

        if let Some(text) = self.texts.iter_mut().find(|t| t.id == self.dragged_text_id) {
            text.x = self.drag_start_text_x + delta_x;
            text.y = self.drag_start_text_y + delta_y;
        }
    }

    pub fn end_text_drag(&mut self) {
        self.is_dragging_text = false;
        self.dragged_text_id = 0;
    }

    pub fn delete_selected_entities(&mut self) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }
        
        let has_active = self.nodes.iter().any(|n| n.is_active) ||
                         self.arrows.iter().any(|a| a.is_active) ||
                         self.groups.iter().any(|g| g.is_active) ||
                         self.texts.iter().any(|t| t.is_active);

        if !has_active { return false; }

        self.save_history_snapshot();
        
        let mut mutated = false;
        
        let initial_nodes = self.nodes.len();
        self.nodes.retain(|n| !n.is_active);
        if self.nodes.len() < initial_nodes { mutated = true; }

        let initial_arrows = self.arrows.len();
        self.arrows.retain(|a| !a.is_active);
        
        let active_node_ids: Vec<u32> = self.nodes.iter().map(|n| n.id).collect();
        self.arrows.retain(|a| 
            (a.start_node_id == 0 || active_node_ids.contains(&a.start_node_id)) && 
            (a.end_node_id == 0 || active_node_ids.contains(&a.end_node_id))
        );
        
        if self.arrows.len() < initial_arrows { mutated = true; }

        let initial_groups = self.groups.len();
        self.groups.retain(|g| !g.is_active);
        if self.groups.len() < initial_groups { mutated = true; }
        
        let initial_texts = self.texts.len();
        self.texts.retain(|t| !t.is_active);
        if self.texts.len() < initial_texts { mutated = true; }
        
        self.is_dragging_node = false;
        self.dragged_node_id = 0;
        self.hovered_anchor_node_id = 0;
        self.hovered_anchor_pos = AnchorPosition::Center;
        
        self.is_dragging_group_entity = false;
        
        self.is_dragging_text = false;
        self.dragged_text_id = 0;
        
        self.is_resizing_text = false;
        self.resized_text_id = 0;

        mutated
    }

    // --- SECURE DATA & ID OVERRIDE METHODS ---

    pub fn get_node_title(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.title.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_description(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.description.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_steps(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.steps.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_expected_result(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.expected_result.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_references(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.references.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_priority(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.priority.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_visual_step(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.visual_step.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_defect_report(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.defect_report.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_defect_media(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.defect_media.clone())
            .unwrap_or_else(String::new)
    }

    pub fn get_node_assigned_to(&self, node_id: u32) -> String {
        self.nodes.iter()
            .find(|n| n.id == node_id)
            .map(|n| n.assigned_to.clone())
            .unwrap_or_else(String::new)
    }

    pub fn update_node_data(&mut self, node_id: u32, title: String, description: String, steps: String, expected_result: String, references: String, priority: String) {
        self.save_history_snapshot(); 
        for node in self.nodes.iter_mut() {
            if node.id == node_id {
                node.title = title;
                node.description = description;
                node.steps = steps;
                node.expected_result = expected_result;
                node.references = references;
                node.priority = priority;
                break;
            }
        }
    }

    pub fn update_node_defect_data(&mut self, node_id: u32, report: String, media: String, assigned_to: String) {
        self.save_history_snapshot(); 
        for node in self.nodes.iter_mut() {
            if node.id == node_id {
                node.defect_report = report;
                node.defect_media = media;
                node.assigned_to = assigned_to;
                break;
            }
        }
    }

    pub fn get_group_title(&self, group_id: u32) -> String {
        self.groups.iter()
            .find(|g| g.id == group_id)
            .map(|g| g.title.clone())
            .unwrap_or_else(String::new)
    }

    pub fn update_group_title(&mut self, group_id: u32, title: String) {
        self.save_history_snapshot(); 
        for group in self.groups.iter_mut() {
            if group.id == group_id {
                group.title = title;
                break;
            }
        }
    }

    pub fn get_text_content(&self, text_id: u32) -> String {
        self.texts.iter()
            .find(|t| t.id == text_id)
            .map(|t| t.content.clone())
            .unwrap_or_else(String::new)
    }

    pub fn update_text_content(&mut self, text_id: u32, content: String) {
        self.save_history_snapshot(); 
        for text in self.texts.iter_mut() {
            if text.id == text_id {
                text.content = content;
                break;
            }
        }
    }

    pub fn check_node_menu_click(&self, click_x: f64, click_y: f64) -> u32 {
        if self.mode != WorkspaceMode::Design { return 0; }
        let world_x = click_x - self.pan_offset_x;
        let world_y = click_y - self.pan_offset_y;

        for node in self.nodes.iter().rev() {
            if node.is_active {
                let menu_x = node.x + node.width - 32.0;
                let menu_y = node.y + 8.0;
                let menu_w = 24.0;
                let menu_h = 24.0;

                if world_x >= menu_x && world_x <= (menu_x + menu_w) &&
                   world_y >= menu_y && world_y <= (menu_y + menu_h) {
                    return node.id;
                }
            }
        }
        0
    }

    pub fn update_node_visual_step(&mut self, node_id: u32, new_step: String) -> bool {
        self.save_history_snapshot(); 
        let mut mutated = false;
        for node in self.nodes.iter_mut() {
            if node.id == node_id {
                node.visual_step = new_step;
                mutated = true;
                break;
            }
        }
        mutated
    }

    // --- SECURE CLIPBOARD OPERATIONS ---

    pub fn copy_to_clipboard(&mut self) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }

        self.clipboard_nodes.clear();
        self.clipboard_groups.clear();
        self.clipboard_arrows.clear();
        self.clipboard_texts.clear();

        let mut copied_anything = false;

        if let Some(active_group) = self.groups.iter().find(|g| g.is_active).cloned() {
            let gx = active_group.x;
            let gy = active_group.y;
            let gw = active_group.width;
            let gh = active_group.height;

            self.clipboard_groups.push(active_group);
            copied_anything = true;

            let mut copied_node_ids = Vec::new();

            for node in &self.nodes {
                let cx = node.x + (node.width / 2.0);
                let cy = node.y + (node.height / 2.0);
                if cx >= gx && cx <= (gx + gw) && cy >= gy && cy <= (gy + gh) {
                    self.clipboard_nodes.push(node.clone());
                    copied_node_ids.push(node.id);
                }
            }

            for text in &self.texts {
                let cx = text.x + (text.width / 2.0);
                let cy = text.y + (text.height / 2.0);
                if cx >= gx && cx <= (gx + gw) && cy >= gy && cy <= (gy + gh) {
                    self.clipboard_texts.push(text.clone());
                }
            }

            for arrow in &self.arrows {
                if copied_node_ids.contains(&arrow.start_node_id) && copied_node_ids.contains(&arrow.end_node_id) {
                    self.clipboard_arrows.push(arrow.clone());
                }
            }
        } else {
            let mut copied_node_ids = Vec::new();
            
            for node in &self.nodes {
                if node.is_active {
                    self.clipboard_nodes.push(node.clone());
                    copied_node_ids.push(node.id);
                    copied_anything = true;
                }
            }

            for text in &self.texts {
                if text.is_active {
                    self.clipboard_texts.push(text.clone());
                    copied_anything = true;
                }
            }
            
            for arrow in &self.arrows {
                if copied_node_ids.contains(&arrow.start_node_id) && copied_node_ids.contains(&arrow.end_node_id) {
                    self.clipboard_arrows.push(arrow.clone());
                }
            }
        }

        copied_anything
    }

    pub fn paste_from_clipboard(&mut self) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }
        
        if self.clipboard_nodes.is_empty() && self.clipboard_groups.is_empty() && self.clipboard_texts.is_empty() {
            return false;
        }

        self.save_history_snapshot();

        for n in self.nodes.iter_mut() { n.is_active = false; }
        for a in self.arrows.iter_mut() { a.is_active = false; }
        for g in self.groups.iter_mut() { g.is_active = false; }
        for t in self.texts.iter_mut() { t.is_active = false; }

        let pasting_group = !self.clipboard_groups.is_empty();
        
        let mut max_entity_height = 0.0;
        if pasting_group {
            for g in &self.clipboard_groups {
                if g.height > max_entity_height { max_entity_height = g.height; }
            }
        } else if !self.clipboard_nodes.is_empty() {
            for n in &self.clipboard_nodes {
                if n.height > max_entity_height { max_entity_height = n.height; }
            }
        }
        
        let offset_x = 40.0; 
        let offset_y = if max_entity_height > 0.0 { max_entity_height + 40.0 } else { 40.0 };
        
        let mut node_id_map = std::collections::HashMap::new();

        for cb_group in &self.clipboard_groups {
            let mut new_group = cb_group.clone();
            new_group.id = self.next_group_id;
            new_group.x += offset_x;
            new_group.y += offset_y;
            new_group.is_active = true;
            self.groups.push(new_group);
            self.next_group_id += 1;
        }

        for cb_node in &self.clipboard_nodes {
            let mut new_node = cb_node.clone();
            let old_id = cb_node.id;
            
            new_node.id = self.next_node_id;
            new_node.x += offset_x;
            new_node.y += offset_y;
            new_node.is_active = !pasting_group;
            
            node_id_map.insert(old_id, new_node.id);
            
            self.nodes.push(new_node);
            self.next_node_id += 1;
        }

        for cb_text in &self.clipboard_texts {
            let mut new_text = cb_text.clone();
            new_text.id = self.next_text_id;
            new_text.x += offset_x;
            new_text.y += offset_y;
            new_text.is_active = !pasting_group;
            self.texts.push(new_text);
            self.next_text_id += 1;
        }

        for cb_arrow in &self.clipboard_arrows {
            if let (Some(&new_start_id), Some(&new_end_id)) = (node_id_map.get(&cb_arrow.start_node_id), node_id_map.get(&cb_arrow.end_node_id)) {
                let mut new_arrow = cb_arrow.clone();
                new_arrow.id = self.next_arrow_id;
                new_arrow.start_x += offset_x;
                new_arrow.start_y += offset_y;
                new_arrow.end_x += offset_x;
                new_arrow.end_y += offset_y;
                new_arrow.start_node_id = new_start_id;
                new_arrow.end_node_id = new_end_id;
                new_arrow.is_active = false;
                self.arrows.push(new_arrow);
                self.next_arrow_id += 1;
            }
        }

        true
    }

    pub fn duplicate_selected(&mut self) -> bool {
        if self.copy_to_clipboard() {
            return self.paste_from_clipboard();
        }
        false
    }
}
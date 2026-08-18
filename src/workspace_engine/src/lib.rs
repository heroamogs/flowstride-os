pub mod models;
pub mod math;
pub mod render;
pub mod engine_render;
pub mod engine_interactions;
pub mod engine_telemetry;
pub mod engine_restore; 

use wasm_bindgen::prelude::*;

// Securely import the models
use crate::models::{AnchorPosition, ExecutionStatus, QaArrow, QaGroup, QaNode, QaText, WorkspaceMode};

// Securely import math strictly needed for the internal routing helper
use crate::math::calculate_orthogonal_routing;

#[wasm_bindgen]
pub fn get_engine_version() -> String {
    "Flowstride Native Engine v0.1.0".to_string()
}

// STRICT MICRO STEP: Lightweight memory structure for time travel
#[derive(Clone)]
pub(crate) struct HistorySnapshot {
    pub nodes: Vec<QaNode>,
    pub arrows: Vec<QaArrow>,
    pub groups: Vec<QaGroup>,
    pub texts: Vec<QaText>,
}

// The core stateful instance of our native engine
#[wasm_bindgen]
pub struct WorkspaceEngine {
    pub(crate) canvas_id: String,
    pub(crate) canvas_width: u32,
    pub(crate) canvas_height: u32,
    pub(crate) dpr: f64, 
    pub(crate) zoom: f64, 
    pub(crate) nodes: Vec<QaNode>, 
    pub(crate) arrows: Vec<QaArrow>,
    pub(crate) groups: Vec<QaGroup>, 
    pub(crate) texts: Vec<QaText>, 
    pub(crate) next_node_id: u32, 
    pub(crate) next_arrow_id: u32,
    pub(crate) next_group_id: u32,
    pub(crate) next_text_id: u32,  
    pub(crate) mode: WorkspaceMode, 
    pub(crate) pan_offset_x: f64,
    pub(crate) pan_offset_y: f64,
    
    // Live freehand & snapped connection drawing states
    pub(crate) is_drawing_arrow: bool,
    pub(crate) drawing_start_x: f64,
    pub(crate) drawing_start_y: f64,
    pub(crate) drawing_end_x: f64,
    pub(crate) drawing_end_y: f64,
    pub(crate) drawing_source_node_id: u32, 
    pub(crate) drawing_start_anchor: AnchorPosition, 

    // Secure Hover Pipeline States for Excalidraw style anchors
    pub(crate) hovered_anchor_node_id: u32,
    pub(crate) hovered_anchor_x: f64,
    pub(crate) hovered_anchor_y: f64,
    pub(crate) hovered_anchor_pos: AnchorPosition, 

    // Secure node dragging and mathematical alignment states
    pub(crate) is_dragging_node: bool,
    pub(crate) dragged_node_id: u32,
    pub(crate) drag_start_node_x: f64,
    pub(crate) drag_start_node_y: f64,
    pub(crate) drag_start_mouse_x: f64,
    pub(crate) drag_start_mouse_y: f64,
    pub(crate) snap_line_x: Option<f64>,
    pub(crate) snap_line_y: Option<f64>,

    // Secure Group Dragging States
    pub(crate) is_dragging_group_entity: bool,
    pub(crate) dragged_group_id: u32,
    pub(crate) drag_start_group_x: f64,
    pub(crate) drag_start_group_y: f64,
    pub(crate) group_drag_initial_nodes: Vec<(u32, f64, f64)>, 

    // Secure Group Drawing Coordinate tracking
    pub(crate) is_drawing_group: bool,
    pub(crate) drawing_group_start_x: f64,
    pub(crate) drawing_group_start_y: f64,
    pub(crate) drawing_group_current_x: f64,
    pub(crate) drawing_group_current_y: f64,

    // Secure Text Dragging States
    pub(crate) is_dragging_text: bool,
    pub(crate) dragged_text_id: u32,
    pub(crate) drag_start_text_x: f64,
    pub(crate) drag_start_text_y: f64,

    // Secure Text Resizing States
    pub(crate) is_resizing_text: bool,
    pub(crate) resized_text_id: u32,
    pub(crate) resized_text_edge: u8, 
    pub(crate) resize_start_mouse_x: f64,
    pub(crate) resize_start_text_x: f64,
    pub(crate) resize_start_text_width: f64,

    // Strict execution tracking
    pub(crate) current_execution_step_id: u32,

    // Secure isolated in memory clipboard
    pub(crate) clipboard_nodes: Vec<QaNode>,
    pub(crate) clipboard_groups: Vec<QaGroup>,
    pub(crate) clipboard_arrows: Vec<QaArrow>,
    pub(crate) clipboard_texts: Vec<QaText>,

    // STRICT MICRO STEP: Secure memory vaults for time travel
    pub(crate) undo_stack: Vec<HistorySnapshot>,
    pub(crate) redo_stack: Vec<HistorySnapshot>,
}

impl WorkspaceEngine {
    pub(crate) fn get_arrow_routing_points(&self, arrow: &QaArrow) -> (bool, Vec<(f64, f64)>) {
        if arrow.start_node_id > 0 || arrow.end_node_id > 0 {
            let (source_x, source_y, source_w, source_h) = if arrow.start_node_id > 0 {
                if let Some(s) = self.nodes.iter().find(|n| n.id == arrow.start_node_id) {
                    (s.x, s.y, s.width, s.height)
                } else { (arrow.start_x, arrow.start_y, 0.0, 0.0) }
            } else { (arrow.start_x, arrow.start_y, 0.0, 0.0) };

            let (target_x, target_y, target_w, target_h) = if arrow.end_node_id > 0 {
                if let Some(t) = self.nodes.iter().find(|n| n.id == arrow.end_node_id) {
                    (t.x, t.y, t.width, t.height)
                } else { (arrow.end_x, arrow.end_y, 0.0, 0.0) }
            } else { (arrow.end_x, arrow.end_y, 0.0, 0.0) };

            let path = calculate_orthogonal_routing(
                source_x, source_y, source_w, source_h, arrow.start_anchor,
                target_x, target_y, target_w, target_h, arrow.end_anchor
            );
            (true, path)
        } else {
            (false, vec![(arrow.start_x, arrow.start_y), (arrow.end_x, arrow.end_y)])
        }
    }

    // STRICT MICRO STEP: Internal helper to mathematically clone the state without crashing RAM
    pub(crate) fn save_history_snapshot(&mut self) {
        if self.mode != WorkspaceMode::Design { return; }
        
        // Strict capacity constraint: Prevent Out of Memory crashes by limiting history to 50 steps
        if self.undo_stack.len() >= 50 {
            self.undo_stack.remove(0);
        }
        
        self.undo_stack.push(HistorySnapshot {
            nodes: self.nodes.clone(),
            arrows: self.arrows.clone(),
            groups: self.groups.clone(),
            texts: self.texts.clone(),
        });
        
        // Mathematically, if a new action occurs, the alternate redo timeline is permanently destroyed
        self.redo_stack.clear();
    }
}

#[wasm_bindgen]
impl WorkspaceEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(canvas_id: String, width: u32, height: u32) -> WorkspaceEngine {
        WorkspaceEngine {
            canvas_id,
            canvas_width: width,
            canvas_height: height,
            dpr: 1.0, 
            zoom: 1.0, 
            nodes: Vec::new(),
            arrows: Vec::new(), 
            groups: Vec::new(),
            texts: Vec::new(),
            next_node_id: 1, 
            next_arrow_id: 1,
            next_group_id: 1,
            next_text_id: 1,
            mode: WorkspaceMode::Design, 
            pan_offset_x: 0.0,
            pan_offset_y: 0.0,
            
            is_drawing_arrow: false,
            drawing_start_x: 0.0,
            drawing_start_y: 0.0,
            drawing_end_x: 0.0,
            drawing_end_y: 0.0,
            drawing_source_node_id: 0,
            drawing_start_anchor: AnchorPosition::Center,
            
            hovered_anchor_node_id: 0,
            hovered_anchor_x: 0.0,
            hovered_anchor_y: 0.0,
            hovered_anchor_pos: AnchorPosition::Center,

            is_dragging_node: false,
            dragged_node_id: 0,
            drag_start_node_x: 0.0,
            drag_start_node_y: 0.0,
            drag_start_mouse_x: 0.0,
            drag_start_mouse_y: 0.0,
            snap_line_x: None,
            snap_line_y: None,

            is_dragging_group_entity: false,
            dragged_group_id: 0,
            drag_start_group_x: 0.0,
            drag_start_group_y: 0.0,
            group_drag_initial_nodes: Vec::new(),

            is_drawing_group: false,
            drawing_group_start_x: 0.0,
            drawing_group_start_y: 0.0,
            drawing_group_current_x: 0.0,
            drawing_group_current_y: 0.0,
            
            is_dragging_text: false,
            dragged_text_id: 0,
            drag_start_text_x: 0.0,
            drag_start_text_y: 0.0,

            is_resizing_text: false,
            resized_text_id: 0,
            resized_text_edge: 0,
            resize_start_mouse_x: 0.0,
            resize_start_text_x: 0.0,
            resize_start_text_width: 0.0,

            current_execution_step_id: 0,

            clipboard_nodes: Vec::new(),
            clipboard_groups: Vec::new(),
            clipboard_arrows: Vec::new(),
            clipboard_texts: Vec::new(),

            // Initialise empty memory vaults
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn get_dimensions(&self) -> String {
        format!("Engine bounds securely set to: {}x{} at {}x scale with {}x internal zoom", self.canvas_width, self.canvas_height, self.dpr, self.zoom)
    }

    pub fn update_dimensions(&mut self, width: u32, height: u32, dpr: f64, zoom: f64) {
        self.canvas_width = width;
        self.canvas_height = height;
        self.dpr = dpr;
        self.zoom = zoom;
    }

    pub fn set_mode(&mut self, new_mode: WorkspaceMode) {
        self.mode = new_mode;
        
        if new_mode == WorkspaceMode::Execution {
            for node in self.nodes.iter_mut() {
                node.execution_status = ExecutionStatus::Pending;
                node.is_active = false;
            }
            for text in self.texts.iter_mut() {
                text.is_active = false;
            }
            
            let mut target_x = 0.0;
            let mut target_y = 0.0;
            let mut found = false;

            if let Some(first_node) = self.nodes.iter_mut().min_by_key(|n| n.id) {
                first_node.execution_status = ExecutionStatus::Current;
                self.current_execution_step_id = first_node.id;
                
                target_x = first_node.x + (first_node.width / 2.0);
                target_y = first_node.y + (first_node.height / 2.0);
                found = true;
            } else {
                self.current_execution_step_id = 0;
            }

            if found {
                self.pan_offset_x = (self.canvas_width as f64 / self.zoom / 2.0) - target_x;
                self.pan_offset_y = (self.canvas_height as f64 / self.zoom / 2.0) - target_y;
            }

        } else {
            self.current_execution_step_id = 0;
        }
    }

    pub fn set_pan_offset(&mut self, x: f64, y: f64) {
        self.pan_offset_x = x;
        self.pan_offset_y = y;
    }

    pub fn get_pan_offset_x(&self) -> f64 {
        self.pan_offset_x
    }

    pub fn get_pan_offset_y(&self) -> f64 {
        self.pan_offset_y
    }

    pub fn recenter_view(&mut self) {
        let mut min_x = f64::MAX;
        let mut min_y = f64::MAX;
        let mut max_x = f64::MIN;
        let mut max_y = f64::MIN;
        let mut has_content = false;

        for node in &self.nodes {
            min_x = min_x.min(node.x);
            min_y = min_y.min(node.y);
            max_x = max_x.max(node.x + node.width);
            max_y = max_y.max(node.y + node.height);
            has_content = true;
        }

        for group in &self.groups {
            min_x = min_x.min(group.x);
            min_y = min_y.min(group.y);
            max_x = max_x.max(group.x + group.width);
            max_y = max_y.max(group.y + group.height);
            has_content = true;
        }

        for text in &self.texts {
            min_x = min_x.min(text.x);
            min_y = min_y.min(text.y);
            max_x = max_x.max(text.x + text.width);
            max_y = max_y.max(text.y + text.height);
            has_content = true;
        }

        let safe_zoom = if self.zoom <= 0.0 { 1.0 } else { self.zoom };

        if has_content {
            let content_center_x = (min_x + max_x) / 2.0;
            let content_center_y = (min_y + max_y) / 2.0;

            let viewport_center_x = (self.canvas_width as f64 / safe_zoom) / 2.0;
            let viewport_center_y = (self.canvas_height as f64 / safe_zoom) / 2.0;

            self.pan_offset_x = viewport_center_x - content_center_x;
            self.pan_offset_y = viewport_center_y - content_center_y;
        } else {
            self.pan_offset_x = 0.0;
            self.pan_offset_y = 0.0;
        }
    }

    pub fn add_node(&mut self, x: f64, y: f64, visual_step: String, title: String, description: String, is_active: bool) -> u32 {
        self.save_history_snapshot(); // Strictly capture state before mutation

        if is_active {
            for node in self.nodes.iter_mut() { node.is_active = false; }
            for arrow in self.arrows.iter_mut() { arrow.is_active = false; }
            for group in self.groups.iter_mut() { group.is_active = false; }
            for text in self.texts.iter_mut() { text.is_active = false; }
        }
        
        let new_internal_id = self.next_node_id;
        let node = QaNode::new(x, y, new_internal_id, visual_step, title, description, is_active);
        self.nodes.push(node);
        self.next_node_id += 1;
        
        new_internal_id
    }

    pub fn add_text(&mut self, x: f64, y: f64, content: String, is_active: bool) -> u32 {
        self.save_history_snapshot(); // Strictly capture state before mutation

        if is_active {
            for node in self.nodes.iter_mut() { node.is_active = false; }
            for arrow in self.arrows.iter_mut() { arrow.is_active = false; }
            for group in self.groups.iter_mut() { group.is_active = false; }
            for text in self.texts.iter_mut() { text.is_active = false; }
        }
        
        let new_internal_id = self.next_text_id;
        let text_entity = QaText::new(new_internal_id, x, y, content, is_active);
        self.texts.push(text_entity);
        self.next_text_id += 1;
        
        new_internal_id
    }

    pub fn evaluate_current_step(&mut self, status: ExecutionStatus) -> bool {
        if self.mode != WorkspaceMode::Execution || self.current_execution_step_id == 0 {
            return false;
        }

        if let Some(current_node) = self.nodes.iter_mut().find(|n| n.id == self.current_execution_step_id) {
            current_node.execution_status = status;
        }

        let next_node_id = self.arrows.iter()
            .find(|a| a.start_node_id == self.current_execution_step_id)
            .map(|a| a.end_node_id)
            .unwrap_or(0);

        if next_node_id > 0 {
            let mut target_x = 0.0;
            let mut target_y = 0.0;
            let mut found = false;

            if let Some(next_node) = self.nodes.iter_mut().find(|n| n.id == next_node_id) {
                next_node.execution_status = ExecutionStatus::Current;
                self.current_execution_step_id = next_node_id;
                
                target_x = next_node.x + (next_node.width / 2.0);
                target_y = next_node.y + (next_node.height / 2.0);
                found = true;
            }

            if found {
                self.pan_offset_x = (self.canvas_width as f64 / self.zoom / 2.0) - target_x;
                self.pan_offset_y = (self.canvas_height as f64 / self.zoom / 2.0) - target_y;
                return true;
            }
        }
        
        self.current_execution_step_id = 0;
        true
    }

    pub fn get_active_execution_hover_data(&self, world_x: f64, world_y: f64) -> String {
        if self.mode != WorkspaceMode::Execution || self.current_execution_step_id == 0 {
            return String::new();
        }

        if let Some(node) = self.nodes.iter().find(|n| n.id == self.current_execution_step_id) {
            if world_x >= node.x && world_x <= (node.x + node.width) &&
               world_y >= node.y && world_y <= (node.y + node.height) {
                
                if node.steps.trim().is_empty() {
                    return String::new();
                }

                let safe_steps = node.steps
                    .replace('\\', "\\\\")
                    .replace('"', "\\\"")
                    .replace('\n', "\\n")
                    .replace('\r', "");

                return format!(
                    r#"{{"id":{},"x":{},"y":{},"width":{},"height":{},"steps":"{}"}}"#,
                    node.id, node.x, node.y, node.width, node.height, safe_steps
                );
            }
        }
        
        String::new()
    }

    #[allow(deprecated)]
    pub fn render_diagnostic_grid(&mut self) -> Result<(), JsValue> {
        self.execute_render()
    }

    // STRICT MICRO STEP: Time Travel WebAssembly Interface
    pub fn trigger_undo(&mut self) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }
        
        if let Some(snapshot) = self.undo_stack.pop() {
            // Strictly preserve the active state into the redo timeline before stepping back
            self.redo_stack.push(HistorySnapshot {
                nodes: self.nodes.clone(),
                arrows: self.arrows.clone(),
                groups: self.groups.clone(),
                texts: self.texts.clone(),
            });
            
            // Mathematically overwrite the canvas arrays
            self.nodes = snapshot.nodes;
            self.arrows = snapshot.arrows;
            self.groups = snapshot.groups;
            self.texts = snapshot.texts;
            
            // Strictly sever any active drag states to prevent pointer crashes
            self.is_dragging_node = false;
            self.is_dragging_group_entity = false;
            self.is_dragging_text = false;
            self.is_resizing_text = false;
            self.is_drawing_arrow = false;
            self.is_drawing_group = false;
            
            return true;
        }
        false
    }

    pub fn trigger_redo(&mut self) -> bool {
        if self.mode != WorkspaceMode::Design { return false; }
        
        if let Some(snapshot) = self.redo_stack.pop() {
            // Strictly push the current state back to the undo timeline before stepping forward
            self.undo_stack.push(HistorySnapshot {
                nodes: self.nodes.clone(),
                arrows: self.arrows.clone(),
                groups: self.groups.clone(),
                texts: self.texts.clone(),
            });
            
            // Mathematically overwrite the canvas arrays
            self.nodes = snapshot.nodes;
            self.arrows = snapshot.arrows;
            self.groups = snapshot.groups;
            self.texts = snapshot.texts;
            
            // Strictly sever any active drag states to prevent pointer crashes
            self.is_dragging_node = false;
            self.is_dragging_group_entity = false;
            self.is_dragging_text = false;
            self.is_resizing_text = false;
            self.is_drawing_arrow = false;
            self.is_drawing_group = false;
            
            return true;
        }
        false
    }
}
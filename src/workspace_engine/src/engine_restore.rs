use wasm_bindgen::prelude::*;

use crate::WorkspaceEngine;
use crate::models::{AnchorPosition, ExecutionStatus, QaArrow, QaGroup, QaNode, QaText};

#[wasm_bindgen]
impl WorkspaceEngine {
    // STRICT MICRO STEP 4.2: Securely purge the canvas before loading a new template
    pub fn clear_canvas(&mut self) {
        self.nodes.clear();
        self.groups.clear();
        self.texts.clear();
        self.arrows.clear();
        
        // Mathematically reset ID trackers back to pristine state
        self.next_node_id = 1;
        self.next_group_id = 1;
        self.next_text_id = 1;
        self.next_arrow_id = 1;
        
        // Reset viewport pan strictly to zero
        self.pan_offset_x = 0.0;
        self.pan_offset_y = 0.0;
    }

    // STRICT MICRO STEP: The Mathematical String Packing Architecture
    // By compressing all 10 rich text strings into a single payload, we completely bypass 
    // the Wasm ABI stack spill limit, ensuring it never crashes again regardless of local Vite cache issues.
    pub fn restore_node_packed(&mut self, id: u32, x: f64, y: f64, width: f64, height: f64, packed_strings: String, is_active: bool) {
        let parts: Vec<&str> = packed_strings.split("|||FLOWSTRIDE|||").collect();
        
        let visual_step = parts.get(0).unwrap_or(&"").to_string();
        let title = parts.get(1).unwrap_or(&"").to_string();
        let description = parts.get(2).unwrap_or(&"").to_string();
        let steps = parts.get(3).unwrap_or(&"").to_string();
        let expected_result = parts.get(4).unwrap_or(&"").to_string();
        let references = parts.get(5).unwrap_or(&"").to_string();
        let defect_report = parts.get(6).unwrap_or(&"").to_string();
        let defect_media = parts.get(7).unwrap_or(&"").to_string();
        let assigned_to = parts.get(8).unwrap_or(&"").to_string();
        // STRICT MICRO STEP: Extracting the newly added priority slot
        let priority = parts.get(9).unwrap_or(&"").to_string();

        let node = QaNode {
            x, y, width, height, id,
            visual_step, title, description, steps, expected_result, references,
            priority,
            defect_report, defect_media, assigned_to,
            is_active,
            execution_status: ExecutionStatus::Pending,
        };
        self.nodes.push(node);
        
        // Mathematically guarantee future nodes do not cause ID collisions
        if id >= self.next_node_id {
            self.next_node_id = id + 1;
        }
    }

    // Secure injection setter for Groups
    pub fn restore_group(&mut self, id: u32, x: f64, y: f64, width: f64, height: f64, title: String, is_active: bool) {
        let group = QaGroup {
            id, x, y, width, height, title, is_active
        };
        self.groups.push(group);
        
        if id >= self.next_group_id {
            self.next_group_id = id + 1;
        }
    }

    // Secure injection setter for Texts
    pub fn restore_text(&mut self, id: u32, x: f64, y: f64, width: f64, height: f64, content: String, is_active: bool) {
        let text = QaText {
            id, x, y, width, height, content, is_active
        };
        self.texts.push(text);
        
        if id >= self.next_text_id {
            self.next_text_id = id + 1;
        }
    }

    // Secure injection setter for Connections using packed anchors to strictly prevent ABI spills
    pub fn restore_connection_packed(&mut self, id: u32, start_x: f64, start_y: f64, end_x: f64, end_y: f64, start_node_id: u32, end_node_id: u32, packed_anchors: String, is_active: bool) {
        let parts: Vec<&str> = packed_anchors.split("|||FLOWSTRIDE|||").collect();
        let start_anchor_str = parts.get(0).unwrap_or(&"Center");
        let end_anchor_str = parts.get(1).unwrap_or(&"Center");

        let start_anchor = match *start_anchor_str {
            "Top" => AnchorPosition::Top,
            "Right" => AnchorPosition::Right,
            "Bottom" => AnchorPosition::Bottom,
            "Left" => AnchorPosition::Left,
            _ => AnchorPosition::Center,
        };

        let end_anchor = match *end_anchor_str {
            "Top" => AnchorPosition::Top,
            "Right" => AnchorPosition::Right,
            "Bottom" => AnchorPosition::Bottom,
            "Left" => AnchorPosition::Left,
            _ => AnchorPosition::Center,
        };

        let arrow = QaArrow {
            id, start_x, start_y, end_x, end_y, start_node_id, end_node_id,
            start_anchor, end_anchor, is_active,
        };
        self.arrows.push(arrow);
        
        if id >= self.next_arrow_id {
            self.next_arrow_id = id + 1;
        }
    }
}
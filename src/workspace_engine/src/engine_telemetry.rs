use wasm_bindgen::prelude::*;

use crate::WorkspaceEngine;
use crate::models::{AnchorPosition, ExecutionStatus};

#[wasm_bindgen]
impl WorkspaceEngine {
    pub fn export_design_state(&self) -> String {
        let mut nodes_json = String::from("[");
        for (i, node) in self.nodes.iter().enumerate() {
            let safe_title = node.title.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            let safe_desc = node.description.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            let safe_visual = node.visual_step.replace('\\', "\\\\").replace('"', "\\\"");
            let safe_steps = node.steps.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            let safe_expected = node.expected_result.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            let safe_references = node.references.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            
            // STRICT MICRO STEP: Safely escape the new priority field for permanent vaulting
            let safe_priority = node.priority.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            
            let safe_defect_report = node.defect_report.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            let safe_defect_media = node.defect_media.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            let safe_assigned_to = node.assigned_to.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");

            nodes_json.push_str(&format!(
                r#"{{"id":{},"x":{},"y":{},"width":{},"height":{},"visual_step":"{}","title":"{}","description":"{}","steps":"{}","expected_result":"{}","references":"{}","priority":"{}","defect_report":"{}","defect_media":"{}","assigned_to":"{}","is_active":{}}}"#,
                node.id, node.x, node.y, node.width, node.height, safe_visual, safe_title, safe_desc, safe_steps, safe_expected, safe_references, safe_priority, safe_defect_report, safe_defect_media, safe_assigned_to, node.is_active
            ));
            if i < self.nodes.len() - 1 {
                nodes_json.push_str(",");
            }
        }
        nodes_json.push_str("]");

        let mut groups_json = String::from("[");
        for (i, group) in self.groups.iter().enumerate() {
            let safe_title = group.title.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            groups_json.push_str(&format!(
                r#"{{"id":{},"x":{},"y":{},"width":{},"height":{},"title":"{}","is_active":{}}}"#,
                group.id, group.x, group.y, group.width, group.height, safe_title, group.is_active
            ));
            if i < self.groups.len() - 1 {
                groups_json.push_str(",");
            }
        }
        groups_json.push_str("]");

        let mut texts_json = String::from("[");
        for (i, text) in self.texts.iter().enumerate() {
            let safe_content = text.content.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            texts_json.push_str(&format!(
                r#"{{"id":{},"x":{},"y":{},"width":{},"height":{},"content":"{}","is_active":{}}}"#,
                text.id, text.x, text.y, text.width, text.height, safe_content, text.is_active
            ));
            if i < self.texts.len() - 1 {
                texts_json.push_str(",");
            }
        }
        texts_json.push_str("]");

        let mut connections_json = String::from("[");
        for (i, arrow) in self.arrows.iter().enumerate() {
            let start_anchor_str = match arrow.start_anchor {
                AnchorPosition::Top => "Top",
                AnchorPosition::Right => "Right",
                AnchorPosition::Bottom => "Bottom",
                AnchorPosition::Left => "Left",
                AnchorPosition::Center => "Center",
            };
            
            let end_anchor_str = match arrow.end_anchor {
                AnchorPosition::Top => "Top",
                AnchorPosition::Right => "Right",
                AnchorPosition::Bottom => "Bottom",
                AnchorPosition::Left => "Left",
                AnchorPosition::Center => "Center",
            };

            connections_json.push_str(&format!(
                r#"{{"id":{},"start_x":{},"start_y":{},"end_x":{},"end_y":{},"start_node_id":{},"end_node_id":{},"start_anchor":"{}","end_anchor":"{}","is_active":{}}}"#,
                arrow.id, arrow.start_x, arrow.start_y, arrow.end_x, arrow.end_y, arrow.start_node_id, arrow.end_node_id, start_anchor_str, end_anchor_str, arrow.is_active
            ));
            if i < self.arrows.len() - 1 {
                connections_json.push_str(",");
            }
        }
        connections_json.push_str("]");

        format!(
            r#"{{"nodes":{},"groups":{},"texts":{},"connections":{}}}"#,
            nodes_json, groups_json, texts_json, connections_json
        )
    }

    pub fn get_execution_report(&self) -> String {
        let mut json = String::from("[");
        
        let mut sorted_nodes = self.nodes.clone();
        sorted_nodes.sort_by(|a, b| a.id.cmp(&b.id));

        for (i, node) in sorted_nodes.iter().enumerate() {
            let status_str = match node.execution_status {
                ExecutionStatus::Pending => "Pending",
                ExecutionStatus::Current => "Current",
                ExecutionStatus::Passed => "Passed",
                ExecutionStatus::Failed => "Failed",
                ExecutionStatus::Blocked => "Blocked",
                ExecutionStatus::Skipped => "Skipped",
            };

            let safe_title = node.title
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "");
                
            let safe_desc = node.description
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "");
                
            let safe_visual = node.visual_step
                .replace('\\', "\\\\")
                .replace('"', "\\\"");

            // STRICT MICRO STEP: Export the missing fields needed for the Cloud Table View
            let safe_steps = node.steps
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "");
                
            let safe_expected = node.expected_result
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "");
                
            let safe_priority = node.priority
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n")
                .replace('\r', "");

            let mut node_group_title = String::new();
            let cx = node.x + (node.width / 2.0);
            let cy = node.y + (node.height / 2.0);
            
            for group in self.groups.iter().rev() {
                if cx >= group.x && cx <= (group.x + group.width) &&
                   cy >= group.y && cy <= (group.y + group.height) {
                    node_group_title = group.title.clone();
                    break;
                }
            }
            
            let safe_group_title = node_group_title
                .replace('\\', "\\\\")
                .replace('"', "\\\"");

            let safe_defect_report = node.defect_report.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            let safe_defect_media = node.defect_media.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");
            let safe_assigned_to = node.assigned_to.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "");

            json.push_str(&format!(
                r#"{{"id":{},"visual_step":"{}","title":"{}","description":"{}","steps":"{}","expected_result":"{}","priority":"{}","status":"{}","group_title":"{}","defect_report":"{}","defect_media":"{}","assigned_to":"{}"}}"#,
                node.id, safe_visual, safe_title, safe_desc, safe_steps, safe_expected, safe_priority, status_str, safe_group_title, safe_defect_report, safe_defect_media, safe_assigned_to
            ));

            if i < sorted_nodes.len() - 1 {
                json.push_str(",");
            }
        }
        json.push_str("]");
        json
    }
}
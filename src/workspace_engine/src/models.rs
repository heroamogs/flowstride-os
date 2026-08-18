use wasm_bindgen::prelude::*;

// Strictly enforce the architectural states natively
#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq)]
pub enum WorkspaceMode {
    Design,
    Execution,
}

// Secure execution states for live testing flows
#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq)]
pub enum ExecutionStatus {
    Pending,
    Current,
    Passed,
    Failed,
    Blocked,
    Skipped,
}

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq)]
pub enum AnchorPosition {
    Top,
    Right,
    Bottom,
    Left,
    Center, 
}

// Physical Arrow entity, securely equipped with an active selection state and precise anchor memory
#[wasm_bindgen]
#[derive(Clone)]
pub struct QaArrow {
    pub id: u32,
    pub start_x: f64,
    pub start_y: f64,
    pub end_x: f64,
    pub end_y: f64,
    pub start_node_id: u32, 
    pub end_node_id: u32,
    pub start_anchor: AnchorPosition, 
    pub end_anchor: AnchorPosition,   
    pub is_active: bool,
}

// A strictly typed struct representing a complex QA node safely in Rust memory
#[wasm_bindgen]
#[derive(Clone)]
pub struct QaNode {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub id: u32, 
    pub(crate) visual_step: String, 
    pub(crate) title: String,       
    pub(crate) description: String, 
    pub(crate) steps: String,           
    pub(crate) expected_result: String, 
    pub(crate) references: String,
    // STRICT MICRO STEP: The native priority memory slot
    pub(crate) priority: String,
    // STRICT MICRO STEP: Native memory slots for Execution Defect Data
    pub(crate) defect_report: String,
    pub(crate) defect_media: String,
    pub(crate) assigned_to: String,
    pub is_active: bool,
    pub execution_status: ExecutionStatus,
}

#[wasm_bindgen]
impl QaNode {
    // Secure constructor for generating new complex nodes
    #[wasm_bindgen(constructor)]
    pub fn new(x: f64, y: f64, id: u32, visual_step: String, title: String, description: String, is_active: bool) -> QaNode {
        QaNode {
            x,
            y,
            width: 320.0,  
            height: 160.0, 
            id,
            visual_step,
            title,
            description,
            steps: String::new(),           
            expected_result: String::new(), 
            references: String::new(),
            priority: String::new(),
            defect_report: String::new(),
            defect_media: String::new(),
            assigned_to: String::new(),
            is_active,
            execution_status: ExecutionStatus::Pending,
        }
    }
}

// A strictly typed struct representing a modular QA test group in Wasm memory
#[wasm_bindgen]
#[derive(Clone)]
pub struct QaGroup {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub(crate) title: String, 
    pub is_active: bool,
}

// A strictly typed struct representing standalone text securely in Wasm memory
#[wasm_bindgen]
#[derive(Clone)]
pub struct QaText {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub(crate) content: String,
    pub is_active: bool,
}

#[wasm_bindgen]
impl QaText {
    // Secure constructor for generating new floating text entities
    #[wasm_bindgen(constructor)]
    pub fn new(id: u32, x: f64, y: f64, content: String, is_active: bool) -> QaText {
        QaText {
            id,
            x,
            y,
            width: 120.0,  
            height: 30.0,  
            content,
            is_active,
        }
    }
}
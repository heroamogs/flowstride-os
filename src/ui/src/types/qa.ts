export interface QATag {
  id: string;
  label: string;
  colour: "indigo" | "purple" | "red" | "emerald" | "slate";
}

export interface QARequirement {
  id: string;
  code: string;
  description: string;
}

export type QAStepPriority = "Low" | "Medium" | "High" | "Critical";

export interface QAStep {
  id: string;
  title: string;
  description: string;
  expectedResult: string;
  requirement?: QARequirement;
  referenceScreenshot?: string;
  priority: QAStepPriority;
  tags: QATag[];
  nextStepIds: string[];
  // Phase 14.1: Spatial Canvas Coordinates
  x: number;
  y: number;
}

export interface QAFlow {
  id: string;
  name: string;
  version: string;
  testPlan: string;
  environment: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  steps: QAStep[];
  // Phase 14.5: Flow-Scoped Overlays (Fixes Cross-Page Bleed)
  overlays: CanvasOverlay[];
}

// Phase 8.1 & 13.5: Canvas Overlay Interface with Strict Types
export interface CanvasOverlay {
  id: string;
  type: "text" | "note" | "image" | "divider" | "group";
  x: number;
  y: number;
  content: string;
  width?: number;
  height?: number;
}

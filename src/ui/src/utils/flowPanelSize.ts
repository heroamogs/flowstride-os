export const DEFAULT_FLOW_PANEL_WIDTH = 280;
export const MIN_FLOW_PANEL_WIDTH = 220;
export const MAX_FLOW_PANEL_WIDTH = 640;
const MIN_PREVIEW_WIDTH = 360;
const PANEL_BORDER_WIDTH = 1;

export function flowPanelBounds(containerWidth: number) {
  const available = Math.max(0, (Number.isFinite(containerWidth)
    ? containerWidth
    : DEFAULT_FLOW_PANEL_WIDTH + MIN_PREVIEW_WIDTH + PANEL_BORDER_WIDTH) - PANEL_BORDER_WIDTH);
  // On small windows, divide the available space instead of overflowing it.
  const previewMinimum = Math.min(MIN_PREVIEW_WIDTH, Math.floor(available * 0.6));
  const max = Math.min(MAX_FLOW_PANEL_WIDTH, Math.floor(available - previewMinimum));
  return { min: Math.min(MIN_FLOW_PANEL_WIDTH, max), max };
}

export function clampFlowPanelWidth(width: number, containerWidth: number) {
  const { min, max } = flowPanelBounds(containerWidth);
  const requested = Number.isFinite(width) ? Math.round(width) : DEFAULT_FLOW_PANEL_WIDTH;
  return Math.max(min, Math.min(max, requested));
}

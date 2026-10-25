/** Historical records carry their own name after the live selection is cleared. */
export function manualFlowTitle(
  isHistorical: boolean,
  selectedFlowName?: string,
  savedFlowName?: string,
): string {
  const hasName = (name: unknown): name is string =>
    typeof name === "string" && name.trim().length > 0;
  if (isHistorical) return hasName(savedFlowName) ? savedFlowName : "Historical Record";
  return hasName(selectedFlowName) ? selectedFlowName : "New Local Flow";
}

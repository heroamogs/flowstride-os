import { stepStatusPresentation } from "../../../reporting/step_status";

interface StatusEntry {
  status?: unknown;
}

interface ScenarioEntry extends StatusEntry {
  steps: readonly StatusEntry[];
}

/** Aggregate recorded outcomes for display; this never changes step execution. */
export function aggregateStepStatus(steps: readonly StatusEntry[]): string {
  if (steps.length === 0) return "pending";
  const statuses = steps.map(step => stepStatusPresentation(step.status).status);

  if (statuses.some(status => status === "failed" || status === "error")) return "failed";
  for (const status of ["interrupted", "cancelled", "blocked", "running", "pending", "not_tested", "unknown"]) {
    if (statuses.includes(status)) return status;
  }

  // A skipped optional command does not undo other commands' successful results.
  // A group with no successful commands remains skipped, rather than becoming green.
  return statuses.includes("passed") ? "passed" : "skipped";
}

/** File icons and counters use the same outcome, including scenario-level errors. */
export function aggregateFileStatus(scenarios: readonly ScenarioEntry[]): string {
  const scenarioStatuses = scenarios.map(scenario => stepStatusPresentation(scenario.status).status);
  const steps = scenarios.flatMap(scenario => scenario.steps);
  const status = aggregateStepStatus(steps);
  if (status === "failed" || scenarioStatuses.some(value => value === "failed" || value === "error")) return "failed";
  for (const value of ["interrupted", "cancelled", "blocked", "running"]) {
    if (scenarioStatuses.includes(value)) return value;
  }
  return status;
}

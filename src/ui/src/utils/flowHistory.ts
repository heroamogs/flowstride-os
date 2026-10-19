import type { TestScenario } from '../store';

// Step IDs repeat between files, so every history lookup must include its file.
export function flowStep(scenarios: TestScenario[], file: string, selection: string | null) {
  if (!file || !selection) return undefined;
  const separator = selection.lastIndexOf(':::');
  if (separator !== -1 && selection.slice(0, separator) !== file) return undefined;
  const id = separator === -1 ? selection : selection.slice(separator + 3);
  return scenarios.filter(scenario => scenario.fileName === file)
    .flatMap(scenario => scenario.steps).find(step => step.id === id);
}

export function lastCapturedStep(scenarios: TestScenario[], file: string) {
  const steps = scenarios.filter(scenario => scenario.fileName === file).flatMap(scenario => scenario.steps);
  return steps.findLast(step => !!step.screenshot);
}

interface HistoryState {
  testScenarios: TestScenario[];
  historicalStepIds: Record<string, string | null>;
  isRunning: boolean;
}
export function restoredStepId(state: HistoryState, file: string): string | null {
  const remembered = Object.hasOwn(state.historicalStepIds, file);
  const id = remembered ? state.historicalStepIds[file]
    : state.isRunning ? null : lastCapturedStep(state.testScenarios, file)?.id;
  return id && flowStep(state.testScenarios, file, id) ? `${file}:::${id}` : null;
}

export function logsForFile<T extends { fileName?: string }>(logs: T[], file: string): T[] {
  return file ? logs.filter(log => log.fileName === file) : logs;
}

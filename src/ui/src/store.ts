import { replayTemplateFromLog } from "../../security/manualReplay";
import { redactPayload, redactWorkerPayload } from "../../security/redaction";
import type { AssertionResult } from '../../reporting/assertion_result';
import { flowStep, restoredStepId } from './utils/flowHistory';
import { create } from "zustand";

export type LogType =
  | "ACTION"
  | "REST"
  | "GRAPHQL"
  | "ASSERT"
  | "CONSOLE"
  | "ERROR"
  | "FILE_HEADER";

export interface LogEvent {
  id: string;
  timestamp: string;
  type: LogType;
  status: "success" | "error" | "info" | "warning";
  summary: string;
  stepContext: string;
  details: any;
  fileName?: string;
}

export interface ReplayState {
  method: string;
  url: string;
  headers: string;
  body: string;
  response: any;
  status: number | null;
  isLoading: boolean;
  error: string | null;
  requestId: string | null;
}

export interface TestStep {
  id: string;
  type: string;
  description: string;
  command: string;
  commandLabel?: string;
  sourceLine?: number;
  error?: string | null;
  assertion?: AssertionResult | null;
  status: "running" | "pass" | "passed" | "success" | "failed" | "pending";
  screenshot?: string;
  profile?: string;
  attempt?: number;
  domSnapshot?: string;
  attemptHistory?: { attempt: number; status: string; screenshot?: string; domSnapshot?: string; profile?: string; error?: string | null; assertion?: AssertionResult | null }[];
}

export interface TestScenario {
  fileName: string;
  name: string;
  status: "running" | "pass" | "passed" | "success" | "failed" | "pending";
  steps: TestStep[];
}

interface AppState {
  browserInfo: Record<string, { engine: string; version: string; headless: boolean }>;
  setBrowserInfo: (fileName: string, info: { engine: string; version: string; headless: boolean }) => void;
  isRunning: boolean;
  runStatus: string;
  failFile: (fileName: string, error: string) => void;
  scenarioResult: (payload: any) => void;
  timer: number;
  completedSteps: string[];
  activeStepId: string | null;
  historicalStepIds: Record<string, string | null>;
  activeView: string;
  activeTestFile: string;
  activeHistoricalRunId: string | null;

  browserFrames: Record<string, string | null>;
  currentUrls: Record<string, string>;
  pageTitles: Record<string, string>;

  activeNetworkTab: "REST" | "GraphQL" | "Network" | "WS";
  selectedLogId: string | null;

  logs: LogEvent[];
  networkLogs: any[];
  assertions: any[];
  activeReplay: ReplayState | null;
  testScenarios: TestScenario[];

  startExecution: () => void;
  stopExecution: (status?: string) => void;
  incrementTimer: () => void;
  setActiveView: (view: string) => void;
  setNetworkTab: (tab: "REST" | "GraphQL" | "Network" | "WS") => void;
  setStepComplete: (stepId: string) => void;
  setActiveStepId: (stepId: string | null) => void;
  setSelectedLogId: (id: string | null) => void;
  addLog: (log: LogEvent) => void;

  setPageMetadata: (fileName: string, url: string, title: string) => void;
  setBrowserFrame: (fileName: string, base64: string | null) => void;
  setActiveTestFile: (fileName: string) => void;
  setActiveHistoricalRunId: (id: string | null) => void;

  startRun: (fileName: string, scenarioName: string) => void;
  addStep: (payload: any) => void;
  updateStepStatus: (
    id: string,
    status: string,
    screenshot?: string,
    fileName?: string,
    metadata?: { attempt?: number; profile?: string; domSnapshot?: string; assertion?: AssertionResult | null; error?: string | null; commandLabel?: string; sourceLine?: number },
  ) => void;
  addNetworkLog: (payload: any) => void;
  addAssertion: (payload: any) => void;
  setSession: (sessionName: string) => void;

  updateReplay: (field: keyof ReplayState, value: any) => void;
  setReplayResponse: (response: any, status: number | null, error?: string | null, requestId?: string) => void;
}

export const useFlowStore = create<AppState>((set) => ({
  browserInfo: {},
  setBrowserInfo: (fileName, info) => set((state) => ({ activeTestFile: state.activeTestFile || fileName, browserInfo: { ...state.browserInfo, [fileName]: info } })),
  isRunning: false,
  runStatus: "idle",
  failFile: (fileName, error) => set(state => ({activeTestFile:state.activeTestFile || fileName, runStatus:"failed", testScenarios:[...state.testScenarios.filter(s=>s.fileName!==fileName || s.name!=="File error"),{fileName,name:"File error",status:"failed",steps:[{id:"file-error",type:"ERROR",description:"File could not complete",command:"parse / execution",status:"failed",error}]}]})),
  scenarioResult: payload => set(state => ({testScenarios:state.testScenarios.map(s=>s.fileName===payload.fileName && s.name===payload.scenario ? {...s,status:payload.status==='passed'?'pass':'failed'} : s)})),
  timer: 0,
  completedSteps: [],
  activeStepId: null,
  historicalStepIds: {},
  activeView: "Flows",
  activeTestFile: "",
  activeHistoricalRunId: null,
  browserFrames: {},
  currentUrls: {},
  pageTitles: {},
  activeNetworkTab: "REST",
  selectedLogId: null,
  logs: [],
  networkLogs: [],
  assertions: [],
  activeReplay: null,
  testScenarios: [],

  setActiveView: (view) => set({ activeView: view }),
  setNetworkTab: (tab) => set({ activeNetworkTab: tab }),
  setStepComplete: (id) =>
    set((state) => ({ completedSteps: [...state.completedSteps, id] })),
  setActiveStepId: (selection) => set((state) => {
    const separator = selection?.lastIndexOf(':::') ?? -1;
    const file = separator === -1 ? state.activeTestFile : selection!.slice(0, separator);
    const step = flowStep(state.testScenarios, file, selection);
    if (selection && !step) return state;
    const id = step?.id || null;
    return {
      activeTestFile: file,
      activeStepId: id ? `${file}:::${id}` : null,
      historicalStepIds: { ...state.historicalStepIds, [file]: id },
      ...(file !== state.activeTestFile ? { selectedLogId: null, activeReplay: null } : {}),
    };
  }),
  setActiveTestFile: (file) => set((state) => file === state.activeTestFile ? state : ({
    activeTestFile: file,
    activeStepId: restoredStepId(state, file),
    selectedLogId: null,
    activeReplay: null,
  })),
  setActiveHistoricalRunId: (id) => set({ activeHistoricalRunId: id }),

  setSelectedLogId: (id) =>
    set((state) => {
      const log = state.logs.find((l) => l.id === id);
      if (log && (log.type === "REST" || log.type === "GRAPHQL")) {
        const details = log.details || {};
        const original = replayTemplateFromLog(details);
        return {
          selectedLogId: id,
          activeReplay: {
            method: original?.method || details.method || 'GET',
            url: original?.url || details.url || '',
            headers: JSON.stringify(original?.headers || details.requestHeaders || {}, null, 2),
            body: original.body ?? '',
            response: null, status: null, error: null, requestId: null, isLoading: false,
          },
        };
      }
      return { selectedLogId: id, activeReplay: null };
    }),

  setPageMetadata: (fileName, url, title) =>
    set((state) => ({
      currentUrls: { ...state.currentUrls, [fileName]: url },
      pageTitles: { ...state.pageTitles, [fileName]: title },
    })),

  setBrowserFrame: (fileName, base64) =>
    set((state) => ({
      browserFrames: { ...state.browserFrames, [fileName]: base64 },
    })),

  incrementTimer: () => set((state) => ({ timer: state.timer + 1 })),

  startExecution: () =>
    set({
      isRunning: true,
      runStatus: "running",
      timer: 0,
      completedSteps: [],
      activeStepId: null,
      historicalStepIds: {},
      logs: [],
      networkLogs: [],
      assertions: [],
      testScenarios: [],
      browserFrames: {},
      browserInfo: {},
      currentUrls: {},
      pageTitles: {},
      selectedLogId: null,
      activeReplay: null,
      activeTestFile: "",
    }),

  stopExecution: (status) =>
    set((state) => {
      const finalizedScenarios = state.testScenarios.map((sc) => {
        const finalizedSteps = sc.steps.map((step) =>
          step.status === "running"
            ? { ...step, status: "failed" as const }
            : step,
        );
        let finalStatus = sc.status;
        if (sc.status === "running") {
          const hasFailed = finalizedSteps.some((s) => s.status === "failed");
          const allPassed = finalizedSteps.length > 0 && finalizedSteps.every((s) =>
            ["pass", "passed", "success"].includes(s.status),
          );
          finalStatus = hasFailed ? "failed" : allPassed ? "pass" : "failed";
        }
        return { ...sc, status: finalStatus, steps: finalizedSteps };
      });
      return {
        isRunning: false,
        runStatus: status === "aborted" || status === "interrupted" ? "interrupted" : status === "failed" || finalizedScenarios.some(s=>s.status==="failed") ? "failed" : status === "success" || finalizedScenarios.length > 0 ? "passed" : "incomplete",
        activeStepId: restoredStepId({ ...state, isRunning: false, testScenarios: finalizedScenarios }, state.activeTestFile),
        testScenarios: finalizedScenarios,
      };
    }),

  startRun: (fileName, scenarioName) =>
    set((state) => {
      const targetFile = fileName;
      if (!targetFile) return state;

      const normalizedScenario = scenarioName || "Default Scenario";
      const runningScenariosCount = state.testScenarios.filter(
        scenario => scenario.status === 'running' && scenario.fileName !== targetFile,
      ).length;
      const newActiveFile = state.activeTestFile === '' || runningScenariosCount === 0
        ? targetFile : state.activeTestFile;

      const existingIndex = state.testScenarios.findIndex(
        (s) => s.fileName === targetFile && s.name === normalizedScenario,
      );

      const updatedScenarios = [...state.testScenarios];

      if (existingIndex !== -1) {
        updatedScenarios[existingIndex] = {
          ...updatedScenarios[existingIndex],
          status: "running",
          steps: [],
        };
      } else {
        updatedScenarios.push({
          fileName: targetFile,
          name: normalizedScenario,
          status: "running",
          steps: [],
        });
      }

      return {
        activeTestFile: newActiveFile, testScenarios: updatedScenarios,
        ...(newActiveFile !== state.activeTestFile ? { activeStepId: null, selectedLogId: null, activeReplay: null } : {}),
      };
    }),

  addStep: (step) =>
    set((state) => {
      const targetFile = step.fileName;
      if (!targetFile) return state;

      let updatedScenarios = [...state.testScenarios];

      let targetIndex = -1;
      for (let i = updatedScenarios.length - 1; i >= 0; i--) {
        if (updatedScenarios[i].fileName === targetFile) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) {
        updatedScenarios.push({
          fileName: targetFile,
          name: "Scenario",
          status: "running",
          steps: [],
        });
        targetIndex = updatedScenarios.length - 1;
      }

      const targetScenario = updatedScenarios[targetIndex];

      const existingStepIndex = targetScenario.steps.findIndex(s => s.id === step.id);
      if (existingStepIndex !== -1) {
        const previous = targetScenario.steps[existingStepIndex];
        if ((step.attempt || 1) <= (previous.attempt || 1)) return state;
        const steps = [...targetScenario.steps];
        steps[existingStepIndex] = { ...previous, status:step.status || 'running', attempt:step.attempt,
          profile:step.profile || previous.profile, error:null, assertion:null, screenshot:undefined, domSnapshot:undefined };
        updatedScenarios[targetIndex] = {...targetScenario,status:'running',steps};
        return {testScenarios:updatedScenarios};
      }

      const newStep: TestStep = {
        id: step.id,
        type: step.type || "ACTION",
        description: step.description || "",
        command: step.command || "",
        status: step.status || "running",
        commandLabel:step.commandLabel, sourceLine:step.sourceLine, error:step.error, assertion:step.assertion,
        attempt:step.attempt, profile:step.profile,
      };

      updatedScenarios[targetIndex] = {
        ...targetScenario,
        steps: [...targetScenario.steps, newStep],
      };

      return { testScenarios: updatedScenarios };
    }),

  updateStepStatus: (id, status, screenshot, fileName, metadata) =>
    set((state) => {
      if (!fileName) return state;

      let updated = false;

      const updatedScenarios = state.testScenarios.map((scenario) => {
        if (scenario.fileName !== fileName) return scenario;

        const stepIndex = scenario.steps.findIndex((s) => s.id === id);
        if (stepIndex === -1) return scenario;

        updated = true;

        const updatedSteps = [...scenario.steps];
        const previous = updatedSteps[stepIndex];
        const attempt = metadata?.attempt || previous.attempt || 1;
        const history = [...(previous.attemptHistory || [])];
        const evidence = { attempt, status, screenshot, domSnapshot: metadata?.domSnapshot, profile: metadata?.profile, error:metadata?.error, assertion:metadata?.assertion };
        const historyIndex = history.findIndex(item => item.attempt === attempt);
        if (historyIndex === -1) history.push(evidence); else history[historyIndex] = { ...history[historyIndex], ...evidence, screenshot: screenshot || history[historyIndex].screenshot };
        updatedSteps[stepIndex] = {
          ...updatedSteps[stepIndex],
          status: (status as any) || "pending",
          screenshot: screenshot || (attempt === (previous.attempt || 1) ? previous.screenshot : undefined),
          attempt, profile: metadata?.profile || previous.profile,
          domSnapshot: metadata?.domSnapshot || (attempt === (previous.attempt || 1) ? previous.domSnapshot : undefined),
          error: metadata?.error !== undefined ? metadata.error : attempt === (previous.attempt || 1) ? previous.error : null,
          assertion: metadata?.assertion !== undefined ? metadata.assertion : attempt === (previous.attempt || 1) ? previous.assertion : null,
          commandLabel: metadata?.commandLabel || previous.commandLabel, sourceLine: metadata?.sourceLine || previous.sourceLine,
          attemptHistory: history,
        };

        const hasFailed = updatedSteps.some((s) => s.status === "failed");
        const allPassed = updatedSteps.every((s) =>
          ["pass", "passed", "success"].includes(s.status),
        );

        let newScenarioStatus = scenario.status;
        if (hasFailed) newScenarioStatus = "failed";
        else if (allPassed) newScenarioStatus = "pass";

        return {
          ...scenario,
          status: newScenarioStatus,
          steps: updatedSteps,
        };
      });

      if (!updated) return state;

      const isSuccess = ["pass", "passed", "success"].includes(status);

      return {
        testScenarios: updatedScenarios,
        completedSteps:
          isSuccess && !state.completedSteps.includes(id)
            ? [...state.completedSteps, id]
            : state.completedSteps,
      };
    }),

  addLog: (log: LogEvent) => {
    const safe = redactWorkerPayload('LOG_EVENT', log, [], true);
    set((state) => ({ logs: [...state.logs, { ...safe, summary: safe.summary || 'Log entry', status: safe.status || 'info' }] }));
  },

  addNetworkLog: (log) =>
    set((state) => ({ networkLogs: [log, ...state.networkLogs] })),
  addAssertion: (assertion) =>
    set((state) => ({ assertions: [...state.assertions, assertion] })),
  setSession: (name) => console.log("Session context updated:", name),
  updateReplay: (field, value) =>
    set((state) => ({
      activeReplay: state.activeReplay
        ? { ...state.activeReplay, [field]: value }
        : null,
    })),
  setReplayResponse: (response, status, error = null, requestId) =>
    set((state) => ({
      activeReplay: state.activeReplay && (!requestId || requestId === state.activeReplay.requestId)
        ? { ...state.activeReplay, response: redactPayload(response), status, error, isLoading: false }
        : state.activeReplay,
    })),
}));

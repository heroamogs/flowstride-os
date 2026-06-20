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
}

export interface TestStep {
  id: string;
  type: string;
  description: string;
  command: string;
  status: "running" | "pass" | "passed" | "success" | "failed" | "pending";
  screenshot?: string;
}

export interface TestScenario {
  fileName: string;
  name: string;
  status: "running" | "pass" | "passed" | "success" | "failed" | "pending";
  steps: TestStep[];
}

interface AppState {
  isRunning: boolean;
  timer: number;
  completedSteps: string[];
  activeStepId: string | null;
  activeView: string;
  activeTestFile: string;

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
  stopExecution: () => void;
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

  startRun: (fileName: string, scenarioName: string) => void;
  addStep: (payload: any) => void;
  updateStepStatus: (
    id: string,
    status: string,
    screenshot?: string,
    fileName?: string,
  ) => void;
  addNetworkLog: (payload: any) => void;
  addAssertion: (payload: any) => void;
  setSession: (sessionName: string) => void;

  updateReplay: (field: keyof ReplayState, value: any) => void;
  setReplayResponse: (response: any, status: number) => void;
}

export const useFlowStore = create<AppState>((set) => ({
  isRunning: false,
  timer: 0,
  completedSteps: [],
  activeStepId: null,
  activeView: "Flows",
  activeTestFile: "",
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
  setActiveStepId: (id) => set({ activeStepId: id }),
  setActiveTestFile: (fileName) => set({ activeTestFile: fileName }),

  setSelectedLogId: (id) =>
    set((state) => {
      const log = state.logs.find((l) => l.id === id);
      if (log && (log.type === "REST" || log.type === "GRAPHQL")) {
        const details = log.details || {};
        return {
          selectedLogId: id,
          activeReplay: {
            method: details.method || "GET",
            url: details.url || "",
            headers: details.requestHeaders
              ? JSON.stringify(details.requestHeaders, null, 2)
              : "{\n  \n}",
            body:
              typeof details.requestBody === "object"
                ? JSON.stringify(details.requestBody, null, 2)
                : details.requestBody || "",
            response: null,
            status: null,
            isLoading: false,
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
      timer: 0,
      completedSteps: [],
      activeStepId: null,
      logs: [],
      networkLogs: [],
      assertions: [],
      testScenarios: [],
      browserFrames: {},
      currentUrls: {},
      pageTitles: {},
      selectedLogId: null,
      activeReplay: null,
      activeTestFile: "",
    }),

  stopExecution: () =>
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
          const allPassed = finalizedSteps.every((s) =>
            ["pass", "passed", "success"].includes(s.status),
          );
          finalStatus = hasFailed ? "failed" : allPassed ? "pass" : "failed";
        }
        return { ...sc, status: finalStatus, steps: finalizedSteps };
      });
      return {
        isRunning: false,
        activeStepId: null,
        testScenarios: finalizedScenarios,
      };
    }),

  startRun: (fileName, scenarioName) =>
    set((state) => {
      const targetFile = fileName;
      if (!targetFile) return state;

      const normalizedScenario = scenarioName || "Default Scenario";
      const newActiveFile =
        state.activeTestFile === "" ? targetFile : state.activeTestFile;

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

      return { activeTestFile: newActiveFile, testScenarios: updatedScenarios };
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

      if (targetScenario.steps.some((s) => s.id === step.id)) return state;

      const newStep: TestStep = {
        id: step.id,
        type: step.type || "ACTION",
        description: step.description || "",
        command: step.command || "",
        status: step.status || "running",
      };

      updatedScenarios[targetIndex] = {
        ...targetScenario,
        steps: [...targetScenario.steps, newStep],
      };

      return { testScenarios: updatedScenarios };
    }),

  updateStepStatus: (id, status, screenshot, fileName) =>
    set((state) => {
      if (!fileName) return state;

      let updated = false;

      const updatedScenarios = state.testScenarios.map((scenario) => {
        if (scenario.fileName !== fileName) return scenario;

        const stepIndex = scenario.steps.findIndex((s) => s.id === id);
        if (stepIndex === -1) return scenario;

        updated = true;

        const updatedSteps = [...scenario.steps];
        updatedSteps[stepIndex] = {
          ...updatedSteps[stepIndex],
          status: (status as any) || "pending",
          screenshot: screenshot || updatedSteps[stepIndex].screenshot,
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

  addLog: (log: LogEvent) =>
    set((state) => ({
      logs: [
        ...state.logs,
        {
          ...log,
          summary: log.summary || "Log entry",
          status: log.status || "info",
        },
      ],
    })),

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
  setReplayResponse: (response, status) =>
    set((state) => ({
      activeReplay: state.activeReplay
        ? { ...state.activeReplay, response, status, isLoading: false }
        : null,
    })),
}));

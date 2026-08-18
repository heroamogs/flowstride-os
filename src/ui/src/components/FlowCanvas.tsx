import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { WorkspaceMode } from "workspace_engine";
import type { QAStep } from "../types/qa";
import type { FlowCanvasImperativeAPI } from "../views/WorkspaceView";

export interface ExecutionReportStep {
  id: number;
  title: string;
  description: string;
  status: string;
  group_title?: string;
  defect_report?: string;
  defect_media?: string;
  assigned_to?: string;
}

interface FlowCanvasProps {
  activeMode: WorkspaceMode;
  activeTool?: string;
  steps?: QAStep[];

  onNodeSelected?: (
    stepNumber: number | null,
    title: string,
    description: string,
    visualStep?: string,
    stepsContent?: string,
    expectedResult?: string,
    references?: string,
    priority?: string,
  ) => void;

  nodeUpdateTrigger?: {
    stepNumber: number;
    title: string;
    description: string;
    stepsContent: string;
    expectedResult: string;
    references: string;
    priority: string;
  } | null;

  defectUpdateTrigger?: {
    stepNumber: number;
    defectReport: string;
    defectMedia: string;
    assignedTo: string;
  } | null;

  onGroupSelected?: (groupId: number | null, title: string) => void;
  groupUpdateTrigger?: { groupId: number; title: string } | null;

  onTextSelected?: (textId: number | null, content: string) => void;
  textUpdateTrigger?: { textId: number; content: string } | null;

  onExecutionReportChange?: (report: ExecutionReportStep[]) => void;

  zoomLevel?: number;
  recenterTrigger?: number;
  onToolChange?: (tool: string) => void;
}

export const FlowCanvas = forwardRef<FlowCanvasImperativeAPI, FlowCanvasProps>(
  (
    {
      activeMode,
      activeTool,
      onNodeSelected,
      nodeUpdateTrigger,
      defectUpdateTrigger,
      onGroupSelected,
      groupUpdateTrigger,
      onTextSelected,
      textUpdateTrigger,
      onExecutionReportChange,
      zoomLevel,
      recenterTrigger,
      onToolChange,
    },
    ref,
  ) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [isCanvasReady, setIsCanvasReady] = useState(false);
    const pendingBlueprintQueueRef = useRef<any>(null);

    // Helper to safely access the isolated iframe API
    const getEngineAPI = () => {
      if (!iframeRef.current || !iframeRef.current.contentWindow) return null;
      return (
        (iframeRef.current.contentWindow as any).flowstrideEngineAPI || null
      );
    };

    useImperativeHandle(ref, () => ({
      exportDesignState: () => {
        const api = getEngineAPI();
        if (api) {
          try {
            return api.exportDesignState();
          } catch (error) {
            console.error(
              "[Flowstride Telemetry Error]: Failed to pull state from EngineFrame",
              error,
            );
            return { nodes: [], groups: [], texts: [], connections: [] };
          }
        }
        console.warn(
          "[Flowstride Telemetry]: Iframe engine missing. Cannot export state.",
        );
        return { nodes: [], groups: [], texts: [], connections: [] };
      },

      importDesignState: (parsedData: any) => {
        const api = getEngineAPI();
        if (api && isCanvasReady) {
          api.importDesignState(parsedData);
        } else {
          pendingBlueprintQueueRef.current = parsedData;
        }
      },
    }));

    // STRICT MICRO STEP: Secure postMessage Listener
    // Scrutinised Security: We physically verify the origin before processing any data
    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        const { type, payload } = event.data;
        if (!type) return;

        switch (type) {
          case "ENGINE_READY":
            setIsCanvasReady(true);
            const api = getEngineAPI();
            if (api && pendingBlueprintQueueRef.current) {
              api.importDesignState(pendingBlueprintQueueRef.current);
              pendingBlueprintQueueRef.current = null;
            }
            break;
          case "NODE_SELECTED":
            onNodeSelected?.(
              payload.id,
              payload.title,
              payload.description,
              payload.visualStep,
              payload.stepsContent,
              payload.expectedResult,
              payload.references,
              payload.priority,
            );
            break;
          case "GROUP_SELECTED":
            onGroupSelected?.(payload.id, payload.title);
            break;
          case "TEXT_SELECTED":
            onTextSelected?.(payload.id, payload.content);
            break;
          case "TOOL_CHANGED":
            onToolChange?.(payload);
            break;
          case "EXECUTION_REPORT_CHANGED":
            onExecutionReportChange?.(payload);
            break;
        }
      };

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [
      onNodeSelected,
      onGroupSelected,
      onTextSelected,
      onToolChange,
      onExecutionReportChange,
    ]);

    // Synchronise Prop Changes to the Isolated Engine
    useEffect(() => {
      if (isCanvasReady) {
        getEngineAPI()?.setMode(activeMode);
      }
    }, [activeMode, isCanvasReady]);

    useEffect(() => {
      if (isCanvasReady && activeTool) {
        getEngineAPI()?.setTool(activeTool);
      }
    }, [activeTool, isCanvasReady]);

    useEffect(() => {
      if (isCanvasReady && zoomLevel !== undefined) {
        getEngineAPI()?.setZoom(zoomLevel);
      }
    }, [zoomLevel, isCanvasReady]);

    useEffect(() => {
      if (
        isCanvasReady &&
        recenterTrigger !== undefined &&
        recenterTrigger > 0
      ) {
        getEngineAPI()?.recenterView();
      }
    }, [recenterTrigger, isCanvasReady]);

    useEffect(() => {
      if (isCanvasReady && nodeUpdateTrigger) {
        getEngineAPI()?.updateNodeData(
          nodeUpdateTrigger.stepNumber,
          nodeUpdateTrigger.title,
          nodeUpdateTrigger.description,
          nodeUpdateTrigger.stepsContent,
          nodeUpdateTrigger.expectedResult,
          nodeUpdateTrigger.references,
          nodeUpdateTrigger.priority,
        );
      }
    }, [nodeUpdateTrigger, isCanvasReady]);

    useEffect(() => {
      if (isCanvasReady && defectUpdateTrigger) {
        getEngineAPI()?.updateNodeDefectData(
          defectUpdateTrigger.stepNumber,
          defectUpdateTrigger.defectReport,
          defectUpdateTrigger.defectMedia,
          defectUpdateTrigger.assignedTo,
        );
      }
    }, [defectUpdateTrigger, isCanvasReady]);

    useEffect(() => {
      if (isCanvasReady && groupUpdateTrigger) {
        getEngineAPI()?.updateGroupTitle(
          groupUpdateTrigger.groupId,
          groupUpdateTrigger.title,
        );
      }
    }, [groupUpdateTrigger, isCanvasReady]);

    useEffect(() => {
      if (isCanvasReady && textUpdateTrigger) {
        getEngineAPI()?.updateTextContent(
          textUpdateTrigger.textId,
          textUpdateTrigger.content,
        );
      }
    }, [textUpdateTrigger, isCanvasReady]);

    return (
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8f9fa",
          overflow: "hidden",
          position: "relative",
          outline: "none",
        }}
        tabIndex={-1}
      >
        <style>{`
          .flowstride-spin-circle {
            animation: flowstride-spin-anim 0.8s linear infinite;
          }
          @keyframes flowstride-spin-anim {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>

        {!isCanvasReady && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(248, 249, 250, 1)",
            }}
          >
            <div
              className="flowstride-spin-circle"
              style={{
                width: "36px",
                height: "36px",
                border: "3px solid #e2e8f0",
                borderTopColor: "#4f46e5",
                borderRadius: "50%",
                marginBottom: "16px",
              }}
            ></div>
            <span
              style={{
                fontSize: "13px",
                fontWeight: "bold",
                color: "#475569",
                letterSpacing: "0.05em",
              }}
            >
              ALLOCATING ISOLATED ENGINE CORE...
            </span>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src="?frame=engine"
          title="Flowstride Isolated Workspace Engine"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            display: "block",
            backgroundColor: "#f8f9fa",
            opacity: isCanvasReady ? 1 : 0,
            transition: "opacity 0.2s ease-in-out",
          }}
        />
      </main>
    );
  },
);

FlowCanvas.displayName = "FlowCanvas";

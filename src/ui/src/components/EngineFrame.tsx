import { useRef, useEffect, useState } from "react";
import init, {
  WorkspaceEngine,
  WorkspaceMode,
  ExecutionStatus,
} from "workspace_engine";
import DOMPurify from "dompurify";

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

export default function EngineFrame() {
  const CANVAS_ID = "flowstride-isolated-engine-canvas";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<WorkspaceEngine | null>(null);

  const pendingBlueprintQueueRef = useRef<any>(null);
  const isExecutingInjectionRef = useRef(false);

  const [isWasmReady, setIsWasmReady] = useState(false);

  const [activeMode, setActiveMode] = useState<WorkspaceMode>(
    WorkspaceMode.Design,
  );
  const [activeTool, setActiveTool] = useState<string>("Hand");
  const [isPanning, setIsPanning] = useState(false);
  const [hoverCursor, setHoverCursor] = useState<"ew-resize" | null>(null);

  const activeModeRef = useRef<WorkspaceMode>(WorkspaceMode.Design);
  const activeToolRef = useRef<string>("Hand");
  const zoomLevelRef = useRef<number>(1.0);

  const nextStepIdRef = useRef<number>(1);

  const [stepOverrideState, setStepOverrideState] = useState<{
    nodeId: number;
    x: number;
    y: number;
    value: string;
  } | null>(null);

  const [executionTooltip, setExecutionTooltip] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    stepsHtml: string;
  } | null>(null);

  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const isDrawingArrowRef = useRef(false);
  const isDraggingNodeRef = useRef(false);
  const isDrawingGroupRef = useRef(false);
  const isDraggingGroupEntityRef = useRef(false);
  const isDraggingTextRef = useRef(false);
  const isResizingTextRef = useRef(false);

  const autoScrollRef = useRef<{ dx: number; dy: number; rafId: number }>({
    dx: 0,
    dy: 0,
    rafId: 0,
  });
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const postEvent = (type: string, payload?: any) => {
    window.parent.postMessage({ type, payload }, window.location.origin);
  };

  const executeBlueprintInjection = (parsedData: any) => {
    if (!engineRef.current || !document.getElementById(CANVAS_ID)) return;
    if (isExecutingInjectionRef.current) return;

    isExecutingInjectionRef.current = true;

    try {
      engineRef.current.clear_canvas();
      nextStepIdRef.current = 1;

      const nodes = Array.isArray(parsedData.nodes) ? parsedData.nodes : [];
      const groups = Array.isArray(parsedData.groups) ? parsedData.groups : [];
      const texts = Array.isArray(parsedData.texts) ? parsedData.texts : [];
      const connections = Array.isArray(parsedData.connections)
        ? parsedData.connections
        : [];

      nodes.forEach((node: any) => {
        const packedStrings = [
          node.visual_step || String(node.id),
          node.title || "",
          node.description || "",
          node.steps || "",
          node.expected_result || "",
          node.references || "",
          node.defect_report || "",
          node.defect_media || "",
          node.assigned_to || "",
          node.priority || "",
        ].join("|||FLOWSTRIDE|||");

        engineRef.current?.restore_node_packed(
          node.id,
          node.x,
          node.y,
          node.width,
          node.height,
          packedStrings,
          false,
        );

        const visualNum = parseInt(node.visual_step, 10);
        if (!isNaN(visualNum) && visualNum >= nextStepIdRef.current) {
          nextStepIdRef.current = visualNum + 1;
        }
      });

      groups.forEach((group: any) => {
        engineRef.current?.restore_group(
          group.id,
          group.x,
          group.y,
          group.width,
          group.height,
          group.title || "",
          false,
        );
      });

      texts.forEach((text: any) => {
        engineRef.current?.restore_text(
          text.id,
          text.x,
          text.y,
          text.width,
          text.height,
          text.content || "",
          false,
        );
      });

      connections.forEach((conn: any) => {
        const packedAnchors = [
          conn.start_anchor || "Center",
          conn.end_anchor || "Center",
        ].join("|||FLOWSTRIDE|||");

        engineRef.current?.restore_connection_packed(
          conn.id,
          conn.start_x,
          conn.start_y,
          conn.end_x,
          conn.end_y,
          conn.start_node_id || 0,
          conn.end_node_id || 0,
          packedAnchors,
          false,
        );
      });

      const totalEntities = nodes.length + groups.length + texts.length;

      if (totalEntities > 0) {
        engineRef.current.recenter_view();
        panOffsetRef.current.x = engineRef.current.get_pan_offset_x();
        panOffsetRef.current.y = engineRef.current.get_pan_offset_y();
      } else {
        engineRef.current.set_pan_offset(0, 0);
        panOffsetRef.current.x = 0;
        panOffsetRef.current.y = 0;
      }

      engineRef.current.render_diagnostic_grid();
      console.log(
        "[Flowstride Telemetry]: Blueprint securely restored to WebAssembly memory.",
      );
    } catch (error) {
      console.error(
        "[Flowstride Telemetry Error]: Failed to safely inject parsed state",
        error,
      );
    } finally {
      isExecutingInjectionRef.current = false;
    }
  };

  useEffect(() => {
    (window as any).flowstrideEngineAPI = {
      exportDesignState: () => {
        if (!engineRef.current || !document.getElementById(CANVAS_ID)) {
          console.warn(
            "[Flowstride Telemetry]: Wasm engine missing. Cannot export state.",
          );
          return { nodes: [], groups: [], texts: [], connections: [] };
        }
        try {
          return JSON.parse(engineRef.current.export_design_state());
        } catch (error) {
          console.error(
            "[Flowstride Telemetry Error]: Failed to parse state from Wasm",
            error,
          );
          throw error;
        }
      },
      importDesignState: (parsedData: any) => {
        if (!document.getElementById(CANVAS_ID)) {
          pendingBlueprintQueueRef.current = parsedData;
          return;
        }

        if (engineRef.current) {
          try {
            engineRef.current.free();
          } catch (e) {
            console.warn(
              "[Flowstride Telemetry]: Bypassing poisoned Wasm lock during Hard Reset.",
            );
          }
        }

        const canvasEl = document.getElementById(
          CANVAS_ID,
        ) as HTMLCanvasElement;
        const width = Math.max(1, canvasEl.clientWidth);
        const height = Math.max(1, canvasEl.clientHeight);

        engineRef.current = new WorkspaceEngine(CANVAS_ID, width, height);
        engineRef.current.set_mode(activeModeRef.current);

        const dpr = window.devicePixelRatio || 1.0;
        engineRef.current.update_dimensions(
          width,
          height,
          dpr,
          zoomLevelRef.current,
        );

        executeBlueprintInjection(parsedData);
      },
      setMode: (mode: WorkspaceMode) => {
        activeModeRef.current = mode;
        setActiveMode(mode);
        if (engineRef.current && document.getElementById(CANVAS_ID)) {
          engineRef.current.set_mode(mode);
          engineRef.current.render_diagnostic_grid();
          if (mode !== WorkspaceMode.Execution) {
            setExecutionTooltip(null);
          }
        }
      },
      setTool: (tool: string) => {
        activeToolRef.current = tool;
        setActiveTool(tool);
      },
      setZoom: (zoom: number) => {
        zoomLevelRef.current = zoom;
        if (engineRef.current && document.getElementById(CANVAS_ID)) {
          const canvasEl = document.getElementById(
            CANVAS_ID,
          ) as HTMLCanvasElement;
          const width = Math.max(1, canvasEl.clientWidth);
          const height = Math.max(1, canvasEl.clientHeight);
          const dpr = window.devicePixelRatio || 1.0;
          engineRef.current.update_dimensions(
            width,
            height,
            dpr,
            zoomLevelRef.current,
          );
          engineRef.current.render_diagnostic_grid();
        }
      },
      recenterView: () => {
        if (engineRef.current && document.getElementById(CANVAS_ID)) {
          try {
            const stateStr = engineRef.current.export_design_state();
            const state = JSON.parse(stateStr);
            const totalEntities =
              (state.nodes?.length || 0) +
              (state.groups?.length || 0) +
              (state.texts?.length || 0);

            if (totalEntities > 0) {
              engineRef.current.recenter_view();
              panOffsetRef.current.x = engineRef.current.get_pan_offset_x();
              panOffsetRef.current.y = engineRef.current.get_pan_offset_y();
            } else {
              engineRef.current.set_pan_offset(0, 0);
              panOffsetRef.current.x = 0;
              panOffsetRef.current.y = 0;
            }
            engineRef.current.render_diagnostic_grid();
          } catch (e) {
            console.error(
              "[Flowstride Telemetry Error]: Failed to structurally recenter view safely.",
              e,
            );
          }
        }
      },
      updateNodeData: (
        stepNumber: number,
        title: string,
        desc: string,
        steps: string,
        expected: string,
        refs: string,
        priority: string,
      ) => {
        if (engineRef.current && document.getElementById(CANVAS_ID)) {
          engineRef.current.update_node_data(
            stepNumber,
            title,
            desc,
            steps,
            expected,
            refs,
            priority,
          );
          engineRef.current.render_diagnostic_grid();
        }
      },
      updateNodeDefectData: (
        stepNumber: number,
        report: string,
        media: string,
        assignedTo: string,
      ) => {
        if (engineRef.current && document.getElementById(CANVAS_ID)) {
          engineRef.current.update_node_defect_data(
            stepNumber,
            report,
            media,
            assignedTo,
          );
          try {
            const reportStr = engineRef.current.get_execution_report();
            const parsedReport = JSON.parse(reportStr) as ExecutionReportStep[];
            postEvent("EXECUTION_REPORT_CHANGED", parsedReport);
          } catch (error) {
            console.error(
              "Security Alert: Failed to safely parse Wasm execution report after defect mutation",
              error,
            );
          }
        }
      },
      updateGroupTitle: (groupId: number, title: string) => {
        if (engineRef.current && document.getElementById(CANVAS_ID)) {
          engineRef.current.update_group_title(groupId, title);
          engineRef.current.render_diagnostic_grid();
        }
      },
      updateTextContent: (textId: number, content: string) => {
        if (engineRef.current && document.getElementById(CANVAS_ID)) {
          engineRef.current.update_text_content(textId, content);
          engineRef.current.render_diagnostic_grid();
        }
      },
    };

    return () => {
      delete (window as any).flowstrideEngineAPI;
      if (engineRef.current) {
        try {
          engineRef.current.free();
        } catch (e) {}
        engineRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const bootWebAssembly = async () => {
      try {
        await init();
        if (isMounted) {
          setIsWasmReady(true);
        }
      } catch (error) {
        console.error(
          "[Flowstride Telemetry Error]: Failed to allocate WebAssembly memory",
          error,
        );
      }
    };

    bootWebAssembly();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isWasmReady) return;

    let pollingRafId: number;
    let resizeObserver: ResizeObserver | null = null;

    const syncDimensions = () => {
      if (
        canvasRef.current &&
        engineRef.current &&
        document.getElementById(CANVAS_ID)
      ) {
        const width = Math.max(1, canvasRef.current.clientWidth);
        const height = Math.max(1, canvasRef.current.clientHeight);
        const dpr = window.devicePixelRatio || 1.0;

        engineRef.current.update_dimensions(
          width,
          height,
          dpr,
          zoomLevelRef.current,
        );
        engineRef.current.render_diagnostic_grid();
      }
    };

    const attemptMount = () => {
      const canvasEl = document.getElementById(
        CANVAS_ID,
      ) as HTMLCanvasElement | null;

      if (!canvasEl) {
        pollingRafId = requestAnimationFrame(attemptMount);
        return;
      }

      if (!engineRef.current) {
        const width = Math.max(1, canvasEl.clientWidth);
        const height = Math.max(1, canvasEl.clientHeight);

        engineRef.current = new WorkspaceEngine(CANVAS_ID, width, height);
        engineRef.current.set_mode(activeModeRef.current);
      }

      syncDimensions();

      if (pendingBlueprintQueueRef.current) {
        executeBlueprintInjection(pendingBlueprintQueueRef.current);
        pendingBlueprintQueueRef.current = null;
      } else if (engineRef.current) {
        engineRef.current.render_diagnostic_grid();
      }

      postEvent("ENGINE_READY");

      resizeObserver = new ResizeObserver(() => {
        syncDimensions();
      });
      resizeObserver.observe(canvasEl);

      window.addEventListener("resize", syncDimensions);
    };

    pollingRafId = requestAnimationFrame(attemptMount);

    return () => {
      cancelAnimationFrame(pollingRafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener("resize", syncDimensions);
    };
  }, [isWasmReady]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        (document.activeElement as HTMLElement)?.isContentEditable ||
        !document.getElementById(CANVAS_ID)
      ) {
        return;
      }

      if (activeModeRef.current === WorkspaceMode.Design) {
        const isModifierActive = e.metaKey || e.ctrlKey;
        const isShiftActive = e.shiftKey;
        const key = e.key.toLowerCase();

        // STRICT MICRO STEP: Time Travel Keyboard Interception (Undo/Redo)
        if (isModifierActive && key === "z") {
          e.preventDefault();
          if (engineRef.current) {
            if (isShiftActive) {
              const redone = engineRef.current.trigger_redo();
              if (redone) engineRef.current.render_diagnostic_grid();
            } else {
              const undone = engineRef.current.trigger_undo();
              if (undone) engineRef.current.render_diagnostic_grid();
            }
          }
          return;
        }

        if (isModifierActive && key === "y") {
          e.preventDefault();
          if (engineRef.current) {
            const redone = engineRef.current.trigger_redo();
            if (redone) engineRef.current.render_diagnostic_grid();
          }
          return;
        }

        if (isModifierActive && key === "c") {
          e.preventDefault();
          if (engineRef.current) {
            engineRef.current.copy_to_clipboard();
          }
          return;
        }

        if (isModifierActive && key === "v") {
          e.preventDefault();
          if (engineRef.current) {
            const pasted = engineRef.current.paste_from_clipboard();
            if (pasted) {
              engineRef.current.render_diagnostic_grid();
            }
          }
          return;
        }

        if (isModifierActive && key === "d") {
          e.preventDefault();
          if (engineRef.current) {
            const duplicated = engineRef.current.duplicate_selected();
            if (duplicated) {
              engineRef.current.render_diagnostic_grid();
            }
          }
          return;
        }

        if (e.key === "Backspace" || e.key === "Delete") {
          if (engineRef.current) {
            const mutated = engineRef.current.delete_selected_entities();
            if (mutated) {
              engineRef.current.render_diagnostic_grid();
              postEvent("NODE_SELECTED", {
                id: null,
                title: "",
                description: "",
              });
              postEvent("GROUP_SELECTED", { id: null, title: "" });
              postEvent("TEXT_SELECTED", { id: null, content: "" });
            }
          }
        }
      } else if (activeModeRef.current === WorkspaceMode.Execution) {
        if (["Enter", "Delete", "Backspace", "Tab", "Escape"].includes(e.key)) {
          e.preventDefault();

          if (engineRef.current) {
            let status;
            if (e.key === "Enter") status = ExecutionStatus.Passed;
            else if (e.key === "Delete" || e.key === "Backspace")
              status = ExecutionStatus.Failed;
            else if (e.key === "Tab") status = ExecutionStatus.Blocked;
            else if (e.key === "Escape") status = ExecutionStatus.Skipped;

            if (status !== undefined) {
              const moved = engineRef.current.evaluate_current_step(status);
              if (moved) {
                engineRef.current.render_diagnostic_grid();
                setExecutionTooltip(null);
              }

              try {
                const reportStr = engineRef.current.get_execution_report();
                const parsedReport = JSON.parse(
                  reportStr,
                ) as ExecutionReportStep[];
                postEvent("EXECUTION_REPORT_CHANGED", parsedReport);
              } catch (error) {
                console.error(
                  "Security Alert: Failed to safely parse Wasm report",
                  error,
                );
              }
            }
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!document.getElementById(CANVAS_ID)) return;

      const zoom = zoomLevelRef.current;
      panOffsetRef.current.x -= e.deltaX / zoom;
      panOffsetRef.current.y -= e.deltaY / zoom;

      if (engineRef.current) {
        engineRef.current.set_pan_offset(
          panOffsetRef.current.x,
          panOffsetRef.current.y,
        );
        engineRef.current.render_diagnostic_grid();
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const handleStepOverrideSubmit = (nodeId: number, newStepStr: string) => {
    if (
      newStepStr.trim() !== "" &&
      engineRef.current &&
      document.getElementById(CANVAS_ID)
    ) {
      const success = engineRef.current.update_node_visual_step(
        nodeId,
        newStepStr.trim(),
      );
      if (success) {
        engineRef.current.render_diagnostic_grid();
        const title = engineRef.current.get_node_title(nodeId);
        const desc = engineRef.current.get_node_description(nodeId);
        const visual = engineRef.current.get_node_visual_step(nodeId);
        const steps = engineRef.current.get_node_steps(nodeId);
        const expected = engineRef.current.get_node_expected_result(nodeId);
        const refs = engineRef.current.get_node_references(nodeId);
        const priority = engineRef.current.get_node_priority(nodeId);

        postEvent("NODE_SELECTED", {
          id: nodeId,
          title,
          description: desc,
          visualStep: visual,
          stepsContent: steps,
          expectedResult: expected,
          references: refs,
          priority,
        });

        const parsedNum = parseInt(newStepStr.trim(), 10);
        if (!isNaN(parsedNum)) {
          nextStepIdRef.current = parsedNum + 1;
        }
      }
    }
    setStepOverrideState(null);
  };

  const stopAutoScroll = () => {
    if (autoScrollRef.current.rafId) {
      cancelAnimationFrame(autoScrollRef.current.rafId);
      autoScrollRef.current.rafId = 0;
    }
    autoScrollRef.current.dx = 0;
    autoScrollRef.current.dy = 0;
  };

  const performAutoScroll = () => {
    if (
      !engineRef.current ||
      !document.getElementById(CANVAS_ID) ||
      (autoScrollRef.current.dx === 0 && autoScrollRef.current.dy === 0)
    ) {
      autoScrollRef.current.rafId = 0;
      return;
    }

    const zoom = zoomLevelRef.current;

    panOffsetRef.current.x -= autoScrollRef.current.dx / zoom;
    panOffsetRef.current.y -= autoScrollRef.current.dy / zoom;
    engineRef.current.set_pan_offset(
      panOffsetRef.current.x,
      panOffsetRef.current.y,
    );

    const worldScreenX = lastMousePosRef.current.x;
    const worldScreenY = lastMousePosRef.current.y;

    if (isDrawingGroupRef.current) {
      engineRef.current.update_group_draw(worldScreenX, worldScreenY);
    } else if (isDrawingArrowRef.current) {
      engineRef.current.update_connection_cursor(worldScreenX, worldScreenY);
    } else if (isDraggingNodeRef.current) {
      engineRef.current.update_node_drag(worldScreenX, worldScreenY);
    } else if (isDraggingGroupEntityRef.current) {
      engineRef.current.update_group_drag(worldScreenX, worldScreenY);
    } else if (isDraggingTextRef.current) {
      engineRef.current.update_text_drag(worldScreenX, worldScreenY);
    } else if (isResizingTextRef.current) {
      engineRef.current.update_text_resize(worldScreenX, worldScreenY);
    }

    engineRef.current.render_diagnostic_grid();
    autoScrollRef.current.rafId = requestAnimationFrame(performAutoScroll);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      !engineRef.current ||
      !canvasRef.current ||
      !document.getElementById(CANVAS_ID)
    )
      return;

    const rect = canvasRef.current.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    const zoom = zoomLevelRef.current;
    const worldScreenX = cssX / zoom;
    const worldScreenY = cssY / zoom;

    if (activeModeRef.current === WorkspaceMode.Execution) {
      const worldX = worldScreenX - panOffsetRef.current.x;
      const worldY = worldScreenY - panOffsetRef.current.y;

      try {
        const hoverDataStr = engineRef.current.get_active_execution_hover_data(
          worldX,
          worldY,
        );
        if (hoverDataStr) {
          const parsed = JSON.parse(hoverDataStr);
          setExecutionTooltip({
            x: parsed.x,
            y: parsed.y,
            width: parsed.width,
            height: parsed.height,
            stepsHtml: parsed.steps,
          });
        } else {
          if (executionTooltip) setExecutionTooltip(null);
        }
      } catch (e) {
        if (executionTooltip) setExecutionTooltip(null);
      }
      return;
    }

    if (activeModeRef.current !== WorkspaceMode.Design) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    stopAutoScroll();

    if (stepOverrideState) {
      setStepOverrideState(null);
    }

    lastMousePosRef.current = { x: worldScreenX, y: worldScreenY };

    if (
      engineRef.current.check_group_delete_click(worldScreenX, worldScreenY)
    ) {
      engineRef.current.render_diagnostic_grid();
      return;
    }

    if (activeToolRef.current === "Hand") {
      setIsPanning(true);
      dragStartRef.current = {
        x: e.clientX - panOffsetRef.current.x * zoom,
        y: e.clientY - panOffsetRef.current.y * zoom,
      };
    } else if (activeToolRef.current === "Group") {
      if (engineRef.current.begin_group_draw(worldScreenX, worldScreenY)) {
        isDrawingGroupRef.current = true;
        engineRef.current.render_diagnostic_grid();
      }
    } else if (activeToolRef.current === "Arrow") {
      if (engineRef.current.begin_connection(worldScreenX, worldScreenY)) {
        isDrawingArrowRef.current = true;
        engineRef.current.render_diagnostic_grid();
      }
    } else if (activeToolRef.current === "Select") {
      const clickedMenuNodeId = engineRef.current.check_node_menu_click(
        worldScreenX,
        worldScreenY,
      );
      if (clickedMenuNodeId > 0) {
        const currentVisual =
          engineRef.current.get_node_visual_step(clickedMenuNodeId);
        setStepOverrideState({
          nodeId: clickedMenuNodeId,
          x: cssX,
          y: cssY,
          value: currentVisual,
        });
        return;
      }

      if (engineRef.current.begin_text_resize(worldScreenX, worldScreenY)) {
        isResizingTextRef.current = true;
        engineRef.current.render_diagnostic_grid();
        return;
      }

      const selectedInternalId = engineRef.current.begin_node_drag(
        worldScreenX,
        worldScreenY,
      );

      if (selectedInternalId > 0) {
        isDraggingNodeRef.current = true;
        const title = engineRef.current.get_node_title(selectedInternalId);
        const desc = engineRef.current.get_node_description(selectedInternalId);
        const visual =
          engineRef.current.get_node_visual_step(selectedInternalId);
        const steps = engineRef.current.get_node_steps(selectedInternalId);
        const expected =
          engineRef.current.get_node_expected_result(selectedInternalId);
        const refs = engineRef.current.get_node_references(selectedInternalId);
        const priority =
          engineRef.current.get_node_priority(selectedInternalId);

        postEvent("NODE_SELECTED", {
          id: selectedInternalId,
          title,
          description: desc,
          visualStep: visual,
          stepsContent: steps,
          expectedResult: expected,
          references: refs,
          priority,
        });
      } else {
        const selectedGroup = engineRef.current.begin_group_drag(
          worldScreenX,
          worldScreenY,
        );
        if (selectedGroup > 0) {
          isDraggingGroupEntityRef.current = true;
          const groupTitle = engineRef.current.get_group_title(selectedGroup);
          postEvent("GROUP_SELECTED", { id: selectedGroup, title: groupTitle });
        } else {
          const selectedTextId = engineRef.current.begin_text_drag(
            worldScreenX,
            worldScreenY,
          );
          if (selectedTextId > 0) {
            isDraggingTextRef.current = true;
            const textContent =
              engineRef.current.get_text_content(selectedTextId);
            postEvent("TEXT_SELECTED", {
              id: selectedTextId,
              content: textContent,
            });
          } else {
            postEvent("NODE_SELECTED", {
              id: null,
              title: "",
              description: "",
            });
            postEvent("GROUP_SELECTED", { id: null, title: "" });
            postEvent("TEXT_SELECTED", { id: null, content: "" });
          }
        }
      }
      engineRef.current.render_diagnostic_grid();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      activeModeRef.current !== WorkspaceMode.Design ||
      !engineRef.current ||
      !canvasRef.current ||
      !document.getElementById(CANVAS_ID)
    )
      return;

    const rect = canvasRef.current.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    const zoom = zoomLevelRef.current;
    const worldScreenX = cssX / zoom;
    const worldScreenY = cssY / zoom;

    lastMousePosRef.current = { x: worldScreenX, y: worldScreenY };

    if (isPanning) {
      const newOffsetX = (e.clientX - dragStartRef.current.x) / zoom;
      const newOffsetY = (e.clientY - dragStartRef.current.y) / zoom;
      panOffsetRef.current = { x: newOffsetX, y: newOffsetY };
      engineRef.current.set_pan_offset(newOffsetX, newOffsetY);
      engineRef.current.render_diagnostic_grid();
    } else {
      if (
        activeToolRef.current === "Select" &&
        !isPanning &&
        !isDrawingGroupRef.current &&
        !isDrawingArrowRef.current &&
        !isDraggingNodeRef.current &&
        !isDraggingGroupEntityRef.current &&
        !isDraggingTextRef.current &&
        !isResizingTextRef.current
      ) {
        const handleHover = engineRef.current.check_text_resize_handle(
          worldScreenX,
          worldScreenY,
        );
        if (handleHover > 0) {
          if (hoverCursor !== "ew-resize") setHoverCursor("ew-resize");
        } else {
          if (hoverCursor !== null) setHoverCursor(null);
        }
      } else {
        if (hoverCursor !== null) setHoverCursor(null);
      }

      if (isResizingTextRef.current && activeToolRef.current === "Select") {
        engineRef.current.update_text_resize(worldScreenX, worldScreenY);
        engineRef.current.render_diagnostic_grid();
      } else if (
        isDrawingGroupRef.current &&
        activeToolRef.current === "Group"
      ) {
        engineRef.current.update_group_draw(worldScreenX, worldScreenY);
        engineRef.current.render_diagnostic_grid();
      } else if (
        isDrawingArrowRef.current &&
        activeToolRef.current === "Arrow"
      ) {
        engineRef.current.update_connection_cursor(worldScreenX, worldScreenY);
        engineRef.current.render_diagnostic_grid();
      } else if (
        isDraggingNodeRef.current &&
        activeToolRef.current === "Select"
      ) {
        engineRef.current.update_node_drag(worldScreenX, worldScreenY);
        engineRef.current.render_diagnostic_grid();
      } else if (
        isDraggingGroupEntityRef.current &&
        activeToolRef.current === "Select"
      ) {
        engineRef.current.update_group_drag(worldScreenX, worldScreenY);
        engineRef.current.render_diagnostic_grid();
      } else if (
        isDraggingTextRef.current &&
        activeToolRef.current === "Select"
      ) {
        engineRef.current.update_text_drag(worldScreenX, worldScreenY);
        engineRef.current.render_diagnostic_grid();
      }

      if (
        isDrawingGroupRef.current ||
        isDrawingArrowRef.current ||
        isDraggingNodeRef.current ||
        isDraggingGroupEntityRef.current ||
        isDraggingTextRef.current ||
        isResizingTextRef.current
      ) {
        const scrollZone = 40;
        const maxSpeed = 12;
        let dx = 0;
        let dy = 0;

        if (cssX < scrollZone) {
          dx = -maxSpeed * (1 - Math.max(0, cssX) / scrollZone);
        } else if (cssX > rect.width - scrollZone) {
          dx = maxSpeed * (1 - Math.max(0, rect.width - cssX) / scrollZone);
        }

        if (cssY < scrollZone) {
          dy = -maxSpeed * (1 - Math.max(0, cssY) / scrollZone);
        } else if (cssY > rect.height - scrollZone) {
          dy = maxSpeed * (1 - Math.max(0, rect.height - cssY) / scrollZone);
        }

        autoScrollRef.current.dx = dx;
        autoScrollRef.current.dy = dy;

        if ((dx !== 0 || dy !== 0) && !autoScrollRef.current.rafId) {
          autoScrollRef.current.rafId =
            requestAnimationFrame(performAutoScroll);
        } else if (dx === 0 && dy === 0 && autoScrollRef.current.rafId) {
          stopAutoScroll();
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    stopAutoScroll();
    if (isPanning) setIsPanning(false);

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !engineRef.current || !document.getElementById(CANVAS_ID))
      return;

    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const zoom = zoomLevelRef.current;
    const worldScreenX = cssX / zoom;
    const worldScreenY = cssY / zoom;

    if (isResizingTextRef.current && activeToolRef.current === "Select") {
      engineRef.current.end_text_resize();
      engineRef.current.render_diagnostic_grid();
      isResizingTextRef.current = false;
    }

    if (isDrawingGroupRef.current && activeToolRef.current === "Group") {
      engineRef.current.complete_group_draw(
        worldScreenX,
        worldScreenY,
        "NEW TEST GROUP",
      );
      engineRef.current.render_diagnostic_grid();
      isDrawingGroupRef.current = false;
    }

    if (isDrawingArrowRef.current && activeToolRef.current === "Arrow") {
      engineRef.current.complete_connection(worldScreenX, worldScreenY);
      engineRef.current.render_diagnostic_grid();
      isDrawingArrowRef.current = false;
    }

    if (isDraggingNodeRef.current && activeToolRef.current === "Select") {
      engineRef.current.end_node_drag();
      engineRef.current.render_diagnostic_grid();
      isDraggingNodeRef.current = false;
    }

    if (
      isDraggingGroupEntityRef.current &&
      activeToolRef.current === "Select"
    ) {
      engineRef.current.end_group_drag();
      engineRef.current.render_diagnostic_grid();
      isDraggingGroupEntityRef.current = false;
    }

    if (isDraggingTextRef.current && activeToolRef.current === "Select") {
      engineRef.current.end_text_drag();
      engineRef.current.render_diagnostic_grid();
      isDraggingTextRef.current = false;
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    stopAutoScroll();
    setIsPanning(false);

    if (!engineRef.current || !document.getElementById(CANVAS_ID)) return;

    if (isResizingTextRef.current) {
      engineRef.current.end_text_resize();
      engineRef.current.render_diagnostic_grid();
      isResizingTextRef.current = false;
    }

    if (isDrawingGroupRef.current) {
      engineRef.current.cancel_group_draw();
      engineRef.current.render_diagnostic_grid();
      isDrawingGroupRef.current = false;
    }

    if (isDrawingArrowRef.current) {
      engineRef.current.cancel_connection();
      engineRef.current.render_diagnostic_grid();
      isDrawingArrowRef.current = false;
    }

    if (isDraggingNodeRef.current) {
      engineRef.current.end_node_drag();
      engineRef.current.render_diagnostic_grid();
      isDraggingNodeRef.current = false;
    }

    if (isDraggingGroupEntityRef.current) {
      engineRef.current.end_group_drag();
      engineRef.current.render_diagnostic_grid();
      isDraggingGroupEntityRef.current = false;
    }

    if (isDraggingTextRef.current) {
      engineRef.current.end_text_drag();
      engineRef.current.render_diagnostic_grid();
      isDraggingTextRef.current = false;
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeModeRef.current !== WorkspaceMode.Design) return;

    if (
      engineRef.current &&
      canvasRef.current &&
      document.getElementById(CANVAS_ID)
    ) {
      const rect = canvasRef.current.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;

      const zoom = zoomLevelRef.current;
      const worldScreenX = cssX / zoom;
      const worldScreenY = cssY / zoom;

      const worldX = worldScreenX - panOffsetRef.current.x;
      const worldY = worldScreenY - panOffsetRef.current.y;

      if (activeToolRef.current === "Step") {
        const defaultTitle = "New Step";
        const defaultDesc = "Enter description here";
        const visualStepStr = nextStepIdRef.current.toString();

        const newInternalId = engineRef.current.add_node(
          worldX,
          worldY,
          visualStepStr,
          defaultTitle,
          defaultDesc,
          true,
        );

        nextStepIdRef.current += 1;
        engineRef.current.render_diagnostic_grid();

        postEvent("NODE_SELECTED", {
          id: newInternalId,
          title: defaultTitle,
          description: defaultDesc,
          visualStep: visualStepStr,
          stepsContent: "",
          expectedResult: "",
          references: "",
          priority: "",
        });
      } else if (activeToolRef.current === "Text") {
        const defaultContent = "New Text Block";
        const newTextId = engineRef.current.add_text(
          worldX,
          worldY,
          defaultContent,
          true,
        );

        engineRef.current.render_diagnostic_grid();
        postEvent("TEXT_SELECTED", { id: newTextId, content: defaultContent });
        postEvent("TOOL_CHANGED", "Select");
      }
    }
  };

  const getCursorStyle = () => {
    if (activeMode === WorkspaceMode.Execution) return "pointer";
    if (isResizingTextRef.current) return "ew-resize";
    if (hoverCursor) return hoverCursor;
    if (activeTool === "Step") return "crosshair";
    if (activeTool === "Group") return "crosshair";
    if (activeTool === "Text") return "text";
    if (activeTool === "Select")
      return isDraggingNodeRef.current ||
        isDraggingGroupEntityRef.current ||
        isDraggingTextRef.current
        ? "grabbing"
        : "pointer";
    if (activeTool === "Hand") return isPanning ? "grabbing" : "grab";
    if (activeTool === "Arrow") return "crosshair";
    return "default";
  };

  return (
    <main
      style={{
        flex: 1,
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f8f9fa",
        overflow: "hidden",
        position: "relative",
        outline: "none",
        margin: 0,
        padding: 0,
      }}
      tabIndex={-1}
    >
      <style>{`
        body { margin: 0; padding: 0; overflow: hidden; }
        .flowstride-tooltip-fade-in {
          animation: flowstride-tooltip-fade-in-anim 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes flowstride-tooltip-fade-in-anim {
          0% { opacity: 0; transform: translateY(5px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .rich-text-preview font[size="1"] { font-size: 10px; }
        .rich-text-preview font[size="3"] { font-size: 13px; }
        .rich-text-preview font[size="4"] { font-size: 18px; }
        .rich-text-preview font[size="5"] { font-size: 24px; }
        .rich-text-preview li:has(font[size="1"]) { font-size: 10px; }
        .rich-text-preview li:has(font[size="3"]) { font-size: 13px; }
        .rich-text-preview li:has(font[size="4"]) { font-size: 18px; }
        .rich-text-preview li:has(font[size="5"]) { font-size: 24px; }
        .rich-text-preview ul, .rich-text-preview ol { padding-left: 20px; margin: 4px 0; }
        .rich-text-preview p { margin: 0 0 4px 0; }
      `}</style>

      <canvas
        id={CANVAS_ID}
        ref={canvasRef}
        onClick={handleCanvasClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          cursor: getCursorStyle(),
          touchAction: "none",
        }}
      />

      {executionTooltip && (
        <div
          className="flowstride-tooltip-fade-in"
          style={{
            position: "absolute",
            left:
              (executionTooltip.x + panOffsetRef.current.x) *
                zoomLevelRef.current +
              executionTooltip.width * zoomLevelRef.current +
              24,
            top:
              (executionTooltip.y + panOffsetRef.current.y) *
              zoomLevelRef.current,
            backgroundColor: "#ffffff",
            border: "1px solid #d0d7de",
            borderRadius: "8px",
            padding: "16px",
            width: "320px",
            maxHeight: "400px",
            overflowY: "auto",
            boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
            zIndex: 50,
            pointerEvents: "auto",
          }}
        >
          <h4
            style={{
              margin: "0 0 10px 0",
              fontSize: "11px",
              color: "#57606a",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Execution Test Steps
          </h4>
          <div
            className="rich-text-preview"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(executionTooltip.stepsHtml, {
                ALLOWED_TAGS: [
                  "b",
                  "i",
                  "em",
                  "strong",
                  "a",
                  "ul",
                  "ol",
                  "li",
                  "br",
                  "div",
                  "p",
                  "font",
                ],
                ALLOWED_ATTR: ["href", "target", "rel", "size"],
              }),
            }}
            style={{
              fontSize: "13px",
              color: "#24292f",
              lineHeight: "1.5",
            }}
          />
        </div>
      )}

      {stepOverrideState && (
        <div
          style={{
            position: "absolute",
            left: stepOverrideState.x,
            top: stepOverrideState.y,
            backgroundColor: "#ffffff",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            borderRadius: "6px",
            padding: "8px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            zIndex: 10,
            border: "1px solid #d0d7de",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <label
            style={{
              fontSize: "10px",
              fontWeight: "bold",
              color: "#57606a",
              letterSpacing: "0.5px",
            }}
          >
            OVERRIDE LABEL
          </label>
          <input
            autoFocus
            type="text"
            value={stepOverrideState.value}
            onChange={(e) =>
              setStepOverrideState({
                ...stepOverrideState,
                value: e.target.value,
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter")
                handleStepOverrideSubmit(
                  stepOverrideState.nodeId,
                  stepOverrideState.value,
                );
              if (e.key === "Escape") setStepOverrideState(null);
            }}
            style={{
              width: "120px",
              padding: "6px",
              border: "1px solid #0969da",
              borderRadius: "4px",
              outline: "none",
              fontSize: "13px",
              color: "#24292f",
            }}
          />
        </div>
      )}
    </main>
  );
}

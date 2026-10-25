import { useFlowStore } from "./store";

let socket: WebSocket | null = null;

export const connectToRunner = () => {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  )
    return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;

  socket = new WebSocket(`${protocol}//${host}`);

  socket.onopen = () =>
    console.log("[Flowstride] Connected to Execution Engine");

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const store = useFlowStore.getState();

      switch (data.type) {
        // STRICT MICRO STEP: The Command Handshake Interceptor
        case "CLI_CONTEXT":
          if (data.payload?.command === "run") {
            store.setActiveView("Flows");
          } else if (data.payload?.command === "open") {
            store.setActiveView("Workspace");
          }
          break;

        case "SUITE_START":
          store.startExecution();
          break;

        case "RUN_START": {
          const currentState = useFlowStore.getState();
          if (!currentState.isRunning) {
            useFlowStore.setState({ isRunning: true });
          }
          store.startRun(data.payload.fileName, data.payload.scenarioName);
          break;
        }

        case 'SCENARIO_RESULT':
          store.scenarioResult(data.payload);
          break;

        case "RUN_COMPLETE":
          store.stopExecution(data.payload?.status);
          break;

        case "FILE_FAILED":
          store.failFile(data.payload.fileName, data.payload.error || "File failed before completion.");
          break;

        case "LOG_EVENT":
          store.addLog(data.payload);
          break;

        case 'BROWSER_INFO':
          store.setBrowserInfo(data.payload.fileName, data.payload);
          break;

        case "BROWSER_FRAME":
          store.setBrowserFrame(
            data.payload.fileName || "General",
            data.payload.base64,
          );
          break;

        case "NETWORK_REQ":
          store.addNetworkLog(data.payload);
          break;

        case "STEP_ADD":
          store.addStep(data.payload);
          break;

        case "STEP_UPDATE":
          const status =
            data.payload.status === "passed" ? "pass" : data.payload.status;
          store.updateStepStatus(
            data.payload.id,
            status,
            data.payload.screenshot,
            data.payload.fileName,
            { attempt: data.payload.attempt, profile: data.payload.profile, domSnapshot: data.payload.domSnapshot, assertion:data.payload.assertion, error:data.payload.error, commandLabel:data.payload.commandLabel, sourceLine:data.payload.sourceLine },
          );
          break;

        case "URL_CHANGE":
          store.setPageMetadata(
            data.payload.fileName || "General",
            data.payload.url,
            data.payload.title,
          );
          break;

        case "REPLAY_RES":
          store.setReplayResponse(data.payload.responseBody, data.payload.status, data.payload.error, data.payload.requestId);
          break;

        case "EXPORT_PDF_RES": {
          const base64Data = data.payload.base64;
          const link = document.createElement("a");
          link.href = `data:application/pdf;base64,${base64Data}`;
          link.download = `Flowstride_Test_Report_${new Date().toISOString().split("T")[0]}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          break;
        }

        case "EXPORT_PDF_SUCCESS":
          console.log(
            "[Flowstride] PDF safely archived at:",
            data.payload.path,
          );
          break;

        case "EXPORT_PDF_ERROR":
          window.alert(
            `Report Error: Failed to generate PDF - ${data.payload.error}`,
          );
          break;

        default:
          console.warn("Unknown event:", data.type);
      }
    } catch (err) {
      console.error("Socket error:", err);
    }
  };

  socket.onclose = () => setTimeout(connectToRunner, 3000);
};

export const disconnectRunner = () => {
  if (socket) {
    socket.close();
    socket = null;
  }
};

export const sendToRunner = (type: string, payload: any) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
  }
};

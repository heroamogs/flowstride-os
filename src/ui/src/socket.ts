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

        case "RUN_COMPLETE":
          store.stopExecution();
          break;

        case "LOG_EVENT":
          store.addLog(data.payload);
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
          store.setReplayResponse(
            data.payload.responseBody,
            data.payload.status,
          );
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

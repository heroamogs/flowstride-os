import ReactDOM from "react-dom/client";
import App from "./App";
import EngineFrame from "./components/EngineFrame";
import "./index.css";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

// STRICT MICRO STEP: The Query Parameter Intercept
// If the URL contains ?frame=engine, bypass the entire App ecosystem natively
// and render only the mathematically isolated WebAssembly EngineFrame.
if (window.location.search.includes("frame=engine")) {
  root.render(<EngineFrame />);
} else {
  root.render(<App />);
}

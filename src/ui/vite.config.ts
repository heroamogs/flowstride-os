import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { workspace_engine: path.resolve(__dirname, "../workspace_engine/pkg/workspace_engine.js") } },
  base: "./",
});

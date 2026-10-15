import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev:worker` serves the API (and the lock WebSocket) on :8787.
    proxy: { "/api": { target: "http://localhost:8787", ws: true } },
  },
});

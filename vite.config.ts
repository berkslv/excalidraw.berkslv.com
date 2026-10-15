import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { BRAND } from "./src/theme";

/**
 * Excalidraw hard-codes the stroke quick-pick swatches
 * ([black, red, green, blue, yellow]) and has no prop to change them. This
 * swaps the green one for the brand accent in the bundled package code, and
 * fails the build if a package update changes that code so the swap would
 * silently stop applying.
 */
function brandStrokeSwatch(): Plugin {
  // e.g. W9=[Z.black,Z.red[fo],Z.green[fo],...] (prod) or the readable dev equivalent
  const pattern = /(\[\s*([\w$]+)\.black,\s*\2\.red\[[\w$]+\],\s*)\2\.green\[[\w$]+\]/;
  let replaced = false;
  return {
    name: "brand-stroke-swatch",
    apply: "build",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw") || !pattern.test(code)) return;
      replaced = true;
      return { code: code.replace(pattern, `$1${JSON.stringify(BRAND.accent)}`), map: null };
    },
    buildEnd(error) {
      if (!error && !replaced) {
        this.error("brand-stroke-swatch: Excalidraw's stroke swatch list was not found; update the pattern.");
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), brandStrokeSwatch()],
  server: {
    // `npm run dev:worker` serves the API (and the lock WebSocket) on :8787.
    proxy: { "/api": { target: "http://localhost:8787", ws: true } },
  },
});

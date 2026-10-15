// Self-host Excalidraw fonts instead of loading them from a public CDN.
import { cpSync, existsSync } from "node:fs";

const src = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
const dest = "public/fonts";

if (!existsSync(dest)) {
  cpSync(src, dest, { recursive: true });
  console.log(`Copied Excalidraw fonts to ${dest}`);
}

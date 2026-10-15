import { restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { StoredScene } from "./api";
import { DEFAULT_CANVAS_BACKGROUND, TOOL_DEFAULTS } from "./theme";

export const imageFileIds = (elements: readonly ExcalidrawElement[]) =>
  elements.flatMap((e) => (e.type === "image" && e.fileId && !e.isDeleted ? [e.fileId] : []));

/** Fetches the images a scene uses; missing ones are skipped. */
export async function loadFiles(
  elements: readonly ExcalidrawElement[],
  getFile: (fileId: string) => Promise<BinaryFileData>,
) {
  const results = await Promise.allSettled(imageFileIds(elements).map(getFile));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/** Turns a stored scene into Excalidraw data, filling in the brand defaults. */
export function restoreScene(scene: StoredScene | null) {
  const elements = restoreElements((scene?.elements ?? []) as ExcalidrawElement[], null);
  const background = (scene?.appState?.viewBackgroundColor as string | undefined) ?? DEFAULT_CANVAS_BACKGROUND;
  return { elements, background, appState: { ...TOOL_DEFAULTS, ...scene?.appState, viewBackgroundColor: background } };
}

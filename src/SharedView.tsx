import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import type { BinaryFileData, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { StoredScene } from "./api";
import { loadFiles, restoreScene } from "./scene";

type Shared = { title: string; version: number; updatedAt: number; scene: StoredScene | null };
type RefreshStatus = "idle" | "refreshing" | "upToDate" | "updated" | "failed";

class LinkGone extends Error {}

/** Fetches the shared drawing; null when it has not changed since `version`. */
async function fetchShared(token: string, version?: number): Promise<Shared | null> {
  const res = await fetch(`/s/${token}/scene`, {
    cache: "no-store",
    headers: version === undefined ? {} : { "If-None-Match": `"v${version}"` },
  });
  if (res.status === 304) return null;
  if (res.status === 404) throw new LinkGone("This link is no longer available.");
  if (!res.ok) throw new Error(`Could not load the drawing (${res.status}).`);
  return res.json();
}

const sharedFile = (token: string) => async (fileId: string) => {
  const res = await fetch(`/s/${token}/files/${fileId}`);
  if (!res.ok) throw new Error(`Image ${fileId}: ${res.status}`);
  return (await res.json()) as BinaryFileData;
};

const STATUS_TEXT: Record<RefreshStatus, string> = {
  idle: "",
  refreshing: "Refreshing…",
  upToDate: "Up to date",
  updated: "Updated",
  failed: "Refresh failed, try again",
};

/**
 * Public, read-only view of a shared drawing. Nothing polls or stays connected:
 * the drawing loads once and again only when the visitor presses Refresh.
 */
export function SharedView({ token }: { token: string }) {
  const [meta, setMeta] = useState<Omit<Shared, "scene"> | null>(null);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RefreshStatus>("idle");
  const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const versionRef = useRef<number | undefined>(undefined);

  const apply = useCallback((data: Shared) => {
    const { scene, ...rest } = data;
    versionRef.current = data.version;
    setMeta(rest);
    document.title = `${data.title} · Excalidraw`;
    return restoreScene(scene);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await fetchShared(token))!;
        const { elements, appState } = apply(data);
        const files = await loadFiles(elements, sharedFile(token));
        if (cancelled) return;
        setInitialData({
          elements,
          appState,
          files: Object.fromEntries(files.map((f) => [f.id, f])),
          scrollToContent: true,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, apply]);

  const refresh = async () => {
    const exc = excalidrawRef.current;
    if (!exc || status === "refreshing") return;
    setStatus("refreshing");
    try {
      const data = await fetchShared(token, versionRef.current);
      if (!data) return setStatus("upToDate");
      const { elements, background } = apply(data);
      exc.addFiles(await loadFiles(elements, sharedFile(token)));
      exc.updateScene({
        elements,
        appState: { viewBackgroundColor: background },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      setStatus("updated");
    } catch (e) {
      if (e instanceof LinkGone) setError(e.message);
      else setStatus("failed");
    }
  };

  // Let "Up to date" / "Updated" fade back to the plain timestamp.
  useEffect(() => {
    if (status !== "upToDate" && status !== "updated") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  // There is nothing to save here; keep Ctrl+S from downloading the page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
      </div>
    );
  }

  return (
    <div className="editor">
      <header className="editor-bar">
        <span className="title shared-title">{meta?.title ?? "Loading…"}</span>
        <span className="status">
          {STATUS_TEXT[status] ||
            (meta && `View only · last saved ${new Date(meta.updatedAt).toLocaleString()}`)}
        </span>
        <button className="primary" onClick={refresh} disabled={!initialData || status === "refreshing"}>
          Refresh
        </button>
      </header>
      <div className="canvas">
        {initialData && (
          <Excalidraw
            excalidrawAPI={(a) => (excalidrawRef.current = a)}
            initialData={initialData}
            viewModeEnabled
            theme="dark"
            name={meta?.title}
            UIOptions={{ canvasActions: { loadScene: false, clearCanvas: false, saveToActiveFile: false } }}
          />
        )}
      </div>
    </div>
  );
}

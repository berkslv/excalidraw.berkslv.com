import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  hashElementsVersion,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { DrawingMeta } from "../shared/protocol";
import { api, ApiError, type StoredScene } from "./api";
import { navigate } from "./router";
import { DEFAULT_CANVAS_BACKGROUND, TOOL_DEFAULTS } from "./theme";
import { useEditLock } from "./useEditLock";

const SAVE_DEBOUNCE_MS = 1000;
const SAVE_RETRY_MS = 5000;
const IDLE_RELEASE_MS = 10 * 60_000;
const VIEWER_POLL_MS = 10_000;

type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "lost";

const sceneKey = (elements: readonly ExcalidrawElement[], background: string) =>
  `${hashElementsVersion(elements)}:${background}`;

const imageFileIds = (elements: readonly ExcalidrawElement[]) =>
  elements.flatMap((e) => (e.type === "image" && e.fileId && !e.isDeleted ? [e.fileId] : []));

async function loadFiles(elements: readonly ExcalidrawElement[]) {
  const results = await Promise.allSettled(imageFileIds(elements).map((id) => api.getFile(id)));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

function restoreScene(scene: StoredScene | null) {
  const elements = restoreElements((scene?.elements ?? []) as ExcalidrawElement[], null);
  const background = (scene?.appState?.viewBackgroundColor as string | undefined) ?? DEFAULT_CANVAS_BACKGROUND;
  return { elements, background, appState: { ...TOOL_DEFAULTS, ...scene?.appState, viewBackgroundColor: background } };
}

export function Editor({ id }: { id: string }) {
  const [meta, setMeta] = useState<DrawingMeta | null>(null);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const tokenRef = useRef<number | null>(null);
  const versionRef = useRef(0);
  const savedKeyRef = useRef("");
  const savedJsonRef = useRef("");
  const uploadedFilesRef = useRef(new Set<string>());
  const dirtyRef = useRef(false);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const debounceRef = useRef<number>(undefined);
  const lastActivityRef = useRef(Date.now());

  const save = useCallback((): Promise<void> => {
    window.clearTimeout(debounceRef.current);
    const run = async () => {
      const exc = excalidrawRef.current;
      const token = tokenRef.current;
      if (!exc || token === null || !dirtyRef.current) return;

      const elements = exc.getSceneElements();
      const appState = exc.getAppState();
      const key = sceneKey(elements, appState.viewBackgroundColor);
      const json = serializeAsJSON(elements, appState, {}, "database");
      if (json === savedJsonRef.current) {
        dirtyRef.current = false;
        setSaveStatus("saved");
        return;
      }

      setSaveStatus("saving");
      try {
        const files = exc.getFiles();
        for (const fileId of imageFileIds(elements)) {
          if (uploadedFilesRef.current.has(fileId) || !files[fileId]) continue;
          await api.putFile(files[fileId]);
          uploadedFilesRef.current.add(fileId);
        }
        const updated = await api.saveScene(id, json, token);
        versionRef.current = updated.version;
        savedJsonRef.current = json;
        savedKeyRef.current = key;
        setMeta(updated);
        // Edits made while this save was in flight are still pending.
        dirtyRef.current = sceneKey(exc.getSceneElements(), exc.getAppState().viewBackgroundColor) !== key;
        setSaveStatus(dirtyRef.current ? "unsaved" : "saved");
        if (dirtyRef.current) debounceRef.current = window.setTimeout(save, SAVE_DEBOUNCE_MS);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          tokenRef.current = null;
          setSaveStatus("lost");
        } else {
          setSaveStatus("error");
          debounceRef.current = window.setTimeout(save, SAVE_RETRY_MS);
        }
      }
    };
    saveChainRef.current = saveChainRef.current.then(run);
    return saveChainRef.current;
  }, [id]);

  const flushRef = useRef(async () => {});
  flushRef.current = async () => {
    if (dirtyRef.current) await save();
    else await saveChainRef.current;
  };

  const lock = useEditLock(id, flushRef);
  const isHolder = lock.state.status === "holder";

  /** Replaces the canvas with the latest saved scene (used when not editing, or just granted). */
  const refreshFromServer = useCallback(async () => {
    const { meta, scene } = await api.getDrawing(id);
    setMeta(meta);
    if (meta.version === versionRef.current) return;
    const exc = excalidrawRef.current;
    if (!exc) return;
    const { elements, background } = restoreScene(scene);
    exc.addFiles(await loadFiles(elements));
    exc.updateScene({
      elements,
      appState: { viewBackgroundColor: background },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    versionRef.current = meta.version;
    savedKeyRef.current = sceneKey(elements, background);
    savedJsonRef.current = "";
  }, [id]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { meta, scene } = await api.getDrawing(id);
        const { elements, background, appState } = restoreScene(scene);
        const files = await loadFiles(elements);
        if (cancelled) return;
        files.forEach((f) => uploadedFilesRef.current.add(f.id));
        versionRef.current = meta.version;
        savedKeyRef.current = sceneKey(elements, background);
        setMeta(meta);
        setInitialData({
          elements,
          appState,
          files: Object.fromEntries(files.map((f) => [f.id, f])),
          scrollToContent: true,
        });
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // React to lock changes: pull the latest scene when granted, stop saving otherwise.
  const token = lock.state.status === "holder" ? lock.state.token : null;
  useEffect(() => {
    if (token === null || !initialData) {
      tokenRef.current = null;
      return;
    }
    let cancelled = false;
    refreshFromServer()
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        tokenRef.current = token;
        dirtyRef.current = false;
        lastActivityRef.current = Date.now();
        setSaveStatus("saved");
      });
    return () => {
      cancelled = true;
    };
  }, [token, initialData, refreshFromServer]);

  // While someone else edits, keep the read-only view reasonably fresh.
  useEffect(() => {
    if (isHolder || !initialData) return;
    const timer = window.setInterval(() => refreshFromServer().catch(() => {}), VIEWER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [isHolder, initialData, refreshFromServer]);

  // Hand the lock back if this device sits idle while holding it.
  useEffect(() => {
    if (!isHolder) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_RELEASE_MS) lock.release();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [isHolder, lock]);

  // Persist before the tab is hidden or closed.
  useEffect(() => {
    const onHidden = () => document.visibilityState === "hidden" && dirtyRef.current && save();
    const onPageHide = () => {
      const exc = excalidrawRef.current;
      if (!exc || tokenRef.current === null || !dirtyRef.current) return;
      const json = serializeAsJSON(exc.getSceneElements(), exc.getAppState(), {}, "database");
      api.saveScene(id, json, tokenRef.current, true).catch(() => {});
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [id, save]);

  // Ctrl+S / Cmd+S saves to the server now instead of downloading the page.
  // Captured before Excalidraw's own shortcut handling sees it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      e.stopPropagation();
      if (tokenRef.current !== null && dirtyRef.current) save();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [save]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: { viewBackgroundColor: string }) => {
      if (tokenRef.current === null) return;
      if (sceneKey(elements, appState.viewBackgroundColor) === savedKeyRef.current && !dirtyRef.current) return;
      dirtyRef.current = true;
      lastActivityRef.current = Date.now();
      setSaveStatus((s) => (s === "saving" ? s : "unsaved"));
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(save, SAVE_DEBOUNCE_MS);
    },
    [save],
  );

  const rename = async () => {
    if (!meta) return;
    const title = prompt("Rename drawing", meta.title);
    if (title?.trim() && title !== meta.title) setMeta(await api.renameDrawing(id, title));
  };

  if (loadError) {
    return (
      <div className="page">
        <p className="error">Could not open drawing: {loadError}</p>
        <a href="/" onClick={(e) => (e.preventDefault(), navigate("/"))}>
          Back to drawings
        </a>
      </div>
    );
  }

  return (
    <div className="editor">
      <header className="editor-bar">
        <a href="/" className="back" onClick={(e) => (e.preventDefault(), navigate("/"))}>
          ← Drawings
        </a>
        <button className="title" onClick={rename} title="Rename">
          {meta?.title ?? "Loading…"}
        </button>
        <LockBanner state={lock.state} saveStatus={saveStatus} onEdit={lock.acquire} onTakeover={lock.takeover} onRelease={lock.release} />
      </header>
      <div className="canvas">
        {initialData && (
          <Excalidraw
            excalidrawAPI={(a) => (excalidrawRef.current = a)}
            initialData={initialData}
            onChange={onChange}
            viewModeEnabled={!isHolder}
            theme="dark"
            name={meta?.title}
          />
        )}
      </div>
    </div>
  );
}

type BannerProps = {
  state: ReturnType<typeof useEditLock>["state"];
  saveStatus: SaveStatus;
  onEdit: () => void;
  onTakeover: () => void;
  onRelease: () => void;
};

function LockBanner({ state, saveStatus, onEdit, onTakeover, onRelease }: BannerProps) {
  switch (state.status) {
    case "connecting":
      return <span className="status">Connecting…</span>;
    case "disconnected":
      return <span className="status warn">Connection lost, reconnecting… (read-only)</span>;
    case "holder":
      return (
        <>
          <span className={`status ${saveStatus === "error" || saveStatus === "lost" ? "warn" : ""}`}>
            {
              {
                saved: "Editing · Saved",
                unsaved: "Editing · Unsaved changes",
                saving: "Editing · Saving…",
                error: "Editing · Save failed, retrying…",
                lost: "Edit lock lost, changes not saved",
              }[saveStatus]
            }
          </span>
          <button onClick={onRelease}>Stop editing</button>
        </>
      );
    case "waiting":
      return (
        <>
          <span className="status warn">
            Read-only: being edited on <b>{state.holder}</b> since {new Date(state.since).toLocaleTimeString()}. You'll
            get control automatically{state.position > 1 ? ` (position ${state.position})` : ""}.
          </span>
          <button
            onClick={() => confirm(`Take over editing from ${state.holder}? Their unsaved changes may be lost.`) && onTakeover()}
          >
            Take over
          </button>
        </>
      );
    case "revoked":
      return (
        <>
          <span className="status warn">Editing was taken over by {state.by}. Read-only.</span>
          <button onClick={onEdit}>Edit</button>
        </>
      );
    case "idle":
      return (
        <>
          <span className="status">Read-only</span>
          <button onClick={onEdit}>Edit</button>
        </>
      );
  }
}

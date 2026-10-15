import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import { LOCK_TOKEN_HEADER, type DrawingMeta } from "../shared/protocol";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // An expired Access session answers with a redirect to the login page, which
  // fetch cannot follow cross-origin; treat it like a 401.
  const res = await fetch(path, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect") throw new ApiError("Session expired, reload to sign in again", 401);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error ?? res.statusText, res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type StoredScene = {
  elements?: unknown[];
  appState?: Record<string, unknown>;
};

export const api = {
  listDrawings: () => request<DrawingMeta[]>("/api/drawings"),

  createDrawing: (title: string) => request<DrawingMeta>("/api/drawings", jsonInit("POST", { title })),

  getDrawing: (id: string) => request<{ meta: DrawingMeta; scene: StoredScene | null }>(`/api/drawings/${id}`),

  renameDrawing: (id: string, title: string) => request<DrawingMeta>(`/api/drawings/${id}`, jsonInit("PATCH", { title })),

  deleteDrawing: (id: string) => request<void>(`/api/drawings/${id}`, { method: "DELETE" }),

  saveScene: (id: string, sceneJson: string, lockToken: number, keepalive = false) =>
    request<DrawingMeta>(`/api/drawings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", [LOCK_TOKEN_HEADER]: String(lockToken) },
      body: sceneJson,
      keepalive,
    }),

  getFile: (fileId: string) => request<BinaryFileData>(`/api/files/${fileId}`),

  hasFile: async (fileId: string) => (await fetch(`/api/files/${fileId}`, { method: "HEAD" })).ok,

  putFile: (file: BinaryFileData) => request<void>(`/api/files/${file.id}`, jsonInit("PUT", file)),
};

// Types shared by the worker and the browser app.

/** Text frames a client sends on the per-drawing lock WebSocket. */
export type ClientMessage = "hello" | "release" | "takeover";

/** JSON frames the lock sends back. */
export type ServerMessage =
  | { type: "granted"; token: number }
  | { type: "waiting"; position: number; holder: string; since: number }
  | { type: "revoked"; by: string };

export type DrawingMeta = {
  id: string;
  title: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export const LOCK_TOKEN_HEADER = "X-Lock-Token";
export const PING = "ping";
export const PONG = "pong";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { PING, type ClientMessage, type ServerMessage } from "../shared/protocol";
import { getDeviceName } from "./device";

export type LockState =
  | { status: "connecting" }
  | { status: "holder"; token: number }
  | { status: "waiting"; position: number; holder: string; since: number }
  | { status: "revoked"; by: string }
  | { status: "idle" } // released by us; editing resumes when the user asks
  | { status: "disconnected" };

const PING_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Holds a WebSocket to the drawing's lock. While connected, the server either
 * grants the edit lock or queues us; a queued connection is granted
 * automatically when the holder goes away.
 *
 * `flushRef` is awaited before the lock is let go (release or unmount) so the
 * last save still carries a valid lock token.
 */
export function useEditLock(drawingId: string, flushRef: RefObject<() => Promise<void>>) {
  const [state, setState] = useState<LockState>({ status: "connecting" });
  const wsRef = useRef<WebSocket | null>(null);
  const wantConnectedRef = useRef(true);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number>(undefined);

  const connect = useCallback(() => {
    wantConnectedRef.current = true;
    window.clearTimeout(retryTimerRef.current);
    wsRef.current?.close();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const device = encodeURIComponent(getDeviceName());
    const ws = new WebSocket(`${proto}://${location.host}/api/drawings/${drawingId}/lock?device=${device}`);
    wsRef.current = ws;
    setState({ status: "connecting" });

    let ping: number | undefined;
    const sendMsg = (msg: ClientMessage | typeof PING) => ws.readyState === WebSocket.OPEN && ws.send(msg);

    ws.onopen = () => {
      retryRef.current = 0;
      sendMsg("hello");
      ping = window.setInterval(() => sendMsg(PING), PING_MS);
    };

    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const msg = JSON.parse(e.data) as ServerMessage;
      if (msg.type === "granted") setState({ status: "holder", token: msg.token });
      else if (msg.type === "waiting") setState({ status: "waiting", ...msg });
      else if (msg.type === "revoked") {
        wantConnectedRef.current = false;
        setState({ status: "revoked", by: msg.by });
      }
    };

    ws.onclose = () => {
      window.clearInterval(ping);
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (!wantConnectedRef.current) return;
      // Unexpected drop: we no longer hold the lock. Rejoin the queue with backoff.
      setState({ status: "disconnected" });
      const delay = Math.min(1000 * 2 ** retryRef.current++, MAX_BACKOFF_MS);
      retryTimerRef.current = window.setTimeout(connect, delay);
    };
  }, [drawingId]);

  /** Gives the lock to the next waiting device and stops participating. */
  const release = useCallback(async () => {
    wantConnectedRef.current = false;
    window.clearTimeout(retryTimerRef.current);
    const ws = wsRef.current;
    await flushRef.current().catch(() => {});
    if (wsRef.current === ws) wsRef.current = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send("release" satisfies ClientMessage);
    ws?.close();
    setState({ status: "idle" });
  }, [flushRef]);

  /** Forcibly takes the lock from whichever device holds it. */
  const takeover = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send("takeover" satisfies ClientMessage);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wantConnectedRef.current = false;
      window.clearTimeout(retryTimerRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      flushRef.current().catch(() => {}).finally(() => ws?.close());
    };
  }, [connect, flushRef]);

  return { state, acquire: connect, release, takeover };
}

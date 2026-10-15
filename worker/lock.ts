import { DurableObject } from "cloudflare:workers";
import { PING, PONG, type ClientMessage, type ServerMessage } from "../shared/protocol";

type Conn = { connId: string; deviceName: string; joinedAt: number };
type Holder = { connId: string; token: number; deviceName: string; since: number };

const HEARTBEAT_CHECK_MS = 15_000;
const STALE_MS = 45_000;

const conn = (ws: WebSocket) => ws.deserializeAttachment() as Conn;
const send = (ws: WebSocket, msg: ServerMessage) => ws.send(JSON.stringify(msg));

/**
 * One instance per drawing. Grants the edit lock to a single WebSocket at a
 * time; everyone else waits in FIFO order and is promoted when the holder
 * releases, disconnects or stops heartbeating. Each grant gets a new fencing
 * token that saves must present.
 */
export class DrawingLock extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered without waking the object; the timestamp doubles as a heartbeat.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const url = new URL(req.url);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      connId: crypto.randomUUID(),
      deviceName: (url.searchParams.get("device") || "Unknown device").slice(0, 80),
      joinedAt: Date.now(),
    } satisfies Conn);
    // The client sends "hello" once open; the lock is granted or queued then.
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const msg = raw as ClientMessage;
    if (msg === "hello") {
      await this.promote();
    } else if (msg === "release") {
      ws.close(1000, "released");
      await this.promote(ws);
    } else if (msg === "takeover") {
      await this.takeover(ws);
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.promote(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.promote(ws);
  }

  /** Evicts a holder whose heartbeats stopped, e.g. a laptop that went to sleep. */
  async alarm() {
    const holder = await this.ctx.storage.get<Holder>("holder");
    const ws = holder && this.socketOf(holder.connId);
    if (ws) {
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (Date.now() - Math.max(lastPing, holder.since) > STALE_MS) {
        ws.close(4000, "heartbeat timeout");
        await this.promote(ws);
      }
    }
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_CHECK_MS);
    }
  }

  /** RPC from the save endpoint: is this token the current, connected holder's? */
  async isHolder(token: number): Promise<boolean> {
    const holder = await this.ctx.storage.get<Holder>("holder");
    return !!holder && holder.token === token && !!this.socketOf(holder.connId);
  }

  private socketOf(connId: string) {
    return this.ctx.getWebSockets().find((ws) => conn(ws).connId === connId);
  }

  private async takeover(requester: WebSocket) {
    const holder = await this.ctx.storage.get<Holder>("holder");
    const current = holder && this.socketOf(holder.connId);
    if (current === requester) return;
    if (current) {
      send(current, { type: "revoked", by: conn(requester).deviceName });
      current.close(4001, "taken over");
    }
    await this.grant(requester);
    await this.promote(current);
  }

  private async grant(ws: WebSocket) {
    const token = ((await this.ctx.storage.get<number>("gen")) ?? 0) + 1;
    const { connId, deviceName } = conn(ws);
    const holder: Holder = { connId, token, deviceName, since: Date.now() };
    await this.ctx.storage.put({ gen: token, holder });
    send(ws, { type: "granted", token });
    await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_CHECK_MS);
  }

  /** Hands the lock to the longest-waiting socket if the holder is gone, then updates waiters. */
  private async promote(closed?: WebSocket) {
    const queue = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== closed)
      .sort((a, b) => conn(a).joinedAt - conn(b).joinedAt);

    let holder = await this.ctx.storage.get<Holder>("holder");
    if (!holder || !queue.some((ws) => conn(ws).connId === holder!.connId)) {
      if (queue.length === 0) {
        await this.ctx.storage.delete("holder");
        return;
      }
      await this.grant(queue[0]);
      holder = (await this.ctx.storage.get<Holder>("holder"))!;
    }

    const current = holder;
    queue
      .filter((ws) => conn(ws).connId !== current.connId)
      .forEach((ws, i) =>
        send(ws, { type: "waiting", position: i + 1, holder: current.deviceName, since: current.since }),
      );
  }
}

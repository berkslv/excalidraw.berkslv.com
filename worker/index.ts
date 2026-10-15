import { authenticate } from "./access";
import { LOCK_TOKEN_HEADER, type DrawingMeta } from "../shared/protocol";

export { DrawingLock } from "./lock";

type Row = {
  id: string;
  title: string;
  version: number;
  created_at: number;
  updated_at: number;
};

const MAX_SCENE_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ID = "[A-Za-z0-9_-]{1,64}";
const COLUMNS = "id, title, version, created_at, updated_at";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const error = (message: string, status: number) => json({ error: message }, status);

const toMeta = (r: Row): DrawingMeta => ({
  id: r.id,
  title: r.title,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const sceneKey = (id: string) => `scenes/${id}.json`;
const fileKey = (owner: string, fileId: string) => `files/${owner}/${fileId}`;
const lockOf = (env: Env, id: string) => env.LOCKS.get(env.LOCKS.idFromName(id));

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    const email = await authenticate(req, env);
    if (!email) return error("Forbidden", 403);

    try {
      return (await route(req, env, url.pathname, email)) ?? error("Not found", 404);
    } catch (e) {
      console.error(e);
      return error("Internal error", 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, path: string, email: string): Promise<Response | undefined> {
  const method = req.method;

  if (path === "/api/me" && method === "GET") return json({ email });

  if (path === "/api/drawings") {
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT ${COLUMNS} FROM drawings WHERE owner_email = ? ORDER BY updated_at DESC`,
      )
        .bind(email)
        .all<Row>();
      return json(results.map(toMeta));
    }
    if (method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { title?: unknown };
      const now = Date.now();
      const row: Row = {
        id: crypto.randomUUID(),
        title: cleanTitle(body.title) ?? "Untitled",
        version: 0,
        created_at: now,
        updated_at: now,
      };
      await env.DB.prepare(
        "INSERT INTO drawings (id, owner_email, title, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(row.id, email, row.title, row.version, row.created_at, row.updated_at)
        .run();
      return json(toMeta(row), 201);
    }
    return;
  }

  let m = path.match(new RegExp(`^/api/drawings/(${ID})/lock$`));
  if (m) {
    if (!(await findDrawing(env, email, m[1]))) return error("Not found", 404);
    return lockOf(env, m[1]).fetch(req);
  }

  m = path.match(new RegExp(`^/api/drawings/(${ID})$`));
  if (m) {
    const id = m[1];
    const drawing = await findDrawing(env, email, id);
    if (!drawing) return error("Not found", 404);

    if (method === "GET") {
      const scene = await env.BUCKET.get(sceneKey(id));
      return json({ meta: toMeta(drawing), scene: scene ? await scene.json() : null });
    }

    if (method === "PUT") {
      const token = Number(req.headers.get(LOCK_TOKEN_HEADER));
      if (!Number.isInteger(token) || !(await lockOf(env, id).isHolder(token))) {
        return error("You do not hold the edit lock for this drawing", 409);
      }
      const body = await req.text();
      if (body.length > MAX_SCENE_BYTES) return error("Scene too large", 413);
      try {
        JSON.parse(body);
      } catch {
        return error("Malformed scene", 400);
      }
      await env.BUCKET.put(sceneKey(id), body, { httpMetadata: { contentType: "application/json" } });
      const updated = await env.DB.prepare(
        `UPDATE drawings SET version = version + 1, updated_at = ? WHERE id = ? AND owner_email = ? RETURNING ${COLUMNS}`,
      )
        .bind(Date.now(), id, email)
        .first<Row>();
      return json(toMeta(updated!));
    }

    if (method === "PATCH") {
      const body = (await req.json().catch(() => ({}))) as { title?: unknown };
      const title = cleanTitle(body.title);
      if (!title) return error("Title required", 400);
      const updated = await env.DB.prepare(
        `UPDATE drawings SET title = ? WHERE id = ? AND owner_email = ? RETURNING ${COLUMNS}`,
      )
        .bind(title, id, email)
        .first<Row>();
      return json(toMeta(updated!));
    }

    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM drawings WHERE id = ? AND owner_email = ?").bind(id, email).run();
      await env.BUCKET.delete(sceneKey(id));
      return new Response(null, { status: 204 });
    }
    return;
  }

  // Embedded images. Excalidraw file ids are content-derived, so a file is
  // uploaded once and shared by every drawing that uses it.
  m = path.match(new RegExp(`^/api/files/(${ID})$`));
  if (m) {
    const key = fileKey(email, m[1]);
    if (method === "GET") {
      const obj = await env.BUCKET.get(key);
      if (!obj) return error("Not found", 404);
      return new Response(obj.body, {
        headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=31536000, immutable" },
      });
    }
    if (method === "HEAD") {
      return new Response(null, { status: (await env.BUCKET.head(key)) ? 200 : 404 });
    }
    if (method === "PUT") {
      const body = await req.text();
      if (body.length > MAX_FILE_BYTES) return error("File too large", 413);
      await env.BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" } });
      return new Response(null, { status: 204 });
    }
  }
}

function findDrawing(env: Env, email: string, id: string) {
  return env.DB.prepare(`SELECT ${COLUMNS} FROM drawings WHERE id = ? AND owner_email = ?`)
    .bind(id, email)
    .first<Row>();
}

function cleanTitle(title: unknown) {
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : null;
}

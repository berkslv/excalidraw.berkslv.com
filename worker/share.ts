// Public, read-only access to a shared drawing. These routes sit under /s/,
// which Cloudflare Access bypasses: the unguessable token is the only check.

import { fileKey, sceneKey } from "./keys";

const TOKEN = "[A-Za-z0-9_-]{32,64}";
const ID = "[A-Za-z0-9_-]{1,64}";

type SharedRow = {
  id: string;
  owner_email: string;
  title: string;
  version: number;
  updated_at: number;
};

// Keep shared pages out of search engines, and the token out of Referer headers.
const PRIVATE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

const respond = (body: BodyInit | null, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...PRIVATE_HEADERS, ...headers } });

const notFound = () =>
  respond(JSON.stringify({ error: "This link is no longer available" }), 404, { "Content-Type": "application/json" });

/** Creates a 256-bit, URL-safe share token. */
export function newShareToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function handleShare(req: Request, env: Env, path: string): Promise<Response> {
  if (req.method !== "GET") return respond(null, 405, { Allow: "GET" });

  // The page itself: the app's index.html; the client loads the scene.
  if (new RegExp(`^/s/${TOKEN}/?$`).test(path)) {
    const page = await env.ASSETS.fetch(new Request(new URL("/", req.url), req));
    const res = new Response(page.body, page);
    for (const [k, v] of Object.entries(PRIVATE_HEADERS)) res.headers.set(k, v);
    return res;
  }

  let m = path.match(new RegExp(`^/s/(${TOKEN})/scene$`));
  if (m) {
    const drawing = await findShared(env, m[1]);
    if (!drawing) return notFound();

    // Refresh with nothing new: answer from D1 alone, without reading the scene from R2.
    const etag = `"v${drawing.version}"`;
    const cacheHeaders = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (req.headers.get("If-None-Match") === etag) return respond(null, 304, cacheHeaders);

    const scene = await env.BUCKET.get(sceneKey(drawing.id));
    const body = JSON.stringify({
      title: drawing.title,
      version: drawing.version,
      updatedAt: drawing.updated_at,
      scene: scene ? await scene.json() : null,
    });
    return respond(body, 200, { ...cacheHeaders, "Content-Type": "application/json" });
  }

  m = path.match(new RegExp(`^/s/(${TOKEN})/files/(${ID})$`));
  if (m) {
    const [, token, fileId] = m;
    const drawing = await findShared(env, token);
    if (!drawing) return notFound();
    // Only images this drawing actually uses, not every file of its owner.
    const scene = await env.BUCKET.get(sceneKey(drawing.id));
    const elements = scene ? ((await scene.json()) as { elements?: { fileId?: string }[] }).elements : [];
    if (!elements?.some((e) => e.fileId === fileId)) return notFound();

    const file = await env.BUCKET.get(fileKey(drawing.owner_email, fileId));
    if (!file) return notFound();
    return respond(file.body, 200, { "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" });
  }

  return notFound();
}

function findShared(env: Env, token: string) {
  return env.DB.prepare(
    `SELECT d.id, d.owner_email, d.title, d.version, d.updated_at
     FROM shares s JOIN drawings d ON d.id = s.drawing_id
     WHERE s.token = ?`,
  )
    .bind(token)
    .first<SharedRow>();
}

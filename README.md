# excalidraw.berkslv.com

Private, self-hosted Excalidraw. Drawings sync across devices, and only one device can edit a drawing at a time.

- **App:** Vite + React around the official [`@excalidraw/excalidraw`](https://www.npmjs.com/package/@excalidraw/excalidraw) package
- **Hosting:** one Cloudflare Worker that serves the static app and the `/api/*` routes
- **Auth:** Cloudflare Access (Google login, email allowlist). The worker also verifies the Access JWT on every API call.
- **Storage:** D1 for the drawing list, R2 for scenes (`scenes/{id}.json`) and embedded images (`files/{email}/{fileId}`)
- **Edit lock:** one Durable Object per drawing (`worker/lock.ts`)

## Edit lock

Opening a drawing connects a WebSocket to that drawing's `DrawingLock` Durable Object:

- The first device gets the lock and a **fencing token**. Every save must carry that token (`X-Lock-Token`), and the worker rejects saves with a stale token (409).
- Other devices wait in a FIFO queue in read-only mode. They see who is editing, and their view refreshes every 10 s.
- When the holder's connection closes, the next device in line gets the lock automatically. The connection can close because:
  - the user clicked **Stop editing**
  - the user left the drawing
  - the tab closed
  - the network dropped
  - the client sent no heartbeat for 45 s (e.g. the laptop went to sleep)
- The holder releases the lock by itself after 10 minutes without edits.
- **Take over** lets a waiting device take the lock immediately. The previous holder is notified and becomes read-only.

## Share links

**Share** in the editor creates a view-only link, `/s/<token>`, that works without signing in. Each drawing has at most one link. **Stop sharing** revokes it, and deleting the drawing revokes it too.

- **Token:** 256 random bits. It is the only check on `/s/*` routes, which Access bypasses (`worker/share.ts`).
- **Visitor page:** read-only, with no polling and no WebSocket. The drawing loads once, then again only when the visitor presses **Refresh**.
- **Refresh:** sends `If-None-Match` with the version the visitor has. If nothing changed, the worker answers `304` from D1 alone, without reading the scene from R2.
- **Images:** a link serves only images its drawing uses, never the owner's other files.
- **Headers:** responses carry `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.

### Cloudflare Access for share links

Access must let these paths through without login:
- `/s/*`: the share page, its scene and its images
- `/assets/*`, `/fonts/*`, `/brand/*`: the app's JS, CSS and fonts. They are public in this repo anyway.

Everything else, including `/` and `/api/*`, stays behind the Google login.

1. **Zero Trust** → **Access controls** → **Applications** → **Create new application** → **Self-hosted and private**.
2. **Name:** `Excalidraw public`.
3. **Add public hostname** four times, each with subdomain `excalidraw`, domain `berkslv.com`, and one path each: `s/*`, `assets/*`, `fonts/*`, `brand/*`.
4. **Access policies** → **Create new policy**: name `Public`, **Action: Bypass**, **Include: Everyone**.
5. **Create**. Access applies the most specific path, so these paths skip login and the main `Excalidraw` application still covers the rest.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars    # DEV_EMAIL stands in for Cloudflare Access locally
npm run db:migrate:local
npm run build
npm run dev:worker                # app + API on http://localhost:8787
npm run dev                       # optional: Vite HMR on :5173, proxies /api to :8787
```

`DEV_EMAIL` only takes effect when the request host is `localhost`. `dev:worker` uses `--local-upstream localhost` so local requests keep that host. Never set `DEV_EMAIL` in production.

## First deployment

1. **Log in:** `npx wrangler login`
2. **Create the resources:**
   ```sh
   npx wrangler d1 create excalidraw              # put the database_id into wrangler.jsonc
   npx wrangler r2 bucket create excalidraw-drawings
   ```
3. **Cloudflare Zero Trust:**
   1. Choose the team domain `berkslv.cloudflareaccess.com`. If you use another one, update `ACCESS_TEAM_DOMAIN`.
   2. Add Google as a login method. The OAuth redirect URI is `https://berkslv.cloudflareaccess.com/cdn-cgi/access/callback`.
   3. Create a **self-hosted** application:
      - Domain: `excalidraw.berkslv.com`
      - Policy: Allow, Include → Emails → `berkslv@gmail.com`
      - Turn on Instant Auth and the binding cookie.
   4. Copy the application's **AUD tag** into `ACCESS_AUD` in `wrangler.jsonc`.
4. **Deploy:** `npm run deploy` (build, remote D1 migration, `wrangler deploy`). The custom domain and its DNS record are created on deploy.

`workers_dev` and `preview_urls` are disabled, so `excalidraw.berkslv.com` is the only hostname and Access covers all of it.

## Checks after deploying

- In a private window, opening the site goes to Google sign-in and then the app.
- Signing in with any other Google account gets "Access denied".
- `curl https://excalidraw.berkslv.com/api/drawings` returns a redirect or 403.
- Open the same drawing on two devices: the second one waits, then gets the lock when the first leaves.
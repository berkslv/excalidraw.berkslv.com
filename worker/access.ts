import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/**
 * Returns the caller's email when the request carries a valid Cloudflare Access
 * JWT for this application and the email is allowlisted, otherwise null.
 */
export async function authenticate(req: Request, env: Env): Promise<string | null> {
  // `wrangler dev` has no Access in front of it. DEV_EMAIL only exists in .dev.vars,
  // and production traffic can never arrive with a localhost host.
  const host = new URL(req.url).hostname;
  if (env.DEV_EMAIL && (host === "localhost" || host === "127.0.0.1")) {
    return env.DEV_EMAIL;
  }

  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  jwks ??= createRemoteJWKSet(new URL(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    const allowed = env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase());
    return email && allowed.includes(email) ? email : null;
  } catch {
    return null;
  }
}

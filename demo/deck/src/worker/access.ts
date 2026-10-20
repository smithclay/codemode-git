// Cloudflare Access in front of /edit and /api/agent: Access signs the user
// in and adds a signed JWT (Cf-Access-Jwt-Assertion) to every request it lets
// through. The Worker checks it anyway, so a request that reaches it some other
// way (a misconfigured Access app, a direct route) can't edit the deck.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

type Jwk = JsonWebKey & { kid: string };
const CERTS_TTL_MS = 60 * 60 * 1000;
let certs: { domain: string; keys: Jwk[]; at: number } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const json = <T,>(s: string) => JSON.parse(new TextDecoder().decode(b64url(s))) as T;

async function keys(teamDomain: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && certs?.domain === teamDomain && Date.now() - certs.at < CERTS_TTL_MS) return certs.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  certs = { domain: teamDomain, keys: ((await res.json()) as { keys: Jwk[] }).keys, at: Date.now() };
  return certs.keys;
}

/** The signed-in user's email, or null if the request has no valid Access JWT for this app. */
export async function accessUser(request: Request, teamDomain: string, aud: string): Promise<string | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  try {
    const { kid, alg } = json<{ kid: string; alg: string }>(head);
    if (alg !== "RS256") return null;
    // Access rotates its keys; an unknown kid means ours are stale.
    const jwk = (await keys(teamDomain)).find((k) => k.kid === kid) ?? (await keys(teamDomain, true)).find((k) => k.kid === kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${head}.${body}`));
    if (!ok) return null;
    const claims = json<{ aud: string | string[]; exp: number; iss: string; email?: string; sub?: string }>(body);
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud) || claims.exp * 1000 < Date.now() || claims.iss !== `https://${teamDomain}`) return null;
    return claims.email ?? claims.sub ?? "access";
  } catch (err) {
    console.error("Access JWT check failed", err);
    return null;
  }
}

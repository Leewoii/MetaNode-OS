interface Env {
  ACCESS_KV: KVNamespace;
  ADMIN_TOKEN: string;
  APP_GRANT_SECRET: string;
  DISTRIBUTION_SHARED_SECRET: string;
  GRANT_TTL_SECONDS?: string;
  DOWNLOAD_TOKEN_TTL_SECONDS?: string;
}

type AccessStatus = "approved" | "pending" | "denied";

interface AccessRequestBody {
  userId?: string;
  deviceId?: string;
  platform?: string;
  arch?: string;
  appVersion?: string;
}

interface AccessRecord {
  id: string;
  userId: string;
  ip: string;
  deviceId: string;
  platform: string;
  arch: string;
  appVersion: string;
  status: AccessStatus;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

interface GrantPayload {
  type: "runtime-grant";
  userId: string;
  ip: string;
  deviceId: string;
  requestId: string;
  exp: number;
  iat: number;
}

const encoder = new TextEncoder();
type TimingSafeSubtleCrypto = SubtleCrypto & {
  timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
      if (url.pathname === "/v1/access/check" && request.method === "POST") return cors(await checkAccess(request, env));
      if (url.pathname === "/v1/access/request" && request.method === "POST") return cors(await requestAccess(request, env));
      if (url.pathname === "/v1/access/verify" && request.method === "POST") return cors(await verifyGrant(request, env));
      if (url.pathname === "/v1/core/download-token" && request.method === "POST") return cors(await createDownloadToken(request, env));
      if (url.pathname === "/v1/admin/requests" && request.method === "GET") return cors(await listRequests(request, env));
      const decisionMatch = url.pathname.match(/^\/v1\/admin\/requests\/([^/]+)\/decision$/);
      if (decisionMatch && request.method === "POST") return cors(await decideRequest(request, env, decisionMatch[1]));
      if (url.pathname === "/admin" && request.method === "GET") return html(adminPage());
      return json({ error: "not found" }, 404);
    } catch (error) {
      ctx.waitUntil(writeAudit(env, "gate.error", { message: error instanceof Error ? error.message : String(error) }));
      return cors(json({ error: "gate request failed" }, 500));
    }
  }
} satisfies ExportedHandler<Env>;

async function checkAccess(request: Request, env: Env): Promise<Response> {
  const body = await readJson<AccessRequestBody>(request);
  const input = normalizeAccessInput(body, request);
  const record = await getRecord(env, input.userId, input.ip, input.deviceId);
  if (!record) {
    const created = await upsertRecord(env, input, "pending");
    await writeAudit(env, "access.requested", { requestId: created.id, userId: created.userId, ip: created.ip, deviceId: created.deviceId });
    return json({ status: "pending", message: "Access request sent. Try again later once accepted." });
  }
  if (record.status !== "approved") {
    return json({ status: record.status, message: record.status === "denied" ? "Access denied." : "Access request sent. Try again later once accepted." });
  }
  const grant = await signGrant(env, record);
  await writeAudit(env, "access.granted", { requestId: record.id, userId: record.userId, ip: record.ip, deviceId: record.deviceId });
  return json({ status: "approved", grant, expiresIn: grantTtl(env) });
}

async function requestAccess(request: Request, env: Env): Promise<Response> {
  const body = await readJson<AccessRequestBody>(request);
  const input = normalizeAccessInput(body, request);
  const record = await upsertRecord(env, input, "pending");
  await writeAudit(env, "access.requested", { requestId: record.id, userId: record.userId, ip: record.ip, deviceId: record.deviceId });
  return json({ status: record.status, message: "Access request sent. Try again later once accepted." });
}

async function verifyGrant(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ grant?: string; deviceId?: string }>(request);
  const grant = await parseSignedPayload<GrantPayload>(env.APP_GRANT_SECRET, String(body.grant ?? ""));
  const ip = clientIp(request);
  if (!grant || grant.type !== "runtime-grant" || grant.exp < nowSeconds() || grant.deviceId !== body.deviceId || grant.ip !== ip) {
    return json({ ok: false }, 403);
  }
  const record = await getRecord(env, grant.userId, grant.ip, grant.deviceId);
  if (!record || record.status !== "approved") return json({ ok: false }, 403);
  return json({ ok: true, userId: grant.userId, requestId: grant.requestId, expiresAt: new Date(grant.exp * 1000).toISOString() });
}

async function createDownloadToken(request: Request, env: Env): Promise<Response> {
  const auth = bearer(request);
  const grant = await parseSignedPayload<GrantPayload>(env.APP_GRANT_SECRET, auth);
  if (!grant || grant.exp < nowSeconds() || grant.ip !== clientIp(request)) return json({ error: "invalid grant" }, 403);
  const record = await getRecord(env, grant.userId, grant.ip, grant.deviceId);
  if (!record || record.status !== "approved") return json({ error: "not approved" }, 403);
  const payload = {
    type: "core-download",
    userId: grant.userId,
    ip: grant.ip,
    deviceId: grant.deviceId,
    requestId: grant.requestId,
    exp: nowSeconds() + downloadTtl(env),
    iat: nowSeconds()
  };
  const token = await signPayload(env.DISTRIBUTION_SHARED_SECRET, payload);
  return json({ token, expiresIn: downloadTtl(env) });
}

async function listRequests(request: Request, env: Env): Promise<Response> {
  if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401);
  const rows = await env.ACCESS_KV.list({ prefix: "request:" });
  const records = await Promise.all(rows.keys.map((key) => env.ACCESS_KV.get<AccessRecord>(key.name, "json")));
  return json({ requests: records.filter(Boolean).sort((a, b) => String(b?.updatedAt).localeCompare(String(a?.updatedAt))) });
}

async function decideRequest(request: Request, env: Env, id: string): Promise<Response> {
  if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401);
  const body = await readJson<{ decision?: AccessStatus; reason?: string; admin?: string }>(request);
  if (body.decision !== "approved" && body.decision !== "denied") return json({ error: "decision must be approved or denied" }, 400);
  const record = await env.ACCESS_KV.get<AccessRecord>(`request:${id}`, "json");
  if (!record) return json({ error: "request not found" }, 404);
  const updated: AccessRecord = {
    ...record,
    status: body.decision,
    updatedAt: new Date().toISOString(),
    decidedAt: new Date().toISOString(),
    decidedBy: String(body.admin ?? "admin"),
    reason: typeof body.reason === "string" ? body.reason : undefined
  };
  await env.ACCESS_KV.put(`request:${id}`, JSON.stringify(updated));
  await writeAudit(env, `access.${body.decision}`, { requestId: id, userId: updated.userId, ip: updated.ip, deviceId: updated.deviceId });
  return json({ request: updated });
}

function normalizeAccessInput(body: AccessRequestBody, request: Request) {
  const userId = cleanId(body.userId, "anonymous");
  const deviceId = cleanId(body.deviceId, "unknown-device");
  return {
    userId,
    deviceId,
    ip: clientIp(request),
    platform: String(body.platform ?? "unknown").slice(0, 64),
    arch: String(body.arch ?? "unknown").slice(0, 64),
    appVersion: String(body.appVersion ?? "unknown").slice(0, 64)
  };
}

async function upsertRecord(env: Env, input: ReturnType<typeof normalizeAccessInput>, fallbackStatus: AccessStatus): Promise<AccessRecord> {
  const existing = await getRecord(env, input.userId, input.ip, input.deviceId);
  if (existing) {
    const updated: AccessRecord = { ...existing, ...input, updatedAt: new Date().toISOString() };
    await env.ACCESS_KV.put(`request:${updated.id}`, JSON.stringify(updated));
    await env.ACCESS_KV.put(indexKey(input.userId, input.ip, input.deviceId), updated.id);
    return updated;
  }
  const record: AccessRecord = {
    id: crypto.randomUUID(),
    ...input,
    status: fallbackStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await env.ACCESS_KV.put(`request:${record.id}`, JSON.stringify(record));
  await env.ACCESS_KV.put(indexKey(input.userId, input.ip, input.deviceId), record.id);
  return record;
}

async function getRecord(env: Env, userId: string, ip: string, deviceId: string): Promise<AccessRecord | null> {
  const id = await env.ACCESS_KV.get(indexKey(userId, ip, deviceId));
  if (!id) return null;
  return env.ACCESS_KV.get<AccessRecord>(`request:${id}`, "json");
}

async function signGrant(env: Env, record: AccessRecord): Promise<string> {
  return signPayload(env.APP_GRANT_SECRET, {
    type: "runtime-grant",
    userId: record.userId,
    ip: record.ip,
    deviceId: record.deviceId,
    requestId: record.id,
    iat: nowSeconds(),
    exp: nowSeconds() + grantTtl(env)
  } satisfies GrantPayload);
}

async function signPayload(secret: string, payload: unknown): Promise<string> {
  const encodedPayload = base64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${base64UrlBytes(new Uint8Array(sig))}`;
}

async function parseSignedPayload<T>(secret: string, token: string): Promise<T | null> {
  const [encodedPayload, encodedSig] = token.split(".");
  if (!encodedPayload || !encodedSig) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(textFromBase64Url(encodedPayload));
  } catch {
    return null;
  }
  const expected = await signPayload(secret, decoded);
  const expectedSig = expected.split(".")[1];
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(encodedSig)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedSig))
  ]);
  if (!timingSafeEqual(a, b)) return null;
  return decoded as T;
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  const provided = bearer(request);
  if (!provided || !env.ADMIN_TOKEN) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(env.ADMIN_TOKEN))
  ]);
  return timingSafeEqual(a, b);
}

async function readJson<T>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) throw new Error("request too large");
  return (await request.json()) as T;
}

async function writeAudit(env: Env, action: string, data: Record<string, unknown>) {
  const id = `${new Date().toISOString()}:${crypto.randomUUID()}`;
  await env.ACCESS_KV.put(`audit:${id}`, JSON.stringify({ id, action, data, createdAt: new Date().toISOString() }));
}

function bearer(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
}

function cleanId(value: unknown, fallback: string): string {
  const clean = String(value ?? "").trim().replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 128);
  return clean || fallback;
}

function indexKey(userId: string, ip: string, deviceId: string): string {
  return `index:${userId}:${ip}:${deviceId}`;
}

function grantTtl(env: Env): number {
  return Number(env.GRANT_TTL_SECONDS ?? 900);
}

function downloadTtl(env: Env): number {
  return Number(env.DOWNLOAD_TOKEN_TTL_SECONDS ?? 300);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function html(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");
  return new Response(response.body, { status: response.status, headers });
}

function base64Url(input: string): string {
  return base64UrlBytes(encoder.encode(input));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textFromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  return (crypto.subtle as TimingSafeSubtleCrypto).timingSafeEqual(a, b);
}

function adminPage(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MetaNode OS Access Gate</title>
  <style>
    body{font-family:Inter,system-ui,sans-serif;background:#0b1016;color:#edf7ff;margin:0;padding:28px}
    input,button{background:#111923;border:1px solid #2a3948;color:#edf7ff;border-radius:8px;padding:8px 10px}
    .row{border:1px solid #22313f;border-radius:10px;padding:12px;margin:10px 0;background:#101821}
    .actions{display:flex;gap:8px;margin-top:10px}
    small{color:#8fb1c7}
  </style>
</head>
<body>
  <h1>MetaNode OS Access Gate</h1>
  <p><input id="token" type="password" placeholder="Admin token" /> <button onclick="loadRequests()">Load requests</button></p>
  <div id="requests"></div>
  <script>
    async function loadRequests(){
      const token = document.getElementById('token').value;
      const res = await fetch('/v1/admin/requests', { headers: { authorization: 'Bearer ' + token } });
      const data = await res.json();
      document.getElementById('requests').innerHTML = (data.requests || []).map(r => '<div class="row"><strong>'+r.userId+'</strong> <small>'+r.status+'</small><br/><small>'+r.ip+' / '+r.deviceId+' / '+r.platform+' '+r.arch+' / '+r.appVersion+'</small><div class="actions"><button onclick="decide(\\''+r.id+'\\',\\'approved\\')">Approve</button><button onclick="decide(\\''+r.id+'\\',\\'denied\\')">Deny</button></div></div>').join('');
    }
    async function decide(id, decision){
      const token = document.getElementById('token').value;
      await fetch('/v1/admin/requests/'+id+'/decision', { method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer '+token }, body: JSON.stringify({ decision }) });
      await loadRequests();
    }
  </script>
</body>
</html>`;
}

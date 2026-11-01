import { isValidPinShape, sanitizePin, SESSION_DAYS } from "./listing-rules";
import {
  classifyBarcode,
  lookupOnAmazon,
  NOTICE_NOT_SET_UP,
  NOTICE_UNAVAILABLE,
  type Env,
} from "./amazon-catalog.server";
import { signToken, timingSafeEqualStr, verifyToken } from "./session.server";

/**
 * JSON API for the native Android companion app.
 *   POST /api/app/unlock         { "pin": "123456" }  ->  { token, expiresAt }
 *   GET  /api/app/barcode/<code> with "Authorization: Bearer <token>"
 *
 * The app unlocks with the same PIN as the website. Its token is signed with a key derived from
 * SESSION_SECRET but different from the website cookie's, so one can never be used as the other.
 */

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;
const failures = new Map<string, { count: number; resetAt: number }>();

export function resetAppApiState() {
  failures.clear();
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function appSecret(env: Env): string | null {
  const s = env["SESSION_SECRET"];
  return s ? `${s}:android-app` : null;
}

/** Lockout is held in this server instance's memory: it slows guessing but resets when the instance restarts. */
function lockedOut(ip: string, now: number): number {
  const f = failures.get(ip);
  if (!f || f.resetAt <= now) return 0;
  return f.count >= MAX_FAILURES ? Math.ceil((f.resetAt - now) / 1000) : 0;
}

function recordFailure(ip: string, now: number) {
  const f = failures.get(ip);
  if (!f || f.resetAt <= now) failures.set(ip, { count: 1, resetAt: now + LOCKOUT_MS });
  else f.count++;
  if (failures.size > 1000) for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
}

export async function handleAppUnlock(
  request: Request,
  env: Env = process.env,
  now = Date.now(),
): Promise<Response> {
  const secret = appSecret(env);
  const adminPin = env["ADMIN_PIN"]?.trim();
  if (!secret || !adminPin) return json({ error: "Server is missing configuration." }, 500);

  const ip = clientIp(request);
  const wait = lockedOut(ip, now);
  if (wait > 0)
    return json({ error: "Too many wrong PINs. Try again later.", retryAfterSeconds: wait }, 429, {
      "Retry-After": String(wait),
    });

  let pin = "";
  try {
    const body = (await request.json()) as { pin?: unknown };
    pin = sanitizePin(String(body?.pin ?? ""));
  } catch {
    return json({ error: 'Send JSON like {"pin":"123456"}.' }, 400);
  }
  if (!isValidPinShape(pin)) return json({ error: "Enter all 6 digits." }, 400);

  if (!(await timingSafeEqualStr(pin, adminPin))) {
    recordFailure(ip, now);
    return json({ error: "Wrong PIN." }, 401);
  }

  failures.delete(ip);
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  return json({ token: await signToken(secret, expiresAt), expiresAt });
}

export async function isAppAuthorized(
  request: Request,
  env: Env = process.env,
  now = Date.now(),
): Promise<boolean> {
  const secret = appSecret(env);
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!secret || !token) return false;
  return verifyToken(secret, token, now);
}

export async function handleAppBarcode(
  request: Request,
  rawCode: string,
  env: Env = process.env,
  f: typeof fetch = fetch,
): Promise<Response> {
  if (!appSecret(env)) return json({ error: "Server is missing configuration." }, 500);
  if (!(await isAppAuthorized(request, env)))
    return json({ error: "Locked. Unlock the app with your PIN." }, 401);

  let code = rawCode;
  try {
    code = decodeURIComponent(rawCode);
  } catch {
    /* keep the raw value; classifyBarcode will reject it */
  }
  const parsed = classifyBarcode(code);
  if (!parsed) return json({ error: "That doesn't look like a valid product barcode." }, 400);

  const { result, notice } = await lookupOnAmazon(parsed.code, env, f);
  if (result) return json({ found: true, barcode: parsed.code, ...result });
  if (notice === NOTICE_NOT_SET_UP) return json({ error: notice }, 503);
  if (notice === NOTICE_UNAVAILABLE) return json({ error: notice }, 502);
  return json(
    { found: false, barcode: parsed.code, message: "No Amazon listing found for this barcode." },
    404,
  );
}

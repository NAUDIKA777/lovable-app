import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { SESSION_DAYS } from "./listing-rules";

export const COOKIE_NAME = "sw_unlock";
const enc = new TextEncoder();

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function b64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** Constant-time equality over SHA-256 digests (lengths always match). */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export async function signToken(secret: string, expiresAtMs: number): Promise<string> {
  const payload = String(expiresAtMs);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyToken(secret: string, token: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !/^\d+$/.test(payload)) return false;
  let sigBytes: Uint8Array<ArrayBuffer>;
  try { sigBytes = fromB64url(sig); } catch { return false; }
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes, enc.encode(payload));
  return ok && Number(payload) > nowMs;
}

function secret() {
  const s = process.env["SESSION_SECRET"];
  if (!s) throw new Error("SESSION_SECRET missing");
  return s;
}

export async function isUnlocked(): Promise<boolean> {
  return verifyToken(secret(), getCookie(COOKIE_NAME));
}

export async function requireUnlocked() {
  if (!(await isUnlocked())) throw new Error("Locked");
}

export async function issueUnlockCookie() {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const token = await signToken(secret(), Date.now() + maxAge * 1000);
  setCookie(COOKIE_NAME, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge });
}

export function clearUnlockCookie() {
  deleteCookie(COOKIE_NAME, { path: "/" });
}

export async function checkPin(pin: string): Promise<boolean> {
  const expected = process.env["ADMIN_PIN"];
  if (!expected) throw new Error("ADMIN_PIN missing");
  return timingSafeEqualStr(pin, expected.trim());
}

// Single-owner sign-in. The password lives in a Worker secret; the session is a
// signed, HttpOnly cookie, so no session table is needed. Rotating SESSION_SECRET
// signs out every device.

import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env";

const COOKIE = "da_session";
const SESSION_DAYS = 180;
const MAX_FAILURES = 8; // per 15 minutes
const WINDOW_MS = 15 * 60_000;

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time comparison via HMAC digests, so lengths and prefixes don't leak. */
async function safeEqual(secret: string, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hmac(secret, a), hmac(secret, b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0 && x.length === y.length;
}

function requireSecrets(env: Env) {
  if (!env.APP_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("APP_PASSWORD and SESSION_SECRET (32+ chars) must be set as Worker secrets.");
  }
}

export async function isSignedIn(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const raw = getCookie(c, COOKIE);
  if (!raw || !c.env.SESSION_SECRET) return false;
  const [exp, sig] = raw.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(c.env.SESSION_SECRET, sig, await hmac(c.env.SESSION_SECRET, `v1:${exp}`));
}

export async function login(c: Context<{ Bindings: Env }>, password: string): Promise<{ ok: boolean; error?: string; status?: number }> {
  requireSecrets(c.env);
  const db = c.env.DB;
  const since = Date.now() - WINDOW_MS;
  await db.prepare("DELETE FROM login_attempts WHERE at < ?").bind(since).run();
  const row = await db.prepare("SELECT COUNT(*) AS n FROM login_attempts").first<{ n: number }>();
  if ((row?.n ?? 0) >= MAX_FAILURES) return { ok: false, status: 429, error: "Too many attempts. Try again in 15 minutes." };

  if (!(await safeEqual(c.env.SESSION_SECRET, password, c.env.APP_PASSWORD))) {
    await db.prepare("INSERT INTO login_attempts (at) VALUES (?)").bind(Date.now()).run();
    return { ok: false, status: 401, error: "Wrong password." };
  }
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  setCookie(c, COOKIE, `${exp}.${await hmac(c.env.SESSION_SECRET, `v1:${exp}`)}`, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return { ok: true };
}

export function logout(c: Context<{ Bindings: Env }>) {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Every /api route except login needs a session; writes must also come from our own origin. */
export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Cross-origin request refused." }, 403);
  }
  if (!(await isSignedIn(c))) return c.json({ error: "Not signed in." }, 401);
  await next();
};

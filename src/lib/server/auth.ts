// One password, one signed cookie. The site is a single person's task list, so
// there are no accounts — just proof that whoever is holding the phone knows
// APP_PASSWORD. The cookie is `<expiry>.<hmac(expiry)>`, so it can be checked
// without any server-side session store.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AstroCookies } from "astro";
import { APP_PASSWORD, SESSION_SECRET } from "astro:env/server";

export const SESSION_COOKIE = "tasks_session";
const SESSION_DAYS = 90;

const digest = (value: string) => createHash("sha256").update(value).digest();

const sign = (payload: string) =>
  createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");

// Hashing both sides first makes the comparison constant-time regardless of
// length, which timingSafeEqual alone would leak.
export function checkPassword(input: unknown): boolean {
  if (typeof input !== "string" || !APP_PASSWORD) return false;
  return timingSafeEqual(digest(input), digest(APP_PASSWORD));
}

export function isValidSession(value: string | undefined): boolean {
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function startSession(cookies: AstroCookies, secure: boolean): void {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  cookies.set(SESSION_COOKIE, `${expires}.${sign(String(expires))}`, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
    expires: new Date(expires),
  });
}

export function endSession(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

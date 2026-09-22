// Whose Notion this request talks to. There are no accounts and no server-side
// settings: each device that connects keeps its own integration token and
// database id in a cookie, and every API request reads them from there. The
// cookie is httpOnly, so the page's scripts can never read the token back.

import type { AstroCookies } from "astro";
import { normalizeDatabaseId } from "../tasksLogic";

export interface NotionConfig {
  apiKey: string;
  // Normalised: 32 hex characters, no dashes
  databaseId: string;
}

export const CONNECTION_COOKIE = "tasks_notion";
// Browsers cap cookie lifetimes at 400 days
const CONNECTION_DAYS = 400;
// Notion tokens are ~50 characters; anything far longer isn't one
const MAX_API_KEY_LENGTH = 200;

export function sanitizeApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key || key.length > MAX_API_KEY_LENGTH || /\s/.test(key)) return null;
  return key;
}

// A config from what the user typed: the key as-is, the database as an id or
// any Notion URL that contains one.
export function parseConfig(apiKey: unknown, database: unknown): NotionConfig | null {
  const key = sanitizeApiKey(apiKey);
  const databaseId = typeof database === "string" ? normalizeDatabaseId(database) : null;
  return key && databaseId
    ? { apiKey: key, databaseId: databaseId.replace(/-/g, "").toLowerCase() }
    : null;
}

export function encodeConfig(config: NotionConfig): string {
  return Buffer.from(JSON.stringify({ k: config.apiKey, d: config.databaseId })).toString(
    "base64url",
  );
}

// Anything that doesn't decode to a usable config counts as not connected.
export function decodeConfig(value: string | undefined): NotionConfig | null {
  if (!value) return null;
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!data || typeof data !== "object") return null;
    const { k, d } = data as Record<string, unknown>;
    return parseConfig(k, d);
  } catch {
    return null;
  }
}

export function readConnection(cookies: AstroCookies): NotionConfig | null {
  return decodeConfig(cookies.get(CONNECTION_COOKIE)?.value);
}

export function saveConnection(cookies: AstroCookies, config: NotionConfig, secure: boolean) {
  cookies.set(CONNECTION_COOKIE, encodeConfig(config), {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: CONNECTION_DAYS * 24 * 60 * 60,
  });
}

export function clearConnection(cookies: AstroCookies) {
  cookies.delete(CONNECTION_COOKIE, { path: "/" });
}

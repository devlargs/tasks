// Whose Notion this device talks to. There are no accounts and no server: the
// phone keeps its own integration token and database id in the platform's
// secure storage (Keychain / Keystore) and calls Notion itself. The web app
// keeps the same pair in an httpOnly cookie its server reads
// (src/lib/server/connection.ts there).

import * as SecureStore from "expo-secure-store";
import { normalizeDatabaseId } from "./tasksLogic";

export interface NotionConfig {
  apiKey: string;
  // Normalised: 32 hex characters, no dashes
  databaseId: string;
}

const CONNECTION_KEY = "tasks_notion";
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
  return JSON.stringify({ k: config.apiKey, d: config.databaseId });
}

// Anything that doesn't decode to a usable config counts as not connected.
export function decodeConfig(value: string | null | undefined): NotionConfig | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value) as unknown;
    if (!data || typeof data !== "object") return null;
    const { k, d } = data as Record<string, unknown>;
    return parseConfig(k, d);
  } catch {
    return null;
  }
}

// Read synchronously: the first frame decides between the list and setup.
export function readConnection(): NotionConfig | null {
  try {
    return decodeConfig(SecureStore.getItem(CONNECTION_KEY));
  } catch {
    return null;
  }
}

export async function saveConnection(config: NotionConfig): Promise<void> {
  await SecureStore.setItemAsync(CONNECTION_KEY, encodeConfig(config));
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(CONNECTION_KEY);
}

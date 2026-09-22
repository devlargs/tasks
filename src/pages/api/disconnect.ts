import type { APIRoute } from "astro";
import { clearConnection } from "../../lib/server/connection";
import { ok } from "../../lib/server/http";

// Forgets this device's Notion connection. The database itself is untouched.
export const POST: APIRoute = ({ cookies }) => {
  clearConnection(cookies);
  return Promise.resolve(ok({}));
};

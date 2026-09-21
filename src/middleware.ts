import { defineMiddleware } from "astro:middleware";
import { isValidSession, SESSION_COOKIE } from "./lib/server/auth";

// Reachable without a session: the login page and what it needs to render.
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/login",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
]);

export const onRequest = defineMiddleware((context, next) => {
  const { request, url, cookies } = context;

  // Writes must come from this site. The session cookie is SameSite=Lax, which
  // already keeps it off cross-site POSTs; this is the belt to that brace.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) {
      return new Response("Cross-origin request refused.", { status: 403 });
    }
  }

  if (PUBLIC_PATHS.has(url.pathname) || url.pathname.startsWith("/_astro/")) return next();
  if (isValidSession(cookies.get(SESSION_COOKIE)?.value)) return next();

  if (url.pathname.startsWith("/api/")) {
    return Response.json({ ok: false, error: "Signed out — reload to sign in." }, { status: 401 });
  }
  return context.redirect("/login");
});

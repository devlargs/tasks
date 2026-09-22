import { defineMiddleware } from "astro:middleware";

// There are no accounts: each device brings its own Notion connection in a
// cookie (lib/server/connection.ts), or keeps its tasks locally. What's left to
// guard is the cookie itself — writes must come from this site. The cookie is
// SameSite=Lax, which already keeps it off cross-site POSTs; this is the belt
// to that brace.
export const onRequest = defineMiddleware(({ request, url }, next) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) {
      return new Response("Cross-origin request refused.", { status: 403 });
    }
  }
  return next();
});

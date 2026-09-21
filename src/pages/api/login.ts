import type { APIRoute } from "astro";
import { checkPassword, startSession } from "../../lib/server/auth";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A plain form post, so signing in works before any script has loaded.
export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData().catch(() => null);
  if (!checkPassword(form?.get("password"))) {
    // Slows guessing to a crawl without needing any stored state
    await wait(1000);
    return redirect("/login?error=1", 303);
  }
  startSession(cookies, url.protocol === "https:");
  return redirect("/", 303);
};

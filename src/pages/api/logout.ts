import type { APIRoute } from "astro";
import { endSession } from "../../lib/server/auth";

export const POST: APIRoute = ({ cookies, redirect }) => {
  endSession(cookies);
  return redirect("/login", 303);
};

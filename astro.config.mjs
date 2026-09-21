// @ts-check
import { defineConfig, envField } from "astro/config";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://tasks.ralphlargo.com",
  // Every page and route reads Notion or the session cookie at request time
  output: "server",
  adapter: vercel(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  env: {
    schema: {
      // The same integration token and database Largs Hub's Todo is connected to
      NOTION_API_KEY: envField.string({ context: "server", access: "secret" }),
      NOTION_DATABASE_ID: envField.string({ context: "server", access: "secret" }),
      // The one password that unlocks the site
      APP_PASSWORD: envField.string({ context: "server", access: "secret", min: 8 }),
      // Signs the session cookie; any long random string
      SESSION_SECRET: envField.string({ context: "server", access: "secret", min: 32 }),
    },
  },
});

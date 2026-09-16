import type { Config } from "@netlify/functions";
import { publicSupabaseAuthConfig } from "../shared/platform/supabase-auth-config.mjs";

export default async () => {
  const config = publicSupabaseAuthConfig((name) => Netlify.env.get(name));
  return new Response(JSON.stringify(config), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600"
    }
  });
};

export const config: Config = {
  path: "/api/supabase-auth-config",
  method: ["GET"]
};

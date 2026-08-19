import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/config/env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = ReturnType<typeof createClient<any, "data_pipeline">>;

let _client: AnySupabaseClient | null = null;

export function getSupabaseClient(): AnySupabaseClient {
  if (_client) return _client;

  const env = getEnv();
  _client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "data_pipeline" },
  });

  return _client;
}

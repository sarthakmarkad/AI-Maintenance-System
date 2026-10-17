import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicConfig } from "./config";
let client: SupabaseClient | undefined;
export function getSupabase() {
  const config = publicConfig();
  if (!config.success) return null;
  client ??= createClient(config.data.supabaseUrl, config.data.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return client;
}

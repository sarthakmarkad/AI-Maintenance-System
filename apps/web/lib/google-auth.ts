import { getSupabase } from "./supabase";
import { publicConfig } from "./config";
import { clearRoleSelection, setRoleIdentity } from "./role-selection";

// Provider availability is public configuration, never an authorization decision.
export async function googleSignInAvailable(signal: AbortSignal) {
  const config = publicConfig();
  if (!config.success) return false;
  const response = await fetch(`${config.data.supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: config.data.publishableKey },
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
  });
  if (!response.ok) throw new Error("Sign-in options are unavailable.");
  const settings = await response.json();
  if (typeof settings?.external?.google !== "boolean")
    throw new Error("Sign-in options are unavailable.");
  return settings.external.google as boolean;
}

export async function beginGoogleSignIn() {
  clearRoleSelection();
  const client = getSupabase();
  if (!client) throw new Error("Sign-in setup is required.");
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url)
    throw new Error("Google sign-in could not start. Please try again.");
  window.location.assign(data.url);
}

// A code is single-use. React's development effect replay and a workspace-check
// retry must share the same in-flight exchange, rather than consume it twice.
let exchange:
  | { code: string; flowId?: string; task: ReturnType<typeof exchangeCode> }
  | undefined;
async function exchangeCode(code: string, flowId?: string) {
  const client = getSupabase();
  if (!client) throw new Error("Sign-in setup is required.");
  let recovery = false;
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") recovery = true;
  });
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (error || !data.session)
      throw new Error(
        "This sign-in link expired or could not be verified. Start sign-in again in this browser.",
      );
    setRoleIdentity(data.session.user.id);
    return { ...data.session, redirectType: recovery ? "recovery" : null };
  } finally {
    subscription.unsubscribe();
  }
}
export function exchangeGoogleCodeOnce(code: string, flowId?: string) {
  if (!exchange || exchange.code !== code || exchange.flowId !== flowId)
    exchange = { code, flowId, task: exchangeCode(code, flowId) };
  return exchange.task;
}

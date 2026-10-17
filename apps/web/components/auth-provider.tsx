"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { setRoleIdentity } from "@/lib/role-selection";
type State = {
  session: Session | null;
  loading: boolean;
  error: string | null;
  expired: boolean;
};
const AuthContext = createContext<State & { expire: () => Promise<void> }>({
  session: null,
  loading: true,
  error: null,
  expired: false,
  expire: async () => {},
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({
    session: null,
    loading: true,
    error: null,
    expired: false,
  });
  const expire = useCallback(async () => {
    setRoleIdentity(null);
    // Keep the expiry reason across sign-out events and nested protected components.
    setState({ session: null, loading: false, error: null, expired: true });
    try {
      await getSupabase()?.auth.signOut({ scope: "local" });
    } catch {
      /* Local UI stays signed out even if provider cleanup fails. */
    }
  }, []);
  useEffect(() => {
    const client = getSupabase();
    if (!client) {
      setState({ session: null, loading: false, error: null, expired: false });
      return;
    }
    let mounted = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      setRoleIdentity(session?.user.id ?? null);
      if (mounted)
        setState((current) =>
          current.session?.access_token === session?.access_token &&
          !current.loading &&
          !current.error
            ? current
            : {
                session,
                loading: false,
                error: null,
                expired: session ? false : current.expired,
              },
        );
    });
    client.auth
      .getSession()
      .then(({ data, error }) => {
        setRoleIdentity(data.session?.user.id ?? null);
        if (mounted)
          setState((current) => ({
            session: data.session,
            loading: false,
            error: error
              ? "Your saved session could not be restored. Please sign in again."
              : null,
            expired: data.session ? false : current.expired,
          }));
      })
      .catch(() => {
        if (mounted)
          setState((current) => ({
            ...current,
            session: null,
            loading: false,
            error:
              "Your saved session could not be restored. Please sign in again.",
          }));
      });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);
  return (
    <AuthContext.Provider value={{ ...state, expire }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);

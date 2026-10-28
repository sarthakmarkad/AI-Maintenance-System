"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { api, ApiError, type Me } from "@/lib/api";
import { exchangeGoogleCodeOnce } from "@/lib/google-auth";
import { getSupabase } from "@/lib/supabase";
import type { StaffInvitations } from "@/components/team-types";
import { Button } from "@/components/ui/button";

type Callback = { code: string | null; flowId?: string; denied: boolean };
export default function AuthCallback() {
  const router = useRouter();
  const request = useRef<Callback | null>(null);
  const [state, setState] = useState<
    "loading" | "error" | "membership" | "unavailable"
  >("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    if (!request.current) {
      const params = new URLSearchParams(window.location.search);
      const codes = params.getAll("code");
      const flows = params.getAll("sb_flow_id");
      request.current = {
        code:
          codes.length === 1 && codes[0].length > 0 && codes[0].length <= 2048
            ? codes[0]
            : null,
        flowId:
          flows.length === 1 && /^[a-zA-Z0-9_-]{8,64}$/.test(flows[0])
            ? flows[0]
            : undefined,
        denied:
          params.has("error") ||
          (flows.length > 0 &&
            (flows.length !== 1 || !/^[a-zA-Z0-9_-]{8,64}$/.test(flows[0]))),
      };
      // Never leave authorization codes/provider errors in browser history or referrers.
      window.history.replaceState(null, "", "/auth/callback");
    }
    const { code, flowId, denied } = request.current;
    if (!code || denied) {
      setState("error");
      return;
    }
    setState("loading");
    exchangeGoogleCodeOnce(code, flowId)
      .then(async (session) => {
        if (!active) return;
        if (session.redirectType === "recovery") {
          router.replace("/reset-password");
          return;
        }
        try {
          await api<Me>("/me", session.access_token);
          if (active) router.replace("/machines");
        } catch (e) {
          if (!active) return;
          if (e instanceof ApiError && e.status === 403) {
            try {
              const pending = await api<StaffInvitations>(
                "/team/onboarding/available",
                session.access_token,
                undefined,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                },
              );
              if (
                active &&
                pending.items?.some(
                  (i) =>
                    typeof i.email === "string" && typeof i.role === "string",
                )
              ) {
                router.replace("/join");
                return;
              }
              if (active) setState("membership");
            } catch (onboardingError) {
              if (active)
                setState(
                  onboardingError instanceof ApiError &&
                    (onboardingError.status === 0 ||
                      onboardingError.status === 429 ||
                      onboardingError.status >= 500)
                    ? "unavailable"
                    : "membership",
                );
            }
          } else if (e instanceof ApiError && e.status === 401) {
            await getSupabase()?.auth.signOut({ scope: "local" });
            if (active) setState("error");
          } else setState("unavailable");
        }
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [router, attempt]);
  async function signInAgain() {
    setState("loading");
    try {
      const result = await getSupabase()?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
      router.replace("/login");
    } catch {
      setState("unavailable");
    }
  }
  return (
    <main className="auth-callback-page">
      <section className="panel auth-callback-card">
        <ShieldCheck size={32} />
        <span className="eyebrow">SUPREME / TEAM ACCESS</span>
        <h1>
          {state === "loading"
            ? "Completing sign-in…"
            : state === "membership"
              ? "Workspace access needed"
              : state === "unavailable"
                ? "Workspace check unavailable"
                : "Sign-in could not finish"}
        </h1>
        {state === "loading" ? (
          <p role="status">Verifying your sign-in and organization access.</p>
        ) : (
          <>
            <p role="alert">
              {state === "membership"
                ? "Your sign-in succeeded, but this account has no active workspace membership. Open your staff invitation to join, or contact your Administrator for access."
                : state === "unavailable"
                  ? "We could not verify your workspace access. Check your connection and try again."
                  : "The sign-in was cancelled, expired or could not be verified. Start again from this browser."}
            </p>
            {state === "unavailable" && (
              <Button onClick={() => setAttempt((n) => n + 1)}>
                Retry workspace check
              </Button>
            )}
            <Button variant="outline" onClick={() => void signInAgain()}>
              Return to sign in
            </Button>
          </>
        )}
        <small>Your role is assigned by your organization.</small>
      </section>
    </main>
  );
}

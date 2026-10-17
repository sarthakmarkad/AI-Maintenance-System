"use client";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Factory, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/lib/supabase";
import { publicConfig } from "@/lib/config";
import { beginGoogleSignIn, googleSignInAvailable } from "@/lib/google-auth";
import { clearRoleSelection } from "@/lib/role-selection";
function Login() {
  const router = useRouter();
  const search = useSearchParams();
  const { session, error: savedError } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [google, setGoogle] = useState<
    "loading" | "enabled" | "disabled" | "unavailable"
  >("loading");
  const [providerAttempt, setProviderAttempt] = useState(0);
  const [googleBusy, setGoogleBusy] = useState(false);
  const configured = publicConfig().success;
  useEffect(() => {
    if (session) router.replace("/machines");
  }, [session, router]);
  useEffect(() => {
    const abort = new AbortController();
    if (!configured) {
      setGoogle("disabled");
      return;
    }
    setGoogle("loading");
    googleSignInAvailable(abort.signal)
      .then((available) => {
        if (!abort.signal.aborted)
          setGoogle(available ? "enabled" : "disabled");
      })
      .catch(() => {
        if (!abort.signal.aborted) setGoogle("unavailable");
      });
    return () => abort.abort();
  }, [configured, providerAttempt]);
  async function googleSignIn() {
    if (google !== "enabled" || busy || googleBusy) return;
    setGoogleBusy(true);
    setBusy(true);
    setError("");
    try {
      await beginGoogleSignIn();
    } catch {
      setError("Google sign-in could not start. Please try again.");
      setGoogleBusy(false);
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabase();
    if (!client) return;
    const data = new FormData(event.currentTarget);
    clearRoleSelection();
    setBusy(true);
    setError("");
    try {
      const { error } = await client.auth.signInWithPassword({
        email: String(data.get("email")).trim(),
        password: String(data.get("password")),
      });
      if (error) {
        setError(
          error.status === 400 || error.status === 401
            ? "The email or password was not accepted. Please try again."
            : "Sign in is unavailable. Please try again shortly.",
        );
        return;
      }
      router.replace("/machines");
    } catch {
      setError("Could not reach the sign-in service. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Factory size={26} />
          </span>
          <span>
            SUPREME<small>Maintenance intelligence</small>
          </span>
        </div>
        <div className="login-intro">
          <div className="eyebrow">WH-C / PILOT WORKSPACE</div>
          <h1>
            Better context.
            <br />
            Confident
            <br />
            <em>maintenance.</em>
          </h1>
          <p>
            Connect your people, machine records and maintenance decisions in
            one trusted workspace.
          </p>
          <div className="login-divider" />
          <span className="story-footnote">
            Built for Supreme Industries
            <br />
            Windmöller & Hölscher · Blown-film line
          </span>
        </div>
        <span className="login-bottom">
          MACHINE MAINTENANCE & PERFORMANCE INTELLIGENCE
        </span>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <span className="tag">SECURE TEAM ACCESS</span>
          <h2>Welcome back.</h2>
          <p className="login-description">
            Sign in to your maintenance workspace.
          </p>
          {!configured && (
            <div className="config-notice" role="status">
              <strong>Supabase setup is required</strong>
              <p>
                Add the project URL and public publishable key to the frontend
                configuration to enable sign in. Your administrator must also
                provision an application membership.
              </p>
            </div>
          )}
          {search.get("reason") === "expired" && (
            <p role="alert" className="inline-error">
              Your session expired. Please sign in again.
            </p>
          )}
          {(error || savedError) && (
            <p className="inline-error" role="alert">
              {error || savedError}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="google-sign-in"
            onClick={() => void googleSignIn()}
            disabled={!configured || google !== "enabled" || busy}
            aria-describedby="google-sign-in-status"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
              <path
                fill="#4285F4"
                d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.23c1.89-1.74 2.99-4.3 2.99-7.36Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.23-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.6A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59C7.19 7.72 9.4 5.96 12 5.96Z"
              />
            </svg>
            {googleBusy ? "Opening Google…" : "Sign in with Google"}
          </Button>
          <p id="google-sign-in-status" className="google-status" role="status">
            {google === "loading"
              ? "Checking sign-in options…"
              : google === "disabled"
                ? "Google sign-in is being set up. Use email and password below."
                : google === "unavailable"
                  ? "Could not check Google sign-in. Email sign-in is still available."
                  : "Use the Google account approved for your workspace."}
            {google === "unavailable" && (
              <button
                type="button"
                className="text-button"
                onClick={() => setProviderAttempt((n) => n + 1)}
              >
                Retry sign-in options
              </button>
            )}
          </p>
          <div className="sign-in-divider">
            <span>or use your email</span>
          </div>
          <form onSubmit={submit}>
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="username"
              required
              disabled={!configured || busy}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              disabled={!configured || busy}
            />
            <Button
              type="submit"
              className="login-submit"
              disabled={!configured || busy}
            >
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight size={17} />
            </Button>
          </form>
          <div className="login-security">
            <ShieldCheck size={17} />
            <span>Access is managed by your organization.</span>
          </div>
          <p className="login-help">
            Need access or a password reset?
            <br />
            Contact your application administrator.
          </p>
        </div>
        <small className="login-version">WH-C pilot · Team access</small>
      </section>
    </main>
  );
}
export default function Page() {
  return (
    <Suspense
      fallback={<main className="loading-state">Loading sign in…</main>}
    >
      <Login />
    </Suspense>
  );
}

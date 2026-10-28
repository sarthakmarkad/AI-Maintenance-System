"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "./auth-provider";
import { api, type Me } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { beginGoogleSignIn, googleSignInAvailable } from "@/lib/google-auth";
import { clearRoleSelection } from "@/lib/role-selection";
import { Button } from "./ui/button";
import {
  type StaffInvitation,
  type StaffInvitations,
  type StaffAcceptance,
  roleNames,
  roleHelp,
} from "./team-types";
import styles from "./team-workspace.module.css";
const json = (v: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(v),
});
export function StaffOnboarding() {
  const { session, loading: authLoading } = useAuth(),
    router = useRouter();
  const token = useRef<string | null>(null),
    [preview, setPreview] = useState<StaffInvitation>(),
    [available, setAvailable] = useState<StaffInvitation[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [mode, setMode] = useState<"signin" | "signup">("signin"),
    [google, setGoogle] = useState(false),
    [passwordReady, setPasswordReady] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    googleSignInAvailable(abort.signal)
      .then(setGoogle)
      .catch(() => setGoogle(false));
    api<{ passwordEmailConfigured: boolean }>(
      "/team/onboarding/options",
      "",
      abort.signal,
    )
      .then((d) => {
        if (!abort.signal.aborted) {
          setPasswordReady(d.passwordEmailConfigured);
          setMode(d.passwordEmailConfigured ? "signup" : "signin");
        }
      })
      .catch(() => setPasswordReady(false));
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (authLoading) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    if (token.current === null) {
      const values = new URLSearchParams(window.location.hash.slice(1)).getAll(
        "invitation",
      );
      token.current = values.length === 1 ? values[0] : "";
      window.history.replaceState(null, "", "/join");
    }
    (async () => {
      try {
        if (token.current) {
          const p = await api<StaffInvitation>(
            "/team/onboarding/preview",
            "",
            abort.signal,
            json({ token: token.current }),
          );
          if (!abort.signal.aborted) setPreview(p);
        }
        if (session) {
          const d = await api<StaffInvitations>(
            "/team/onboarding/available",
            session.access_token,
            abort.signal,
            json({}),
          );
          if (!abort.signal.aborted) setAvailable(d.items);
        }
      } catch (e) {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Invitation could not be checked.",
          );
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [authLoading, session?.access_token, attempt]);
  async function authenticate(e: FormEvent) {
    e.preventDefault();
    const client = getSupabase();
    if (!client || !preview) return;
    if (
      mode === "signup" &&
      (!passwordReady || password.length < 12 || password !== confirm)
    ) {
      setError("Use at least 12 characters and enter the same password twice.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    clearRoleSelection();
    try {
      const result =
        mode === "signup"
          ? await client.auth.signUp({
              email: preview.email,
              password,
              options: {
                emailRedirectTo: window.location.origin + "/auth/callback",
              },
            })
          : await client.auth.signInWithPassword({
              email: preview.email,
              password,
            });
      if (result.error)
        throw Error(
          mode === "signup"
            ? "Account setup could not start. Try signing in if you already have an account, or use Google."
            : "The email or password was not accepted.",
        );
      setPassword("");
      setConfirm("");
      if (!result.data.session)
        setNotice(
          "Check your email to confirm your account. Open the confirmation in this browser, then accept your invitation.",
        );
      else setAttempt((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Sign-in is unavailable. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function accept(invitation: StaffInvitation) {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await api<StaffAcceptance>(
        "/team/onboarding/accept",
        session.access_token,
        undefined,
        json({ invitationId: invitation.id }),
      );
      clearRoleSelection();
      await api<Me>("/me", session.access_token);
      router.replace("/machines");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Workspace access could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const matching = preview
    ? available.filter((i) => i.id === preview.id)
    : available;
  return (
    <main className="auth-callback-page">
      <section className={"panel auth-callback-card " + styles.form}>
        <span className="eyebrow">SUPREME / TEAM ACCESS</span>
        <h1>Join your maintenance team</h1>
        {loading && <p role="status">Checking your invitation…</p>}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        )}
        {preview && (
          <div>
            <h2>{preview.organization}</h2>
            <p>
              Invitation for {preview.displayName} · {preview.email}
            </p>
            <p>
              {roleNames[preview.role]} · {roleHelp[preview.role]}
            </p>
            <p>
              {["OPERATOR", "TECHNICIAN"].includes(preview.role)
                ? "Machines: " + preview.machines.map((m) => m.code).join(", ")
                : "Organization-wide access"}
            </p>
          </div>
        )}
        {!loading && session && (
          <>
            <p>
              Signed in as {session.user.email ?? "your confirmed account"}.
            </p>
            {matching.map((i) => (
              <section className={styles.notice} key={i.id}>
                {!preview && (
                  <>
                    <h2>{i.organization}</h2>
                    <p>
                      {i.email} · {roleNames[i.role]}
                    </p>
                    <p>{roleHelp[i.role]}</p>
                  </>
                )}
                <Button disabled={busy} onClick={() => void accept(i)}>
                  Accept invitation
                </Button>
              </section>
            ))}
            {matching.length === 0 && (
              <p>
                No pending invitation matches this confirmed account. Confirm
                your email, reopen your invitation, or ask your Administrator to
                issue a new one.
              </p>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await getSupabase()?.auth.signOut({
                    scope: "local",
                  });
                  if (result?.error) throw result.error;
                  setAvailable([]);
                  setError("");
                } catch {
                  setError("Sign-out could not complete. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Use another account
            </Button>
          </>
        )}
        {!loading && !session && preview && preview.status === "PENDING" && (
          <>
            <p>
              Use the invited email address. Your role comes from this
              invitation.
            </p>
            <Button
              variant="outline"
              disabled={!google || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await beginGoogleSignIn();
                } catch {
                  setError("Google sign-in could not start.");
                  setBusy(false);
                }
              }}
            >
              Continue with Google
            </Button>
            <div className={styles.actions}>
              <Button
                variant={mode === "signup" ? "default" : "outline"}
                disabled={busy || !passwordReady}
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
              >
                Create password account
              </Button>
              <Button
                variant={mode === "signin" ? "default" : "outline"}
                disabled={busy}
                onClick={() => {
                  setMode("signin");
                  setError("");
                }}
              >
                I already have an account
              </Button>
            </div>
            {!passwordReady && (
              <p role="status">
                New password accounts require email confirmation setup. Continue
                with Google, or sign in if you already have an account.
              </p>
            )}
            <form
              onSubmit={(e) => void authenticate(e)}
              className={styles.form}
            >
              <label>
                Invited email
                <input
                  type="email"
                  readOnly
                  autoComplete="username"
                  value={preview.email}
                />
              </label>
              <label>
                {mode === "signup" ? "Create password" : "Password"}
                <input
                  type="password"
                  required
                  minLength={mode === "signup" ? 12 : 1}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {mode === "signup" && (
                <label>
                  Confirm password
                  <input
                    type="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                    aria-label="Confirm password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <small>
                    Use at least 12 characters. Your Administrator never
                    receives your password.
                  </small>
                </label>
              )}
              <Button disabled={busy || (mode === "signup" && !passwordReady)}>
                {mode === "signup" ? "Create my account" : "Sign in to accept"}
              </Button>
            </form>
            <Link href="/forgot-password">Forgot your password?</Link>
          </>
        )}
        {!loading && !session && !preview && (
          <p>
            Open the private invitation your Administrator sent you. If you have
            already confirmed your account, sign in below to find your pending
            invitation.
          </p>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Refresh invitation
        </Button>
        <Link href="/login">Back to sign in</Link>
      </section>
    </main>
  );
}

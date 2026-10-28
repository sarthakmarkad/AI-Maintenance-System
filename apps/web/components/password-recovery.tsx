"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import styles from "./team-workspace.module.css";
export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saved, setSaved] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    if (reset) return;
    const a = new AbortController();
    api<{ passwordEmailConfigured: boolean }>(
      "/team/onboarding/options",
      "",
      a.signal,
    )
      .then((d) => {
        if (!a.signal.aborted) setReady(d.passwordEmailConfigured);
      })
      .catch(() => setReady(false));
    return () => a.abort();
  }, [reset]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const client = getSupabase();
    if (!client) {
      setError("Sign-in is not configured. Contact your Administrator.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (reset) {
        if (!session)
          throw Error("Open a valid recovery link before setting a password.");
        if (password.length < 12 || password !== confirm)
          throw Error(
            "Use at least 12 characters and enter the same password twice.",
          );
        const verified = await client.auth.getUser();
        if (
          verified.error ||
          !verified.data.user ||
          verified.data.user.id !== session.user.id
        )
          throw Error("Your recovery session expired. Request a new link.");
        const result = await client.auth.updateUser({ password });
        if (result.error)
          throw Error(
            "Password could not be saved. Try another strong password or request a new link.",
          );
        setPassword("");
        setConfirm("");
        setSaved(true);
        setNotice(
          "Your password has been updated. Sign in again with your new password.",
        );
        await client.auth.signOut({ scope: "global" });
        setNotice(
          "Your password has been updated. Sign in again with your new password.",
        );
      } else {
        if (!ready)
          throw Error(
            "Email recovery setup is not complete. Contact your Administrator or use Google sign-in.",
          );
        const result = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin + "/auth/callback",
        });
        if (result.error)
          throw Error(
            "The recovery service is unavailable or rate limited. Try again shortly.",
          );
        setNotice(
          "If this address has an account, a recovery link will be sent. Open it in this browser.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Password recovery could not complete.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-callback-page">
      <section className={"panel auth-callback-card " + styles.form}>
        <span className="eyebrow">SUPREME / ACCOUNT RECOVERY</span>
        <h1>{reset ? "Set a new password" : "Forgot your password?"}</h1>
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
        {!reset && !ready && (
          <p role="status">
            Email recovery setup is not complete. If you normally use Google,
            sign in with Google. Contact your Administrator for help.
          </p>
        )}
        {reset && session && !saved && (
          <p>
            Updating the password for{" "}
            {session.user.email ?? "your signed-in account"}.
          </p>
        )}
        {loading && reset ? (
          <p role="status">Checking recovery session…</p>
        ) : reset && !session && !saved ? (
          <p>
            Open a valid recovery link from your email. If it expired, request a
            new one.
          </p>
        ) : (
          !saved && (
            <form className={styles.form} onSubmit={(e) => void submit(e)}>
              {reset ? (
                <>
                  <label>
                    New password
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <label>
                    Confirm new password
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>
                  <p>
                    Use at least 12 characters. Existing workspace roles and
                    machine access are unaffected.
                  </p>
                </>
              ) : (
                <label>
                  Work email
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              <Button disabled={busy || (!reset && !ready)}>
                {reset ? "Save new password" : "Send recovery link"}
              </Button>
            </form>
          )
        )}
        {reset && !saved && (
          <Link href="/forgot-password">Request another recovery link</Link>
        )}
        <Link href="/login">Back to sign in</Link>
      </section>
    </main>
  );
}

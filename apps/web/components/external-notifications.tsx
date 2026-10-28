"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Shell } from "./shell";
import { Button } from "./ui/button";
import { FormPopup } from "./ui/form-popup";
import type { ExternalNotificationSettings } from "./external-notifications-types";
import styles from "./external-notifications.module.css";
const time = (at: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(at)) + " IST";
const labels = {
  PENDING: "Queued",
  SENDING: "Sending",
  SENT: "Accepted by email provider",
  FAILED: "Failed",
  SUPPRESSED: "Suppressed",
};
const reasons: Record<string, string> = {
  RATE_LIMITED: "Provider rate limit; automatic retry is scheduled.",
  PROVIDER_BUSY:
    "The email is still being processed; automatic retry is scheduled.",
  PROVIDER_UNAVAILABLE: "Provider unavailable; automatic retry is scheduled.",
  NETWORK_UNCERTAIN:
    "Email acceptance is unconfirmed; an automatic retry is scheduled within the safe retry window.",
  INVALID_PROVIDER_RESPONSE: "Provider result could not be confirmed.",
  PROVIDER_REJECTED:
    "Provider rejected the message. Contact your maintainer to check sender configuration.",
  IDEMPOTENCY_CONFLICT:
    "The email provider could not reconcile this delivery. Contact your administrator.",
  STALE_OR_DISABLED: "The handoff, access, or saved email preference changed.",
  LEASE_EXPIRED: "Sending was interrupted; an automatic retry is scheduled.",
  ATTEMPTS_EXHAUSTED:
    "Retry limit reached. No further automatic send is scheduled.",
  IDEMPOTENCY_WINDOW_EXPIRED:
    "The safe retry window expired. No further automatic send is scheduled.",
  NOT_CONFIGURED: "Email sending is not configured.",
};
export function ExternalNotificationsSettings({
  code,
  user,
  token,
}: {
  code: string;
  user: Me;
  token: string;
}) {
  const { expire } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<ExternalNotificationSettings | null>(null);
  const [preferenceOpen, setPreferenceOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const pending = useRef<{
    enabled: boolean;
    version: number;
    requestId: string;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const base = `/machines/${encodeURIComponent(code)}/external-notifications`;
  const failed = useCallback(
    async (e: unknown, isSave: boolean) => {
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
        await expire();
        router.replace("/login?reason=expired");
        return;
      }
      const access = e instanceof ApiError && [403, 404].includes(e.status);
      if (access) setData(null);
      const mustRefresh =
        !isSave || access || (e instanceof ApiError && e.status === 409);
      setNeedsRefresh(mustRefresh);
      if (mustRefresh) {
        pending.current = null;
        setRetrying(false);
      } else setRetrying(true);
      setError(
        e instanceof Error
          ? e.message
          : "Email settings are unavailable. Try again.",
      );
    },
    [expire, router],
  );
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSaved("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await api<ExternalNotificationSettings>(
        base,
        token,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setData(next);
      setEnabled(next.preference.enabled);
      setError("");
      setNeedsRefresh(false);
      pending.current = null;
      setRetrying(false);
      setPreferenceOpen(false);
    } catch (e) {
      if (!controller.signal.aborted) await failed(e, false);
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }, [base, token, failed]);
  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      inFlight.current = false;
    };
  }, [load]);
  async function save() {
    if (!data || inFlight.current || needsRefresh) return;
    inFlight.current = true;
    setBusy(true);
    setSaved("");
    const controller = new AbortController();
    request.current = controller;
    pending.current ??= {
      enabled,
      version: data.preference.version,
      requestId: crypto.randomUUID(),
    };
    try {
      const next = await api<ExternalNotificationSettings>(
        `${base}/preference`,
        token,
        controller.signal,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pending.current),
        },
      );
      if (controller.signal.aborted) return;
      setData(next);
      setEnabled(next.preference.enabled);
      setError("");
      setNeedsRefresh(false);
      setSaved(
        next.preference.enabled
          ? "Email handoffs enabled for this role. Only new actionable events after enrollment are eligible."
          : "Email handoffs disabled for this role.",
      );
      pending.current = null;
      setRetrying(false);
      setPreferenceOpen(false);
    } catch (e) {
      if (!controller.signal.aborted) await failed(e, true);
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }
  const supported =
    user.role === "TECHNICIAN" || user.role === "MAINTENANCE_HEAD";
  return (
    <section
      className={`${styles.workspace} form-popup-workspace`}
      aria-label="Email notification settings"
      aria-busy={busy}
    >
      <div className={styles.header}>
        <div>
          <h1>Email handoffs</h1>
          <p>
            {code} · Your active{" "}
            {user.role === "MAINTENANCE_HEAD"
              ? "Maintenance head"
              : user.role === "TECHNICIAN"
                ? "Technician"
                : "workspace"}{" "}
            role
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? "Loading…" : "Refresh email status"}
        </Button>
      </div>
      <Link href={`/machines/${encodeURIComponent(code)}/work-orders`}>
        Back to work orders
      </Link>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          {needsRefresh && (
            <p>Refresh email status before changing settings.</p>
          )}
        </div>
      )}
      {saved && (
        <p role="status" className={styles.success}>
          {saved}
        </p>
      )}
      {!data && !error && <p role="status">Loading email settings…</p>}
      {(!supported || data?.supported === false) && (
        <div className={styles.card}>
          <h2>Email handoffs are unavailable in this role</h2>
          <p>
            Only a trusted Technician or Maintenance head role can enable
            personal engineering handoff emails. Select an eligible granted role
            to manage its own preference.
          </p>
        </div>
      )}
      {supported && data?.supported && (
        <>
          <div className={styles.card}>
            <h2>Your preference</h2>
            {!data.configured && (
              <p role="status" className={styles.notice}>
                Email sending is not configured. Your maintainer must configure
                the verified sender and provider before you can enable it.
                Existing preferences can still be disabled.
              </p>
            )}
            <p>
              Receive new assignment, release, return, or review actions that
              apply to this role. Enabling does not send older handoffs. Marking
              an in-app notification read is separate.
            </p>
            <p>
              <strong>Destination:</strong>{" "}
              {data.preference.destination ??
                "Your confirmed sign-in email will be verified when you enable."}
            </p>
            {data.preference.verifiedAt && (
              <p>Last verified: {time(data.preference.verifiedAt)}</p>
            )}
            {data.preference.enabledAt && (
              <p>New events after: {time(data.preference.enabledAt)}</p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreferenceOpen(true)}
              disabled={busy}
              aria-haspopup="dialog"
            >
              Edit email preference
            </Button>
            <FormPopup
              open={preferenceOpen}
              onOpenChange={setPreferenceOpen}
              title="Email handoff preference"
              description="Choose whether to receive actionable handoffs for your current role."
              busy={busy}
              error={error}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={
                      busy ||
                      needsRefresh ||
                      retrying ||
                      (!data.configured && !data.preference.enabled)
                    }
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  Email actionable handoffs in this role
                </label>
                <Button
                  type="submit"
                  disabled={
                    busy || needsRefresh || (enabled && !data.configured)
                  }
                >
                  {busy
                    ? "Saving…"
                    : retrying
                      ? "Retry same save"
                      : enabled
                        ? "Save and verify email"
                        : "Save preference"}
                </Button>
              </form>
              {needsRefresh && (
                <p>
                  Close this form and refresh the settings before saving again.
                </p>
              )}
            </FormPopup>
            <p className={styles.note}>
              Only your email confirmed by the configured sign-in provider can
              be used. Save and verify again after changing that address. A
              queued email keeps its original destination and cannot be
              redirected. A send already underway may complete after disabling.
            </p>
          </div>
          <div className={styles.card}>
            <h2>Recent delivery activity</h2>
            <p>
              Your latest 25 deliveries for the active role. Accepted means the
              provider accepted the message; inbox delivery is not confirmed.
            </p>
            {!data.deliveries.length && (
              <p>
                No email deliveries yet. A new actionable handoff after
                enrollment is required.
              </p>
            )}
            <ul className={styles.deliveries}>
              {data.deliveries.map((item) => (
                <li key={item.id}>
                  <div className={styles.row}>
                    <strong>{labels[item.status]}</strong>
                    <span>
                      {item.attemptCount}{" "}
                      {item.attemptCount === 1 ? "attempt" : "attempts"}
                    </span>
                  </div>
                  <Link
                    href={`/machines/${encodeURIComponent(code)}/work-orders/${item.orderId}`}
                  >
                    Work order {item.orderId.slice(0, 8)} ·{" "}
                    {item.action.toLowerCase()}
                  </Link>
                  <p>Event: {time(item.eventAt)}</p>
                  <p>Updated: {time(item.updatedAt)}</p>
                  {item.code && reasons[item.code] && (
                    <p>{reasons[item.code]}</p>
                  )}
                  {item.nextAttemptAt && (
                    <p>Next automatic attempt: {time(item.nextAttemptAt)}</p>
                  )}
                  {item.attempts.length > 0 && (
                    <details>
                      <summary>Attempt history</summary>
                      <ol>
                        {item.attempts.map((attempt) => (
                          <li key={attempt.id}>
                            Attempt {attempt.attempt}:{" "}
                            {attempt.status.toLowerCase()}
                            {attempt.late
                              ? " (result arrived after cancellation or lease change)"
                              : ""}{" "}
                            · {time(attempt.at)}
                            {attempt.code && reasons[attempt.code]
                              ? ` — ${reasons[attempt.code]}`
                              : ""}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
export function ExternalNotificationsPage({ code }: { code: string }) {
  const { session, loading, expired, expire } = useAuth();
  const router = useRouter();
  const token = session?.access_token;
  const [user, setUser] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (loading) return;
    if (!token) {
      router.replace(expired ? "/login?reason=expired" : "/login");
      return;
    }
    const controller = new AbortController();
    setUser(null);
    setError("");
    api<Me>("/me", token, controller.signal)
      .then((me) => {
        if (!controller.signal.aborted) setUser(me);
      })
      .catch(async (e) => {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) {
          await expire();
          router.replace("/login?reason=expired");
        } else
          setError(
            e instanceof Error ? e.message : "Workspace access is unavailable.",
          );
      });
    return () => controller.abort();
  }, [token, loading, expired, expire, router, attempt]);
  if (!user || !token)
    return (
      <main className={styles.workspace}>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={() => setAttempt((v) => v + 1)}>
              Retry workspace access
            </Button>
          </>
        ) : (
          <p role="status">Checking workspace access…</p>
        )}
      </main>
    );
  return (
    <Shell user={user} code={code}>
      <ExternalNotificationsSettings
        key={`email-settings:${user.userId}:${user.role}:${code}`}
        code={code}
        user={user}
        token={token}
      />
    </Shell>
  );
}

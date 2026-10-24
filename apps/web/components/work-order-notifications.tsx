"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, RefreshCw } from "lucide-react";
import { api, ApiError, type Me } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import styles from "./work-order-notifications.module.css";

import type {
  WorkOrderNotification,
  WorkOrderNotificationsResponse,
} from "./work-order-notifications-types";
const time = (v: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(v)) + " IST";

export function WorkOrderNotifications({
  code,
  user,
  token,
}: {
  code: string;
  user: Me;
  token: string;
}) {
  const router = useRouter();
  const { expire } = useAuth();
  const [data, setData] = useState<WorkOrderNotificationsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);
  const reading = useRef(false);
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const base = `/machines/${encodeURIComponent(code)}/work-order-notifications`;
  const load = useCallback(
    async (after?: string) => {
      if (inFlight.current || reading.current) return;
      inFlight.current = true;
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      try {
        const next = await api<WorkOrderNotificationsResponse>(
          base + (after ? `?after=${encodeURIComponent(after)}` : ""),
          token,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setData((previous) => ({
          ...next,
          items:
            after && previous ? [...previous.items, ...next.items] : next.items,
        }));
        setError("");
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) {
          setData(null);
          await expire();
          router.replace("/login?reason=expired");
        } else {
          // Clear stale privileges immediately; transient errors retain the list
          // with disabled actions until a successful explicit refresh.
          if (e instanceof ApiError && [403, 404].includes(e.status))
            setData(null);
          setError(
            e instanceof Error
              ? e.message
              : "Unable to load work-order notifications.",
          );
        }
      } finally {
        if (request.current === controller) {
          inFlight.current = false;
          if (!controller.signal.aborted) setLoading(false);
        }
      }
    },
    [base, token, expire, router],
  );
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      request.current?.abort();
      request.current = null;
      inFlight.current = false;
    };
  }, [load]);
  useEffect(() => {
    // Only the compact inbox polls. Expanding/paging never discards its list,
    // and this component never reloads its parent or any workflow forms.
    if (open || error) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [open, error, load]);
  async function read(item: WorkOrderNotification, navigate = false) {
    if (reading.current || inFlight.current) return;
    reading.current = true;
    setBusy(item.id);
    setError("");
    try {
      // Recheck actionability even for an already-read item before following it.
      const receipt = await api<{ read: boolean; readAt: string }>(
        `${base}/${item.id}/read`,
        token,
        undefined,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!alive.current) return;
      setData((previous) =>
        previous
          ? {
              ...previous,
              unread: Math.max(0, previous.unread - (item.readAt ? 0 : 1)),
              items: previous.items.map((n) =>
                n.id === item.id ? { ...n, readAt: receipt.readAt } : n,
              ),
            }
          : previous,
      );
      if (navigate)
        router.push(
          `/machines/${encodeURIComponent(code)}/work-orders/${item.orderId}`,
        );
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
        await expire();
        router.replace("/login?reason=expired");
      } else {
        if (e instanceof ApiError && [403, 404].includes(e.status))
          setData(null);
        setError(
          e instanceof Error
            ? e.message
            : "Read receipt could not be saved. Refresh and try again.",
        );
      }
    } finally {
      reading.current = false;
      if (alive.current) setBusy(null);
    }
  }
  return (
    <section className={styles.inbox} aria-label="Work-order notifications">
      <div className={styles.heading}>
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls="work-order-notification-list"
          onClick={() => setOpen((v) => !v)}
        >
          <Bell size={17} />
          <span>
            Work-order notifications ({data ? data.unread : "…"} unread)
          </span>
        </Button>
        <Button
          variant="ghost"
          disabled={loading || !!busy}
          onClick={() => void load()}
          aria-label="Refresh work-order notifications"
        >
          <RefreshCw size={16} />
          <span>Refresh</span>
        </Button>
      </div>
      {loading && !data && <p role="status">Loading notifications…</p>}
      {error && (
        <p role="alert">
          {error} Use Refresh to check current access and stages.
        </p>
      )}
      <div id="work-order-notification-list" hidden={!open}>
        <p>
          For your active{" "}
          {user.role === "TECHNICIAN" ? "Technician" : "Maintenance head"} view.
          Only current actionable handoffs appear. Calendar due-date reminders
          are separate.
        </p>
        {!loading && !error && data?.items.length === 0 && (
          <p role="status">No actionable work-order notifications.</p>
        )}
        {!!data?.items.length && (
          <ul className={styles.list}>
            {data.items.map((item) => (
              <li key={item.id}>
                <div className={styles.heading}>
                  <strong>{item.title}</strong>
                  <span>{item.readAt ? "Read" : "Unread"}</span>
                </div>
                <small>
                  {item.kind.toLowerCase()} · WO-
                  {item.orderId.slice(0, 8).toUpperCase()}
                </small>
                <p>{item.message}</p>
                <p className={styles.meta}>
                  {item.actorName} ·{" "}
                  <time dateTime={item.createdAt}>{time(item.createdAt)}</time>
                </p>
                <div className={styles.actions}>
                  <Link
                    href={`/machines/${encodeURIComponent(code)}/work-orders/${item.orderId}`}
                    aria-disabled={loading || !!busy || !!error}
                    onClick={(e) => {
                      e.preventDefault();
                      if (!loading && !busy && !error) void read(item, true);
                    }}
                  >
                    Open work order
                  </Link>
                  {!item.readAt && (
                    <Button
                      variant="outline"
                      disabled={loading || !!busy || !!error}
                      onClick={() => void read(item)}
                      aria-label={`Mark ${item.title} as read`}
                    >
                      {busy === item.id ? "Saving…" : "Mark read"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data?.nextCursor && (
          <Button
            variant="outline"
            disabled={loading || !!busy || !!error}
            onClick={() => void load(data.nextCursor!)}
          >
            Load older notifications
          </Button>
        )}
      </div>
    </section>
  );
}

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Bell,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  ApiError,
  type Machine,
  type Me,
  type MaintenanceCalendar,
  type MaintenancePlans,
  type MaintenanceOccurrence,
  type MaintenanceReminders,
  type EligibleTechnicians,
} from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { FormPopup } from "./ui/form-popup";
const localDate = (d: Date) =>
  new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const time = (v: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v)) + " IST";
const pretty = (v: string) =>
  v
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (s) => s.toUpperCase());
const inputTime = (v: string) =>
  new Date(Date.parse(v) + 330 * 60000).toISOString().slice(0, 19);
function instant(v: string) {
  const date = new Date(v + "+05:30");
  if (
    !Number.isFinite(date.getTime()) ||
    inputTime(date.toISOString()) !== (v.length === 16 ? v + ":00" : v)
  )
    throw new Error("Enter a real date and time in IST.");
  return date.toISOString();
}
function monthGrid(month: string) {
  const start = new Date(month + "-01T00:00:00Z");
  start.setUTCDate(1 - start.getUTCDay());
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10),
  );
}
function shiftMonth(month: string, offset: number) {
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}
type Plan = MaintenancePlans["items"][number];
export function CalendarWorkspace({
  machine,
  user,
  token,
}: {
  machine: Machine;
  user: Me;
  token: string;
}) {
  const router = useRouter(),
    { expire } = useAuth(),
    base = `/machines/${encodeURIComponent(machine.code)}/calendar`;
  const [month, setMonth] = useState(() => localDate(new Date()).slice(0, 7)),
    [day, setDay] = useState(""),
    [status, setStatus] = useState(""),
    [cursor, setCursor] = useState("");
  const [tab, setTab] = useState<"calendar" | "plans" | "reminders">(
      "calendar",
    ),
    [form, setForm] = useState(false),
    [editor, setEditor] = useState(""),
    [attempt, setAttempt] = useState(0),
    [reset, setReset] = useState(0);
  const [data, setData] = useState<MaintenanceCalendar | null>(null),
    [gridData, setGridData] = useState<MaintenanceCalendar | null>(null),
    [plans, setPlans] = useState<MaintenancePlans | null>(null),
    [reminders, setReminders] = useState<MaintenanceReminders | null>(null);
  const [roster, setRoster] = useState<EligibleTechnicians["items"]>([]),
    [rosterError, setRosterError] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [conflict, setConflict] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const grid = monthGrid(month),
    canManage = user.role === "MAINTENANCE_HEAD";
  async function failure(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      await expire();
      router.replace("/login?reason=expired");
      return;
    }
    setError(
      e instanceof Error ? e.message : "Maintenance calendar is unavailable.",
    );
    if (e instanceof ApiError && e.status === 409) setConflict(true);
  }
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const monthQuery = new URLSearchParams({ from: grid[0], to: grid[41] }),
      query = new URLSearchParams({
        from: day || grid[0],
        to: day || grid[41],
      });
    if (status) query.set("status", status);
    if (cursor) query.set("after", cursor);
    Promise.all([
      api<MaintenanceCalendar>(base + "?" + monthQuery, token, abort.signal),
      api<MaintenanceCalendar>(base + "?" + query, token, abort.signal),
      api<MaintenancePlans>(base + "/plans", token, abort.signal),
      api<MaintenanceReminders>(base + "/reminders", token, abort.signal),
    ])
      .then(([monthData, agenda, planList, alerts]) => {
        if (abort.signal.aborted) return;
        setGridData(monthData);
        setData((old) =>
          cursor && old
            ? {
                ...agenda,
                items: [
                  ...new Map(
                    [...old.items, ...agenda.items].map((o) => [o.id, o]),
                  ).values(),
                ],
              }
            : agenda,
        );
        setPlans(planList);
        setReminders(alerts);
      })
      .catch((e) => {
        if (!abort.signal.aborted) void failure(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
    // Equivalent Auth focus events must not reset a plan/action draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, month, day, status, cursor, attempt]);
  useEffect(() => {
    if (!canManage) return;
    const abort = new AbortController();
    setRosterError("");
    api<EligibleTechnicians>(
      `/machines/${encodeURIComponent(machine.code)}/work-orders/technicians`,
      token,
      abort.signal,
    )
      .then((r) => {
        if (!abort.signal.aborted) setRoster(r.items);
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setRosterError(
            "Eligible technicians could not be loaded. Reload the calendar to retry.",
          );
          void failure(e);
        }
      });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, machine.code, token, attempt]);
  useEffect(() => {
    if (form || editor || busy || conflict || cursor) return;
    const timer = setInterval(() => setAttempt((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, [form, editor, busy, conflict, cursor]);
  function reload() {
    setConflict(false);
    setEditor("");
    setReset((n) => n + 1);
    setCursor("");
    setAttempt((n) => n + 1);
  }
  async function action(path: string, body: unknown) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(base + path, token, undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setEditor("");
      setCursor("");
      setAttempt((n) => n + 1);
      setSuccess("Saved. Maintenance history and access rules are preserved.");
    } catch (e) {
      await failure(e);
    } finally {
      setBusy(false);
    }
  }
  async function olderReminders() {
    if (!reminders?.nextCursor) return;
    setBusy(true);
    try {
      const next = await api<MaintenanceReminders>(
        base + "/reminders?after=" + reminders.nextCursor,
        token,
      );
      setReminders((old) =>
        old ? { ...next, items: [...old.items, ...next.items] } : next,
      );
    } catch (e) {
      await failure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="calendar-workspace">
      <Link className="back-link" href={`/machines/${machine.code}`}>
        <ArrowLeft size={14} />
        Machine overview
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{machine.code} / PLANNED MAINTENANCE</div>
          <h1>Maintenance calendar</h1>
        </div>
        <div className="calendar-heading-actions">
          <Button variant="outline" disabled={busy} onClick={reload}>
            <RefreshCw size={15} />
            Reload calendar
          </Button>
          {canManage && (
            <Button disabled={busy || conflict} onClick={() => setForm(true)}>
              <Plus size={15} />
              Create maintenance plan
            </Button>
          )}
        </div>
      </div>
      <div className="info-strip">
        <ShieldCheck size={18} />
        <p>
          {canManage
            ? "Create plans, release scheduled tasks to technicians, or skip an unreleased task with a reason."
            : "Plans are managed by the maintenance head. Your role can view the calendar."}{" "}
          Due times use IST. Missed work stays visible until reviewed closure or
          an explicit skip.
        </p>
      </div>
      {error && (
        <div role="alert" className="inline-error">
          <p>{error}</p>
          {conflict && (
            <p>
              The record changed. Reload before another action; reloading resets
              open action forms.
            </p>
          )}
          <Button variant="outline" onClick={reload}>
            Reload latest schedule
          </Button>
        </div>
      )}
      {success && (
        <p role="status" className="work-success">
          {success}
        </p>
      )}
      {canManage && (
        <PlanForm
          key={"plan-" + reset}
          open={form}
          onOpenChange={setForm}
          error={error}
          roster={roster}
          rosterError={rosterError}
          busy={busy || conflict}
          base={base}
          token={token}
          onFailure={failure}
          onSaved={() => {
            setForm(false);
            setReset((n) => n + 1);
            setAttempt((n) => n + 1);
            setTab("plans");
            setSuccess(
              "Maintenance plan created. Occurrences follow fixed calendar dates.",
            );
          }}
        />
      )}
      <div
        className="calendar-tabs"
        role="tablist"
        aria-label="Maintenance views"
      >
        {(["calendar", "plans", "reminders"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "calendar" ? (
              <CalendarDays size={17} />
            ) : t === "reminders" ? (
              <Bell size={17} />
            ) : null}
            {pretty(t)}
            {t === "reminders" && !!reminders?.unread && (
              <span className="calendar-unread">{reminders.unread}</span>
            )}
          </button>
        ))}
      </div>
      {loading && !data ? (
        <div className="loading-state" role="status">
          Loading maintenance schedules…
        </div>
      ) : (
        tab === "calendar" &&
        data && (
          <>
            {(data.scheduling.failed || data.scheduling.catchingUp) && (
              <p role="status" className="config-notice">
                {data.scheduling.failed
                  ? "Schedule refresh is delayed. Existing tasks remain available and the background job will retry."
                  : "The scheduler is catching up missed occurrences. Counts will update as the backlog is processed."}
              </p>
            )}
            <div className="work-metrics">
              {[
                ["UPCOMING", "Upcoming"],
                ["DUE", "Due today"],
                ["OVERDUE", "Overdue"],
              ].map(([key, label]) => (
                <section
                  className={"metric-card calendar-metric-" + key.toLowerCase()}
                  key={key}
                >
                  <h2>{label}</h2>
                  <p>{data.counts[key] ?? 0}</p>
                  <small>
                    {day
                      ? "On the selected day"
                      : "In the displayed calendar range"}
                  </small>
                </section>
              ))}
            </div>
            <section className="panel calendar-month">
              <div className="panel-heading">
                <div>
                  <h2>
                    {new Intl.DateTimeFormat("en-IN", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(month + "-01T00:00:00Z"))}
                  </h2>
                  <p>
                    Occurrences are generated through the next 35 days. Daily
                    counts include completed and skipped tasks.
                  </p>
                </div>
                <div className="calendar-month-controls">
                  <Button
                    variant="outline"
                    aria-label="Previous month"
                    onClick={() => {
                      setMonth(shiftMonth(month, -1));
                      setDay("");
                      setCursor("");
                    }}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMonth(localDate(new Date()).slice(0, 7));
                      setDay("");
                      setCursor("");
                    }}
                  >
                    This month
                  </Button>
                  <Button
                    variant="outline"
                    aria-label="Next month"
                    onClick={() => {
                      setMonth(shiftMonth(month, 1));
                      setDay("");
                      setCursor("");
                    }}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
              <div
                className="calendar-grid"
                aria-label="Scheduled maintenance days"
              >
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div className="calendar-weekday" key={d}>
                    {d}
                  </div>
                ))}
                {grid.map((d) => (
                  <button
                    key={d}
                    aria-label={`Show maintenance on ${d}`}
                    aria-pressed={day === d}
                    className={`${d.startsWith(month) ? "" : "outside-month"} ${d === localDate(new Date()) ? "calendar-today" : ""}`}
                    onClick={() => {
                      setDay(d);
                      setCursor("");
                    }}
                  >
                    <span>{Number(d.slice(-2))}</span>
                    {!!gridData?.dayCounts[d] && (
                      <small>
                        {gridData.dayCounts[d]}
                        <span className="calendar-task-word"> tasks</span>
                      </small>
                    )}
                  </button>
                ))}
              </div>
            </section>
            <div className="calendar-agenda-heading">
              <div>
                <h2>{day ? `Tasks for ${day}` : "Scheduled tasks"}</h2>
                {day && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setDay("");
                      setCursor("");
                    }}
                  >
                    Show the whole calendar range
                  </button>
                )}
              </div>
              <label>
                Task status
                <select
                  aria-label="Task status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setCursor("");
                  }}
                >
                  <option value="">All tasks</option>
                  {[
                    "UPCOMING",
                    "DUE",
                    "OVERDUE",
                    "COMPLETED",
                    "SKIPPED",
                    "CANCELLED",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {pretty(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!data.items.length ? (
              <section className="state-card">
                <CalendarDays size={32} />
                <h2>No scheduled tasks in this view</h2>
                <p>
                  {canManage
                    ? "Create a maintenance plan, or choose another date or status."
                    : "The maintenance head can create plans. Choose another date or status to see existing tasks."}
                </p>
              </section>
            ) : (
              <div className="calendar-agenda">
                {data.items.map((o) => (
                  <TaskCard
                    key={o.id + "-" + o.version + "-" + reset}
                    task={o}
                    code={machine.code}
                    canManage={data.canManage}
                    roster={roster}
                    rosterError={rosterError}
                    open={editor === o.id}
                    toggle={() => setEditor(editor === o.id ? "" : o.id)}
                    disabled={busy || conflict || loading}
                    saving={busy}
                    error={error}
                    onSkip={(reason) =>
                      action(`/occurrences/${o.id}/skip`, {
                        version: o.version,
                        reason,
                      })
                    }
                    onRelease={async (technicianId) => {
                      setBusy(true);
                      setError("");
                      try {
                        const saved = await api<{ orderId: string }>(
                          base + `/occurrences/${o.id}/release`,
                          token,
                          undefined,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              version: o.version,
                              technicianId,
                            }),
                          },
                        );
                        router.push(
                          `/machines/${machine.code}/work-orders/${saved.orderId}`,
                        );
                      } catch (e) {
                        await failure(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                ))}
              </div>
            )}
            {data.nextCursor && (
              <Button
                variant="outline"
                disabled={loading || busy}
                onClick={() => setCursor(data.nextCursor!)}
              >
                Load more tasks
              </Button>
            )}
          </>
        )
      )}
      {tab === "plans" && plans && (
        <section className="calendar-plan-list">
          <div>
            <h2>Recurring maintenance plans</h2>
            <p>
              Fixed cadence from the first due date. Pausing stops additional
              generation; existing tasks and reminders remain. Change cadence by
              creating a replacement plan and explicitly handling outstanding
              tasks.
            </p>
          </div>
          {!plans.items.length ? (
            <section className="state-card">
              <CalendarDays size={32} />
              <h2>No maintenance plans yet</h2>
              <p>The Maintenance head can create the first plan.</p>
            </section>
          ) : (
            plans.items.map((p) => (
              <section
                className="panel calendar-plan"
                key={p.id + "-" + p.version + "-" + reset}
              >
                <div className="panel-heading">
                  <div>
                    <h3>{p.title}</h3>
                    <p>
                      Every {p.interval}{" "}
                      {p.frequency === "DAILY"
                        ? "day(s)"
                        : p.frequency === "WEEKLY"
                          ? "week(s)"
                          : "month(s)"}{" "}
                      · first due {time(p.firstDueAt)}
                    </p>
                  </div>
                  <span
                    className={
                      "work-status " +
                      (p.active ? "status-approved" : "status-assigned")
                    }
                  >
                    {p.active ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="calendar-plan-body">
                  <p className="work-prose">{p.instructions}</p>
                  <p>
                    Assigned to {p.technicianName} · Upcoming reminder lead:{" "}
                    {p.remindDays} days · {pretty(p.priority)} priority
                  </p>
                  {p.pauseReason && <p>Pause reason: {p.pauseReason}</p>}
                  {canManage && (
                    <>
                      <Button
                        variant="outline"
                        disabled={busy || conflict}
                        onClick={() => setEditor(editor === p.id ? "" : p.id)}
                      >
                        {p.active ? "Pause plan" : "Resume plan"}
                      </Button>
                      <PlanStateForm
                        key={p.version}
                        open={editor === p.id}
                        onOpenChange={(value) => {
                          if (!value) setEditor("");
                        }}
                        saving={busy}
                        error={error}
                        plan={p}
                        disabled={busy || conflict}
                        save={(reason) =>
                          action(`/plans/${p.id}/state`, {
                            version: p.version,
                            active: !p.active,
                            reason,
                          })
                        }
                      />
                    </>
                  )}
                </div>
              </section>
            ))
          )}
        </section>
      )}
      {tab === "reminders" && reminders && (
        <section className="calendar-reminders">
          <div>
            <h2>In-app maintenance reminders</h2>
            <p>
              Heads and supervisors see outstanding work; technicians see their
              assigned tasks. Read status is separate for each role view. Closed
              and skipped tasks stop appearing.
            </p>
          </div>
          {!reminders.items.length ? (
            <section className="state-card">
              <Bell size={32} />
              <h2>No current reminders for this role</h2>
              <p>
                Reminders appear here when scheduled work is upcoming, due or
                overdue.
              </p>
            </section>
          ) : (
            reminders.items.map((r) => (
              <article className="panel calendar-reminder" key={r.id}>
                <div>
                  <span
                    className={"work-status status-" + r.kind.toLowerCase()}
                  >
                    {pretty(r.kind)}
                  </span>
                  <h3>{r.title}</h3>
                  <p>Due {time(r.dueAt)}</p>
                </div>
                <div>
                  {r.orderId ? (
                    <Link
                      className="text-button"
                      href={`/machines/${machine.code}/work-orders/${r.orderId}`}
                    >
                      Open work order
                    </Link>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() => {
                        setDay(localDate(new Date(r.dueAt)));
                        setMonth(localDate(new Date(r.dueAt)).slice(0, 7));
                        setStatus("");
                        setCursor("");
                        setTab("calendar");
                      }}
                    >
                      View scheduled task
                    </button>
                  )}
                  {r.read ? (
                    <small>Read in this role</small>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void action(`/reminders/${r.id}/read`, {})}
                    >
                      Mark read
                    </Button>
                  )}
                </div>
              </article>
            ))
          )}
          {reminders.nextCursor && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void olderReminders()}
            >
              Load older reminders
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
function PlanForm({
  open,
  onOpenChange,
  error,
  roster,
  rosterError,
  busy,
  base,
  token,
  onSaved,
  onFailure,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  error: string;
  roster: EligibleTechnicians["items"];
  rosterError: string;
  busy: boolean;
  base: string;
  token: string;
  onSaved: () => void;
  onFailure: (e: unknown) => Promise<void>;
}) {
  const [requestId] = useState(() => crypto.randomUUID()),
    [saving, setSaving] = useState(false),
    [frequency, setFrequency] = useState("WEEKLY");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaving(true);
    try {
      await api(base + "/plans", token, undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          title: f.get("title"),
          instructions: f.get("instructions"),
          frequency,
          interval: Number(f.get("interval")),
          firstDueAt: instant(String(f.get("firstDue"))),
          technicianId: f.get("technician"),
          priority: f.get("priority"),
          remindDays: Number(f.get("lead")),
        }),
      });
      onSaved();
    } catch (error) {
      await onFailure(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <FormPopup
      open={open}
      onOpenChange={onOpenChange}
      title="Create a recurring plan"
      description="Fixed calendar dates in IST. Late completion does not move the next due date."
      busy={saving}
      error={error}
    >
      <form
        className="work-form"
        aria-label="Maintenance plan"
        onSubmit={submit}
      >
        <fieldset disabled={saving || busy}>
          <label>
            Plan title
            <input name="title" required minLength={3} maxLength={160} />
          </label>
          <label>
            Maintenance instructions
            <textarea
              name="instructions"
              required
              minLength={3}
              maxLength={4000}
              rows={4}
            />
          </label>
          <div className="work-form-row">
            <label>
              Repeat frequency
              <select
                name="frequency"
                aria-label="Repeat frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
            <label>
              Every N periods
              <input
                name="interval"
                type="number"
                min={1}
                max={12}
                defaultValue={1}
                required
              />
            </label>
            <label>
              First due (IST)
              <input name="firstDue" type="datetime-local" step="1" required />
            </label>
          </div>
          <div className="work-form-row">
            <label>
              Assigned technician
              <select
                aria-label="Assigned technician"
                name="technician"
                required
              >
                <option value="">Choose a technician</option>
                {roster.map((t) => (
                  <option key={t.userId} value={t.userId}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                name="priority"
                aria-label="Plan priority"
                defaultValue="NORMAL"
              >
                {["LOW", "NORMAL", "HIGH"].map((v) => (
                  <option key={v} value={v}>
                    {pretty(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reminder lead days
              <input
                name="lead"
                type="number"
                min={1}
                max={14}
                defaultValue={3}
                required
              />
            </label>
          </div>
          <p>
            Due dates stay fixed even when earlier work finishes late.
            {frequency === "MONTHLY"
              ? " Short months use their last day, then return to the original day."
              : ""}{" "}
            The first date can be at most 31 days in the past or 366 days ahead.
            Each task requires release by the maintenance head.
          </p>
          {rosterError && <p role="alert">{rosterError}</p>}
          {!roster.length && !rosterError && (
            <p>
              No eligible technicians are available. An active technician with
              access to this machine is required.
            </p>
          )}
          <Button type="submit" disabled={!roster.length || !!rosterError}>
            {saving ? "Saving plan…" : "Save maintenance plan"}
          </Button>
        </fieldset>
      </form>
    </FormPopup>
  );
}
function PlanStateForm({
  open,
  onOpenChange,
  saving,
  error,
  plan,
  disabled,
  save,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  saving: boolean;
  error: string;
  plan: Plan;
  disabled: boolean;
  save: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return (
    <FormPopup
      open={open}
      onOpenChange={onOpenChange}
      title={plan.active ? "Pause maintenance plan" : "Resume maintenance plan"}
      description={plan.title}
      busy={saving}
      error={error}
    >
      <form
        className="work-form calendar-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(reason);
        }}
      >
        <p>
          {plan.active
            ? "Pausing stops creation of additional occurrences. Existing tasks remain scheduled and continue to remind their owners."
            : "Resuming catches up all missed fixed-date occurrences; it does not move the anchor."}
        </p>
        <label>
          Reason for schedule change
          <textarea
            required
            minLength={3}
            maxLength={4000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={disabled}
          />
        </label>
        <Button type="submit" disabled={disabled}>
          {plan.active ? "Confirm pause" : "Confirm resume"}
        </Button>
      </form>
    </FormPopup>
  );
}
function TaskCard({
  task: o,
  code,
  canManage,
  roster,
  rosterError,
  open,
  toggle,
  disabled,
  saving,
  error,
  onSkip,
  onRelease,
}: {
  task: MaintenanceOccurrence;
  code: string;
  canManage: boolean;
  roster: EligibleTechnicians["items"];
  rosterError: string;
  open: boolean;
  toggle: () => void;
  disabled: boolean;
  saving: boolean;
  error: string;
  onSkip: (reason: string) => Promise<void>;
  onRelease: (id: string) => Promise<void>;
}) {
  const [action, setAction] = useState<"release" | "skip">("release"),
    [reason, setReason] = useState(""),
    [tech, setTech] = useState(() =>
      roster.some((t) => t.userId === o.technician.userId)
        ? o.technician.userId
        : "",
    );
  return (
    <article className="panel calendar-task">
      <div className="calendar-task-top">
        <div>
          <small>Due {time(o.dueAt)}</small>
          <h3>{o.title}</h3>
          <p>
            Planned technician: {o.technician.displayName} ·{" "}
            {pretty(o.priority)} priority
            {o.workOrderStatus
              ? ` · Work order: ${pretty(o.workOrderStatus)}`
              : ""}
          </p>
        </div>
        <span className={"work-status status-" + o.status.toLowerCase()}>
          {pretty(o.status)}
        </span>
      </div>
      <details>
        <summary>Maintenance instructions</summary>
        <p className="work-prose">{o.instructions}</p>
      </details>
      {o.skipReason && (
        <p className="work-prose">Skip reason: {o.skipReason}</p>
      )}
      {o.workOrderId ? (
        <Link
          className="text-button"
          href={`/machines/${code}/work-orders/${o.workOrderId}`}
        >
          Open work order
        </Link>
      ) : (
        canManage &&
        o.status !== "SKIPPED" && (
          <>
            <Button variant="outline" disabled={disabled} onClick={toggle}>
              Manage scheduled task
            </Button>
            <FormPopup
              open={open}
              onOpenChange={(value) => {
                if (!value && open) toggle();
              }}
              title="Manage scheduled task"
              description={`${o.title} · Due ${time(o.dueAt)}`}
              busy={saving}
              error={error}
            >
              <form
                className="work-form calendar-inline-form"
                aria-label="Scheduled task action"
                onSubmit={(e) => {
                  e.preventDefault();
                  void (action === "release"
                    ? onRelease(tech)
                    : onSkip(reason));
                }}
              >
                <label>
                  Task action
                  <select
                    aria-label="Task action"
                    value={action}
                    disabled={disabled}
                    onChange={(e) =>
                      setAction(e.target.value as "release" | "skip")
                    }
                  >
                    <option value="release">Create assigned work order</option>
                    <option value="skip">Skip this occurrence</option>
                  </select>
                </label>
                {action === "release" ? (
                  <>
                    <p>
                      Creates one assigned planned work order. The technician
                      submits completion; head review and approved closure are
                      still required.
                    </p>
                    <label>
                      Release to technician
                      <select
                        aria-label="Release to technician"
                        value={tech}
                        required
                        disabled={disabled}
                        onChange={(e) => setTech(e.target.value)}
                      >
                        <option value="">Choose an eligible technician</option>
                        {roster.map((t) => (
                          <option key={t.userId} value={t.userId}>
                            {t.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    {rosterError && <p>{rosterError}</p>}
                  </>
                ) : (
                  <>
                    <p>
                      Skipping applies only to this unreleased occurrence. The
                      next fixed due date is unchanged.
                    </p>
                    <label>
                      Reason for skipping
                      <textarea
                        required
                        minLength={3}
                        maxLength={4000}
                        disabled={disabled}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <Button
                  type="submit"
                  disabled={
                    disabled ||
                    (action === "release" && (!tech || !!rosterError))
                  }
                >
                  {action === "release" ? "Create work order" : "Confirm skip"}
                </Button>
              </form>
            </FormPopup>
          </>
        )
      )}
    </article>
  );
}

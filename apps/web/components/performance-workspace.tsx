"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, RefreshCw, ShieldCheck } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  api,
  ApiError,
  type Machine,
  type Me,
  type MaintenancePerformance,
} from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
const label = (v: string) =>
  ({
    BREAKDOWN: "Breakdowns",
    PLANNED: "Planned maintenance",
    INVESTIGATION: "Investigations",
    MANAGEMENT: "Plant management",
    MAINTENANCE_REQUIRED: "Maintenance required",
    SENSOR_CHECK_REQUIRED: "Sensor check required",
    OPERATING_CHANGE_EXPLAINED: "Operating change explained",
    NO_FAULT_FOUND: "No fault found",
    INCONCLUSIVE: "Inconclusive",
  })[v] ??
  v
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (s) => s.toUpperCase());
const todayIST = () =>
  new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const time = (v: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v)) + " IST";
const hours = (v: number | null) =>
  v === null
    ? "Unavailable"
    : `${v.toLocaleString("en-IN", { maximumFractionDigits: 3 })} h`;
const focus: Record<Me["role"], string> = {
  OPERATOR:
    "Check reported work and delays. Report new observations from Work orders; this dashboard does not create issues.",
  TECHNICIAN:
    "Check your assigned open work, then open its work order to start or submit findings. You cannot approve your submission in Technician view.",
  MAINTENANCE_HEAD:
    "Identify unassigned work, overdue planned tasks and submissions awaiting your review. Open the source work order or calendar to take action.",
  SUPERVISOR:
    "Monitor approved work awaiting closure and overdue tasks. Close approved work from its work order; engineering approval remains with the Maintenance head.",
  MANAGEMENT:
    "Review workload, delays, planned-task completion and investigation outcomes. Operational changes remain with the responsible team roles.",
  ADMINISTRATOR:
    "Inspect the same scoped performance records. Administrator view has no assignment, repair, engineering approval or closure authority.",
};
export function PerformanceWorkspace({
  machine,
  user,
  token,
}: {
  machine: Machine;
  user: Me;
  token: string;
}) {
  const router = useRouter(),
    { expire } = useAuth();
  const [query, setQuery] = useState({ from: "", to: "", kind: "" }),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [kind, setKind] = useState("");
  const [data, setData] = useState<MaintenancePerformance | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [validation, setValidation] = useState(""),
    [attempt, setAttempt] = useState(0);
  const base = `/machines/${encodeURIComponent(machine.code)}`;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    const params = new URLSearchParams();
    if (query.from) {
      params.set("from", query.from);
      params.set("to", query.to);
    }
    if (query.kind) params.set("kind", query.kind);
    api<MaintenancePerformance>(
      base + "/performance?" + params,
      token,
      abort.signal,
    )
      .then((next) => {
        if (abort.signal.aborted) return;
        setData(next);
        if (!query.from) {
          setFrom(next.from);
          setTo(next.to);
        }
      })
      .catch(async (e) => {
        if (abort.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) {
          await expire();
          router.replace("/login?reason=expired");
          return;
        }
        setError(
          e instanceof Error
            ? e.message
            : "Unable to load maintenance performance.",
        );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [base, token, query, attempt, expire, router]);
  function apply(e: FormEvent) {
    e.preventDefault();
    if (
      !from ||
      !to ||
      from > to ||
      to > todayIST() ||
      Date.parse(to) - Date.parse(from) > 365 * 86400000
    ) {
      setValidation(
        "Choose both IST dates in order, up to 366 days, ending no later than today.",
      );
      return;
    }
    setValidation("");
    setQuery({ from, to, kind });
  }
  const count = (key: string) =>
    data?.current.statuses.find((s) => s.key === key)?.count ?? 0;
  return (
    <div className="performance-workspace">
      <Link className="back-link" href={base}>
        <ArrowLeft size={14} />
        Machine overview
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {machine.code} / MAINTENANCE PERFORMANCE
          </div>
          <h1>Maintenance performance</h1>
          <p>
            Workload, planned-task closure and investigation outcomes from saved
            maintenance records.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setAttempt((v) => v + 1)}
        >
          <RefreshCw size={15} />
          Refresh performance
        </Button>
      </div>
      <div className="performance-role">
        <ShieldCheck size={19} />
        <div>
          <strong>{label(user.role)} workspace · Read-only dashboard</strong>
          <p>{focus[user.role]}</p>
          <div className="performance-links">
            <Link href={base + "/work-orders"}>Open work orders</Link>
            <Link href={base + "/calendar"}>Open maintenance calendar</Link>
          </div>
        </div>
      </div>
      <form
        className="performance-filters"
        aria-label="Performance filters"
        onSubmit={apply}
      >
        <label>
          From (IST)
          <input
            aria-label="Performance from date"
            type="date"
            required
            max={todayIST()}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          To (IST)
          <input
            aria-label="Performance to date"
            type="date"
            required
            max={todayIST()}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          Work type
          <select
            aria-label="Performance work type"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={loading}
          >
            <option value="">All work types</option>
            {["BREAKDOWN", "PLANNED", "INVESTIGATION"].map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={loading}>Apply performance filters</Button>
      </form>
      {validation && (
        <p className="performance-error" role="alert">
          {validation}
        </p>
      )}
      {loading ? (
        <p role="status">Loading saved maintenance performance…</p>
      ) : error ? (
        <div className="performance-error" role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setAttempt((v) => v + 1)}>
            Retry performance
          </Button>
        </div>
      ) : (
        data && (
          <>
            <p className="performance-snapshot">
              {data.from} to {data.to} (IST) ·{" "}
              {data.kind ? label(data.kind) : "All work types"} · Refreshed{" "}
              {time(data.generatedAt)}. Refresh after workflow changes.
            </p>
            <div className="performance-summary">
              {[
                [
                  "Orders created in range",
                  data.cohort.total,
                  "Current state of orders created on these dates",
                ],
                [
                  "Orders closed in range",
                  data.closedInRange,
                  "Includes orders created before the selected dates",
                ],
                [
                  "Current open work orders",
                  data.current.total,
                  "All creation dates; selected work type applies",
                ],
                [
                  "Awaiting head review",
                  count("AWAITING_REVIEW"),
                  "Current submissions waiting for engineering review",
                ],
              ].map(([title, value, note]) => (
                <article className="performance-metric" key={String(title)}>
                  <h2>{title}</h2>
                  <strong>{value}</strong>
                  <p>{note}</p>
                </article>
              ))}
            </div>
            <section
              className="panel performance-section"
              aria-label="Current maintenance backlog"
            >
              <div className="panel-heading">
                <h2>Current backlog · all creation dates</h2>
              </div>
              <div className="performance-body">
                <p>
                  The date filter does not hide older unfinished work. These are
                  current states, not a reconstructed historical backlog.
                </p>
                <div className="performance-chips">
                  {data.current.statuses.map((s) => (
                    <span key={s.key}>
                      {label(s.key)} <strong>{s.count}</strong>
                    </span>
                  ))}
                </div>
                {data.planned.applicable &&
                  (data.planned.scheduling.failed ||
                    data.planned.scheduling.catchingUp) && (
                    <p className="performance-warning" role="alert">
                      Scheduler coverage is incomplete. Overdue planned-task
                      counts include generated tasks only and may understate the
                      backlog.
                    </p>
                  )}
                <div className="performance-highlights">
                  <p>
                    Oldest open order:{" "}
                    <strong>
                      {data.current.oldestAgeHours === null
                        ? "No open work"
                        : hours(data.current.oldestAgeHours)}
                    </strong>
                  </p>
                  <p>
                    Overdue planned tasks:{" "}
                    <strong>
                      {data.current.overduePlanned === null
                        ? "Outside selected work type"
                        : data.current.overduePlanned}
                    </strong>{" "}
                    · Includes unreleased tasks
                  </p>
                  {data.current.myOpen !== null && (
                    <p>
                      Assigned to you: <strong>{data.current.myOpen}</strong>{" "}
                      open work orders
                    </p>
                  )}
                </div>
                <h3>Oldest open work orders · first 10</h3>
                {!data.current.items.length ? (
                  <p>No open work orders for this work type.</p>
                ) : (
                  <div
                    className="performance-table-scroll"
                    tabIndex={0}
                    aria-label="Oldest open work orders"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Work order</th>
                          <th>Type / current stage</th>
                          <th>Technician</th>
                          <th>Age since creation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.current.items.map((o) => (
                          <tr key={o.id}>
                            <td>
                              <Link href={`${base}/work-orders/${o.id}`}>
                                {o.title}
                              </Link>
                              <small>Created {time(o.reportedAt)}</small>
                            </td>
                            <td>
                              {label(o.kind)}
                              <small>{label(o.status)}</small>
                            </td>
                            <td>{o.technicianName ?? "Not assigned"}</td>
                            <td>{hours(o.ageHours)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
            <section
              className="panel performance-section"
              aria-label="Work order creation cohort"
            >
              <div className="panel-heading">
                <h2>Orders created in selected dates · current states</h2>
              </div>
              <div className="performance-body">
                <div className="performance-chips">
                  {data.cohort.statuses.map((s) => (
                    <span key={s.key}>
                      {label(s.key)} <strong>{s.count}</strong>
                    </span>
                  ))}
                </div>
                <div className="performance-chips">
                  {data.cohort.kinds.map((s) => (
                    <span key={s.key}>
                      {label(s.key)} <strong>{s.count}</strong>
                    </span>
                  ))}
                </div>
                {data.cohort.total === 0 && (
                  <p>
                    No work orders were created in this date range. Current
                    backlog can still contain older work.
                  </p>
                )}
              </div>
            </section>
            <section
              className="panel performance-section"
              aria-label="Maintenance activity"
            >
              <div className="panel-heading">
                <h2>Created and closed activity</h2>
                <BarChart3 size={18} />
              </div>
              <div className="performance-body">
                <p>
                  Counts by IST date. Closures include orders created earlier;
                  these two series are not a completion percentage.
                </p>
                <div
                  className="performance-chart"
                  aria-label="Daily created and closed work order chart"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.activity}
                      margin={{ top: 12, right: 15, left: -15, bottom: 8 }}
                    >
                      <CartesianGrid stroke="#deddd5" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => String(v).slice(5)}
                        minTickGap={30}
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Line
                        isAnimationActive={false}
                        type="linear"
                        dataKey="created"
                        name="Created"
                        stroke="#242424"
                        strokeWidth={2}
                        dot={data.activity.length < 40}
                      />
                      <Line
                        isAnimationActive={false}
                        type="linear"
                        dataKey="closed"
                        name="Closed"
                        stroke="#ff5b29"
                        strokeWidth={2}
                        dot={data.activity.length < 40}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <details>
                  <summary>View daily activity table</summary>
                  <div className="performance-table-scroll" tabIndex={0}>
                    <table>
                      <thead>
                        <tr>
                          <th>IST date</th>
                          <th>Created</th>
                          <th>Closed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.activity.map((d) => (
                          <tr key={d.date}>
                            <td>{d.date}</td>
                            <td>{d.created}</td>
                            <td>{d.closed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </section>
            <section
              className="panel performance-section"
              aria-label="Planned maintenance performance"
            >
              <div className="panel-heading">
                <h2>Planned maintenance · due in selected dates</h2>
              </div>
              <div className="performance-body">
                {!data.planned.applicable ? (
                  <p>Planned maintenance is outside the selected work type.</p>
                ) : (
                  <>
                    <p>
                      Generated tasks due by refresh time. Completion means
                      approved work was administratively closed. On-time means
                      closure at or before the fixed due instant; performed time
                      remains separate.
                    </p>
                    {(data.planned.scheduling.failed ||
                      data.planned.scheduling.catchingUp) && (
                      <p className="performance-warning" role="alert">
                        Schedule coverage is incomplete or the last scheduler
                        run failed. Counts describe generated tasks only;
                        percentages are unavailable until scheduling catches up.
                      </p>
                    )}
                    <div className="performance-chips">
                      {[
                        ["Due", data.planned.due],
                        ["Skipped", data.planned.skipped],
                        ["Cancelled", data.planned.cancelled ?? 0],
                        [
                          "Eligible (excluding skipped/cancelled)",
                          data.planned.eligible,
                        ],
                        ["Closed on time", data.planned.onTime],
                        ["Closed late", data.planned.late],
                        ["Still open", data.planned.open],
                      ].map(([k, v]) => (
                        <span key={String(k)}>
                          {k} <strong>{v}</strong>
                        </span>
                      ))}
                    </div>
                    <p>
                      Closed / eligible due tasks:{" "}
                      <strong>
                        {data.planned.completionPercent === null
                          ? "Unavailable"
                          : data.planned.completionPercent + "%"}
                      </strong>{" "}
                      · On-time closed / eligible due tasks:{" "}
                      <strong>
                        {data.planned.onTimePercent === null
                          ? "Unavailable"
                          : data.planned.onTimePercent + "%"}
                      </strong>
                    </p>
                    <p>
                      Last scheduler run:{" "}
                      {data.planned.scheduling.lastJobAt
                        ? time(data.planned.scheduling.lastJobAt)
                        : "No run observed since service restart"}
                      . Future due instants today are excluded.
                    </p>
                    <Link href={base + "/calendar"}>
                      Inspect due dates and task evidence
                    </Link>
                  </>
                )}
              </div>
            </section>
            <section
              className="panel performance-section"
              aria-label="Investigation outcomes"
            >
              <div className="panel-heading">
                <h2>
                  Investigation outcomes · orders created in selected dates
                </h2>
              </div>
              <div className="performance-body">
                <p>
                  Latest retained submissions, including returned or pending
                  review. Findings from synthetic flags are not confirmed
                  breakdowns or causes of production loss. Recommended work is
                  not a tracked repair completion.
                </p>
                <p>
                  {data.investigations.total} investigations ·{" "}
                  {data.investigations.unsubmitted} without a current submission
                  · {data.investigations.legacyUnrecorded} earlier submissions
                  without an outcome.
                </p>
                <div className="performance-table-scroll" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Outcome</th>
                        <th>Submitted</th>
                        <th>Approved or closed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.investigations.outcomes.map((o) => (
                        <tr key={o.key}>
                          <td>{label(o.key)}</td>
                          <td>{o.count}</td>
                          <td>{o.approvedOrClosed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )
      )}
    </div>
  );
}

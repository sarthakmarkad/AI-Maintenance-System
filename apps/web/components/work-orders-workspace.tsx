"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ClipboardList, RefreshCw, Plus, ShieldCheck, Clock, CheckCircle2, } from "lucide-react";
import { api, ApiError, type Machine, type Me, type WorkOrder, type WorkOrderList, type WorkOrderHistory, type EligibleTechnicians, } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
const statuses = [
    "REPORTED",
    "ASSIGNED",
    "IN_PROGRESS",
    "AWAITING_REVIEW",
    "APPROVED",
    "CLOSED",
];
const label = (v: string) => v
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (s) => s.toUpperCase());
const time = (v: string | null) => v
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "medium",
    }).format(new Date(v)) + " IST"
    : "Not recorded";
const localInput = (v: string | null) => v ? new Date(Date.parse(v) + 330 * 60000).toISOString().slice(0, 19) : "";
function instant(value: string) {
    const d = new Date(value + "+05:30");
    if (!Number.isFinite(d.getTime()) ||
        localInput(d.toISOString()) !==
            (value.length === 16 ? value + ":00" : value))
        throw new Error("Enter a real local date and time in IST.");
    return d.toISOString();
}
const orderRef = (id: string) => "WO-" + id.slice(0, 8).toUpperCase();
const actionLabels: Record<string, string> = {
    assign: "Assign technician",
    start: "Start repair",
    submit: "Submit repair",
    approve: "Approve repair",
    return: "Return for more work",
    close: "Close work order",
};
const confirmation: Record<string, string> = {
    assign: "Save assignment",
    start: "Confirm start",
    submit: "Submit for review",
    approve: "Confirm approval",
    return: "Send back to technician",
    close: "Confirm closure",
};
const fieldLabels: Record<string, string> = {
    findings: "Inspection findings",
    rootCause: "Human root-cause analysis",
    correctiveAction: "Corrective action",
    preventiveAction: "Preventive action",
    restoredAt: "Service restored",
    reason: "Reason",
    note: "Note",
    technicianId: "Assigned technician ID",
    technicianName: "Assigned technician",
    previousTechnicianId: "Previous technician ID",
    priority: "Reported priority",
    impact: "Reported impact",
    observedAt: "First observed",
    performedAt: "Maintenance performed",
    workPerformed: "Work performed",
    dueAt: "Planned due time",
};
const evidenceLabel = (key: string, planned: boolean) => fieldLabels[key];
export function WorkOrdersWorkspace({ machine, user, token, orderId, }: {
    machine: Machine;
    user: Me;
    token: string;
    orderId?: string;
}) {
    const router = useRouter(), { expire } = useAuth(), base = `/machines/${encodeURIComponent(machine.code)}/work-orders`;
    const [list, setList] = useState<WorkOrderList | null>(null), [order, setOrder] = useState<WorkOrder | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [busy, setBusy] = useState(false), [success, setSuccess] = useState("");
    const [status, setStatus] = useState(""), [cursor, setCursor] = useState(""), [attempt, setAttempt] = useState(0), [reportOpen, setReportOpen] = useState(false);
    const lastVersion = useRef<number | null>(null);
    const activeOrderId = useRef(orderId), previousOrderId = useRef(orderId);
    activeOrderId.current = orderId;
    async function failure(e: unknown) {
        if (e instanceof ApiError && e.status === 401) {
            await expire();
            router.replace("/login?reason=expired");
            return;
        }
        setError(e instanceof Error ? e.message : "Unable to load work orders.");
        if (e instanceof ApiError && e.status === 409)
            setConflict(true);
    }
    useEffect(() => {
        const abort = new AbortController();
        setLoading(true);
        setError("");
        if (previousOrderId.current !== orderId) {
            previousOrderId.current = orderId;
            lastVersion.current = null;
            setOrder(null);
            setSuccess("");
            setConflict(false);
            setBusy(false);
        }
        if (orderId)
            api<WorkOrder>(`${base}/${encodeURIComponent(orderId)}`, token, abort.signal)
                .then((next) => {
                if (abort.signal.aborted)
                    return;
                if (lastVersion.current !== null &&
                    lastVersion.current !== next.version)
                    setSuccess("Latest version loaded. Review the record before choosing an action.");
                lastVersion.current = next.version;
                setOrder(next);
                setConflict(false);
            })
                .catch((e) => {
                if (!abort.signal.aborted)
                    void failure(e);
            })
                .finally(() => {
                if (!abort.signal.aborted)
                    setLoading(false);
            });
        else {
            const query = new URLSearchParams();
            if (status)
                query.set("status", status);
            if (cursor)
                query.set("after", cursor);
            api<WorkOrderList>(base + "?" + query, token, abort.signal)
                .then((next) => {
                if (!abort.signal.aborted)
                    setList((old) => cursor && old
                        ? {
                            ...next,
                            items: [
                                ...new Map([...old.items, ...next.items].map((o) => [o.id, o])).values(),
                            ],
                        }
                        : next);
            })
                .catch((e) => {
                if (!abort.signal.aborted)
                    void failure(e);
            })
                .finally(() => {
                if (!abort.signal.aborted)
                    setLoading(false);
            });
        }
        return () => abort.abort();
        // A repeated provider focus event must not reset a workflow form.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [base, orderId, token, status, cursor, attempt]);
    async function act(action: string, body: Record<string, unknown>) {
        if (!order)
            return;
        setBusy(true);
        setError("");
        setSuccess("");
        try {
            const next = await api<WorkOrder>(`${base}/${order.id}/actions/${action}`, token, undefined, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...body, version: order.version }),
            });
            if (activeOrderId.current !== order.id)
                return;
            lastVersion.current = next.version;
            setOrder(next);
            setConflict(false);
            setSuccess("Work order updated. The action and its history were saved together.");
        }
        catch (e) {
            if (activeOrderId.current === order.id)
                await failure(e);
        }
        finally {
            if (activeOrderId.current === order.id)
                setBusy(false);
        }
    }
    async function older() {
        if (!order?.historyNextVersion)
            return;
        setBusy(true);
        try {
            const next = await api<WorkOrderHistory>(`${base}/${order.id}/history?beforeVersion=${order.historyNextVersion}`, token);
            setOrder((current) => current && current.id === order.id
                ? {
                    ...current,
                    events: [...current.events, ...next.items],
                    historyNextVersion: next.nextBeforeVersion,
                }
                : current);
        }
        catch (e) {
            await failure(e);
        }
        finally {
            setBusy(false);
        }
    }
    return (<div className="work-orders-workspace">
      <Link className="back-link" href={orderId
            ? `/machines/${machine.code}/work-orders`
            : `/machines/${machine.code}`}>
        <ArrowLeft size={14}/>
        {orderId ? "All work orders" : "Machine overview"}
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{machine.code} / MAINTENANCE WORKFLOW</div>
          <h1>{orderId ? "Work order" : "Breakdowns & work orders"}</h1>
          <p>
            {orderId
            ? "Repair evidence, engineering review and a clear handoff."
            : "Operator reports and maintenance actions, with a traceable history."}
          </p>
        </div>
        {!orderId && user.role === "OPERATOR" && (<Button onClick={() => setReportOpen((v) => !v)}>
            <Plus size={16}/>
            {reportOpen ? "Hide issue report" : "Report an issue"}
          </Button>)}
      </div>
      {!orderId && (<div className="work-role-note">
          <ShieldCheck size={18}/>
          <p>
            {user.role === "OPERATOR"
                ? "Report observed issues on this machine. The maintenance head assigns the technician."
                : user.role === "TECHNICIAN"
                    ? "You can update repairs assigned to you. Machine access is required."
                    : user.role === "MAINTENANCE_HEAD"
                        ? "Assign technicians, review repair evidence and return or approve submissions."
                        : user.role === "SUPERVISOR"
                            ? "Close approved work after engineering review. Approval belongs to the maintenance head."
                            : "Your role can view work orders. Engineering actions follow the operational roles."}{" "}
            Imported readings do not automatically create breakdowns.
          </p>
        </div>)}
      {reportOpen && !orderId && user.role === "OPERATOR" && (<ReportForm base={base} token={token} onSaved={(id) => router.push(`/machines/${machine.code}/work-orders/${id}`)} onFailure={failure}/>)}
      {error && (<div className="inline-error" role="alert">
          <strong>{error}</strong>
          {conflict && (<p>
              The update was not applied. Reload the latest version and review
              it before trying again. Reloading resets the action form.
            </p>)}
          <Button variant="outline" onClick={() => {
                lastVersion.current = null;
                setOrder(null);
                setAttempt((n) => n + 1);
            }}>
            <RefreshCw size={14}/>
            {orderId ? "Reload work order" : "Retry work orders"}
          </Button>
        </div>)}
      {success && (<p className="work-success" role="status">
          <CheckCircle2 size={17}/>
          {success}
        </p>)}
      {loading ? (<div className="loading-state" role="status">
          <div className="loader"/>
          <p>Loading work orders…</p>
        </div>) : orderId ? (order && (<>
            <section className="panel work-order-header">
              <div>
                <span className="eyebrow">
                  {orderRef(order.id)} · VERSION {order.version}
                </span>
                <h2>{order.title}</h2>
                <div className="work-tags">
                  <span className={`work-status status-${order.status.toLowerCase()}`}>
                    {label(order.status)}
                  </span>
                  <span className="pill">{label(order.priority)} priority</span>
                  {(<span className="pill">
                      Reported impact: {label(order.impact)}
                    </span>)}
                </div>
              </div>
              <p className="work-prose">{order.description}</p>
              <small>
                {"Reported by"}{" "}
                {order.reporter.displayName} · {time(order.reportedAt)}
              </small>
              {null}
            </section>
            <ol className="work-stages" aria-label="Work order stages">
              {statuses.map((s, i) => (<li key={s} aria-current={order.status === s ? "step" : undefined} className={i <= statuses.indexOf(order.status) ? "reached" : ""}>
                  <span>{i + 1}</span>
                  {label(s)}
                </li>))}
            </ol>
            <div className="work-detail-grid">
              <section className="panel">
                <div className="panel-heading">
                  <h2>Responsibility & times</h2>
                  <Clock size={17}/>
                </div>
                <dl className="work-facts">
                  <div>
                    <dt>Assigned technician</dt>
                    <dd>{order.technician?.displayName ?? "Not assigned"}</dd>
                  </div>
                  <div>
                    <dt>
                      {"First observed"}
                    </dt>
                    <dd>
                      {time(order.observedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {"Reported"}
                    </dt>
                    <dd>{time(order.reportedAt)}</dd>
                  </div>
                  <div>
                    <dt>
                      {"Repair started"}
                    </dt>
                    <dd>{time(order.startedAt)}</dd>
                  </div>
                  <div>
                    <dt>
                      {"Service restored"}
                    </dt>
                    <dd>
                      {time(order.restoredAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Submitted for review</dt>
                    <dd>{time(order.submittedAt)}</dd>
                  </div>
                  <div>
                    <dt>Engineering approval</dt>
                    <dd>
                      {time(order.reviewedAt)}
                      {order.reviewer && (<small>{order.reviewer.displayName}</small>)}
                    </dd>
                  </div>
                  <div>
                    <dt>Administrative closure</dt>
                    <dd>
                      {time(order.closedAt)}
                      {order.closer && (<small>{order.closer.displayName}</small>)}
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    {"Current repair & human RCA"}
                  </h2>
                  <ClipboardList size={17}/>
                </div>
                <div className="work-evidence">
                  {[
                "findings",
                "rootCause",
                "correctiveAction",
                "preventiveAction",
            ]
                .filter((key) => true)
                .map((key) => (<div key={key}>
                        <h3>{evidenceLabel(key, false)}</h3>
                        <p className="work-prose">
                          {order[key as "findings"] ?? "Not submitted"}
                        </p>
                      </div>))}
                  {order.returnReason && (<div className="work-return">
                      <h3>Work returned for</h3>
                      <p className="work-prose">{order.returnReason}</p>
                    </div>)}
                </div>
              </section>
            </div>
            <ActionForm key={`${order.id}-${order.version}`} order={order} base={base} token={token} busy={busy} conflict={conflict} act={act} onFailure={failure}/>
            <section className="panel work-history">
              <div className="panel-heading">
                <div>
                  <h2>Assignment, repair & review history</h2>
                  <p>
                    Newest first. Earlier submissions and return reasons remain
                    unchanged.
                  </p>
                </div>
              </div>
              <ol className="work-timeline">
                {order.events.map((event) => (<li key={event.id}>
                    <div className="timeline-marker"/>
                    <div>
                      <div className="work-event-heading">
                        <h3>
                          {label(event.action)} · v{event.version}
                        </h3>
                        <time>{time(event.at)}</time>
                      </div>
                      <p>
                        {event.actor.displayName} · {label(event.actorRole)}
                        <span>
                          {" "}
                          {event.fromStatus
                    ? label(event.fromStatus) + " → "
                    : ""}
                          {label(event.toStatus)}
                        </span>
                      </p>
                      <dl>
                        {Object.entries(event.detail)
                    .filter(([key, v]) => v !== null &&
                    !(event.action === "SCHEDULE" &&
                        [
                            "planId",
                            "occurrenceId",
                            "technicianId",
                        ].includes(key)))
                    .map(([key, value]) => (<div key={key}>
                              <dt>{fieldLabels[key] ?? label(key)}</dt>
                              <dd className="work-prose">
                                {[
                        "restoredAt",
                        "observedAt",
                        "performedAt",
                        "dueAt",
                    ].includes(key) && typeof value === "string"
                        ? time(value)
                        : typeof value === "string"
                            ? value
                            : JSON.stringify(value)}
                              </dd>
                            </div>))}
                      </dl>
                    </div>
                  </li>))}
              </ol>
              {order.historyNextVersion && (<div className="work-panel-footer">
                  <Button variant="outline" disabled={busy} onClick={() => void older()}>
                    Load older history
                  </Button>
                </div>)}
            </section>
          </>)) : (list && (<>
            <div className="work-metrics">
              <section className="metric-card">
                <h2>Open work orders</h2>
                <p>{list.total - (list.counts.CLOSED ?? 0)}</p>
                <small>Across all workflow stages before closure</small>
              </section>
              <section className="metric-card">
                <h2>Awaiting engineering review</h2>
                <p>{list.counts.AWAITING_REVIEW ?? 0}</p>
                <small>Repair submissions waiting for the head</small>
              </section>
              <section className="metric-card">
                <h2>Closed</h2>
                <p>{list.counts.CLOSED ?? 0}</p>
                <small>Approved work with recorded closure</small>
              </section>
            </div>
            <div className="work-list-toolbar">
              <label htmlFor="order-status">
                Workflow status
                <select id="order-status" value={status} onChange={(e) => {
                setStatus(e.target.value);
                setCursor("");
            }}>
                  <option value="">All stages</option>
                  {statuses.map((s) => (<option key={s} value={s}>
                      {label(s)}
                    </option>))}
                </select>
              </label>
              <span>
                {list.total} total work orders on {machine.code}
              </span>
            </div>
            {!list.items.length ? (<section className="state-card">
                <ClipboardList size={32}/>
                <h2>
                  {status
                    ? "No work orders in this stage"
                    : "No work orders yet"}
                </h2>
                <p>
                  Operator reports will appear here. Each report keeps its
                  repair and review history.
                </p>
              </section>) : (<div className="work-order-list">
                {list.items.map((o) => (<Link href={`/machines/${machine.code}/work-orders/${o.id}`} className="work-order-card" key={o.id}>
                    <div>
                      <small>{orderRef(o.id)}</small>
                      <h2>{o.title}</h2>
                      <p>
                        Reported by {o.reporter.displayName} ·{" "}
                        {time(o.reportedAt)}
                      </p>
                      <p>
                        {o.technician
                        ? `Assigned to ${o.technician.displayName}`
                        : "Awaiting technician assignment"}
                      </p>
                    </div>
                    <div className="work-card-status">
                      <span className={`work-status status-${o.status.toLowerCase()}`}>
                        {label(o.status)}
                      </span>
                      <small>
                        {label(o.priority)} priority ·{" "}
                        {label(o.impact)}
                      </small>
                      <ArrowRight size={18}/>
                    </div>
                  </Link>))}
              </div>)}
            {list.nextCursor && (<div className="work-panel-footer">
                <Button variant="outline" onClick={() => setCursor(list.nextCursor!)}>
                  Load more work orders
                </Button>
              </div>)}
          </>))}
      <div className="info-strip">
        <ShieldCheck size={18}/>
        <p>
          Repair restoration, engineering approval and closure are recorded
          separately. Work orders use operator reports and human findings.
        </p>
      </div>
    </div>);
}
function ReportForm({ base, token, onSaved, onFailure, }: {
    base: string;
    token: string;
    onSaved: (id: string) => void;
    onFailure: (e: unknown) => Promise<void>;
}) {
    const [requestId] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [title, setTitle] = useState(""), [description, setDescription] = useState(""), [priority, setPriority] = useState("NORMAL"), [impact, setImpact] = useState("OBSERVATION"), [observed, setObserved] = useState("");
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        try {
            const saved = await api<WorkOrder>(base, token, undefined, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestId,
                    title,
                    description,
                    priority,
                    impact,
                    observedAt: observed ? instant(observed) : null,
                }),
            });
            onSaved(saved.id);
        }
        catch (error) {
            await onFailure(error);
        }
        finally {
            setBusy(false);
        }
    }
    return (<section className="panel work-report">
      <div className="panel-heading">
        <h2>Report a breakdown or issue</h2>
      </div>
      <form className="work-form" onSubmit={submit} aria-label="Issue report">
        <label>
          Issue title
          <input required minLength={3} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy}/>
        </label>
        <label>
          Observed symptoms
          <textarea required minLength={3} maxLength={4000} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy}/>
        </label>
        <div className="work-form-row">
          <label>
            Reported priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)} disabled={busy}>
              {["LOW", "NORMAL", "HIGH"].map((v) => (<option key={v} value={v}>
                  {label(v)}
                </option>))}
            </select>
          </label>
          <label>
            Reported impact
            <select value={impact} onChange={(e) => setImpact(e.target.value)} disabled={busy}>
              {["STOPPED", "DEGRADED", "OBSERVATION"].map((v) => (<option key={v} value={v}>
                  {label(v)}
                </option>))}
            </select>
          </label>
          <label>
            First observed (IST, optional)
            <input type="datetime-local" step="1" value={observed} onChange={(e) => setObserved(e.target.value)} disabled={busy}/>
          </label>
        </div>
        <p>
          Describe what you observed. Leave the observation time blank if it is
          unknown. Report time is recorded when saved.
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving issue…" : "Save issue report"}
        </Button>
      </form>
    </section>);
}
function ActionForm({ order, base, token, busy, conflict, act, onFailure, }: {
    order: WorkOrder;
    base: string;
    token: string;
    busy: boolean;
    conflict: boolean;
    act: (action: string, body: Record<string, unknown>) => Promise<void>;
    onFailure: (e: unknown) => Promise<void>;
}) {
    const planned = false;
    const [action, setAction] = useState(""), [technicians, setTechnicians] = useState<EligibleTechnicians["items"]>([]), [rosterLoading, setRosterLoading] = useState(false), [rosterError, setRosterError] = useState(""), [rosterAttempt, setRosterAttempt] = useState(0), [technicianId, setTechnicianId] = useState(""), [reason, setReason] = useState(""), [note, setNote] = useState("");
    const [findings, setFindings] = useState(order.findings ?? ""), [rootCause, setRootCause] = useState(order.rootCause ?? ""), [correctiveAction, setCorrective] = useState(order.correctiveAction ?? ""), [preventiveAction, setPreventive] = useState(order.preventiveAction ?? ""), [restored, setRestored] = useState(localInput(order.restoredAt));
    useEffect(() => {
        if (action !== "assign")
            return;
        const abort = new AbortController();
        setRosterLoading(true);
        setRosterError("");
        api<EligibleTechnicians>(base + "/technicians", token, abort.signal)
            .then((data) => {
            if (!abort.signal.aborted)
                setTechnicians(data.items);
        })
            .catch((e) => {
            if (!abort.signal.aborted) {
                setRosterError("Could not load eligible technicians.");
                void onFailure(e);
            }
        })
            .finally(() => {
            if (!abort.signal.aborted)
                setRosterLoading(false);
        });
        return () => abort.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [action, base, token, rosterAttempt]);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        if (!action)
            return;
        try {
            const body: Record<string, unknown> = action === "assign"
                ? { technicianId, ...(reason.trim() ? { reason } : {}) }
                : action === "submit"
                    ? {
                        findings,
                        correctiveAction,
                        ...({
                            rootCause,
                            preventiveAction,
                            restoredAt: instant(restored),
                        }),
                    }
                    : action === "return"
                        ? { reason }
                        : action === "approve" || action === "close"
                            ? note.trim()
                                ? { note }
                                : {}
                            : {};
            await act(action, body);
        }
        catch (error) {
            await onFailure(error);
        }
    }
    return (<section className="panel work-action-panel" aria-label="Workflow actions">
      <div className="panel-heading">
        <h2>Next action</h2>
        <span className="pill">Version {order.version}</span>
      </div>
      <div className="work-action-body">
        {!order.allowedActions.length ? (<p>
            {order.status === "CLOSED"
                ? "This work order is closed. Its report and history remain available."
                : "No workflow action is available to your role or assignment at this stage."}
          </p>) : (<>
            <div className="work-action-choices">
              {order.allowedActions.map((a) => (<Button key={a} variant={action === a ? "default" : "outline"} disabled={busy || conflict} onClick={() => setAction(a)}>
                  {(actionLabels[a] ?? label(a))}
                </Button>))}
            </div>
            {action && (<form className="work-form" aria-label="Work order action" onSubmit={submit}>
                {action === "assign" && (<>
                    {order.technician && (<p>
                        Reassignment resets the current repair fields. Earlier
                        submissions remain in history.
                      </p>)}
                    {rosterLoading ? (<p role="status">Loading eligible technicians…</p>) : rosterError ? (<p>
                        {rosterError}
                        <Button variant="outline" type="button" onClick={() => setRosterAttempt((n) => n + 1)}>
                          Retry technician list
                        </Button>
                      </p>) : (<label>
                        Eligible technician
                        <select required value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} disabled={busy}>
                          <option value="">Choose a technician</option>
                          {technicians
                            .filter((t) => t.userId !== order.technician?.userId)
                            .map((t) => (<option key={t.userId} value={t.userId}>
                                {t.displayName}
                              </option>))}
                        </select>
                      </label>)}
                    {!rosterLoading && !rosterError && !technicians.length && (<p>
                        No eligible technicians. An administrator must provision
                        an active technician and grant machine access.
                      </p>)}
                    <label>
                      Assignment reason
                      {order.technician ? " (required)" : " (optional)"}
                      <textarea required={!!order.technician} minLength={3} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}/>
                    </label>
                  </>)}
                {action === "start" && (<p>
                    {"Confirm that you are starting the assigned repair. The start time will be recorded separately from restoration."}
                  </p>)}
                {action === "submit" && (<>
                    {[
                        ["findings", findings, setFindings],
                        ["rootCause", rootCause, setRootCause],
                        ["correctiveAction", correctiveAction, setCorrective],
                        ["preventiveAction", preventiveAction, setPreventive],
                    ]
                        .filter(([key]) => true)
                        .map(([key, value, setter]) => (<label key={String(key)}>
                          {evidenceLabel(String(key), false)}
                          <textarea required={true} minLength={3} maxLength={4000} rows={3} value={String(value)} disabled={busy} onChange={(e) => (setter as (value: string) => void)(e.target.value)}/>
                        </label>))}
                    <label>
                      {"Service restored (IST)"}
                      <input required type="datetime-local" step="1" value={restored} onChange={(e) => setRestored(e.target.value)} disabled={busy}/>
                    </label>
                    <p>
                      {"Enter the actual restoration time, between report time and now. This submission requests engineering review."}
                    </p>
                  </>)}
                {action === "return" && (<label>
                    Reason for return
                    <textarea required minLength={3} maxLength={4000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}/>
                  </label>)}
                {(action === "approve" || action === "close") && (<>
                    <p>
                      {action === "approve"
                        ?
                            "Review the repair evidence and human RCA before recording engineering approval."
                        : "Confirm administrative closure of the approved work. Restoration and approval timestamps stay unchanged."}
                    </p>
                    <label>
                      {action === "approve"
                        ? "Engineering review note (optional)"
                        : "Closure note (optional)"}
                      <textarea minLength={3} maxLength={4000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy}/>
                    </label>
                  </>)}
                <Button disabled={busy ||
                    conflict ||
                    (action === "assign" &&
                        (!technicianId || rosterLoading || !!rosterError))} type="submit">
                  {busy ? "Saving action…" : confirmation[action]}
                </Button>
              </form>)}
          </>)}
      </div>
    </section>);
}

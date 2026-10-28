"use client";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanLine, RefreshCw } from "lucide-react";
import {
  api,
  ApiError,
  type AnomalyList,
  type AnomalyFlag,
  type AnomalyEvidence,
  type AnomalyMarker,
  type AnomalyReceipt,
  type AnomalyHistory,
  type EligibleTechnicians,
} from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { FormPopup } from "./ui/form-popup";
const labels: Record<string, string> = {
  SUDDEN_CHANGE: "Sudden change",
  SUSTAINED_SHIFT: "Sustained shift",
  DRIFT: "Gradual drift",
};
const n = (v: number) =>
  v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const time = (v: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v)) + " IST";
export function Evidence({ flag }: { flag: AnomalyEvidence }) {
  const explanation =
    flag.kind === "SUDDEN_CHANGE"
      ? "Change from the immediately preceding hour"
      : flag.kind === "SUSTAINED_SHIFT"
        ? "Mean shift across three hours; every sample crosses the threshold"
        : "Net change across six hours; at least four of five steps follow this direction";
  return (
    <>
      <p className="anomaly-explanation">
        {explanation}:{" "}
        <strong>
          {n(flag.change)} {flag.unit}
        </strong>
        . Rule threshold: {n(flag.threshold)} {flag.unit}. Direction:{" "}
        {flag.direction === "UP" ? "upward" : "downward"}.
      </p>
      <dl className="anomaly-facts">
        <div>
          <dt>Measured value</dt>
          <dd>
            {n(flag.value)} {flag.unit}
          </dd>
        </div>
        <div>
          <dt>Baseline median</dt>
          <dd>
            {n(flag.baselineMedian)} {flag.unit}
          </dd>
        </div>
        <div>
          <dt>Baseline variation (MAD)</dt>
          <dd>
            {n(flag.baselineMad)} {flag.unit}
          </dd>
        </div>
        <div>
          <dt>Effective scale</dt>
          <dd>
            {n(flag.scale)} {flag.unit}
          </dd>
        </div>
      </dl>
      <p className="anomaly-context">
        Baseline: 24 consecutive earlier hourly readings,{" "}
        {time(flag.baseline[0].measuredAt)} to{" "}
        {time(flag.baseline.at(-1)!.measuredAt)}. Evidence available after
        receipt: {time(flag.availableAt)}.
      </p>
      <details className="anomaly-evidence">
        <summary>View supporting readings</summary>
        <div
          className="table-scroll"
          tabIndex={0}
          aria-label="Statistical flag evidence"
        >
          <table>
            <thead>
              <tr>
                <th>Evidence</th>
                <th>Measured (IST)</th>
                <th>Value ({flag.unit})</th>
                <th>Source reference</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...flag.baseline.map((r) => ({ ...r, group: "Baseline" })),
                ...flag.samples.map((r) => ({
                  ...r,
                  group: "Evaluated sample",
                })),
              ].map((r) => (
                <tr key={r.id}>
                  <td>{r.group}</td>
                  <td>{time(r.measuredAt)}</td>
                  <td>{n(r.value)}</td>
                  <td>
                    {r.sourceId} · row {r.sourceRow}
                    <small>Received {time(r.receivedAt)}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Policy {flag.policyVersion}. Thresholds describe this synthetic
          demonstration; they are not engineering operating limits. A
          statistical pattern does not establish a fault or its cause.
        </p>
      </details>
    </>
  );
}
function InvestigationHandoff({
  code,
  token,
  review,
  canOpen,
  onSaved,
  onFailure,
}: {
  code: string;
  token: string;
  review: AnomalyReceipt;
  canOpen: boolean;
  onSaved: (r: AnomalyReceipt) => void;
  onFailure: (e: unknown, set: (s: string) => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [technicianId, setTechnician] = useState("");
  const [roster, setRoster] = useState<EligibleTechnicians["items"]>([]),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setRoster([]);
    api<EligibleTechnicians>(
      `/machines/${encodeURIComponent(code)}/work-orders/technicians`,
      token,
      abort.signal,
    )
      .then((r) => {
        if (!abort.signal.aborted) setRoster(r.items);
      })
      .catch((e) => {
        if (!abort.signal.aborted) void onFailure(e, setError);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code, token, attempt]);
  if (review.decision !== "INVESTIGATE") return null;
  if (review.workOrderId)
    return (
      <p>
        <Link
          className="text-button"
          href={`/machines/${code}/work-orders/${review.workOrderId}`}
        >
          View investigation work order
        </Link>{" "}
        · {review.workOrderStatus?.replaceAll("_", " ").toLowerCase()}
      </p>
    );
  if (!canOpen)
    return (
      <p>Awaiting the Maintenance head to open and assign an investigation.</p>
    );
  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Open investigation
      </Button>
      <FormPopup
        open={open}
        onOpenChange={setOpen}
        title="Assign investigation"
        description="Explicitly open investigation work from this retained synthetic review. It does not confirm a breakdown."
        busy={busy}
      >
        <form
          aria-label="Open investigation"
          className="anomaly-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              busy ||
              conflict ||
              !roster.some((t) => t.userId === technicianId)
            )
              return;
            setBusy(true);
            setError("");
            try {
              onSaved(
                await api<AnomalyReceipt>(
                  `/machines/${encodeURIComponent(code)}/readings/anomalies/reviews/${review.id}/investigation`,
                  token,
                  undefined,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ technicianId }),
                  },
                ),
              );
            } catch (e) {
              if (e instanceof ApiError && e.status === 409) setConflict(true);
              await onFailure(e, setError);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Assign technician
            <select
              aria-label="Investigation technician"
              required
              value={technicianId}
              disabled={loading || busy || conflict}
              onChange={(e) => setTechnician(e.target.value)}
            >
              <option value="">Choose a technician</option>
              {roster.map((t) => (
                <option key={t.userId} value={t.userId}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </label>
          {loading ? (
            <p>Loading eligible technicians…</p>
          ) : !error && !roster.length ? (
            <p>
              No eligible technicians with machine access. Contact your
              administrator.
            </p>
          ) : null}
          <p>
            The assignee must use their granted Technician role to start and
            submit the investigation.
          </p>
          {error && <p role="alert">{error}</p>}
          {error && !conflict && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setAttempt((v) => v + 1)}
            >
              Retry technician directory
            </Button>
          )}
          {conflict && (
            <p>
              Reload the analysis or review history to see the existing
              investigation.
            </p>
          )}
          <div className="anomaly-actions">
            <Button
              disabled={
                loading ||
                busy ||
                conflict ||
                !roster.some((t) => t.userId === technicianId)
              }
            >
              {busy
                ? "Opening investigation…"
                : "Confirm investigation assignment"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel assignment
            </Button>
          </div>
        </form>
      </FormPopup>
    </>
  );
}
export function AnomaliesWorkspace({
  code,
  token,
  from,
  to,
  onMarkers,
}: {
  code: string;
  token: string;
  from: string;
  to: string;
  onMarkers: Dispatch<SetStateAction<AnomalyMarker[]>>;
}) {
  const base = `/machines/${encodeURIComponent(code)}/readings/anomalies`,
    router = useRouter(),
    { expire } = useAuth();
  const [data, setData] = useState<AnomalyList | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [parameter, setParameter] = useState(""),
    [kind, setKind] = useState(""),
    [status, setStatus] = useState(""),
    [after, setAfter] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selected, setSelected] = useState<AnomalyFlag | null>(null),
    [reason, setReason] = useState(""),
    [decision, setDecision] = useState("INVESTIGATE"),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [actionError, setActionError] = useState(""),
    [message, setMessage] = useState("");
  const [history, setHistory] = useState<AnomalyHistory | null>(null),
    [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState("");
  async function failure(e: unknown, set: (v: string) => void) {
    if (e instanceof ApiError && e.status === 401) {
      await expire();
      router.replace("/login?reason=expired");
      return;
    }
    set(
      e instanceof Error ? e.message : "Unable to load statistical patterns.",
    );
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    onMarkers([]);
    const q = new URLSearchParams({ from, to });
    if (parameter) q.set("parameter", parameter);
    if (kind) q.set("kind", kind);
    if (status) q.set("status", status);
    if (after) q.set("after", after);
    api<AnomalyList>(base + "?" + q, token, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setData(next);
          onMarkers(next.markers);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          if (e instanceof ApiError && e.status === 409) setConflict(true);
          void failure(e, setError);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // Stable API identity, selected date range and explicit filters own this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    base,
    token,
    from,
    to,
    parameter,
    kind,
    status,
    after,
    attempt,
    onMarkers,
  ]);
  function reload() {
    setSelected(null);
    setReason("");
    setConflict(false);
    setActionError("");
    setAfter("");
    setAttempt((v) => v + 1);
  }
  async function save() {
    if (!selected || busy || conflict) return;
    setBusy(true);
    setActionError("");
    setMessage("");
    try {
      const receipt = await api<AnomalyReceipt>(
        base + "/reviews",
        token,
        undefined,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: selected.key,
            measuredAt: selected.measuredAt,
            decision,
            reason,
          }),
        },
      );
      setMessage(
        receipt.workOrderId
          ? "Investigation work order opened with this flag's evidence. Track it on the Work orders page."
          : receipt.decision === "INVESTIGATE"
            ? "Review saved with its supporting evidence. Open and assign an investigation from the reviewed flag or saved review history."
            : "Review saved with its supporting evidence. Flag dismissed; no investigation was opened.",
      );
      setHistory(null);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      await failure(e, setActionError);
    } finally {
      setBusy(false);
    }
  }
  function updateReceipt(receipt: AnomalyReceipt) {
    setData((current) =>
      current
        ? {
            ...current,
            items: current.items.map((f) =>
              f.review?.id === receipt.id ? { ...f, review: receipt } : f,
            ),
          }
        : current,
    );
    setHistory((current) =>
      current
        ? {
            ...current,
            items: current.items.map((r) =>
              r.id === receipt.id ? { ...r, ...receipt } : r,
            ),
          }
        : current,
    );
    setMessage(
      "Investigation assigned. Open its work order to track progress.",
    );
  }
  async function loadHistory(more = false) {
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const next = await api<AnomalyHistory>(
        base +
          "/reviews" +
          (more && history?.nextCursor ? "?after=" + history.nextCursor : ""),
        token,
      );
      setHistory((prev) => ({
        ...next,
        items: more && prev ? [...prev.items, ...next.items] : next.items,
      }));
    } catch (e) {
      await failure(e, setHistoryError);
    } finally {
      setHistoryBusy(false);
    }
  }
  function change(set: (v: string) => void, value: string) {
    set(value);
    setAfter("");
    setSelected(null);
    setReason("");
  }
  return (
    <section
      className="panel anomaly-panel"
      aria-label="Statistical pattern analysis"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">COMPARE WITH EARLIER READINGS</span>
          <h2>
            <ScanLine size={19} /> Statistical patterns
          </h2>
          <p>
            Sudden changes, sustained shifts and gradual drift · synthetic
            demonstration
          </p>
        </div>
        <Button variant="outline" onClick={reload} disabled={busy || loading}>
          <RefreshCw size={14} /> Reload analysis
        </Button>
      </div>
      <div className="anomaly-body">
        <p>
          Each rule compares hourly values with 24 consecutive earlier readings.
          Missing hours stop evaluation until enough history is available. Flags
          identify patterns for human investigation.
        </p>
        <details className="anomaly-method">
          <summary>How the rules work</summary>
          <p>
            The baseline uses a median and median absolute deviation (MAD),
            scaled by 1 / 0.6745. Demo minimum scales are 1 °C for hot
            temperature, 0.5 °C for cold temperature and 1 bar for pressure.
          </p>
          <ul>
            <li>
              Sudden change: one-hour change exceeds four effective scales.
            </li>
            <li>
              Sustained shift: three successive values each lie more than three
              scales on the same side of the earlier baseline median.
            </li>
            <li>
              Gradual drift: six values change by more than four scales, with at
              least four of five steps in the same direction.
            </li>
          </ul>
          <p>
            Rules use only earlier data and exclude workbook event labels. They
            do not account for job changes, sensor condition or operating modes.
            Nearby flags can describe the same pattern; counts are not incident
            counts or probabilities.
          </p>
        </details>
        {message && (
          <p className="reading-success" role="status">
            {message}
          </p>
        )}
        {conflict && (
          <p className="anomaly-warning" role="alert">
            Results changed or this flag was reviewed elsewhere. Reload analysis
            before another action.
          </p>
        )}
        <div className="anomaly-filters">
          <label>
            Parameter
            <select
              aria-label="Pattern parameter"
              value={parameter}
              disabled={busy || conflict}
              onChange={(e) => change(setParameter, e.target.value)}
            >
              <option value="">All parameters</option>
              <option value="hotTempC">Hot temperature</option>
              <option value="coldTempC">Cold temperature</option>
              <option value="pressureBar">Pressure</option>
            </select>
          </label>
          <label>
            Pattern
            <select
              aria-label="Pattern type"
              value={kind}
              disabled={busy || conflict}
              onChange={(e) => change(setKind, e.target.value)}
            >
              <option value="">All patterns</option>
              {Object.entries(labels).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Review
            <select
              aria-label="Pattern review status"
              value={status}
              disabled={busy || conflict}
              onChange={(e) => change(setStatus, e.target.value)}
            >
              <option value="">All reviews</option>
              <option value="PENDING">Needs review</option>
              <option value="REVIEWED">Reviewed</option>
            </select>
          </label>
        </div>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button variant="outline" disabled={busy} onClick={reload}>
              Try pattern analysis again
            </Button>
          </div>
        ) : loading ? (
          <p role="status">Comparing saved readings…</p>
        ) : (
          data && (
            <>
              <div className="anomaly-metrics">
                <div>
                  <strong>{data.total}</strong>
                  <span>Statistical flags</span>
                </div>
                <div>
                  <strong>{data.pending}</strong>
                  <span>Needs review</span>
                </div>
                <div>
                  <strong>{data.reviewed}</strong>
                  <span>Reviewed</span>
                </div>
              </div>
              <p className="anomaly-context">
                {data.eligible.SUDDEN_CHANGE} of {data.observations}{" "}
                observations eligible for sudden-change checks;{" "}
                {data.eligible.SUSTAINED_SHIFT} for shifts;{" "}
                {data.eligible.DRIFT} for drift. {data.insufficientHistory}{" "}
                observations lack the 24 earlier hours needed for a
                sudden-change check. Calculated {time(data.evaluatedAt)}.
              </p>
              {!data.observations ? (
                <p>
                  No saved readings in this date range. Import synthetic
                  readings or choose another period.
                </p>
              ) : !data.items.length ? (
                <p>
                  {data.total
                    ? "No flags match these filters."
                    : data.eligible.SUDDEN_CHANGE
                      ? "No statistical flags under these demonstration rules. This does not establish machine health."
                      : "Not enough consecutive history to evaluate patterns yet. At least 25 hourly observations are needed for the first sudden-change check."}
                </p>
              ) : (
                <>
                  <p className="anomaly-context">
                    {data.matching} matching flags · up to 5 per page. Colored
                    dots on the charts mark the evaluated reading for matching
                    flags across all pages.
                  </p>
                  <div className="anomaly-cards">
                    {data.items.map((flag) => (
                      <article className="anomaly-card" key={flag.key}>
                        <div className="anomaly-card-heading">
                          <div>
                            <span className="tag">{labels[flag.kind]}</span>
                            <h3>{flag.name}</h3>
                            <p>{time(flag.measuredAt)}</p>
                          </div>
                          <span className="pill">
                            {flag.review
                              ? flag.review.decision === "INVESTIGATE"
                                ? "Investigation needed"
                                : "Dismissed"
                              : "Needs review"}
                          </span>
                        </div>
                        <Evidence flag={flag} />
                        {flag.review ? (
                          <div className="anomaly-decision">
                            <strong>
                              {flag.review.decision === "INVESTIGATE"
                                ? "Investigation needed"
                                : "Dismissed"}
                            </strong>
                            <p>{flag.review.reason}</p>
                            <small>
                              {flag.review.reviewerName} · Maintenance head ·{" "}
                              {time(flag.review.createdAt)}
                            </small>
                            <InvestigationHandoff
                              code={code}
                              token={token}
                              review={flag.review}
                              canOpen={data.canReview}
                              onSaved={updateReceipt}
                              onFailure={failure}
                            />
                          </div>
                        ) : (
                          data.canReview && (
                            <Button
                              variant="outline"
                              disabled={busy || loading || conflict}
                              onClick={() => {
                                if (selected?.key !== flag.key) {
                                  setSelected(flag);
                                  setReason("");
                                  setDecision("INVESTIGATE");
                                  setActionError("");
                                }
                                setReviewOpen(true);
                              }}
                            >
                              Review {labels[flag.kind].toLowerCase()}
                            </Button>
                          )
                        )}
                        {selected?.key === flag.key && (
                          <FormPopup
                            open={reviewOpen}
                            onOpenChange={setReviewOpen}
                            title="Review statistical flag"
                            description={`Synthetic observations · ${flag.parameter} · ${labels[flag.kind]}`}
                            busy={busy}
                          >
                            <details>
                              <summary>Review flag evidence</summary>
                              <Evidence flag={flag} />
                            </details>
                            <form
                              className="anomaly-form"
                              aria-label="Review statistical flag"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void save();
                              }}
                            >
                              <h4>Record your review</h4>
                              <label>
                                Decision
                                <select
                                  aria-label="Review decision"
                                  value={decision}
                                  disabled={busy || conflict}
                                  onChange={(e) => setDecision(e.target.value)}
                                >
                                  <option value="INVESTIGATE">
                                    Needs investigation
                                  </option>
                                  <option value="DISMISSED">
                                    Dismiss with reason
                                  </option>
                                </select>
                              </label>
                              <label>
                                Review reason
                                <textarea
                                  aria-label="Review reason"
                                  required
                                  minLength={3}
                                  maxLength={2000}
                                  value={reason}
                                  disabled={busy || conflict}
                                  onChange={(e) => setReason(e.target.value)}
                                />
                              </label>
                              <p>
                                This decision and the exact supporting readings
                                are retained. Save the review first, then
                                explicitly open and assign an investigation. No
                                breakdown is created.
                              </p>
                              {actionError && <p role="alert">{actionError}</p>}
                              <div className="anomaly-actions">
                                <Button
                                  disabled={
                                    busy ||
                                    loading ||
                                    conflict ||
                                    reason.trim().length < 3
                                  }
                                >
                                  {busy ? "Saving review…" : "Save review"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() => setReviewOpen(false)}
                                >
                                  Cancel review
                                </Button>
                              </div>
                            </form>
                          </FormPopup>
                        )}
                      </article>
                    ))}
                  </div>
                  <div className="anomaly-actions">
                    {after && (
                      <Button
                        variant="outline"
                        disabled={busy || conflict}
                        onClick={() => setAfter("")}
                      >
                        First flags
                      </Button>
                    )}
                    {data.nextCursor && (
                      <Button
                        variant="outline"
                        disabled={busy || conflict}
                        onClick={() => {
                          setSelected(null);
                          setAfter(data.nextCursor!);
                        }}
                      >
                        Next flags
                      </Button>
                    )}
                  </div>
                </>
              )}
              {!data.canReview && (
                <p className="anomaly-context">
                  Your role can inspect evidence. The Maintenance head records
                  engineering review decisions.
                </p>
              )}
            </>
          )
        )}
        <div className="anomaly-history">
          <h3>Saved review history</h3>
          <p>
            All retained reviews for this machine, including earlier evidence
            that may no longer appear in the current results.
          </p>
          <Button
            variant="outline"
            disabled={historyBusy || busy}
            onClick={() => void loadHistory()}
          >
            {historyBusy
              ? "Loading reviews…"
              : history
                ? "Reload review history"
                : "Load review history"}
          </Button>
          {historyError && <p role="alert">{historyError}</p>}
          {history &&
            (!history.items.length ? (
              <p>No saved statistical reviews yet.</p>
            ) : (
              <>
                <div className="anomaly-history-list">
                  {history.items.map((r) => (
                    <details key={r.id}>
                      <summary>
                        {r.evidence.name} · {labels[r.evidence.kind]} ·{" "}
                        {r.decision === "INVESTIGATE"
                          ? "Investigation needed"
                          : "Dismissed"}{" "}
                        · {time(r.evidence.measuredAt)}
                      </summary>
                      <p>{r.reason}</p>
                      <small>
                        {r.reviewerName} · Maintenance head · Reviewed{" "}
                        {time(r.createdAt)}
                      </small>
                      <InvestigationHandoff
                        code={code}
                        token={token}
                        review={r}
                        canOpen={history.canOpenInvestigation}
                        onSaved={updateReceipt}
                        onFailure={failure}
                      />
                      <Evidence flag={r.evidence} />
                    </details>
                  ))}
                </div>
                {history.nextCursor && (
                  <Button
                    variant="outline"
                    disabled={historyBusy}
                    onClick={() => void loadHistory(true)}
                  >
                    Older reviews
                  </Button>
                )}
              </>
            ))}
        </div>
      </div>
    </section>
  );
}

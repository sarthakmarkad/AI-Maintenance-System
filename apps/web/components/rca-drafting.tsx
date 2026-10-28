"use client";
import type { components } from "@maintenance/api-client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import styles from "./rca-drafting.module.css";

export const rcaFields = [
  "findings",
  "rootCause",
  "correctiveAction",
  "preventiveAction",
] as const;
export type RcaField = (typeof rcaFields)[number];
export type RcaHumanFields = Record<RcaField, string>;
export type RcaProvenance = {
  draftId: string;
  sourceHash: string;
  version: number;
  fields: RcaField[];
};
export type RcaDraftReceipt = components["schemas"]["RcaReceiptDto"];
const labels: Record<RcaField, string> = {
  findings: "Inspection findings",
  rootCause: "Root-cause analysis",
  correctiveAction: "Corrective action",
  preventiveAction: "Preventive action",
};
const base = (code: string, id: string) =>
  `/machines/${encodeURIComponent(code)}/work-orders/${encodeURIComponent(id)}/rca-drafts`;
const ist = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value)) + " IST";
function EvidenceReview({
  receipt,
  generatedText = false,
}: {
  receipt: RcaDraftReceipt;
  generatedText?: boolean;
}) {
  const draft = receipt.draft;
  if (!draft) return null;
  return (
    <div className={styles.review}>
      <p className={styles.notice}>
        {draft.status === "INSUFFICIENT_EVIDENCE"
          ? "Insufficient evidence to establish a cause."
          : "Limited evidence — all possible causes remain unconfirmed."}
      </p>
      <div>
        <h4>Recorded human statements</h4>
        <ul>
          {draft.facts.map((source) => (
            <li key={source.id}>
              <strong>
                [{source.id}] {source.attribution}
              </strong>
              <p>{source.text}</p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>Possible causes / hypotheses</h4>
        {draft.hypotheses.length ? (
          <ul>
            {draft.hypotheses.map((item, i) => (
              <li key={i}>
                Unconfirmed possibility: {item.text}{" "}
                <small>[{item.sourceIds.join(", ")}]</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>No supported hypothesis proposed.</p>
        )}
      </div>
      <div>
        <h4>Missing evidence / checks</h4>
        <ul>
          {draft.missingChecks.map((item, i) => (
            <li key={i}>
              {item.text} <small>[{item.sourceIds.join(", ")}]</small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4>Proposed corrective / preventive actions</h4>
        <ul>
          {[...draft.correctiveProposals, ...draft.preventiveProposals].map(
            (item, i) => (
              <li key={i}>
                {item.text} <small>[{item.sourceIds.join(", ")}]</small>
              </li>
            ),
          )}
        </ul>
        <p>Proposals are not evidence that a repair was performed.</p>
      </div>
      {generatedText && (
        <details>
          <summary>
            Original generated suggestions (may differ from the submitted human
            report)
          </summary>
          {rcaFields.map((field) => (
            <div key={field}>
              <h4>{labels[field]}</h4>
              <p>{draft.proposed[field]}</p>
            </div>
          ))}
        </details>
      )}
      <details>
        <summary>Source snapshot & provenance</summary>
        <p>{receipt.snapshot.coverage}</p>
        <p>
          Work-order version {receipt.version} · {receipt.model} ·{" "}
          {receipt.policy}
        </p>
        <p>
          Requested {ist(receipt.createdAt)} · Technician {receipt.requestedBy}
        </p>
        <p className={styles.hash}>
          Draft {receipt.id} · Source fingerprint {receipt.sourceHash}
        </p>
        <ol>
          {receipt.snapshot.sources.map((s) => (
            <li key={s.id}>
              <strong>
                {s.id}: {s.attribution}
              </strong>
              {s.eventVersion && <small> · History v{s.eventVersion}</small>}
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
export function RcaDrafting({
  code,
  orderId,
  version,
  token,
  human,
  onApply,
  disabled = false,
  onFailure,
}: {
  code: string;
  orderId: string;
  version: number;
  token: string;
  human: RcaHumanFields;
  onApply: (patch: Partial<RcaHumanFields>, provenance: RcaProvenance) => void;
  disabled?: boolean;
  onFailure?: (error: unknown) => void;
}) {
  const [receipt, setReceipt] = useState<RcaDraftReceipt | null>(null),
    [proposed, setProposed] = useState<RcaHumanFields | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const attempt = useRef<{
      requestId: string;
      version: number;
      human: RcaHumanFields;
    } | null>(null),
    baseline = useRef<RcaHumanFields | null>(null),
    guard = useRef(false),
    live = useRef({ orderId, version, token }),
    controller = useRef<AbortController | null>(null);
  live.current = { orderId, version, token };
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    controller.current?.abort();
    attempt.current = null;
    baseline.current = null;
    guard.current = false;
    setBusy(false);
    setReceipt(null);
    setProposed(null);
    setError("");
    setMessage("");
  }, [orderId, token]);
  const changed = (field: RcaField) =>
    baseline.current !== null && human[field] !== baseline.current[field];
  const stale =
    !!receipt &&
    (receipt.stale ||
      receipt.version !== version ||
      receipt.orderId !== orderId);
  async function generate(retry: boolean) {
    if (guard.current || disabled) return;
    guard.current = true;
    const sent =
      retry && attempt.current
        ? attempt.current
        : { requestId: crypto.randomUUID(), version, human: { ...human } };
    attempt.current = sent;
    baseline.current = { ...sent.human };
    const scope = { orderId, version, token },
      currentController = new AbortController();
    controller.current = currentController;
    setBusy(true);
    if (!retry) {
      setReceipt(null);
      setProposed(null);
    }
    setError("");
    setMessage("");
    try {
      const result = await api<RcaDraftReceipt>(
        base(code, orderId),
        token,
        currentController.signal,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sent),
        },
        65000,
      );
      if (
        currentController.signal.aborted ||
        live.current.orderId !== scope.orderId ||
        live.current.token !== scope.token
      )
        return;
      setReceipt(result);
      setProposed(result.draft ? { ...result.draft.proposed } : null);
      if (result.status === "PENDING")
        setError(
          result.reason === "RCA_REQUEST_UNCERTAIN"
            ? "The original request has no completed receipt. It will not be automatically generated again. Continue manually, or explicitly start a new draft later."
            : "This request is still pending. Retrieve its receipt explicitly; no new AI call will be made for this request ID.",
        );
      if (result.status === "FAILED" || result.status === "STALE")
        setError(
          "The AI draft could not be retained or delivered. Your completion form is unchanged. Continue manually, or explicitly generate a new draft.",
        );
    } catch (e) {
      if (currentController.signal.aborted) return;
      if (e instanceof ApiError && [403, 404].includes(e.status)) {
        setReceipt(null);
        setProposed(null);
      }
      setError(
        e instanceof ApiError
          ? e.message
          : "AI drafting is unavailable. Your completion form is unchanged.",
      );
      onFailure?.(e);
    } finally {
      if (controller.current === currentController) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  function apply(fields: RcaField[]) {
    if (!receipt?.draft || !proposed || stale || disabled || busy) return;
    const eligible = fields.filter(
      (field) =>
        !changed(field) &&
        proposed[field].trim().length >= 3 &&
        proposed[field].trim().length <= 4000,
    );
    if (!eligible.length) return;
    onApply(
      Object.fromEntries(eligible.map((field) => [field, proposed[field]])),
      {
        draftId: receipt.id,
        sourceHash: receipt.sourceHash,
        version: receipt.version,
        fields: eligible,
      },
    );
    setMessage(
      `Applied ${eligible.length} reviewed field${eligible.length === 1 ? "" : "s"} to the form. Edit and submit through the normal review workflow.`,
    );
  }
  return (
    <section className={styles.panel} aria-label="AI-assisted RCA drafting">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>OPTIONAL ASSISTANCE</span>
          <h3>Draft from recorded evidence</h3>
        </div>
        <span className={styles.badge}>AI advisory draft</span>
      </div>
      <p>
        AI suggestions require your review. AI cannot confirm a cause, record
        restoration, submit work or approve a report. You can complete the
        report manually.
      </p>
      <p className={styles.notice}>
        Generating retains these current unsubmitted inputs and AI evidence in
        shared work-order draft history, visible to authorized readers including
        the maintenance head. These inputs are not private scratch notes.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => void generate(false)}
        >
          {busy
            ? "Drafting from evidence…"
            : receipt || attempt.current
              ? "Generate a new draft"
              : "Generate AI draft"}
        </button>
        {attempt.current &&
          !busy &&
          (error || receipt?.status === "PENDING") && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void generate(true)}
            >
              Retrieve original request
            </button>
          )}
      </div>
      {busy && (
        <p role="status">
          Your form stays editable while this draft is generated. Changes you
          make now will be preserved.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {stale && (
        <p role="alert" className={styles.notice}>
          Work-order evidence changed. Applying this draft is disabled. Reload
          and review current evidence.
        </p>
      )}
      {receipt?.draft && (
        <>
          <EvidenceReview receipt={receipt} />
          <div className={styles.editors}>
            <h4>Review and edit proposed form text</h4>
            <p>
              Apply only text you have checked. Record actual work performed and
              human conclusions before submitting. Service-restored time must be
              entered separately.
            </p>
            {rcaFields.map((field) => (
              <div className={styles.field} key={field}>
                <label htmlFor={`rca-${orderId}-${field}`}>
                  Proposed {labels[field].toLowerCase()}
                </label>
                <textarea
                  id={`rca-${orderId}-${field}`}
                  value={proposed?.[field] ?? ""}
                  maxLength={4000}
                  rows={4}
                  onChange={(e) =>
                    setProposed((current) =>
                      current
                        ? { ...current, [field]: e.target.value }
                        : current,
                    )
                  }
                />
                <button
                  type="button"
                  disabled={
                    disabled ||
                    busy ||
                    stale ||
                    changed(field) ||
                    !proposed ||
                    proposed[field].trim().length < 3
                  }
                  onClick={() => apply([field])}
                >
                  Use {labels[field].toLowerCase()}
                </button>
                {changed(field) && (
                  <small>
                    Your form field changed since this request. It will be
                    preserved; copy reviewed text manually or generate a fresh
                    draft.
                  </small>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={disabled || busy || stale || rcaFields.every(changed)}
              onClick={() => apply([...rcaFields])}
            >
              Apply reviewed draft
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function RcaDraftHistory({
  code,
  orderId,
  version,
  token,
  onFailure,
}: {
  code: string;
  orderId: string;
  version: number;
  token: string;
  onFailure?: (error: unknown) => void;
}) {
  const [items, setItems] = useState<RcaDraftReceipt[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const failure = useRef(onFailure);
  failure.current = onFailure;
  const sequence = useRef(0),
    olderController = useRef<AbortController | null>(null);
  useEffect(() => {
    sequence.current++;
    olderController.current?.abort();
    const controller = new AbortController();
    setItems([]);
    setError("");
    setCursor(null);
    setBusy(true);
    api<{ items: RcaDraftReceipt[]; nextCursor: string | null }>(
      base(code, orderId),
      token,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.items);
        setCursor(result.nextCursor);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError("AI draft history could not be loaded.");
          failure.current?.(e);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => {
      controller.abort();
      olderController.current?.abort();
    };
  }, [code, orderId, version, token, refresh]);
  async function older() {
    if (!cursor || busy) return;
    const currentSequence = sequence.current,
      controller = new AbortController();
    olderController.current = controller;
    setBusy(true);
    try {
      const result = await api<{
        items: RcaDraftReceipt[];
        nextCursor: string | null;
      }>(
        base(code, orderId) + "?before=" + encodeURIComponent(cursor),
        token,
        controller.signal,
      );
      if (controller.signal.aborted || sequence.current !== currentSequence)
        return;
      setItems((current) => [...current, ...result.items]);
      setCursor(result.nextCursor);
    } catch (e) {
      if (controller.signal.aborted || sequence.current !== currentSequence)
        return;
      if (e instanceof ApiError && [403, 404].includes(e.status)) setItems([]);
      setError("Older AI drafts could not be loaded.");
      failure.current?.(e);
    } finally {
      if (sequence.current === currentSequence) setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="Retained AI draft history">
      <div className={styles.heading}>
        <h3>AI draft history</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh drafts
        </button>
      </div>
      <p>
        Retained generation evidence only. The technician may edit or discard
        every suggestion. The submitted human report and existing head approval
        remain the authoritative workflow records; this history does not
        identify submitted text as an unedited AI draft.
      </p>
      {error && <p role="alert">{error}</p>}
      {!items.length && !busy && !error && <p>No retained AI drafts.</p>}
      {items.map((item) => (
        <details className={styles.history} key={item.id}>
          <summary>
            Version {item.version} · {item.status.toLowerCase()} ·{" "}
            {ist(item.createdAt)}
            {item.version !== version ? " · historical evidence" : ""}
          </summary>
          {item.draft ? (
            <EvidenceReview receipt={item} generatedText />
          ) : (
            <p>
              No generated report text retained.{" "}
              {item.reason ??
                "Request pending; it is never automatically regenerated."}
            </p>
          )}
        </details>
      ))}
      {cursor && (
        <button type="button" disabled={busy} onClick={() => void older()}>
          Load older drafts
        </button>
      )}
      {busy && <p role="status">Loading draft history…</p>}
    </section>
  );
}

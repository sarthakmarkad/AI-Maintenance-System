"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
} from "lucide-react";
import {
  api,
  apiBlob,
  ApiError,
  type Machine,
  type Me,
  type MaintenanceReport,
} from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
const names = {
  "work-orders": "Work orders",
  "planned-maintenance": "Planned maintenance",
  investigations: "Investigation outcomes",
};
type ReportType = keyof typeof names;
type Filters = {
  report: ReportType;
  from: string;
  to: string;
  basis: "created" | "closed";
  status: "ALL" | "OPEN" | "CLOSED";
  kind: string;
};
const localDate = (d: Date) =>
  new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
function defaults(report: ReportType = "work-orders"): Filters {
  const today = localDate(new Date()),
    add = (n: number) =>
      new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
  return {
    report,
    from: report === "planned-maintenance" ? today : add(-29),
    to: report === "planned-maintenance" ? add(29) : today,
    basis: "created",
    status: "ALL",
    kind: "ALL",
  };
}
function query(filters: Filters) {
  const q = new URLSearchParams({
    report: filters.report,
    from: filters.from,
    to: filters.to,
    status: filters.status,
  });
  if (filters.report !== "planned-maintenance") q.set("basis", filters.basis);
  if (filters.report === "work-orders" && filters.kind !== "ALL")
    q.set("kind", filters.kind);
  return q;
}
const time = (v: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(v)) + " IST";
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ReportsWorkspace({
  machine,
  user,
  token,
}: {
  machine: Machine;
  user: Me;
  token: string;
}) {
  const base = `/machines/${encodeURIComponent(machine.code)}/reports`,
    router = useRouter(),
    { expire } = useAuth();
  const [initial] = useState(() => defaults()),
    [draft, setDraft] = useState(initial),
    [applied, setApplied] = useState(initial),
    [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<MaintenanceReport | null>(null),
    [loading, setLoading] = useState(true),
    [downloading, setDownloading] = useState(""),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const downloadAbort = useRef<AbortController | null>(null);
  const dirty = query(draft).toString() !== query(applied).toString();
  async function failure(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      await expire();
      router.replace("/login?reason=expired");
      return;
    }
    setError(e instanceof Error ? e.message : "Unable to load this report.");
    if (e instanceof ApiError && e.status === 409) setStale(true);
  }
  useEffect(() => () => downloadAbort.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setStale(false);
    api<MaintenanceReport>(
      `${base}/preview?${query(applied)}`,
      token,
      abort.signal,
    )
      .then((next) => {
        if (!abort.signal.aborted) setReport(next);
      })
      .catch((e) => {
        if (!abort.signal.aborted) void failure(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
    // Equivalent Auth focus events must not reset selected filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, applied, attempt]);
  function apply(e: FormEvent) {
    e.preventDefault();
    setApplied({ ...draft });
    setAttempt((n) => n + 1);
  }
  async function download(format: "pdf" | "xlsx") {
    if (!report || loading || dirty || stale || downloading) return;
    setDownloading(format);
    setError("");
    downloadAbort.current = new AbortController();
    const q = query(applied);
    q.set("format", format);
    q.set("fingerprint", report.fingerprint);
    try {
      const blob = await apiBlob(
        `${base}/export?${q}`,
        token,
        downloadAbort.current.signal,
      );
      if (!downloadAbort.current.signal.aborted)
        save(
          blob,
          `${machine.code}-${report.report}-${report.from}-${report.to}.${format}`,
        );
    } catch (e) {
      if (!downloadAbort.current.signal.aborted) await failure(e);
    } finally {
      if (!downloadAbort.current.signal.aborted) setDownloading("");
    }
  }
  return (
    <div className="reports-workspace">
      <Link className="back-link" href={`/machines/${machine.code}`}>
        <ArrowLeft size={14} />
        Machine overview
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {machine.code} / SAVED MAINTENANCE RECORDS
          </div>
          <h1>Maintenance reports</h1>
          <p>
            Review saved records, then download a PDF summary or an Excel
            workbook.
          </p>
        </div>
      </div>
      <p className="reports-role-note">
        Downloads reflect saved records and do not approve maintenance work.
      </p>
      <form
        className="panel report-filters"
        onSubmit={apply}
        aria-label="Report filters"
      >
        <label>
          Report type
          <select
            value={draft.report}
            disabled={!!downloading}
            onChange={(e) => setDraft(defaults(e.target.value as ReportType))}
          >
            {Object.entries(names).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From (IST)
          <input
            type="date"
            required
            value={draft.from}
            disabled={!!downloading}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label>
          To (IST)
          <input
            type="date"
            required
            min={draft.from}
            value={draft.to}
            disabled={!!downloading}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        {draft.report !== "planned-maintenance" && (
          <label>
            Date basis
            <select
              value={draft.basis}
              disabled={!!downloading}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  basis: e.target.value as Filters["basis"],
                  status: e.target.value === "closed" ? "ALL" : draft.status,
                })
              }
            >
              <option value="created">Created date</option>
              <option value="closed">Closed date</option>
            </select>
          </label>
        )}
        <label>
          Status
          <select
            value={draft.status}
            disabled={!!downloading}
            onChange={(e) =>
              setDraft({
                ...draft,
                status: e.target.value as Filters["status"],
              })
            }
          >
            <option value="ALL">All statuses</option>
            {(draft.report === "planned-maintenance" ||
              draft.basis !== "closed") && <option value="OPEN">Open</option>}
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        {draft.report === "work-orders" && (
          <label>
            Work type
            <select
              value={draft.kind}
              disabled={!!downloading}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            >
              <option value="ALL">All work types</option>
              <option value="BREAKDOWN">Breakdown</option>
              <option value="PLANNED">Planned maintenance</option>
              <option value="INVESTIGATION">Investigation</option>
            </select>
          </label>
        )}
        <div className="report-filter-footer">
          <p>
            {draft.report === "planned-maintenance"
              ? "Dates select fixed planned due times, including generated future tasks."
              : "Dates select when orders were created or closed. Displayed stages and findings reflect their current saved state."}
          </p>
          <Button type="submit" disabled={loading || !!downloading}>
            {loading ? "Loading preview…" : "Preview report"}
          </Button>
        </div>
      </form>
      {dirty && (
        <p className="report-notice" role="status">
          Filters changed. Select Preview report before downloading.
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          <p>{error}</p>
          <Button
            variant="outline"
            disabled={loading || !!downloading}
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RefreshCw size={14} />
            Refresh preview
          </Button>
        </div>
      )}
      {loading ? (
        <div className="loading-state" role="status">
          <div className="loader" />
          <p>Loading report preview…</p>
        </div>
      ) : (
        report && (
          <section className="panel report-preview" aria-label="Report preview">
            <div className="panel-heading">
              <div>
                <h2>{report.title}</h2>
                <p>
                  {report.total} records · {report.basis}: {report.from} to{" "}
                  {report.to} (IST)
                </p>
                <p>Snapshot: {time(report.generatedAt)}</p>
              </div>
              <div className="report-downloads">
                <Button
                  variant="outline"
                  disabled={!!downloading || dirty || stale || !!error}
                  onClick={() => void download("pdf")}
                >
                  <FileText size={16} />
                  {downloading === "pdf" ? "Generating PDF…" : "Download PDF"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!!downloading || dirty || stale || !!error}
                  onClick={() => void download("xlsx")}
                >
                  <FileSpreadsheet size={16} />
                  {downloading === "xlsx"
                    ? "Generating Excel…"
                    : "Download Excel"}
                </Button>
              </div>
            </div>
            <div className="report-preview-body">
              <p className="report-counts">
                Cancelled: <strong>{report.counts.cancelled ?? 0}</strong> ·
                Open: <strong>{report.counts.open}</strong> · Closed:{" "}
                <strong>{report.counts.closed}</strong>
                {report.report === "planned-maintenance" && (
                  <>
                    {" "}
                    · Skipped: <strong>{report.counts.skipped}</strong>
                  </>
                )}
              </p>
              {report.warning && (
                <p className="report-notice">{report.warning}</p>
              )}
              {report.total === 0 ? (
                <p className="report-empty">
                  No records match these filters. You can still download a
                  report showing the selected dates and zero records.
                </p>
              ) : (
                <div className="report-table-wrap">
                  <table>
                    <caption>
                      Saved maintenance records in the selected report
                    </caption>
                    <thead>
                      <tr>
                        {report.columns.map((column) => (
                          <th scope="col" key={column}>
                            {column}
                          </th>
                        ))}
                        <th scope="col">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <tr key={row.id}>
                          {row.cells.map((cell, i) => (
                            <td key={i}>{cell}</td>
                          ))}
                          <td>
                            {row.orderId ? (
                              <Link
                                href={`/machines/${machine.code}/work-orders/${row.orderId}`}
                              >
                                Open work order
                              </Link>
                            ) : (
                              <Link href={`/machines/${machine.code}/calendar`}>
                                Open calendar
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {report.total > report.previewLimit && (
                <p className="report-preview-limit">
                  Showing the first {report.previewLimit} of {report.total}{" "}
                  records. Downloads include all {report.total} matching
                  records.
                </p>
              )}
              <ul className="report-notes">
                {report.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </section>
        )
      )}
    </div>
  );
}
export function WorkOrderReportButtons({
  code,
  id,
  version,
  token,
  disabled,
  onFailure,
}: {
  code: string;
  id: string;
  version: number;
  token: string;
  disabled: boolean;
  onFailure: (e: unknown) => Promise<void>;
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function download(format: "pdf" | "xlsx") {
    if (disabled || busy) return;
    setBusy(format);
    setError("");
    abort.current = new AbortController();
    try {
      const blob = await apiBlob(
        `/machines/${encodeURIComponent(code)}/reports/work-orders/${id}/export?format=${format}&version=${version}`,
        token,
        abort.current.signal,
      );
      if (!abort.current.signal.aborted)
        save(
          blob,
          `${code}-WO-${id.slice(0, 8).toUpperCase()}-v${version}.${format}`,
        );
    } catch (e) {
      if (!abort.current.signal.aborted) {
        setError(e instanceof Error ? e.message : "Unable to download report.");
        await onFailure(e);
      }
    } finally {
      if (!abort.current.signal.aborted) setBusy("");
    }
  }
  return (
    <div className="work-order-report-downloads">
      <div>
        <p>
          Download this work order’s current findings, complete action history
          and attachment manifest.
        </p>
        <div className="report-downloads">
          <Button
            variant="outline"
            disabled={disabled || !!busy}
            onClick={() => void download("pdf")}
          >
            <Download size={15} />
            {busy === "pdf" ? "Generating PDF…" : "Download work order PDF"}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !!busy}
            onClick={() => void download("xlsx")}
          >
            <FileSpreadsheet size={15} />
            {busy === "xlsx"
              ? "Generating Excel…"
              : "Download work order Excel"}
          </Button>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

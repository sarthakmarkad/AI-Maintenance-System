"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpFromLine,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  ApiError,
  type Machine,
  type Me,
  type ProductionPreview,
  type WorkbookInfo,
  type ProductionDashboard,
  type ProductionCommit,
} from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
type Source = "AUTHENTIC" | "SYNTHETIC";
const number = (value: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(value);
const monthWindow = (month: string) => ({
  from: month + "-01",
  to: new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0))
    .toISOString()
    .slice(0, 10),
});
export function ProductionWorkspace({
  machine,
  user,
  token,
}: {
  machine: Machine;
  user: Me;
  token: string;
}) {
  const router = useRouter();
  const { expire } = useAuth();
  const canImport = [
    "ADMINISTRATOR",
    "MAINTENANCE_HEAD",
    "SUPERVISOR",
  ].includes(user.role);
  const [source, setSource] = useState<Source>("AUTHENTIC");
  const [dashboard, setDashboard] = useState<ProductionDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [window, setWindow] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [revision, setRevision] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<WorkbookInfo | null>(null);
  const [sheet, setSheet] = useState("");
  const [preview, setPreview] = useState<ProductionPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  const [committed, setCommitted] = useState<ProductionCommit | null>(null);
  const handleError = useCallback(
    async (problem: unknown, setMessage: (s: string) => void) => {
      if (problem instanceof ApiError && problem.status === 401) {
        await expire();
        router.replace("/login?reason=expired");
        return;
      }
      setMessage(
        problem instanceof Error
          ? problem.message
          : "The request could not be completed. Please try again.",
      );
    },
    [router, expire],
  );
  const base = `/machines/${machine.code}/production`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ source, ...(window || {}) });
    api<ProductionDashboard>(
      `${base}/dashboard?${query}`,
      token,
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setDashboard(data);
        setDraft({ from: data.from, to: data.to });
      })
      .catch((problem) => {
        if (!controller.signal.aborted) void handleError(problem, setError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, source, token, window, revision, handleError]);
  function resetPreview() {
    setPreview(null);
    setSelected([]);
    setAck(false);
    setCommitted(null);
    setImportError("");
  }
  function changeSource(next: Source) {
    setSource(next);
    setWindow(null);
    setDashboard(null);
    resetPreview();
  }
  async function inspect() {
    if (!file) return;
    setBusy("Inspecting workbook…");
    setImportError("");
    resetPreview();
    try {
      const body = new FormData();
      body.set("file", file);
      const info = await api<WorkbookInfo>(
        `${base}/inspect`,
        token,
        undefined,
        { method: "POST", body },
      );
      setWorkbook(info);
      const currentMonth = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
      }).format(new Date());
      const supported = info.sheets
        .filter((item) => item.supported)
        .sort((a, b) => (b.month || "").localeCompare(a.month || ""));
      const prior = supported.find(
        (item) => item.month && item.month < currentMonth,
      );
      setSheet((prior || supported[0])?.name || "");
    } catch (problem) {
      await handleError(problem, setImportError);
    } finally {
      setBusy(null);
    }
  }
  async function makePreview() {
    if (!file || !sheet) return;
    setBusy("Validating selected sheet…");
    resetPreview();
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("sheet", sheet);
      body.set("source", source);
      const data = await api<ProductionPreview>(
        `${base}/previews`,
        token,
        undefined,
        { method: "POST", body },
      );
      setPreview(data);
      setSelected(
        data.days.filter((day) => day.eligible).map((day) => day.key),
      );
    } catch (problem) {
      await handleError(problem, setImportError);
    } finally {
      setBusy(null);
    }
  }
  async function refreshPreview() {
    if (!preview) return;
    setBusy("Refreshing validation…");
    setImportError("");
    try {
      const data = await api<ProductionPreview>(
        `${base}/previews/${preview.id}`,
        token,
      );
      setPreview(data);
      setSelected(
        data.days.filter((day) => day.eligible).map((day) => day.key),
      );
      setAck(false);
    } catch (problem) {
      await handleError(problem, setImportError);
    } finally {
      setBusy(null);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy("Saving selected days…");
    setImportError("");
    try {
      const result = await api<ProductionCommit>(
        `${base}/previews/${preview.id}/commit`,
        token,
        undefined,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dayKeys: selected, acknowledgeWarnings: ack }),
        },
      );
      setCommitted(result);
      setPreview({
        ...preview,
        status: "COMMITTED",
        committedDayKeys: selected,
      });
      setWindow(monthWindow(preview.month));
      setRevision((n) => n + 1);
    } catch (problem) {
      await handleError(problem, setImportError);
    } finally {
      setBusy(null);
    }
  }
  async function viewImport(id: string) {
    setBusy("Loading source records…");
    setImportError("");
    setImportOpen(true);
    setCommitted(null);
    setAck(false);
    try {
      const data = await api<ProductionPreview>(
        `${base}/previews/${id}`,
        token,
      );
      setPreview(data);
      setSelected(data.committedDayKeys);
    } catch (problem) {
      await handleError(problem, setImportError);
    } finally {
      setBusy(null);
    }
  }
  const selectedDays =
    preview?.days.filter((day) => selected.includes(day.key)) || [];
  const excluded =
    preview?.days.filter((day) => !day.eligible && !day.alreadyImported)
      .length || 0;
  return (
    <>
      <Link href={`/machines/${machine.code}`} className="back-link">
        <ArrowLeft size={14} />
        Machine overview
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{machine.code} / HISTORICAL PRODUCTION</div>
          <h1>Production records</h1>
          <p>Saved job quantities and scrap, with a traceable source.</p>
        </div>
        {canImport && (
          <Button onClick={() => setImportOpen((value) => !value)}>
            <ArrowUpFromLine size={15} />
            {importOpen ? "Hide import review" : "Import workbook"}
          </Button>
        )}
      </div>
      <section className="production-toolbar" aria-label="Production filters">
        <label>
          Dataset
          <select
            aria-label="Dataset"
            value={source}
            disabled={!!busy}
            onChange={(event) => changeSource(event.target.value as Source)}
          >
            <option value="AUTHENTIC">Authentic company production</option>
            <option value="SYNTHETIC">Synthetic demonstration</option>
          </select>
        </label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setWindow({ ...draft });
          }}
        >
          <label>
            From
            <input
              aria-label="From date"
              type="date"
              value={draft.from}
              required
              onChange={(event) =>
                setDraft({ ...draft, from: event.target.value })
              }
            />
          </label>
          <label>
            To
            <input
              aria-label="To date"
              type="date"
              value={draft.to}
              required
              onChange={(event) =>
                setDraft({ ...draft, to: event.target.value })
              }
            />
          </label>
          <Button variant="outline" type="submit" disabled={loading}>
            Apply dates
          </Button>
        </form>
      </section>
      <p
        className={`dataset-note ${source === "SYNTHETIC" ? "synthetic-note" : ""}`}
      >
        {source === "SYNTHETIC"
          ? "SYNTHETIC DEMONSTRATION — separate test records; these do not describe company production."
          : "Authentic production — source declared at import. Totals include saved, validated days only."}
      </p>
      {importOpen && canImport && (
        <section className="import-panel panel" aria-label="Production import">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">PREVIEW → REVIEW → SAVE</div>
              <h2>Import production Excel</h2>
            </div>
            <FileSpreadsheet size={21} />
          </div>
          <div className="import-body">
            <p className="import-intro">
              Choose one monthly WH-C sheet. Original files stay unchanged. The
              application saves source rows and validation notes, and does not
              retain the workbook file.
            </p>
            <div className="upload-controls">
              <label className="file-field" htmlFor="production-file">
                Production workbook (.xlsx, up to 8 MB)
                <input
                  id="production-file"
                  type="file"
                  accept=".xlsx"
                  disabled={!!busy}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    setWorkbook(null);
                    setSheet("");
                    resetPreview();
                  }}
                />
              </label>
              <Button
                variant="outline"
                disabled={!file || !!busy}
                onClick={inspect}
              >
                Read worksheets
              </Button>
            </div>
            {workbook && (
              <div className="sheet-controls">
                <label>
                  Worksheet
                  <select
                    aria-label="Worksheet"
                    value={sheet}
                    disabled={!!busy}
                    onChange={(event) => {
                      setSheet(event.target.value);
                      resetPreview();
                    }}
                  >
                    <option value="">Choose a supported monthly sheet</option>
                    {workbook.sheets.map((item) => (
                      <option
                        key={item.name}
                        value={item.name}
                        disabled={!item.supported}
                      >
                        {item.name}
                        {!item.supported ? " — review required" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Button onClick={makePreview} disabled={!sheet || !!busy}>
                  Preview selected sheet
                </Button>
                <details className="sheet-notes">
                  <summary>
                    Sheet eligibility ({workbook.sheets.length} sheets)
                  </summary>
                  <ul>
                    {workbook.sheets.map((item) => (
                      <li key={item.name}>
                        <strong>{item.name}</strong>:{" "}
                        {item.supported
                          ? "Recognized full monthly WH-C layout."
                          : item.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            {busy && (
              <p role="status" className="operation-status">
                {busy}
              </p>
            )}
            {importError && (
              <div role="alert" className="inline-error">
                {importError}
                {preview && preview.status === "PREVIEW" && (
                  <Button
                    variant="ghost"
                    onClick={refreshPreview}
                    disabled={!!busy}
                  >
                    <RefreshCw size={13} />
                    Refresh preview
                  </Button>
                )}
              </div>
            )}
            {committed && (
              <div role="status" className="import-success">
                <CheckCircle2 size={19} />
                <span>
                  {committed.alreadyCommitted
                    ? "This selection was already saved. No duplicates were added."
                    : `${committed.importedDays} days saved · ${committed.jobRows} job rows · ${number(committed.productionKg)} kg production.`}{" "}
                  Dashboard totals now come from saved records.
                </span>
              </div>
            )}
            {preview && (
              <div className="production-preview">
                <div className="preview-heading">
                  <div>
                    <h3>
                      {preview.status === "COMMITTED"
                        ? "Saved import source"
                        : "Validation preview"}
                    </h3>
                    <p>
                      {preview.filename} · {preview.sheet} ·{" "}
                      {preview.source === "SYNTHETIC"
                        ? "SYNTHETIC"
                        : "AUTHENTIC"}
                    </p>
                    <small>
                      Source hash {preview.workbookHash.slice(0, 16)} ·{" "}
                      {preview.parserVersion}
                    </small>
                  </div>
                  <span className="pill">
                    {preview.days.length} date blocks
                  </span>
                </div>
                <div className="validation-notes">
                  <ul>
                    {preview.warnings.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  {excluded > 0 && (
                    <p className="validation-error">
                      <strong>
                        {excluded} date{" "}
                        {excluded === 1 ? "block needs" : "blocks need"} review.
                      </strong>{" "}
                      These blocks are excluded; their dates and quantities are
                      not corrected automatically.
                    </p>
                  )}
                  {preview.days.some((day) => day.alreadyImported) && (
                    <p>
                      Already imported dates are excluded to prevent duplicate
                      totals.
                    </p>
                  )}
                </div>
                <div className="day-review-list">
                  {preview.days.map((day) => {
                    const imported =
                      preview.status === "COMMITTED" &&
                      preview.committedDayKeys.includes(day.key);
                    return (
                      <article
                        className={`day-review ${!day.eligible && !imported ? "needs-review" : ""}`}
                        key={day.key}
                      >
                        <div className="day-review-top">
                          <label className="day-choice">
                            <input
                              type="checkbox"
                              aria-label={`Import ${day.date || `source row ${day.sourceStartRow}`}`}
                              checked={selected.includes(day.key)}
                              disabled={
                                !day.eligible ||
                                preview.status === "COMMITTED" ||
                                !!busy
                              }
                              onChange={(event) =>
                                setSelected((current) =>
                                  event.target.checked
                                    ? [...current, day.key]
                                    : current.filter((key) => key !== day.key),
                                )
                              }
                            />
                            <span>
                              <strong>{day.date || "Date needs review"}</strong>
                              <small>
                                {preview.sheet} · rows {day.sourceStartRow}–
                                {day.sourceEndRow}
                                {!day.date
                                  ? ` · original date: ${day.rawDate || "(blank)"}`
                                  : ""}
                              </small>
                            </span>
                          </label>
                          <span
                            className={`review-status ${day.eligible ? "valid" : ""}`}
                          >
                            {imported
                              ? "Imported"
                              : day.alreadyImported
                                ? "Already imported"
                                : !day.eligible
                                  ? "Review required"
                                  : preview.status === "COMMITTED"
                                    ? "Not selected"
                                    : "Ready"}
                          </span>
                        </div>
                        <div className="day-quantities">
                          <span>
                            Job production{" "}
                            <strong>{number(day.productionKg)} kg</strong>
                          </span>
                          <span>
                            Daily control{" "}
                            <strong>
                              {day.controlProductionKg === null
                                ? "Missing"
                                : number(day.controlProductionKg) + " kg"}
                            </strong>
                          </span>
                          <span>
                            Category scrap{" "}
                            <strong>{number(day.scrapKg)} kg</strong>
                          </span>
                          <span>
                            Daily scrap control{" "}
                            <strong>
                              {day.controlScrapKg === null
                                ? "Missing"
                                : number(day.controlScrapKg) + " kg"}
                            </strong>
                          </span>
                        </div>
                        {day.problems.length > 0 && (
                          <ul className="row-problems">
                            {day.problems.map((problem, index) => (
                              <li
                                key={index}
                                className={
                                  problem.severity === "ERROR"
                                    ? "validation-error"
                                    : ""
                                }
                              >
                                <strong>{problem.cell}</strong> ·{" "}
                                {problem.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        <details className="source-rows">
                          <summary>Source rows ({day.rows.length})</summary>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Row / shift</th>
                                  <th>Original job description</th>
                                  <th>Production kg</th>
                                  <th>Scrap kg</th>
                                  <th>Remarks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {day.rows.map((row) => (
                                  <tr key={row.sourceRow}>
                                    <td>
                                      {row.sourceRow} / {row.shift || "Unknown"}
                                      {row.kind === "ACTIVITY" && (
                                        <small>Activity only</small>
                                      )}
                                    </td>
                                    <td>
                                      {row.description ||
                                        "No job description recorded"}
                                    </td>
                                    <td>
                                      {row.productionKg === null
                                        ? "—"
                                        : number(row.productionKg)}
                                    </td>
                                    <td>
                                      {number(
                                        Object.values(row.scrap).reduce(
                                          (a, b) => a + b,
                                          0,
                                        ),
                                      )}
                                    </td>
                                    <td>{row.remarks || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <details className="raw-source">
                            <summary>
                              Original cell values and formula caches
                            </summary>
                            <pre>
                              {JSON.stringify(
                                day.rows.map((row) => ({
                                  row: row.sourceRow,
                                  cells: row.rawCells,
                                  downtime: row.downtime,
                                  downtimeUnit: "UNCONFIRMED",
                                })),
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        </details>
                      </article>
                    );
                  })}
                </div>
                {preview.status === "PREVIEW" && (
                  <div className="commit-review">
                    <p>
                      <strong>Preview totals, not saved:</strong>{" "}
                      {selected.length} selected days ·{" "}
                      {number(
                        selectedDays.reduce(
                          (n, day) => n + day.productionKg,
                          0,
                        ),
                      )}{" "}
                      kg production ·{" "}
                      {number(
                        selectedDays.reduce((n, day) => n + day.scrapKg, 0),
                      )}{" "}
                      kg scrap
                    </p>
                    <label className="acknowledgement">
                      <input
                        type="checkbox"
                        checked={ack}
                        disabled={!!busy}
                        onChange={(event) => setAck(event.target.checked)}
                      />
                      I reviewed the source, excluded blocks and cached-formula
                      notes.
                    </label>
                    <Button
                      disabled={!selected.length || !ack || !!busy}
                      onClick={commit}
                    >
                      Import {selected.length} valid{" "}
                      {selected.length === 1 ? "day" : "days"}
                    </Button>
                    <small>
                      Preview expires{" "}
                      {new Date(preview.expiresAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}{" "}
                      IST. Nothing is saved to dashboard totals until you
                      import.
                    </small>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
      {loading ? (
        <div className="loading-state production-loading" role="status">
          <div className="loader" />
          Loading saved production records…
        </div>
      ) : error ? (
        <section className="state-card" role="alert">
          <h2>Production records are unavailable</h2>
          <p>{error}</p>
          <Button onClick={() => setRevision((n) => n + 1)}>Try again</Button>
        </section>
      ) : (
        dashboard && (
          <>
            <div className="production-metrics">
              <Metric
                label="Production"
                value={dashboard.hasData ? number(dashboard.productionKg) : "—"}
                unit="kg"
                note="Sum of saved job quantities"
              />
              <Metric
                label="Scrap"
                value={dashboard.hasData ? number(dashboard.scrapKg) : "—"}
                unit="kg"
                note="Sum of saved scrap categories"
              />
              <Metric
                label="Imported days"
                value={dashboard.hasData ? String(dashboard.importedDays) : "—"}
                unit={`/ ${dashboard.daily.length}`}
                note="Missing dates are gaps, not zeros"
              />
              <Metric
                label="Job rows"
                value={dashboard.hasData ? number(dashboard.jobRows) : "—"}
                note="Multiple jobs may share one shift"
              />
            </div>
            {!dashboard.hasData ? (
              <section className="state-card production-empty">
                <FileSpreadsheet size={35} />
                <h2>No saved production for this period</h2>
                <p>
                  {canImport
                    ? "Start with a workbook preview, then import validated days."
                    : "A supervisor, maintenance head or administrator can import production workbooks."}
                </p>
              </section>
            ) : (
              <>
                <section className="panel production-chart">
                  <div className="panel-heading">
                    <div>
                      <h2>Daily production & scrap</h2>
                      <p>
                        {dashboard.from} to {dashboard.to} ·{" "}
                        {dashboard.source === "SYNTHETIC"
                          ? "Synthetic demonstration"
                          : "Authentic production"}
                      </p>
                    </div>
                    <span className="pill">
                      {dashboard.importedDays} saved days
                    </span>
                  </div>
                  <div
                    className="chart-frame"
                    role="img"
                    aria-label="Daily saved production and scrap in kilograms; missing dates have no bars"
                  >
                    <ResponsiveContainer width="100%" height={285}>
                      <ComposedChart
                        data={dashboard.daily}
                        margin={{ top: 12, right: 15, left: 10, bottom: 10 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 4"
                          vertical={false}
                          stroke="#e5ebe2"
                        />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(value) => value.slice(8)}
                          tick={{ fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          width={58}
                          tickFormatter={(value) => number(value)}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          labelFormatter={(label) => String(label)}
                          formatter={(value, name) => [
                            `${number(Number(value))} kg`,
                            name,
                          ]}
                          contentStyle={{
                            borderRadius: 8,
                            fontSize: 12,
                            borderColor: "#dce5d8",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar
                          dataKey="productionKg"
                          name="Production"
                          fill="#2e765a"
                          radius={[3, 3, 0, 0]}
                        />
                        <Bar
                          dataKey="scrapKg"
                          name="Scrap"
                          fill="#bda36f"
                          radius={[3, 3, 0, 0]}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="chart-footnote">
                    No interpolation between dates. Control totals are used for
                    reconciliation and are never added as production.
                  </p>
                </section>
                <section className="panel production-daily">
                  <div className="panel-heading">
                    <h2>Saved daily records</h2>
                    <span>{dashboard.importedDays} dates</span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Job rows</th>
                          <th>Production kg</th>
                          <th>Scrap kg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.daily
                          .filter((day) => day.productionKg !== null)
                          .map((day) => (
                            <tr key={day.date}>
                              <td>{day.date}</td>
                              <td>{day.jobRows}</td>
                              <td>{number(day.productionKg!)}</td>
                              <td>{number(day.scrapKg!)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
            {dashboard.imports.length > 0 && (
              <section className="panel production-history">
                <div className="panel-heading">
                  <h2>Import history for this period</h2>
                  <ShieldCheck size={17} />
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Source workbook / sheet</th>
                        <th>Imported</th>
                        <th>Saved days</th>
                        {canImport && <th>Source review</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.imports.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.filename}</strong>
                            <small>
                              {item.sheet} · {item.source}
                            </small>
                          </td>
                          <td>
                            {new Date(item.committedAt).toLocaleString(
                              "en-IN",
                              { timeZone: "Asia/Kolkata" },
                            )}{" "}
                            IST
                          </td>
                          <td>{item.importedDays}</td>
                          {canImport && (
                            <td>
                              <Button
                                variant="ghost"
                                disabled={!!busy}
                                onClick={() => viewImport(item.id)}
                              >
                                Review source
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {dashboard.lastImportedAt && (
              <p className="last-import">
                Last received/imported:{" "}
                {new Date(dashboard.lastImportedAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST. Measurement dates stay separate from upload time.
              </p>
            )}
          </>
        )
      )}
      <div className="info-strip">
        <ShieldCheck size={18} />
        <p>
          Downtime units and shift start times remain unconfirmed. No
          availability, live-health or failure-cause claims are derived from
          these totals.
        </p>
      </div>
    </>
  );
}
function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <section className="metric-card">
      <h2>{label}</h2>
      <p>
        {value}
        <span>{unit}</span>
      </p>
      <small>{note}</small>
    </section>
  );
}

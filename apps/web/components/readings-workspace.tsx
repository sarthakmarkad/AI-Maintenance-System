"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  RefreshCw,
  Activity,
  CheckCircle2,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import {
  api,
  ApiError,
  type Machine,
  type Me,
  type ReadingPreview,
  type ReadingTrends,
  type ReadingCommit,
  type AnomalyMarker,
} from "@/lib/api";
import { Button } from "./ui/button";
import { ExcelTemplateButton } from "./excel-template-button";
import { FormPopup } from "./ui/form-popup";
import { AnomaliesWorkspace } from "./anomalies-workspace";
import { useAuth } from "./auth-provider";
const number = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const time = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v)) + " IST"
    : "—";
const tick = (v: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
  }).format(new Date(v));
type ParamKey = "hotTempC" | "coldTempC" | "pressureBar";
export function ReadingsWorkspace({
  machine,
  user,
  token,
}: {
  machine: Machine;
  user: Me;
  token: string;
}) {
  const [markers, setMarkers] = useState<AnomalyMarker[]>([]);
  const router = useRouter(),
    { expire } = useAuth();
  const base = `/machines/${encodeURIComponent(machine.code)}/readings`;
  const importer =
    !machine.archivedAt &&
    ["ADMINISTRATOR", "MAINTENANCE_HEAD", "SUPERVISOR"].includes(user.role);
  const [data, setData] = useState<ReadingTrends | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [attempt, setAttempt] = useState(0),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [open, setOpen] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<ReadingPreview | null>(null),
    [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false),
    [importError, setImportError] = useState(""),
    [success, setSuccess] = useState(""),
    [page, setPage] = useState(0),
    [flagged, setFlagged] = useState(false);
  async function failure(e: unknown, upload = false) {
    if (e instanceof ApiError && e.status === 401) {
      await expire();
      router.replace("/login?reason=expired");
      return;
    }
    const message =
      e instanceof Error ? e.message : "Unable to load process readings.";
    (upload ? setImportError : setError)(message);
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<ReadingTrends>(base + "/trends" + query, token, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setData(next);
          setFrom(next.from);
          setTo(next.to);
          setPage(0);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) void failure(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The API identity and date window own this request. UI import state survives refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, query, attempt]);
  async function makePreview() {
    if (!file) return;
    setBusy(true);
    setImportError("");
    setSuccess("");
    setPreview(null);
    setAck(false);
    try {
      const body = new FormData();
      body.append("file", file);
      setPreview(
        await api<ReadingPreview>(base + "/previews", token, undefined, {
          method: "POST",
          body,
        }),
      );
    } catch (e) {
      await failure(e, true);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setImportError("");
    try {
      const saved = await api<ReadingCommit>(
        `${base}/previews/${preview.id}/commit`,
        token,
        undefined,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acknowledgeWarnings: ack }),
        },
      );
      setPreview({ ...preview, status: "COMMITTED" });
      setSuccess(
        `${saved.importedReadings} synthetic observations saved. Trends now use saved records.`,
      );
      setQuery("");
      setAttempt((n) => n + 1);
    } catch (e) {
      await failure(e, true);
    } finally {
      setBusy(false);
    }
  }
  async function review(id: string) {
    setOpen(true);
    setBusy(true);
    setImportError("");
    setSuccess("");
    setAck(false);
    try {
      setPreview(await api<ReadingPreview>(`${base}/previews/${id}`, token));
    } catch (e) {
      await failure(e, true);
    } finally {
      setBusy(false);
    }
  }
  const eligible = preview?.rows.filter((r) => r.eligible).length ?? 0;
  const excluded = (preview?.rows.length ?? 0) - eligible;
  const visibleRows =
    data?.rows.filter(
      (r) =>
        !flagged ||
        data.statistics.some(
          (p) => r[p.key as ParamKey] < p.low || r[p.key as ParamKey] > p.high,
        ),
    ) ?? [];
  const paged = visibleRows.slice(page * 24, page * 24 + 24);
  return (
    <div className="readings-workspace">
      <Link href={`/machines/${machine.code}`} className="back-link">
        <ArrowLeft size={14} /> Machine overview
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {machine.code} / SYNTHETIC PROCESS READINGS
          </div>
          <h1>Process trends</h1>
        </div>
        {importer && (
          <Button onClick={() => setOpen(true)}>
            <Upload size={16} />
            Import synthetic readings
          </Button>
        )}
      </div>
      <div className="synthetic-banner" role="note">
        <strong>SYNTHETIC DEMONSTRATION</strong>
        <p>
          Invented readings and review bands for testing. They do not describe
          actual machine conditions or explain authentic production losses. This
          page is retrospective; hourly snapshots can miss events between
          samples.
        </p>
      </div>
      <form
        className="production-filters readings-filters"
        aria-label="Reading date filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(
            `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          );
          setAttempt((n) => n + 1);
        }}
      >
        <div>
          <label htmlFor="read-from">From (IST)</label>
          <input
            id="read-from"
            type="date"
            value={from}
            required
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="read-to">To (IST)</label>
          <input
            id="read-to"
            type="date"
            value={to}
            required
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button variant="outline" disabled={loading}>
          Apply reading dates
        </Button>
        <small>
          Choose up to 31 days. Each date includes its full local day.
        </small>
      </form>
      {importer && (
        <FormPopup
          open={open}
          onOpenChange={setOpen}
          title="Import hourly observations"
          description="Synthetic demonstration only. Preview, review and save eligible hourly observations."
          busy={busy}
          wide
        >
          <section
            id="reading-import"
            className="panel reading-import"
            aria-label="Synthetic reading import"
          >
            <div className="reading-import-body">
              <p>
                Use a workbook for {machine.code} with Guide and Hourly_Readings
                sheets. Source cells are retained; keep the original workbook
                for your records. The workbook file is not retained.
              </p>
              <p>
                The standard template contains hot temperature (°C), cold
                temperature (°C) and pressure (bar). Its readings and review
                bands are synthetic demonstrations, not verified operating
                limits. Other parameters require a different mapping.
              </p>
              <ExcelTemplateButton
                path={`/machines/${machine.code}/readings/template`}
                filename={`${machine.code}-synthetic-process-template.xlsx`}
                token={token}
              />
              <label htmlFor="reading-file">
                Synthetic readings workbook (.xlsx, up to 8 MB)
              </label>
              <input
                id="reading-file"
                type="file"
                accept=".xlsx"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                  setAck(false);
                  setImportError("");
                  setSuccess("");
                }}
              />
              <Button
                onClick={() => void makePreview()}
                disabled={!file || busy}
              >
                Preview reading workbook
              </Button>
              {busy && <p role="status">Processing readings…</p>}
              {importError && (
                <div className="inline-error" role="alert">
                  {importError}
                  <p>
                    For conflicts or an expired preview, preview the workbook
                    again before importing.
                  </p>
                </div>
              )}
              {success && (
                <p className="reading-success" role="status">
                  <CheckCircle2 size={18} />
                  {success}
                </p>
              )}
              {preview && (
                <div className="reading-preview">
                  <h3>
                    {preview.status === "COMMITTED"
                      ? "Saved reading source"
                      : "Reading validation preview"}
                  </h3>
                  <p>
                    <strong>{preview.filename}</strong> · {preview.sheet} ·
                    SYNTHETIC
                  </p>
                  <details>
                    <summary>Source details</summary>
                    <small>
                      SHA-256 {preview.workbookHash.slice(0, 16)} ·{" "}
                      {preview.parserVersion}
                    </small>
                  </details>
                  <ul className="reading-notes">
                    {preview.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <div className="reading-preview-counts">
                    <strong>{preview.rows.length} source rows</strong>
                    <span>{eligible} valid new observations</span>
                    <span>{excluded} excluded rows</span>
                  </div>
                  <div
                    className="table-scroll reading-preview-table"
                    tabIndex={0}
                    aria-label="Source reading validation rows"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Source row / ID</th>
                          <th>Measured (IST)</th>
                          <th>Hot °C assumed</th>
                          <th>Cold °C assumed</th>
                          <th>Pressure bar</th>
                          <th>Validation / source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r) => (
                          <tr key={r.sourceRow}>
                            <td>
                              {r.sourceRow}
                              <small>{r.sourceId}</small>
                            </td>
                            <td>
                              {r.localMeasuredAt?.replace("T", " ") ??
                                "Needs review"}
                            </td>
                            <td>{number(r.hotTempC)}</td>
                            <td>{number(r.coldTempC)}</td>
                            <td>{number(r.pressureBar)}</td>
                            <td>
                              {r.problems.length ? (
                                <ul>
                                  {r.problems.map((p) => (
                                    <li key={p}>{p}</li>
                                  ))}
                                </ul>
                              ) : preview.status === "COMMITTED" ? (
                                "Saved"
                              ) : (
                                "Ready"
                              )}
                              <details>
                                <summary>Raw source cells</summary>
                                <pre>{JSON.stringify(r.rawCells, null, 2)}</pre>
                              </details>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.status !== "COMMITTED" && (
                    <>
                      <label className="reading-ack">
                        <input
                          type="checkbox"
                          checked={ack}
                          disabled={busy}
                          onChange={(e) => setAck(e.target.checked)}
                        />
                        I reviewed the exclusions and understand these are
                        synthetic hourly readings with invented review bands.
                      </label>
                      <Button
                        disabled={
                          !ack ||
                          !eligible ||
                          busy ||
                          Date.parse(preview.expiresAt) < Date.now()
                        }
                        onClick={() => void commit()}
                      >
                        Import {eligible} valid observations
                      </Button>
                      <p>
                        <small>
                          Preview expires {time(preview.expiresAt)}. Dashboard
                          values change only after import. Every excluded row
                          remains unsaved.
                        </small>
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        </FormPopup>
      )}
      {error && (
        <section className="state-card" role="alert">
          <h2>Couldn’t load process trends</h2>
          <p>{error}</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw size={15} />
            Try reading trends again
          </Button>
        </section>
      )}
      {loading ? (
        <div className="loading-state" role="status">
          <div className="loader" />
          <p>Loading saved observations…</p>
        </div>
      ) : (
        !error &&
        data && (
          <>
            <div className="reading-metrics">
              <section className="metric-card">
                <h2>Observations</h2>
                <p>
                  {data.observations}
                  <small> / {data.expectedHours} hours</small>
                </p>
                <span>Three parameter values per observation</span>
              </section>
              <section className="metric-card">
                <h2>Missing hours</h2>
                <p>{data.missingHours}</p>
                <span>Gaps stay blank on every chart</span>
              </section>
              <section className="metric-card">
                <h2>Review samples</h2>
                <p>{data.reviewObservations}</p>
                <span>Unique observations outside a demo band</span>
              </section>
              <section className="metric-card">
                <h2>Review periods</h2>
                <p>{data.reviews.length}</p>
                <span>Within the selected window</span>
              </section>
            </div>
            <section className="panel reading-freshness">
              <div>
                <span>Latest measurement in dataset</span>
                <strong>{time(data.latestMeasuredAt)}</strong>
              </div>
              <div>
                <span>Last received / imported</span>
                <strong>{time(data.lastReceivedAt)}</strong>
              </div>
              <p>
                These historical snapshots are evaluated after receipt.
                Temperature units are assumed and sensor locations are
                unconfirmed. Demo shifts do not establish actual shift times.
              </p>
            </section>
            {!data.hasData ? (
              <section className="state-card">
                <Activity size={30} />
                <h2>No saved process readings for this period</h2>
                <p>
                  Import a synthetic workbook or choose a period with saved
                  observations.
                </p>
              </section>
            ) : (
              <>
                {data.statistics.map((p) => (
                  <section className="panel reading-chart" key={p.key}>
                    <div className="panel-heading">
                      <div>
                        <h2>{p.name}</h2>
                        <p>
                          {p.unit} · Demo review band {p.low}–{p.high} ·{" "}
                          {p.reviewCount} review samples
                        </p>
                      </div>
                      <span className="pill">SYNTHETIC</span>
                    </div>
                    <dl className="reading-statistics">
                      <div>
                        <dt>Minimum</dt>
                        <dd>{number(p.min)}</dd>
                      </div>
                      <div>
                        <dt>Mean</dt>
                        <dd>{number(p.mean)}</dd>
                      </div>
                      <div>
                        <dt>Maximum</dt>
                        <dd>{number(p.max)}</dd>
                      </div>
                    </dl>
                    <div
                      className="reading-chart-canvas"
                      role="img"
                      aria-label={`${p.name} hourly trend in ${p.unit}; gaps are not connected`}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={data.points.map((point) => ({
                            ...point,
                            statisticalFlag: markers.some(
                              (m) =>
                                m.parameter === p.key &&
                                m.measuredAt === point.measuredAt,
                            )
                              ? point[p.key as ParamKey]
                              : null,
                          }))}
                          margin={{ top: 12, right: 24, left: 4, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 5"
                            vertical={false}
                            stroke="#deddd5"
                          />
                          <XAxis
                            dataKey="measuredAt"
                            tickFormatter={tick}
                            minTickGap={60}
                            tick={{ fontSize: 10 }}
                          />
                          <YAxis
                            domain={[
                              Math.floor(Math.min(p.low, p.min ?? p.low) - 2),
                              Math.ceil(Math.max(p.high, p.max ?? p.high) + 2),
                            ]}
                            tick={{ fontSize: 10 }}
                            width={52}
                          />
                          <Tooltip
                            labelFormatter={(v) => time(String(v))}
                            formatter={(v, name) => [
                              `${number(Number(v))} ${p.unit}`,
                              name === "Statistical flag"
                                ? "Statistical flag"
                                : p.name,
                            ]}
                          />
                          <ReferenceArea
                            y1={p.low}
                            y2={p.high}
                            fill="#f5ff80"
                            fillOpacity={0.35}
                          />
                          <ReferenceLine
                            y={p.low}
                            stroke="#73736c"
                            strokeDasharray="4 4"
                          />
                          <ReferenceLine
                            y={p.high}
                            stroke="#73736c"
                            strokeDasharray="4 4"
                          />
                          <Line
                            type="linear"
                            dataKey={p.key}
                            name={p.name}
                            stroke="#242424"
                            strokeWidth={2}
                            dot={{ r: 1.5, fill: "#242424" }}
                            activeDot={{ r: 4 }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                          <Line
                            dataKey="statisticalFlag"
                            name="Statistical flag"
                            stroke="none"
                            dot={{
                              r: 4,
                              fill: "#ff5b29",
                              stroke: "#ffffff",
                              strokeWidth: 1,
                            }}
                            activeDot={{ r: 6 }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="chart-footnote">
                      Shaded band: invented review rule. This is not an approved
                      operating band or safety limit. Colored dots mark
                      statistical flags for the selected pattern filters.
                    </p>
                  </section>
                ))}
                <AnomaliesWorkspace
                  key={`${data.from}:${data.to}:${data.lastReceivedAt}`}
                  code={machine.code}
                  token={token}
                  from={data.from}
                  to={data.to}
                  onMarkers={setMarkers}
                />

                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Retrospective review</h2>
                      <p>
                        Version {data.policyVersion} · Calculated from values,
                        excluding workbook labels and formula flags.
                      </p>
                    </div>
                  </div>
                  <div className="reading-review-body">
                    <p>
                      Consecutive means successive hourly observations in this
                      window. It does not prove continuous duration or cause. An
                      isolated reading needs verification; no breakdown or
                      emergency alarm is created.
                    </p>
                    {data.reviews.length ? (
                      <div className="reading-review-grid">
                        {data.reviews.map((r, i) => (
                          <article className="reading-review-card" key={i}>
                            <span className="tag">
                              {r.kind === "ISOLATED"
                                ? "Isolated observation"
                                : "Consecutive observations"}
                            </span>
                            <h3>{r.parameter}</h3>
                            <p>
                              {r.samples} sample{r.samples === 1 ? "" : "s"}{" "}
                              {r.direction.toLowerCase()} demo band {r.low}–
                              {r.high} {r.unit}
                            </p>
                            <small>
                              First: {time(r.firstMeasuredAt)}
                              <br />
                              Last: {time(r.lastMeasuredAt)}
                              <br />
                              Available after receipt: {time(r.receivedAt)}
                            </small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p>
                        No samples outside the demonstration bands in this
                        window. Hourly data cannot establish that no event
                        occurred between samples.
                      </p>
                    )}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Saved observations</h2>
                    <label className="reading-toggle">
                      <input
                        type="checkbox"
                        checked={flagged}
                        onChange={(e) => {
                          setFlagged(e.target.checked);
                          setPage(0);
                        }}
                      />
                      Review samples only
                    </label>
                  </div>
                  <div
                    className="table-scroll"
                    tabIndex={0}
                    aria-label="Saved process readings"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Measured (IST)</th>
                          <th>Hot °C assumed</th>
                          <th>Cold °C assumed</th>
                          <th>Pressure bar</th>
                          <th>Source / receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map((r) => (
                          <tr key={r.sourceId}>
                            <td>
                              {r.localMeasuredAt.replace("T", " ")}
                              <small>
                                {r.sourceId} · demo shift {r.demoShift}
                              </small>
                            </td>
                            <td>{number(r.hotTempC)}</td>
                            <td>{number(r.coldTempC)}</td>
                            <td>{number(r.pressureBar)}</td>
                            <td>
                              <details>
                                <summary>
                                  {r.sheet} row {r.sourceRow}
                                </summary>
                                <p>
                                  {r.filename}
                                  <br />
                                  Received {time(r.receivedAt)}
                                </p>
                                <small>SHA-256 {r.workbookHash}</small>
                              </details>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="reading-pagination">
                    <Button
                      variant="outline"
                      disabled={!page}
                      onClick={() => setPage((n) => n - 1)}
                    >
                      Previous readings
                    </Button>
                    <span>
                      {visibleRows.length
                        ? `${page * 24 + 1}–${Math.min((page + 1) * 24, visibleRows.length)} of ${visibleRows.length}`
                        : "No matching observations"}
                    </span>
                    <Button
                      variant="outline"
                      disabled={(page + 1) * 24 >= visibleRows.length}
                      onClick={() => setPage((n) => n + 1)}
                    >
                      Next readings
                    </Button>
                  </div>
                </section>
              </>
            )}
            {!!data.imports.length && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Reading import history for this period</h2>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Workbook / source</th>
                        <th>Received / imported</th>
                        <th>Saved observations</th>
                        {importer && <th>Source review</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.imports.map((i) => (
                        <tr key={i.id}>
                          <td>
                            <strong>{i.filename}</strong>
                            <small>{i.sheet} · SYNTHETIC</small>
                          </td>
                          <td>{time(i.receivedAt)}</td>
                          <td>{i.observations}</td>
                          {importer && (
                            <td>
                              <Button
                                variant="ghost"
                                onClick={() => void review(i.id)}
                              >
                                Review reading source
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
          </>
        )
      )}
    </div>
  );
}

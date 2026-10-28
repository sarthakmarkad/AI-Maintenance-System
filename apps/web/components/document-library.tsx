"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, apiBlob, ApiError, type Machine, type Me } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { FormPopup } from "./ui/form-popup";
import type {
  DocumentLibrary,
  DocumentFile,
  MachineDocument,
} from "./document-library-types";
import styles from "./document-library.module.css";
const time = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value)) + " IST";
const statusNames = {
  CURRENT: "Current approved",
  DRAFT: "Draft · unapproved",
  SUPERSEDED: "Obsolete · superseded",
  WITHDRAWN: "Obsolete · withdrawn",
};
const defaults = { q: "", kind: "ALL", status: "ALL", page: 1 };
export function DocumentLibraryWorkspace({
  machine,
  user,
  token,
}: {
  machine: Machine;
  user: Me;
  token: string;
}) {
  const base = `/machines/${encodeURIComponent(machine.code)}/documents`,
    router = useRouter(),
    { expire } = useAuth();
  const [filters, setFilters] = useState(defaults),
    [applied, setApplied] = useState(defaults),
    [attempt, setAttempt] = useState(0);
  const [library, setLibrary] = useState<DocumentLibrary | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [message, setMessage] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [target, setTarget] = useState<MachineDocument | null>(null),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState("MANUAL"),
    [description, setDescription] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [reason, setReason] = useState("");
  const [opened, setOpened] = useState<string | null>(null),
    [review, setReview] = useState<{
      document: MachineDocument;
      file: DocumentFile;
      action: "approve" | "withdraw";
    } | null>(null);
  const operation = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const manager =
    !machine.archivedAt &&
    (user.role === "ADMINISTRATOR" || user.role === "MAINTENANCE_HEAD");
  const dirty = JSON.stringify(filters) !== JSON.stringify(applied);
  const blocked = busy || loading || stale;
  function key(payload: unknown) {
    const value = JSON.stringify(payload);
    if (request.current?.payload !== value)
      request.current = { payload: value, id: crypto.randomUUID() };
    return request.current.id;
  }
  async function failure(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      await expire();
      router.replace("/login?reason=expired");
      return;
    }
    if (e instanceof ApiError && [403, 404].includes(e.status)) {
      setUploadOpen(false);
      setLibrary(null);
      setReview(null);
      setOpened(null);
      setTarget(null);
      setFile(null);
      setTitle("");
      setDescription("");
      setReason("");
      request.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
    setError(
      e instanceof Error
        ? e.message
        : "Unable to complete the document request.",
    );
    if (e instanceof ApiError && e.status === 409) setStale(true);
  }
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setStale(false);
    const query = new URLSearchParams({
      ...applied,
      page: String(applied.page),
    });
    Promise.all([
      api<DocumentLibrary>(`${base}?${query}`, token, abort.signal),
      target
        ? api<MachineDocument>(`${base}/${target.id}`, token, abort.signal)
        : Promise.resolve(null),
    ])
      .then(([next, latest]) => {
        if (!abort.signal.aborted) {
          setLibrary(next);
          if (latest) setTarget(latest);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) void failure(e);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
    // Stable token prevents equivalent Auth focus events from resetting forms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, applied, attempt]);
  function reload() {
    setReview(null);
    setAttempt((n) => n + 1);
  }
  function newDraft(document: MachineDocument | null) {
    setUploadOpen(true);
    setTarget(document);
    setTitle(document?.title ?? "");
    setKind(document?.kind ?? "MANUAL");
    setDescription("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    request.current = null;
  }
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (blocked || !file) return;
    if (
      file.size === 0 ||
      file.size > 5 * 1024 * 1024 ||
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Choose a non-empty PDF file, at most 5 MB.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    operation.current = new AbortController();
    const data = new FormData();
    const fields = {
      version: target?.version ?? 0,
      title: title.trim(),
      kind,
      description: description.trim(),
    };
    Object.entries(fields).forEach(([k, v]) => data.set(k, String(v)));
    data.set(
      "requestId",
      key({
        target: target?.id ?? null,
        ...fields,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      }),
    );
    data.set("file", file);
    try {
      await api(
        `${base}${target ? `/${target.id}/versions` : ""}`,
        token,
        operation.current.signal,
        { method: "POST", body: data },
      );
      if (operation.current.signal.aborted) return;
      newDraft(null);
      setUploadOpen(false);
      setMessage(
        "Draft saved. It is not approved for reference use. Any current approval remains available.",
      );
      setAttempt((n) => n + 1);
    } catch (e) {
      if (!operation.current.signal.aborted) await failure(e);
    } finally {
      if (!operation.current.signal.aborted) setBusy(false);
    }
  }
  async function act(e: FormEvent) {
    e.preventDefault();
    if (!review || blocked) return;
    setBusy(true);
    setError("");
    setMessage("");
    operation.current = new AbortController();
    const payload = {
      version: review.document.version,
      fileId: review.file.id,
      reason: reason.trim(),
    };
    try {
      await api(
        `${base}/${review.document.id}/actions/${review.action}`,
        token,
        operation.current.signal,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            requestId: key({
              documentId: review.document.id,
              action: review.action,
              ...payload,
            }),
          }),
        },
      );
      if (operation.current.signal.aborted) return;
      setMessage(
        review.action === "approve"
          ? "Reference approved. Previous approval is retained as obsolete history."
          : "Approval withdrawn. This reference is no longer available to library readers.",
      );
      setReview(null);
      setReason("");
      setAttempt((n) => n + 1);
    } catch (e) {
      if (!operation.current.signal.aborted) await failure(e);
    } finally {
      if (!operation.current.signal.aborted) setBusy(false);
    }
  }
  async function download(d: MachineDocument, f: DocumentFile) {
    if (blocked) return;
    setBusy(true);
    setError("");
    operation.current = new AbortController();
    try {
      const blob = await apiBlob(
        `${base}/${d.id}/versions/${f.id}/download?version=${d.version}`,
        token,
        operation.current.signal,
      );
      if (operation.current.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `${f.status === "CURRENT" ? "" : "UNAPPROVED-OR-OBSOLETE-"}${f.filename}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!operation.current.signal.aborted) await failure(e);
    } finally {
      if (!operation.current.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className={`${styles.library} form-popup-workspace`}>
      <Link className="back-link" href={`/machines/${machine.code}`}>
        ← Machine overview
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{machine.code} / PRIVATE REFERENCES</div>
          <h1>Machine manuals & SOPs</h1>
          <p>Download the current approved references for this machine.</p>
          <p>
            <Link href={`/machines/${machine.code}/assistant`}>
              Chat with the maintenance assistant
            </Link>
          </p>
        </div>
        {manager && library?.canManage && (
          <Button
            type="button"
            onClick={() => setUploadOpen(true)}
            aria-haspopup="dialog"
          >
            Upload reference
          </Button>
        )}
      </div>
      <p className={styles.notice}>
        {manager
          ? "Drafts and obsolete versions are visible in your management view. Only the active Maintenance head can approve or withdraw a reference."
          : "Only current approved versions are available in your role. Drafts and obsolete versions are restricted to Maintenance head and Administrator."}{" "}
        Approval records a human reference review; it does not validate a repair
        or diagnose a fault.
      </p>
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      {error && (
        <div
          role="alert"
          aria-label="Document request error"
          className="inline-error"
        >
          <p>{error}</p>
          {stale && (
            <p>
              Reload the library, then review the latest evidence before acting.
              Your file and description are retained until you start another
              draft.
            </p>
          )}
          <Button disabled={busy || loading} onClick={reload}>
            Reload library
          </Button>
        </div>
      )}
      <form
        aria-label="Library filters"
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ ...filters, page: 1 });
          setFilters({ ...filters, page: 1 });
        }}
      >
        <label>
          Search title
          <input
            value={filters.q}
            maxLength={160}
            disabled={busy}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
        </label>
        <label>
          Document type
          <select
            value={filters.kind}
            disabled={busy}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
          >
            <option value="ALL">All types</option>
            <option value="MANUAL">Manual</option>
            <option value="SOP">SOP</option>
          </select>
        </label>
        <label>
          Reference status
          <select
            value={filters.status}
            disabled={busy}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="ALL">All visible</option>
            <option value="CURRENT">Current approved</option>
            {manager && (
              <>
                <option value="DRAFT">Draft pending approval</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </>
            )}
          </select>
        </label>
        <Button disabled={busy || loading}>Apply filters</Button>
      </form>
      {dirty && <p role="status">Apply filters to update the results.</p>}
      {loading ? (
        <p role="status">Loading document library…</p>
      ) : (
        library && (
          <section aria-label="Document library" className={styles.results}>
            <div className={styles.row}>
              <p>
                {library.total} reference{library.total === 1 ? "" : "s"} · Page{" "}
                {library.page}
              </p>
              <Button variant="outline" disabled={busy} onClick={reload}>
                Refresh library
              </Button>
            </div>
            {library.items.length === 0 && (
              <div className={styles.card}>
                <h2>No references match</h2>
                <p>
                  {manager
                    ? "Upload a manual or SOP as a draft for Maintenance head review."
                    : "No approved references are available for these filters. Ask the Maintenance head about the required reference."}
                </p>
              </div>
            )}
            {library.items.map((d) => (
              <article className={styles.card} key={d.id}>
                <div className={styles.row}>
                  <div>
                    <span className="eyebrow">
                      {d.kind} · record version {d.version}
                    </span>
                    <h2>{d.title}</h2>
                    <p>
                      {d.currentFileId
                        ? "A current approved reference is available."
                        : "No current approval."}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setOpened(opened === d.id ? null : d.id)}
                    aria-expanded={opened === d.id}
                  >
                    {opened === d.id ? "Hide details" : "Details & history"}
                  </Button>
                </div>
                {d.files
                  .filter((f) => f.status === "CURRENT")
                  .map((f) => (
                    <div className={styles.file} key={f.id}>
                      <span className={styles.current}>
                        Current approved · v{f.number}
                      </span>
                      <strong>{f.filename}</strong>
                      <p>{f.description}</p>
                      <Button
                        disabled={blocked}
                        onClick={() => void download(d, f)}
                      >
                        Download approved PDF
                      </Button>
                    </div>
                  ))}
                {manager && (
                  <div className={styles.row}>
                    <p>
                      {d.files.filter((f) => f.status === "DRAFT").length}{" "}
                      unapproved draft(s)
                    </p>
                    <Button
                      variant="outline"
                      disabled={blocked}
                      onClick={() => newDraft(d)}
                    >
                      Upload revision
                    </Button>
                  </div>
                )}
                {opened === d.id && (
                  <div className={styles.history}>
                    <h3>Versions & evidence</h3>
                    {d.files.map((f) => (
                      <section
                        aria-label={`Version ${f.number}`}
                        className={styles.file}
                        key={f.id}
                      >
                        <span
                          className={
                            f.status === "CURRENT"
                              ? styles.current
                              : styles.badge
                          }
                        >
                          {statusNames[f.status]} · v{f.number}
                        </span>
                        <strong>{f.filename}</strong>
                        <p>{f.description}</p>
                        <p>
                          PDF · {Math.ceil(f.byteSize / 1024)} KB · SHA-256{" "}
                          <code>{f.sha256}</code>
                        </p>
                        <div className={styles.row}>
                          <Button
                            disabled={blocked}
                            variant="outline"
                            onClick={() => void download(d, f)}
                          >
                            Download{" "}
                            {f.status === "CURRENT"
                              ? "approved"
                              : f.status === "DRAFT"
                                ? "unapproved"
                                : "obsolete"}{" "}
                            v{f.number}
                          </Button>
                          {library.canApprove &&
                            (f.status === "DRAFT" ||
                              f.status === "CURRENT") && (
                              <Button
                                disabled={blocked}
                                onClick={() => {
                                  setReviewOpen(true);
                                  const sameReview =
                                    review?.document.id === d.id &&
                                    review.file.id === f.id &&
                                    review.action ===
                                      (f.status === "DRAFT"
                                        ? "approve"
                                        : "withdraw");
                                  setReview({
                                    document: d,
                                    file: f,
                                    action:
                                      f.status === "DRAFT"
                                        ? "approve"
                                        : "withdraw",
                                  });
                                  if (!sameReview) {
                                    setReason("");
                                    request.current = null;
                                  }
                                }}
                              >
                                {f.status === "DRAFT"
                                  ? `Review approval v${f.number}`
                                  : `Withdraw approval v${f.number}`}
                              </Button>
                            )}
                        </div>
                        <ol className={styles.events}>
                          {d.events
                            .filter((e) => e.fileId === f.id)
                            .map((e) => (
                              <li key={e.id}>
                                <strong>{e.action}</strong> · {e.actorName} (
                                {e.actorRole.replaceAll("_", " ")}) ·{" "}
                                {time(e.at)} · record v{e.revision}
                                <p>{e.reason}</p>
                              </li>
                            ))}
                        </ol>
                      </section>
                    ))}
                  </div>
                )}
              </article>
            ))}
            <div className={styles.row}>
              <Button
                variant="outline"
                disabled={busy || library.page <= 1}
                onClick={() => {
                  const next = { ...applied, page: library.page - 1 };
                  setApplied(next);
                  setFilters(next);
                }}
              >
                Previous page
              </Button>
              <Button
                variant="outline"
                disabled={
                  busy || library.page * library.pageSize >= library.total
                }
                onClick={() => {
                  const next = { ...applied, page: library.page + 1 };
                  setApplied(next);
                  setFilters(next);
                }}
              >
                Next page
              </Button>
            </div>
          </section>
        )
      )}
      {review && (
        <FormPopup
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          title={
            review.action === "approve"
              ? "Approve reference"
              : "Withdraw approval"
          }
          busy={busy}
          error={
            stale
              ? `${error} Reload the library, then review the latest evidence before acting.`
              : error
          }
          errorLabel="Document request error"
        >
          {stale && (
            <Button type="button" disabled={busy || loading} onClick={reload}>
              Reload library
            </Button>
          )}
          <section className={styles.card} aria-label="Head reference review">
            <p>
              {review.document.title} · v{review.file.number} ·{" "}
              {review.file.filename}
            </p>
            <p>
              {review.action === "approve"
                ? "Download and review the file before approving. Approval replaces the current reference and retains its history."
                : "Withdrawal removes the current reference from all reader views and retains its immutable approval history. It does not restore an older version."}
            </p>
            <form onSubmit={act} className={styles.form}>
              <label>
                {review.action === "approve"
                  ? "Approval review reason"
                  : "Withdrawal reason"}
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className={styles.row}>
                <Button disabled={blocked || reason.trim().length < 3}>
                  {review.action === "approve"
                    ? "Confirm approval"
                    : "Confirm withdrawal"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setReviewOpen(false)}
                >
                  Cancel review
                </Button>
              </div>
            </form>
          </section>
        </FormPopup>
      )}
      {manager && library?.canManage && (
        <FormPopup
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          title={
            target
              ? `Upload revision: ${target.title}`
              : "Upload a new reference draft"
          }
          description="Save a private, unapproved PDF for the Maintenance head to review."
          busy={busy}
          error={
            stale
              ? `${error} Reload the library, then review the latest evidence before acting.`
              : error
          }
          errorLabel="Document request error"
        >
          {stale && (
            <Button type="button" disabled={busy || loading} onClick={reload}>
              Reload library
            </Button>
          )}
          <section className={styles.card} aria-label="Upload reference draft">
            <p>
              PDF only · 5 MB per file · up to 100 versions per reference and
              200 references per machine. Uploading preserves any current
              approval. Draft files and descriptions cannot be replaced; upload
              a new revision to correct them.
            </p>
            <form className={styles.form} onSubmit={upload}>
              <label>
                Reference title
                <input
                  required
                  minLength={3}
                  maxLength={160}
                  disabled={busy || !!target}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Reference type
                <select
                  disabled={busy || !!target}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="MANUAL">Machine manual</option>
                  <option value="SOP">Standard operating procedure</option>
                </select>
              </label>
              <label>
                Revision description
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  disabled={busy}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                PDF file
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={busy}
                  required
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    request.current = null;
                  }}
                />
              </label>
              <div className={styles.row}>
                <Button
                  disabled={
                    blocked ||
                    !file ||
                    title.trim().length < 3 ||
                    description.trim().length < 3
                  }
                >
                  {busy ? "Saving…" : "Save unapproved draft"}
                </Button>
                {target && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => newDraft(null)}
                  >
                    Start new reference
                  </Button>
                )}
              </div>
            </form>
          </section>
        </FormPopup>
      )}
    </div>
  );
}

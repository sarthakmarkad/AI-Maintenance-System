"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, FileText, Paperclip, Upload } from "lucide-react";
import {
  api,
  apiBlob,
  ApiError,
  type WorkOrder,
  type AttachmentReceipt,
} from "@/lib/api";
import { Button } from "./ui/button";
const time = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value)) + " IST";
const role = (value: string) => value.toLowerCase().replaceAll("_", " ");
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
export function WorkOrderAttachments({
  order,
  base,
  token,
  disabled,
  onBusy,
  onUploaded,
  onFailure,
}: {
  order: WorkOrder;
  base: string;
  token: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onUploaded: () => void;
  onFailure: (error: unknown) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [description, setDescription] = useState(""),
    [uploading, setUploading] = useState(false),
    [downloading, setDownloading] = useState(""),
    [error, setError] = useState("");
  const requestId = useRef(""),
    submitted = useRef(false),
    input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    abort.current = new AbortController();
    return () => {
      abort.current?.abort();
      if (submitted.current) {
        submitted.current = false;
        onBusy(false);
      }
    };
  }, [onBusy]);
  const attachments = order.attachments ?? [],
    limit = order.attachmentLimit ?? 20,
    maxBytes = order.attachmentMaxBytes ?? 5 * 1024 * 1024;
  async function failure(e: unknown) {
    if (abort.current?.signal.aborted) return;
    setError(
      e instanceof Error ? e.message : "Unable to access this attachment.",
    );
    if (e instanceof ApiError && [401, 403, 409].includes(e.status))
      await onFailure(e);
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || disabled || uploading || submitted.current) return;
    if (file.size === 0 || file.size > maxBytes) {
      setError("Choose a non-empty file of 5 MB or smaller.");
      return;
    }
    if (!/\.(png|jpe?g|pdf)$/i.test(file.name)) {
      setError("Choose a JPEG, PNG or PDF.");
      return;
    }
    if (description.trim().length < 3) {
      setError("Describe what this attachment shows (at least 3 characters).");
      return;
    }
    if (!requestId.current) requestId.current = crypto.randomUUID();
    submitted.current = true;
    setUploading(true);
    onBusy(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("requestId", requestId.current);
    form.set("version", String(order.version));
    form.set("description", description.trim());
    try {
      await api<AttachmentReceipt>(
        `${base}/${order.id}/attachments`,
        token,
        abort.current?.signal,
        { method: "POST", body: form },
      );
      if (abort.current?.signal.aborted) return;
      setFile(null);
      setDescription("");
      requestId.current = "";
      if (input.current) input.current.value = "";
      onUploaded();
    } catch (e) {
      await failure(e);
    } finally {
      if (!abort.current?.signal.aborted) {
        submitted.current = false;
        setUploading(false);
        onBusy(false);
      }
    }
  }
  async function download(id: string, filename: string) {
    if (downloading) return;
    setDownloading(id);
    setError("");
    try {
      const blob = await apiBlob(
        `${base}/${order.id}/attachments/${id}/download`,
        token,
        abort.current?.signal,
      );
      if (abort.current?.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      await failure(e);
    } finally {
      if (!abort.current?.signal.aborted) setDownloading("");
    }
  }
  return (
    <section
      className="panel work-attachments"
      aria-label="Work order attachments"
    >
      <div className="panel-heading">
        <div>
          <h2>
            <Paperclip size={18} /> Photos & documents
          </h2>
          <p>
            {attachments.length} of {limit} attachments · Private to this
            machine’s authorized team
          </p>
        </div>
      </div>
      <div className="work-attachments-body">
        {attachments.length === 0 ? (
          <p className="attachment-empty">No attachments yet.</p>
        ) : (
          <ul className="attachment-list">
            {attachments.map((a) => (
              <li key={a.id}>
                <FileText size={20} aria-hidden="true" />
                <div className="attachment-info">
                  <strong>{a.filename}</strong>
                  <p>{a.description}</p>
                  <small>
                    {size(a.byteSize)} ·{" "}
                    {a.mediaType === "application/pdf"
                      ? "PDF"
                      : a.mediaType === "image/png"
                        ? "PNG"
                        : "JPEG"}{" "}
                    · Added by {a.uploader.displayName} ({role(a.actorRole)})
                  </small>
                  <small>
                    {time(a.createdAt)} · Work order v{a.orderVersion}
                  </small>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!downloading}
                  aria-label={`Download ${a.filename}`}
                  onClick={() => void download(a.id, a.filename)}
                >
                  <Download size={15} />
                  {downloading === a.id ? "Downloading…" : "Download"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="attachment-retention">
          Saved attachments stay in the maintenance history. Files cannot be
          replaced or deleted.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {order.canUploadAttachment ? (
          <form className="attachment-form" onSubmit={(e) => void upload(e)}>
            <h3>Add supporting evidence</h3>
            <p>
              JPEG, PNG or PDF, up to 5 MB each. Upload files before submitting
              work for review.
            </p>
            <label htmlFor="work-attachment-file">
              Choose a photo or document
              <input
                ref={input}
                id="work-attachment-file"
                type="file"
                accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
                required
                disabled={disabled || uploading}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  requestId.current = "";
                  setError("");
                }}
              />
            </label>
            <label htmlFor="work-attachment-description">
              What does this attachment show?
              <textarea
                id="work-attachment-description"
                required
                minLength={3}
                maxLength={1000}
                rows={2}
                value={description}
                disabled={disabled || uploading}
                onChange={(e) => {
                  setDescription(e.target.value);
                  requestId.current = "";
                }}
                placeholder="For example: inspection photo showing the observed condition"
              />
            </label>
            <Button type="submit" disabled={disabled || uploading || !file}>
              <Upload size={16} />
              {uploading ? "Saving attachment…" : "Save attachment"}
            </Button>
          </form>
        ) : (
          <p className="attachment-guidance">
            {attachments.length >= limit
              ? "This work order has reached its attachment limit."
              : order.status === "REPORTED"
                ? "The reporting operator can add photos and documents before assignment."
                : order.status === "ASSIGNED"
                  ? "The assigned technician can add evidence after starting the work."
                  : order.status === "IN_PROGRESS"
                    ? "The assigned technician can add evidence while work is in progress."
                    : order.status === "AWAITING_REVIEW"
                      ? "Evidence is frozen for review. The Maintenance Head must return the work before the assigned technician can add more files."
                      : "Evidence is retained for review and maintenance history. Uploads are closed for this stage."}
          </p>
        )}
      </div>
    </section>
  );
}

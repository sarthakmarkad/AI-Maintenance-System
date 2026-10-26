"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { apiBlob, type WorkOrderAttachment } from "@/lib/api";
import { Button } from "./ui/button";
import styles from "./attachment-photo-viewer.module.css";

export function AttachmentPhotoViewer({
  attachment,
  path,
  token,
  onClose,
  onFailure,
}: {
  attachment: WorkOrderAttachment;
  path: string;
  token: string;
  onClose: () => void;
  onFailure: (error: unknown) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const failure = useRef(onFailure);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    failure.current = onFailure;
  }, [onFailure]);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setError("");
    setLoading(true);
    // Only raster photos are rendered. Download responses stay private and
    // attachment-only; fetching bytes does not save a file to the user's disk.
    if (!["image/jpeg", "image/png"].includes(attachment.mediaType)) {
      setError("This file is not a supported photo.");
      setLoading(false);
      return () => controller.abort();
    }
    void apiBlob(path, token, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(
          new Blob([blob], { type: attachment.mediaType }),
        );
        setUrl(objectUrl);
      })
      .catch(async (e: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(e instanceof Error ? e.message : "Unable to load this photo.");
        await failure.current(e);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, token, attachment.mediaType, attempt]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="attachment-photo-title"
      onClose={onClose}
    >
      <header className={styles.header}>
        <h2 id="attachment-photo-title">{attachment.filename}</h2>
        <Button
          type="button"
          variant="ghost"
          aria-label="Close photo preview"
          autoFocus
          onClick={() => dialog.current?.close()}
        >
          <X size={20} aria-hidden="true" />
        </Button>
      </header>
      <p className={styles.description}>{attachment.description}</p>
      <div className={styles.canvas} aria-busy={loading}>
        {loading && <p role="status">Loading photo…</p>}
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry photo
            </Button>
          </div>
        ) : (
          url && (
            <img
              src={url}
              alt={attachment.description}
              hidden={loading}
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(
                  "This photo could not be displayed. You can still download the original file.",
                );
              }}
            />
          )
        )}
      </div>
    </dialog>
  );
}

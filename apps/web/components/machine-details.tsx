"use client";
import { useEffect, useRef, useState } from "react";
import { api, apiBlob, ApiError, type Machine } from "@/lib/api";
import { Button } from "./ui/button";
import { FormPopup } from "./ui/form-popup";
import type { components } from "@maintenance/api-client";
import styles from "./machine-details.module.css";
export type MachineDetailsView = components["schemas"]["MachineDetailsDto"];
type Draft = {
  name: string;
  manufacturer: string;
  model: string;
  department: string;
  location: string;
};
const draftOf = (m: Machine): Draft => ({
  name: m.name,
  manufacturer: m.manufacturer ?? "",
  model: m.model ?? "",
  department: m.department?.name ?? "",
  location: m.location?.name ?? "",
});
export function MachinePicture({
  code,
  token,
  revision = 0,
  photo,
}: {
  code: string;
  token: string;
  revision?: number;
  photo?: Machine["photo"];
}) {
  const [url, setUrl] = useState<string>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setUrl(undefined);
    setError("");
    setLoading(true);
    // Current registry responses include only this lightweight summary, so
    // empty cards need no extra metadata request. Older responses still work.
    const summary =
      photo !== undefined && retry === 0
        ? Promise.resolve(photo)
        : api<MachineDetailsView>(
            `/machines/${code}/details`,
            token,
            controller.signal,
          ).then((d) => d.photo);
    void summary
      .then(async (current) => {
        if (!current) return;
        const blob = await apiBlob(
          `/machines/${code}/photo/${current.id}`,
          token,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [code, token, revision, retry, photo?.id, photo === undefined]);
  return (
    <div className={styles.picture}>
      {url && !error ? (
        <img
          src={url}
          alt={`${code} machine photograph`}
          onError={() => {
            setUrl(undefined);
            setError("The photo could not be displayed.");
          }}
        />
      ) : loading ? (
        <p role="status">Loading machine photo…</p>
      ) : error ? (
        <div>
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={() => setRetry((x) => x + 1)}>
            Retry photo
          </Button>
        </div>
      ) : (
        <p>No machine photo recorded</p>
      )}
    </div>
  );
}
export function MachineEditor({
  machine,
  token,
  onSaved,
}: {
  machine: Machine;
  token: string;
  onSaved?: (machine: Machine) => void;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<MachineDetailsView>(),
    [draft, setDraft] = useState<Draft>(draftOf(machine));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState("");
  const [file, setFile] = useState<File>(),
    [fileKey, setFileKey] = useState(0);
  const keys = useRef<Record<string, string>>({}),
    pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function load(discard: boolean) {
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      const d = await api<MachineDetailsView>(
        `/machines/${machine.code}/details`,
        token,
        controller.signal,
      );
      setData(d);
      if (discard) {
        setDraft(draftOf(d.machine));
        setFile(undefined);
        setFileKey((k) => k + 1);
        keys.current = {};
      }
      setBlocked(false);
      onSaved?.(d.machine);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not refresh machine.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function save(kind: "details" | "upload" | "remove") {
    if (!data || busy || blocked) return;
    setBusy(true);
    setError("");
    setNotice("");
    keys.current[kind] ??= crypto.randomUUID();
    const input = {
      requestId: keys.current[kind],
      version: data.machine.version,
    };
    const controller = new AbortController();
    pending.current = controller;
    try {
      let init: RequestInit,
        path = `/machines/${machine.code}/details`;
      if (kind === "upload") {
        if (!file) throw Error("Choose a photo first.");
        const form = new FormData();
        form.set("file", file);
        form.set("version", String(input.version));
        form.set("requestId", input.requestId);
        init = { method: "POST", body: form };
        path = `/machines/${machine.code}/photo`;
      } else {
        path =
          kind === "remove" ? `/machines/${machine.code}/photo/remove` : path;
        init = {
          method: kind === "remove" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            kind === "details"
              ? {
                  ...input,
                  ...Object.fromEntries(
                    Object.entries(draft).map(([k, v]) => [
                      k,
                      k === "name" ? v.trim() : v.trim() || null,
                    ]),
                  ),
                }
              : input,
          ),
        };
      }
      const receipt = await api<{ version: number }>(
        path,
        token,
        controller.signal,
        init,
      );
      if (
        !receipt ||
        !Number.isSafeInteger(receipt.version) ||
        receipt.version < 1
      )
        throw new Error(
          "The save response could not be confirmed. Refresh and review the machine.",
        );
      // Preserve the known receipt even if the following refresh fails; never silently replay against a new version.
      setData((d) =>
        d ? { ...d, machine: { ...d.machine, version: receipt.version } } : d,
      );
      const latest = await api<MachineDetailsView>(
        `/machines/${machine.code}/details`,
        token,
        controller.signal,
      );
      setData(latest);
      if (kind === "details") setDraft(draftOf(latest.machine));
      setFile(undefined);
      setFileKey((k) => k + 1);
      keys.current = {};
      onSaved?.(latest.machine);
      setNotice(
        kind === "details"
          ? "Machine details saved."
          : kind === "upload"
            ? "Machine photo saved."
            : "Machine photo removed.",
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Could not save machine.");
      if (e instanceof ApiError && [403, 404, 409].includes(e.status))
        setBlocked(true);
      else if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500)
        setBlocked(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          if (!data) void load(true);
        }}
      >
        Edit machine
      </Button>
      <FormPopup
        open={open}
        onOpenChange={setOpen}
        title={`Edit machine · ${machine.code}`}
        description="Update machine details and its photo. The machine code cannot be changed."
        busy={busy}
        error={error}
      >
        <div className={styles.editor}>
          {notice && <p role="status">{notice}</p>}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void load(true)}
          >
            Refresh machine and discard draft
          </Button>
          {blocked && (
            <p role="alert">
              Refresh and review the current machine before saving again. This
              discards unfinished changes.
            </p>
          )}
          <form
            className="work-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save("details");
            }}
          >
            <fieldset
              disabled={busy || blocked || !data?.canManage}
              className={styles.fields}
            >
              <label>
                Machine code
                <input value={machine.code} readOnly className="ui-input" />
              </label>
              {(
                [
                  ["name", "Machine name", 160],
                  ["manufacturer", "Manufacturer", 160],
                  ["model", "Model", 160],
                  ["department", "Department", 120],
                  ["location", "Location", 160],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key}>
                  {label}
                  <input
                    className="ui-input"
                    value={draft[key]}
                    required={key === "name"}
                    minLength={key === "name" ? 2 : undefined}
                    maxLength={max}
                    onChange={(e) => {
                      setDraft((d) => ({ ...d, [key]: e.target.value }));
                      delete keys.current.details;
                      setNotice("");
                    }}
                  />
                </label>
              ))}
              <p>Leave optional fields blank when not recorded.</p>
              <Button type="submit">Save machine details</Button>
            </fieldset>
          </form>
          <form
            className="work-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save("upload");
            }}
          >
            <fieldset
              disabled={busy || blocked || !data?.canManage}
              className={styles.fields}
            >
              <h3>Machine photo</h3>
              {data?.photo && (
                <p>
                  Current photo: {data.photo.source.filename} · Uploaded by{" "}
                  {data.photo.uploaderName} ·{" "}
                  {new Date(data.photo.createdAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST
                </p>
              )}
              <label>
                Choose machine photo
                <input
                  key={fileKey}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    setFile(e.target.files?.[0]);
                    delete keys.current.upload;
                    setNotice("");
                  }}
                />
              </label>
              <p>
                JPEG, PNG or WebP, up to 5 MB. Replacing a photo removes the
                previous display photo.
              </p>
              <details>
                <summary>Photo requirements</summary>
                <p>
                  Use a still image up to 8192 pixels per side and 16 million
                  pixels. Photos are resized for display and embedded metadata
                  is removed.
                </p>
              </details>
              <Button type="submit" disabled={!file}>
                {data?.photo ? "Replace machine photo" : "Upload machine photo"}
              </Button>
              {data?.photo && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void save("remove")}
                >
                  Remove machine photo
                </Button>
              )}
            </fieldset>
          </form>
        </div>
      </FormPopup>
    </>
  );
}

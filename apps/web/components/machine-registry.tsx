"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Factory, Plus, Search, ShieldCheck } from "lucide-react";
import { api, type Machine, type Machines, type Me } from "@/lib/api";
import { Button } from "./ui/button";
import styles from "./machine-details.module.css";
import { MachineEditor, MachinePicture } from "./machine-details";
import { FormPopup } from "./ui/form-popup";
export function MachineLifecycle({
  machine,
  token,
  onSaved,
}: {
  machine: Machine;
  token: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef<string | null>(null);
  const archived = Boolean(machine.archivedAt);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    key.current ??= crypto.randomUUID();
    try {
      await api(`/machines/${machine.code}/lifecycle`, token, undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: key.current,
          version: machine.version,
          archived: !archived,
          reason,
        }),
      });
      setOpen(false);
      setReason("");
      key.current = null;
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update the machine.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {archived ? "Restore machine" : "Archive machine"}
      </Button>
      <FormPopup
        open={open}
        onOpenChange={setOpen}
        title={archived ? "Restore machine" : "Archive machine"}
        description={machine.code}
        busy={busy}
        error={error}
      >
        <form className="work-form" onSubmit={save}>
          <p>
            {archived
              ? "Restore this machine to the active registry. Paused maintenance plans stay paused."
              : "Remove this machine from the active registry and make its workspace read only. Its records, photos and history remain available. Resolve open work, pause plans and skip unreleased tasks first."}
          </p>
          {machine.archiveReason && (
            <p>Archive reason: {machine.archiveReason}</p>
          )}
          <label>
            Reason
            <textarea
              required
              minLength={3}
              maxLength={4000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {archived ? "Confirm restore" : "Confirm archive"}
          </Button>
        </form>
      </FormPopup>
    </>
  );
}
export function MachineRegistry({
  user,
  token,
  initial,
}: {
  user: Me;
  token: string;
  initial: Machines;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [data, setData] = useState<Machines>(initial);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0),
    [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const requestId = useRef<string | null>(null),
    pending = useRef<AbortController | null>(null);
  const lastQuery = useRef(`${token}:0::false`);
  useEffect(() => {
    const currentQuery = `${token}:${reload}:${q}:${archived}`;
    if (lastQuery.current === currentQuery) return;
    lastQuery.current = currentQuery;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setBusy(true);
    setError("");
    setData({ items: [], nextCursor: null });
    const timer = setTimeout(
      () => {
        void api<Machines>(
          `/machines?q=${encodeURIComponent(q.trim())}&archived=${archived}`,
          token,
          controller.signal,
        )
          .then(setData)
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setBusy(false);
          });
      },
      q ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, token, reload, archived]);
  useEffect(() => () => pending.current?.abort(), []);
  async function more() {
    if (!data.nextCursor || busy) return;
    const controller =
      pending.current?.signal.aborted === false
        ? pending.current
        : new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const next = await api<Machines>(
        `/machines?q=${encodeURIComponent(q.trim())}&archived=${archived}&after=${encodeURIComponent(data.nextCursor)}`,
        token,
        controller.signal,
      );
      if (!controller.signal.aborted)
        setData((d) => ({
          items: [
            ...d.items,
            ...next.items.filter((m) => !d.items.some((x) => x.id === m.id)),
          ],
          nextCursor: next.nextCursor,
        }));
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not load machines.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    requestId.current ??= crypto.randomUUID();
    setSaving(true);
    setSaveError("");
    const optional = (key: string) =>
      String(form.get(key) || "").trim() || null;
    try {
      const machine = await api<Machine>("/machines", token, undefined, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: requestId.current,
          code: String(form.get("code")).trim().toUpperCase(),
          name: String(form.get("name")).trim(),
          manufacturer: optional("manufacturer"),
          model: optional("model"),
          department: optional("department"),
          location: optional("location"),
        }),
      });
      setOpen(false);
      router.push(`/machines/${machine.code}`);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Could not add the machine.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="eyebrow">YOUR OPERATIONS, IN FOCUS</div>
      <div className="page-heading">
        <div>
          <h1>Asset registry</h1>
          <p>The machines your team is authorized to access.</p>
        </div>
        {user.role === "ADMINISTRATOR" && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Add machine
          </Button>
        )}
      </div>
      <div className="registry-toolbar">
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived machines
        </label>
        <label>
          <Search size={16} />
          <span className="visually-hidden">Search machines</span>
          <input
            className="ui-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by machine code or name"
          />
        </label>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setReload((x) => x + 1)}
        >
          Refresh machines
        </Button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {busy && <p role="status">Loading machines…</p>}
      {!busy && !error && data.items.length === 0 && (
        <section className="state-card">
          <Factory size={34} />
          <h2>{q ? "No matching machines" : "No machines assigned yet"}</h2>
          <p>
            {q
              ? "Try another machine code or name."
              : user.role === "ADMINISTRATOR"
                ? "Add your first machine, then grant access to its operators and technicians."
                : "Ask your administrator to register machines and grant your account access."}
          </p>
        </section>
      )}
      <div className="machine-grid">
        {data.items.map((machine) => (
          <article
            key={machine.id}
            className={`asset-card ${styles.registryCard}`}
          >
            <div className="asset-card-top">
              <span className="machine-code">{machine.code}</span>
              <ArrowRight size={20} aria-hidden="true" />
            </div>
            <MachinePicture
              code={machine.code}
              token={token}
              revision={machine.version}
              photo={machine.photo}
            />
            <h2>{machine.name}</h2>
            <p>{machine.manufacturer || "Manufacturer not recorded"}</p>
            <div className="asset-card-bottom">
              <span>
                <span className="status-dot" />{" "}
                {machine.archivedAt
                  ? "Archived · read only"
                  : "Registry record"}
              </span>
              <Link
                className={styles.registryNavigation}
                aria-label={`${machine.code} ${machine.name} View machine`}
                href={`/machines/${machine.code}`}
              >
                View machine <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            {user.role === "ADMINISTRATOR" && !machine.archivedAt && (
              <MachineEditor
                machine={machine}
                token={token}
                onSaved={(updated) =>
                  setData((d) => ({
                    ...d,
                    items: d.items.map((m) =>
                      m.id === updated.id ? updated : m,
                    ),
                  }))
                }
              />
            )}
            {user.role === "ADMINISTRATOR" && (
              <MachineLifecycle
                machine={machine}
                token={token}
                onSaved={() => setReload((x) => x + 1)}
              />
            )}
          </article>
        ))}
      </div>
      {data.items.length > 0 && (
        <div className="registry-toolbar">
          <p>
            {data.items.length}{" "}
            {data.items.length === 1 ? "machine" : "machines"} shown
            {data.nextCursor ? " · More available" : ""}
          </p>
          {data.nextCursor && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void more()}
            >
              Load more machines
            </Button>
          )}
        </div>
      )}
      <div className="info-strip">
        <ShieldCheck size={20} />
        <p>
          Access follows your organization and assigned machine permissions.
          Each machine keeps its own maintenance records.
        </p>
      </div>
      {user.role === "ADMINISTRATOR" && (
        <FormPopup
          open={open}
          onOpenChange={setOpen}
          title="Add machine"
          description="Create a machine workspace for your organization. Grant operator and technician access from its overview after saving."
          busy={saving}
          error={saveError}
        >
          <form
            className="work-form"
            onSubmit={register}
            onChange={() => {
              requestId.current = null;
              setSaveError("");
            }}
          >
            <fieldset className="machine-registration-fields" disabled={saving}>
              <label>
                Machine code
                <input
                  name="code"
                  required
                  maxLength={32}
                  pattern="[A-Za-z0-9][A-Za-z0-9-]{0,31}"
                  placeholder="e.g. COMP-01"
                  autoCapitalize="characters"
                />
                <small>
                  A unique code in your organization. Letters, numbers and
                  hyphens; saved in uppercase.
                </small>
              </label>
              <label>
                Machine name
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder="e.g. Air compressor"
                />
              </label>
              <div className="work-form-row">
                <label>
                  Manufacturer (optional)
                  <input name="manufacturer" maxLength={160} />
                </label>
                <label>
                  Model (optional)
                  <input name="model" maxLength={160} />
                </label>
              </div>
              <div className="work-form-row">
                <label>
                  Department (optional)
                  <input name="department" maxLength={120} />
                </label>
                <label>
                  Location (optional)
                  <input name="location" maxLength={160} />
                </label>
              </div>
              <p className="muted">
                Work orders, calendars, manuals, reports and the assistant are
                available for registered machines. Live telemetry requires a
                separate connection. Standard templates support production and
                synthetic process readings for each machine.
              </p>
              <Button type="submit" disabled={saving}>
                {saving ? "Adding machine…" : "Create machine workspace"}
              </Button>
            </fieldset>
          </form>
        </FormPopup>
      )}
    </>
  );
}

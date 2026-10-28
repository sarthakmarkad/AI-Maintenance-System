"use client";
import { useEffect, useRef, useState } from "react";
import type { components } from "@maintenance/api-client";
import { api, type Machine } from "@/lib/api";
import { Button } from "./ui/button";
import { FormPopup } from "./ui/form-popup";
type Roster = components["schemas"]["MachineAccessRosterDto"];
export function MachineAccess({
  machine,
  token,
}: {
  machine: Machine;
  token: string;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [data, setData] = useState<Roster | null>(null),
    [changes, setChanges] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [message, setMessage] = useState("");
  const key = useRef<string | null>(null),
    pending = useRef<AbortController | null>(null),
    cacheKey = useRef("");
  const dirty = Object.keys(changes).length > 0;
  const path = `/machines/${machine.code}/access`;
  useEffect(() => {
    if (!open) {
      setBusy(false);
      return;
    }
    const currentKey = `${path}:${q}:${token}:${reload}`;
    if (data && cacheKey.current === currentKey) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setData(null);
    setChanges({});
    key.current = null;
    const timer = setTimeout(
      () => {
        void api<Roster>(
          `${path}?q=${encodeURIComponent(q.trim())}`,
          token,
          controller.signal,
        )
          .then((value) => {
            cacheKey.current = currentKey;
            setData(value);
          })
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
  }, [open, q, path, token, reload]);
  async function more() {
    if (!data?.nextCursor) return;
    const controller = pending.current;
    if (!controller) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Roster>(
        `${path}?q=${encodeURIComponent(q.trim())}&after=${data.nextCursor}`,
        token,
        controller.signal,
      );
      if (next.version !== data.version)
        throw new Error("Machine access changed. Reload before saving.");
      if (!controller.signal.aborted)
        setData((d) =>
          d ? { ...next, items: [...d.items, ...next.items] } : next,
        );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not load people.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function save() {
    if (!data || !dirty) return;
    key.current ??= crypto.randomUUID();
    setSaving(true);
    setError("");
    try {
      await api(path, token, undefined, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: key.current,
          version: data.version,
          changes: Object.entries(changes).map(([membershipId, granted]) => ({
            membershipId,
            granted,
          })),
        }),
      });
      setMessage(
        "Machine access saved. Operators and technicians can open this machine only while their grant and role remain active.",
      );
      setChanges({});
      setData(null);
      cacheKey.current = "";
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save access.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Manage machine access
      </Button>
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
      <FormPopup
        open={open}
        onOpenChange={setOpen}
        title={`Machine access · ${machine.code}`}
        description="Grant machine access to existing Operators and Technicians. Accounts and roles are managed separately."
        busy={saving}
        error={error}
      >
        <div className="work-form">
          <p>
            Heads, supervisors, plant management and administrators already have
            organization-wide read access under their own role permissions.
          </p>
          <label>
            Find a person
            <input
              value={q}
              disabled={saving || dirty}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name"
            />
          </label>
          {busy && <p role="status">Loading access list…</p>}
          {data && (
            <>
              <div className="machine-access-people">
                {data.items.map((person) => (
                  <label
                    className="machine-access-person"
                    key={person.membershipId}
                  >
                    <input
                      type="checkbox"
                      disabled={
                        saving ||
                        (!person.granted &&
                          (!person.active || person.roles.length === 0))
                      }
                      checked={changes[person.membershipId] ?? person.granted}
                      onChange={(e) => {
                        key.current = null;
                        setChanges((c) => {
                          const next = { ...c };
                          if (e.target.checked === person.granted)
                            delete next[person.membershipId];
                          else next[person.membershipId] = e.target.checked;
                          return next;
                        });
                      }}
                    />
                    <span>
                      <strong>{person.displayName}</strong>
                      <small>
                        {person.active
                          ? person.roles
                              .map((r) =>
                                r === "OPERATOR" ? "Operator" : "Technician",
                              )
                              .join(" · ") || "Operational role revoked"
                          : "Inactive account"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {data.items.length === 0 && (
                <p>
                  No matching operators or technicians. Staff must first have a
                  trusted application membership and an operational role.
                </p>
              )}
              {data.nextCursor && (
                <Button
                  variant="outline"
                  disabled={busy || saving}
                  onClick={() => void more()}
                >
                  Load more people
                </Button>
              )}
            </>
          )}
          <p className="muted">
            Removing access prevents future access to this machine. Existing
            assignments and history stay recorded; a head may need to reassign
            unfinished work.
          </p>
          <div className="record-actions">
            <Button
              disabled={!dirty || busy || saving || !data}
              onClick={() => void save()}
            >
              {saving
                ? "Saving…"
                : `Save access${dirty ? ` (${Object.keys(changes).length})` : ""}`}
            </Button>
            <Button
              variant="outline"
              disabled={busy || saving}
              onClick={() => setReload((x) => x + 1)}
            >
              Reload access list
            </Button>
          </div>
        </div>
      </FormPopup>
    </>
  );
}

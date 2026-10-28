"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Me, type Machines } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { FormPopup } from "./ui/form-popup";
import {
  type StaffMember,
  type StaffList,
  type StaffInvitation,
  type StaffInvitations,
  type StaffMachine,
  type StaffReceipt,
  roleNames,
  roleHelp,
} from "./team-types";
import styles from "./team-workspace.module.css";
const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const time = (v: string) =>
  new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST";
function RoleField({
  value,
  onChange,
}: {
  value: Me["role"];
  onChange: (v: Me["role"]) => void;
}) {
  return (
    <label>
      Staff role
      <select
        aria-label="Staff role"
        value={value}
        onChange={(e) => onChange(e.target.value as Me["role"])}
      >
        {Object.entries(roleNames).map(([key, name]) => (
          <option value={key} key={key}>
            {name}
          </option>
        ))}
      </select>
      <small>{roleHelp[value]}</small>
    </label>
  );
}
function MachinePicker({
  token,
  selected,
  onChange,
  existing = [],
}: {
  token: string;
  selected: string[];
  onChange: (v: string[]) => void;
  existing?: StaffMachine[];
}) {
  const [items, setItems] = useState<StaffMachine[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    api<Machines>("/machines?limit=100", token, abort.signal)
      .then((d) => {
        if (!abort.signal.aborted) {
          setItems(
            d.items.map((m) => ({ ...m, archivedAt: m.archivedAt ?? null })),
          );
          setCursor(d.nextCursor);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [token, attempt]);
  async function more() {
    setLoading(true);
    try {
      const d = await api<Machines>(
        "/machines?limit=100&after=" + encodeURIComponent(cursor!),
        token,
      );
      setItems((old) => [
        ...old,
        ...d.items.map((m) => ({ ...m, archivedAt: m.archivedAt ?? null })),
      ]);
      setCursor(d.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load machines.");
    } finally {
      setLoading(false);
    }
  }
  const choices = [
    ...new Map([...existing, ...items].map((m) => [m.id, m])).values(),
  ];
  return (
    <fieldset className={styles.picker}>
      <legend>Machine access</legend>
      <p className={styles.muted}>
        Required for Operators and Technicians. Other roles have
        organization-wide access.
      </p>
      {error && (
        <p role="alert">
          {error}{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry machines
          </Button>
        </p>
      )}
      {choices.map((m) => (
        <label key={m.id}>
          <input
            type="checkbox"
            checked={selected.includes(m.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, m.id]
                  : selected.filter((id) => id !== m.id),
              )
            }
          />
          <span>
            {m.code} · {m.name}
            {m.archivedAt ? " · Archived" : ""}
          </span>
        </label>
      ))}
      {loading && <p role="status">Loading machines…</p>}
      {!loading && !choices.length && !error && (
        <p>No machines registered yet.</p>
      )}
      {cursor && (
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onClick={() => void more()}
        >
          Load more machines
        </Button>
      )}
    </fieldset>
  );
}
export function TeamWorkspace({ user, token }: { user: Me; token: string }) {
  const router = useRouter(),
    { expire } = useAuth();
  const [members, setMembers] = useState<StaffList>(),
    [invitations, setInvitations] = useState<StaffInvitations>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(1),
    [invPage, setInvPage] = useState(1),
    [q, setQ] = useState(""),
    [draftQ, setDraftQ] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false),
    [editing, setEditing] = useState<StaffMember | null>(null),
    [action, setAction] = useState<{
      invitation: StaffInvitation;
      kind: "revoke" | "email";
    } | null>(null),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [blocked, setBlocked] = useState(false);
  const [displayName, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<Me["role"]>("OPERATOR"),
    [machineIds, setMachineIds] = useState<string[]>([]),
    [active, setActive] = useState(true),
    [reason, setReason] = useState(""),
    [replaceRoles, setReplaceRoles] = useState(false);
  const keys = useRef<Record<string, string>>({});
  const draftIdentity = useRef("");
  const memberDraft = useRef<StaffMember | null>(null);
  const authorized = user.role === "ADMINISTRATOR";
  async function failure(e: unknown) {
    const message =
      e instanceof Error ? e.message : "The request could not be completed.";
    setFormError(message);
    if (e instanceof ApiError) {
      if (e.status === 401) {
        await expire();
        router.replace("/login?reason=expired");
      }
      if (e.status === 403) {
        setMembers(undefined);
        setInvitations(undefined);
        setError(message);
      }
      if ([403, 404, 409].includes(e.status)) setBlocked(true);
    }
    return message;
  }
  useEffect(() => {
    if (!authorized) return;
    const abort = new AbortController();
    setError("");
    Promise.all([
      api<StaffList>(
        `/team/members?page=${page}&q=${encodeURIComponent(q)}`,
        token,
        abort.signal,
      ),
      api<StaffInvitations>(
        `/team/invitations?page=${invPage}&q=${encodeURIComponent(q)}`,
        token,
        abort.signal,
      ),
    ])
      .then(([m, i]) => {
        if (!abort.signal.aborted) {
          setMembers(m);
          setInvitations(i);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setMembers(undefined);
          setInvitations(undefined);
          setError(e.message);
          void failure(e);
        }
      });
    return () => abort.abort();
  }, [token, authorized, page, invPage, q, revision]);
  function prepare() {
    setFormError("");
    setBlocked(false);
    setNotice("");
    keys.current = {};
    setReason("");
    setReplaceRoles(false);
  }
  function prepareAction() {
    setFormError("");
    setBlocked(false);
    setNotice("");
    delete keys.current.action;
  }
  function edit(m: StaffMember) {
    if (draftIdentity.current !== m.id) {
      prepare();
      memberDraft.current = m;
      draftIdentity.current = m.id;
      setName(m.displayName);
      setRole(m.role);
      setActive(m.active);
      setMachineIds(m.machines.map((x) => x.id));
    }
    setEditing(memberDraft.current ?? m);
  }
  function resetInvite() {
    if (draftIdentity.current !== "invite") {
      prepare();
      draftIdentity.current = "invite";
      setName("");
      setEmail("");
      setRole("OPERATOR");
      setActive(true);
      setMachineIds([]);
    }
    setInviteOpen(true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || blocked) return;
    setBusy(true);
    setFormError("");
    const kind = editing ? "member" : "invite";
    keys.current[kind] ??= crypto.randomUUID();
    try {
      const payload = editing
        ? {
            requestId: keys.current[kind],
            version: editing.version,
            displayName,
            role,
            active,
            machineIds,
            expectedMachineIds: editing.machines.map((m) => m.id).sort(),
            reason,
            replaceAdditionalRoles: replaceRoles,
          }
        : {
            requestId: keys.current[kind],
            email,
            displayName,
            role,
            machineIds,
          };
      const saved = await api<StaffReceipt>(
        editing ? "/team/members/" + editing.id : "/team/invitations",
        token,
        undefined,
        json(payload, editing ? "PUT" : "POST"),
      );
      draftIdentity.current = "";
      memberDraft.current = null;
      setEditing(null);
      setInviteOpen(false);
      if (saved.invitationUrl) setLink(saved.invitationUrl);
      setNotice(
        kind === "invite"
          ? "Invitation created. Share its private link or send an invitation email."
          : "Staff access saved. Existing maintenance history is retained.",
      );
      setRevision((n) => n + 1);
      keys.current = {};
    } catch (e) {
      await failure(e);
    } finally {
      setBusy(false);
    }
  }
  async function invitationAction(e: FormEvent) {
    e.preventDefault();
    if (!action || busy || blocked) return;
    setBusy(true);
    setFormError("");
    keys.current.action ??= crypto.randomUUID();
    try {
      const result = await api<StaffReceipt>(
        `/team/invitations/${action.invitation.id}/${action.kind}`,
        token,
        undefined,
        json({
          requestId: keys.current.action,
          version: action.invitation.version,
        }),
      );
      setNotice(
        action.kind === "revoke"
          ? "Invitation revoked. Its link can no longer grant access."
          : result.deliveryStatus === "SENT"
            ? "Invitation accepted by the email provider. Inbox delivery is not guaranteed."
            : result.deliveryStatus === "PENDING"
              ? "Email delivery is not confirmed. Refresh before deciding whether to send again."
              : "Invitation email could not be confirmed. Check the delivery status or share the private link instead.",
      );
      setAction(null);
      setRevision((n) => n + 1);
      delete keys.current.action;
    } catch (e) {
      await failure(e);
    } finally {
      setBusy(false);
    }
  }
  async function getLink(i: StaffInvitation) {
    setBusy(true);
    setError("");
    try {
      const r = await api<StaffReceipt>(
        `/team/invitations/${i.id}/link`,
        token,
        undefined,
        json({}),
      );
      setLink(r.invitationUrl ?? "");
    } catch (e) {
      setError(await failure(e));
    } finally {
      setBusy(false);
    }
  }
  const needsMachines = ["OPERATOR", "TECHNICIAN"].includes(role) && active;
  if (!authorized)
    return (
      <section className="state-card">
        <h1>Team management</h1>
        <p>Only an Administrator can manage staff accounts.</p>
      </section>
    );
  return (
    <div className={styles.grid}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{user.organization} / TEAM ACCESS</span>
          <h1>Team</h1>
          <p>Individual accounts, roles and machine access.</p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setRevision((n) => n + 1)}
          >
            Refresh team
          </Button>
          <Button
            disabled={!invitations?.invitationsConfigured || busy}
            onClick={resetInvite}
          >
            Invite staff
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {invitations && !invitations.invitationsConfigured && (
        <p role="status" className={styles.notice}>
          Staff invitation setup is required. Existing staff access can still be
          managed.
        </p>
      )}
      {invitations && !invitations.passwordEmailConfigured && (
        <p className={styles.notice}>
          Password signup and recovery need email setup. Invited staff can join
          with Google or an existing confirmed account.
        </p>
      )}
      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draftQ);
          setPage(1);
          setInvPage(1);
        }}
      >
        <label>
          Search staff or invitation
          <input
            value={draftQ}
            maxLength={120}
            onChange={(e) => setDraftQ(e.target.value)}
          />
        </label>
        <Button variant="outline">Search team</Button>
      </form>
      <section className={"panel " + styles.card}>
        <h2>Staff accounts {members ? `(${members.total})` : ""}</h2>
        <p className={styles.muted}>
          Deactivation blocks application access and preserves history. Your own
          account must be managed by another Administrator.
        </p>
        {!members && !error && <p role="status">Loading staff…</p>}
        {members?.items.map((m) => (
          <article key={m.id} className={styles.row}>
            <div>
              <h3>
                {m.displayName} {m.userId === user.userId && "· You"}
              </h3>
              <p>{m.email ?? "Email not recorded for this existing account"}</p>
              <p>
                {roleNames[m.role]}{" "}
                <span className={styles.status}>
                  {m.active ? "Active" : "Inactive"}
                </span>
              </p>
              {m.additionalRoles.length > 0 && (
                <p className={styles.muted}>
                  Additional trusted roles:{" "}
                  {m.additionalRoles.map((r) => roleNames[r]).join(", ")}
                </p>
              )}
              <p className={styles.muted}>
                {["OPERATOR", "TECHNICIAN"].includes(m.role)
                  ? m.machines.map((x) => x.code).join(", ") ||
                    "No machine access"
                  : "Organization-wide access"}
              </p>
              {(m.openWorkOrders > 0 || m.activePlans > 0) && (
                <p className={styles.muted}>
                  {m.openWorkOrders} open work orders · {m.activePlans} active
                  plans assigned
                </p>
              )}
            </div>
            <Button
              variant="outline"
              disabled={busy || m.userId === user.userId}
              onClick={() => edit(m)}
            >
              Manage {m.displayName}
            </Button>
          </article>
        ))}
        {members?.total === 0 && <p>No staff match this search.</p>}
        {members && (
          <div className={styles.pager}>
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((n) => n - 1)}
            >
              Previous staff
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={page * 25 >= members.total}
              onClick={() => setPage((n) => n + 1)}
            >
              Next staff
            </Button>
          </div>
        )}
      </section>
      <section className={"panel " + styles.card}>
        <h2>Invitations {invitations ? `(${invitations.total})` : ""}</h2>
        <p className={styles.muted}>
          Invitations expire after seven days. Only the confirmed email
          recipient can accept.
        </p>
        {invitations?.items.map((i) => (
          <article key={i.id} className={styles.row}>
            <div>
              <h3>{i.displayName}</h3>
              <p>
                {i.email} · {roleNames[i.role]}
              </p>
              <p>
                <span className={styles.status}>{i.status}</span> · Expires{" "}
                {time(i.expiresAt)}
              </p>
              {i.deliveryStatus && (
                <p className={styles.muted}>
                  Email: {i.deliveryStatus}
                  {i.deliveryCode ? " · " + i.deliveryCode : ""}
                </p>
              )}
            </div>
            {i.status === "PENDING" && (
              <div className={styles.actions}>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void getLink(i)}
                >
                  Get invitation link
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !invitations.emailConfigured}
                  onClick={() => {
                    prepareAction();
                    setAction({ invitation: i, kind: "email" });
                  }}
                >
                  Send email
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    prepareAction();
                    setAction({ invitation: i, kind: "revoke" });
                  }}
                >
                  Revoke invitation
                </Button>
              </div>
            )}
          </article>
        ))}
        {invitations?.total === 0 && <p>No invitations yet.</p>}
        {invitations && !invitations.emailConfigured && (
          <p className={styles.muted}>
            Email sending is unavailable. You can share a private invitation
            link.
          </p>
        )}
        {invitations && (
          <div className={styles.pager}>
            <Button
              variant="outline"
              disabled={invPage === 1}
              onClick={() => setInvPage((n) => n - 1)}
            >
              Previous invitations
            </Button>
            <span>Page {invPage}</span>
            <Button
              variant="outline"
              disabled={invPage * 25 >= invitations.total}
              onClick={() => setInvPage((n) => n + 1)}
            >
              Next invitations
            </Button>
          </div>
        )}
      </section>
      <FormPopup
        open={inviteOpen || !!editing}
        onOpenChange={(v) => {
          if (!v) {
            setInviteOpen(false);
            setEditing(null);
          }
        }}
        title={
          editing ? "Manage staff · " + editing.displayName : "Invite staff"
        }
        busy={busy}
        error={formError}
      >
        <form className={styles.form} onSubmit={(e) => void save(e)}>
          <label>
            Full name
            <input
              required
              minLength={2}
              maxLength={120}
              value={displayName}
              onChange={(e) => {
                setName(e.target.value);
                delete keys.current.member;
                delete keys.current.invite;
              }}
            />
          </label>
          {!editing && (
            <label>
              Staff email
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  delete keys.current.invite;
                }}
              />
            </label>
          )}
          <RoleField
            value={role}
            onChange={(v) => {
              setRole(v);
              keys.current = {};
            }}
          />
          {editing && (
            <label>
              Account status
              <select
                aria-label="Account status"
                value={active ? "ACTIVE" : "INACTIVE"}
                onChange={(e) => {
                  setActive(e.target.value === "ACTIVE");
                  delete keys.current.member;
                }}
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
          )}
          <MachinePicker
            token={token}
            selected={machineIds}
            existing={editing?.machines}
            onChange={(v) => {
              setMachineIds(v);
              keys.current = {};
            }}
          />
          {needsMachines && machineIds.length === 0 && (
            <p>Select at least one machine for this role.</p>
          )}
          {editing && (
            <>
              <label>
                Reason for access change
                <textarea
                  aria-label="Reason for access change"
                  required
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    delete keys.current.member;
                  }}
                />
              </label>
              {editing.additionalRoles.length > 0 && (
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    required
                    checked={replaceRoles}
                    onChange={(e) => {
                      setReplaceRoles(e.target.checked);
                      delete keys.current.member;
                    }}
                  />
                  Replace this person's additional role grants with the single
                  role selected above.
                </label>
              )}
              {(editing.openWorkOrders > 0 || editing.activePlans > 0) && (
                <p className={styles.notice}>
                  This person has {editing.openWorkOrders} open work orders and{" "}
                  {editing.activePlans} active plans. Changing or deactivating
                  access does not reassign them. Ask the Maintenance head to
                  resolve assignments.
                </p>
              )}
            </>
          )}
          {blocked && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setInviteOpen(false);
                setEditing(null);
                draftIdentity.current = "";
                memberDraft.current = null;
                setRevision((n) => n + 1);
              }}
            >
              Reload team and discard draft
            </Button>
          )}
          <Button
            disabled={
              busy || blocked || (needsMachines && machineIds.length === 0)
            }
          >
            {editing ? "Save staff access" : "Create invitation"}
          </Button>
        </form>
      </FormPopup>
      <FormPopup
        open={!!action}
        onOpenChange={(v) => {
          if (!v) setAction(null);
        }}
        title={
          action?.kind === "email"
            ? "Send invitation email"
            : "Revoke invitation"
        }
        busy={busy}
        error={formError}
      >
        <form
          className={styles.form}
          onSubmit={(e) => void invitationAction(e)}
        >
          <p>
            {action?.invitation.displayName} · {action?.invitation.email}
          </p>
          <p>
            {action?.kind === "email"
              ? "Send the private invitation to this address? The person must confirm this email before joining."
              : "Revoke this invitation? Its link will no longer grant access. Existing staff accounts are unaffected."}
          </p>
          <Button disabled={busy || blocked}>
            {action?.kind === "email"
              ? "Send invitation email"
              : "Confirm revocation"}
          </Button>
        </form>
      </FormPopup>
      <FormPopup
        open={!!link}
        onOpenChange={(v) => {
          if (!v) setLink("");
        }}
        title="Private invitation link"
      >
        <div className={styles.form}>
          <p>
            Share only with the invited person. A confirmed matching email is
            required to accept.
          </p>
          <label>
            Invitation link
            <textarea
              className={styles.link}
              aria-label="Invitation link"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setNotice("Invitation link copied.");
              } catch {
                setNotice("Select and copy the invitation link manually.");
              }
            }}
          >
            Copy link
          </Button>
        </div>
      </FormPopup>
    </div>
  );
}

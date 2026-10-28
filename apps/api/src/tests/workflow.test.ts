import { test } from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { transition, type Issue } from "../domain/workflow";
import type { Principal } from "../repository";
const principal = (role: Role, id = role): Principal => ({
  userId: id,
  membershipId: id,
  displayName: id,
  role,
  orgId: "supreme",
  organization: "Supreme Industries",
});
const base: Issue = {
  id: "issue",
  orgId: "supreme",
  status: "REPORTED",
  version: 1,
  reportedAt: "2026-09-01T00:00:00Z",
  technicianId: null,
  findings: null,
  rootCause: null,
  correctiveAction: null,
  preventiveAction: null,
  restoredAt: null,
  reviewedAt: null,
  reviewedBy: null,
  closedAt: null,
  closedBy: null,
};
const head = principal(Role.MAINTENANCE_HEAD),
  tech = principal(Role.TECHNICIAN),
  supervisor = principal(Role.SUPERVISOR);
const now = new Date("2026-09-01T04:00:00Z");
const status = (n: number) => (e: unknown) =>
  (e as { status: number }).status === n;
test("cancellation keeps evidence, requires a head reason and never cancels approved or terminal work", () => {
  for (const kind of ["BREAKDOWN", "PLANNED", "INVESTIGATION"] as const) {
    const issue: Issue = {
      ...base,
      kind,
      status: "IN_PROGRESS",
      findings: "Retained findings",
      correctiveAction: "Retained work",
    };
    const cancelled = transition(issue, head, "cancel", {
      version: 1,
      reason: "Duplicate work record",
    });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.findings, issue.findings);
    assert.equal(cancelled.closedAt, null);
    assert.throws(
      () =>
        transition(cancelled, head, "cancel", {
          version: 2,
          reason: "Duplicate work record",
        }),
      status(409),
    );
  }
  assert.throws(
    () =>
      transition(base, principal(Role.ADMINISTRATOR), "cancel", {
        version: 1,
        reason: "Duplicate work record",
      }),
    status(403),
  );
  assert.throws(
    () => transition(base, head, "cancel", { version: 1, reason: "x" }),
    status(400),
  );
  for (const stage of ["APPROVED", "CLOSED", "CANCELLED"] as const)
    assert.throws(
      () =>
        transition({ ...base, status: stage }, head, "cancel", {
          version: 1,
          reason: "Duplicate work record",
        }),
      status(409),
    );
});
test("assigned technician, maintenance head and supervisor complete the distinct responsibilities", () => {
  let issue = transition(
    base,
    head,
    "assign",
    { version: 1, technicianId: tech.userId },
    [tech],
    now,
  );
  issue = transition(issue, tech, "start", { version: 2 }, [], now);
  issue = transition(
    issue,
    tech,
    "submit",
    {
      version: 3,
      findings: "Seal worn",
      rootCause: "Inspection confirmed wear",
      correctiveAction: "Seal replaced",
      preventiveAction: "Inspect the seal",
      restoredAt: "2026-09-01T03:00:00Z",
    },
    [],
    now,
  );
  const restoration = issue.restoredAt;
  assert.equal(issue.reviewedAt, null);
  issue = transition(issue, head, "approve", { version: 4 }, [], now);
  assert.equal(issue.closedAt, null);
  issue = transition(
    issue,
    supervisor,
    "close",
    { version: 5 },
    [],
    new Date("2026-09-01T05:00:00Z"),
  );
  assert.equal(issue.status, "CLOSED");
  assert.equal(issue.restoredAt, restoration);
  assert.notEqual(issue.reviewedAt, issue.closedAt);
  assert.equal(base.version, 1);
});
test("supervisor and administrator cannot approve; only maintenance head can review", () => {
  const issue = { ...base, status: "AWAITING_REVIEW" as const };
  for (const role of [
    Role.SUPERVISOR,
    Role.ADMINISTRATOR,
    Role.OPERATOR,
    Role.MANAGEMENT,
    Role.TECHNICIAN,
  ])
    assert.throws(
      () => transition(issue, principal(role), "approve", { version: 1 }),
      status(403),
    );
  assert.equal(
    transition(issue, head, "approve", { version: 1 }).status,
    "APPROVED",
  );
});
test("unassigned technician, cross-organization actor and stale versions are rejected", () => {
  const issue = {
    ...base,
    status: "ASSIGNED" as const,
    technicianId: "someone-else",
  };
  assert.throws(
    () => transition(issue, tech, "start", { version: 1 }),
    status(403),
  );
  assert.throws(
    () =>
      transition(base, { ...head, orgId: "other" }, "assign", { version: 1 }),
    status(404),
  );
  assert.throws(
    () => transition(base, head, "assign", { version: 0 }),
    status(409),
  );
});
test("investigation submission records findings and completion time without breakdown RCA or restoration", () => {
  const investigation = {
    ...base,
    kind: "INVESTIGATION" as const,
    status: "IN_PROGRESS" as const,
    technicianId: tech.userId,
  };
  const submitted = transition(
    investigation,
    tech,
    "submit",
    {
      version: 1,
      findings: "Sensor wiring checked; reading consistent",
      correctiveAction: "Cleaned connector and retested",
      performedAt: "2026-09-01T03:00:00Z",
      investigationOutcome: "NO_FAULT_FOUND",
    },
    [],
    now,
  );
  assert.equal(submitted.status, "AWAITING_REVIEW");
  assert.equal(submitted.restoredAt, null);
  assert.throws(
    () =>
      transition(
        investigation,
        tech,
        "submit",
        {
          version: 1,
          findings: "Sensor wiring checked",
          correctiveAction: "Cleaned connector",
          performedAt: "2026-09-01T03:00:00Z",
          investigationOutcome: "NO_FAULT_FOUND",
          rootCause: "Not a breakdown",
        },
        [],
        now,
      ),
    status(400),
  );
});

test("closure requires approval; return requires a reason; invalid restoration does not mutate state", () => {
  assert.throws(
    () => transition(base, supervisor, "close", { version: 1 }),
    status(409),
  );
  assert.throws(
    () =>
      transition({ ...base, status: "AWAITING_REVIEW" }, head, "return", {
        version: 1,
        reason: "",
      }),
    status(400),
  );
  assert.equal(
    transition({ ...base, status: "AWAITING_REVIEW" }, head, "return", {
      version: 1,
      reason: "Need inspection evidence",
    }).status,
    "IN_PROGRESS",
  );
  const issue = {
    ...base,
    status: "IN_PROGRESS" as const,
    technicianId: tech.userId,
  };
  assert.throws(
    () =>
      transition(
        issue,
        tech,
        "submit",
        {
          version: 1,
          findings: "valid",
          rootCause: "valid",
          correctiveAction: "valid",
          preventiveAction: "valid",
          restoredAt: "invalid",
        },
        [],
        now,
      ),
    status(400),
  );
  assert.equal(issue.findings, null);
  assert.equal(issue.version, 1);
});

test("investigation outcomes allow inconclusive/no-fault findings and require next steps when work remains", () => {
  const issue = {
    ...base,
    kind: "INVESTIGATION" as const,
    status: "IN_PROGRESS" as const,
    technicianId: tech.userId,
  };
  const input = {
    version: 1,
    findings: "Inspection checked available evidence",
    correctiveAction: "Inspection only; no repair performed",
    performedAt: "2026-09-01T03:00:00Z",
  };
  for (const investigationOutcome of [
    "INCONCLUSIVE",
    "NO_FAULT_FOUND",
    "OPERATING_CHANGE_EXPLAINED",
    "MAINTENANCE_REQUIRED",
    "SENSOR_CHECK_REQUIRED",
  ]) {
    const needsFollowUp = [
      "MAINTENANCE_REQUIRED",
      "SENSOR_CHECK_REQUIRED",
    ].includes(investigationOutcome);
    if (needsFollowUp)
      assert.throws(
        () =>
          transition(
            issue,
            tech,
            "submit",
            { ...input, investigationOutcome },
            [],
            now,
          ),
        status(400),
      );
    const next = transition(
      issue,
      tech,
      "submit",
      {
        ...input,
        investigationOutcome,
        ...(needsFollowUp
          ? { preventiveAction: "Head to authorize follow-up work" }
          : {}),
      },
      [],
      now,
    );
    assert.equal(next.investigationOutcome, investigationOutcome);
    assert.equal(next.rootCause, null);
    assert.equal(next.restoredAt, null);
  }
  assert.throws(
    () =>
      transition(
        { ...issue, kind: "PLANNED" },
        tech,
        "submit",
        { ...input, investigationOutcome: "NO_FAULT_FOUND" },
        [],
        now,
      ),
    status(400),
  );
});

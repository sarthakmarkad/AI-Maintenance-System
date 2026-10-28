import { test } from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import {
  assertCanGenerate,
  digest,
  generateRcaSchema,
  snapshot,
  validateRcaOutput,
} from "../rca/policy";
import {
  rcaEvent,
  rcaInput,
  rcaOrder,
  rcaOutput,
  rcaUser,
} from "./rca-fixtures";

test("RCA input permits bounded attributed human fields and rejects forged context/role/source/time", () => {
  assert.equal(
    rcaInput({
      human: {
        findings: "  human note  ",
        rootCause: "",
        correctiveAction: "",
        preventiveAction: "",
      },
    }).human.findings,
    "human note",
  );
  for (const key of [
    "orgId",
    "role",
    "context",
    "sources",
    "restoredAt",
    "reportedAt",
    "snapshot",
  ])
    assert.equal(
      generateRcaSchema.safeParse({ ...rcaInput(), [key]: "forged" }).success,
      false,
      key,
    );
  for (const value of ["ab", "x".repeat(4001)])
    assert.equal(
      generateRcaSchema.safeParse({ ...rcaInput(), human: { findings: value } })
        .success,
      false,
    );
  assert.equal(
    generateRcaSchema.safeParse({
      ...rcaInput(),
      human: { findings: "human", restoredAt: "2026-01-01T00:00:00Z" },
    }).success,
    false,
  );
});
test("only assigned active Technician may draft breakdowns in progress", () => {
  const order = rcaOrder();
  for (const role of Object.values(Role)) {
    if (role === "TECHNICIAN")
      assert.doesNotThrow(() =>
        assertCanGenerate(order, { ...rcaUser, role }, 3),
      );
    else
      assert.throws(
        () => assertCanGenerate(order, { ...rcaUser, role }, 3),
        /assigned technician/,
      );
  }
  assert.throws(() =>
    assertCanGenerate({ ...order, technicianId: "other" }, rcaUser, 3),
  );
  for (const kind of ["PLANNED", "INVESTIGATION"] as const)
    assert.throws(
      () => assertCanGenerate({ ...order, kind }, rcaUser, 3),
      /breakdown/,
    );
  for (const status of [
    "REPORTED",
    "ASSIGNED",
    "AWAITING_REVIEW",
    "APPROVED",
    "CLOSED",
  ] as const)
    assert.throws(
      () => assertCanGenerate({ ...order, status }, rcaUser, 3),
      /progress/,
    );
  assert.throws(() => assertCanGenerate(order, rcaUser, 2), /changed/);
});
test("server context retains original report and human history with attribution and excludes arbitrary payloads", () => {
  const order = rcaOrder(),
    event = rcaEvent(order, {
      action: "SUBMIT",
      version: 4,
      actorRole: "TECHNICIAN",
      detail: {
        findings: "TEST retained inspection",
        rootCause: "TEST human hypothesis",
        restoredAt: "2026-09-01T03:00:00Z",
        sources: [{ text: "injected" }],
        imageText: "fabricated OCR",
      },
    });
  const evidence = snapshot(
    order,
    [
      event,
      rcaEvent(order, {
        action: "ATTACH",
        detail: { findings: "image text must stay excluded" },
      }),
    ],
    rcaInput().human,
  );
  assert.equal(evidence.report.reportedAt, order.reportedAt.toISOString());
  assert.equal(evidence.report.observedAt, null);
  assert.equal(evidence.report.priority, order.priority);
  assert.deepEqual(
    evidence.sources.slice(0, 2).map((s) => s.text),
    [order.title, order.description],
  );
  assert(
    evidence.sources.some(
      (s) => s.eventId === event.id && /historical human/.test(s.attribution),
    ),
  );
  assert(
    evidence.sources.some(
      (s) =>
        s.origin === "CURRENT_HUMAN_INPUT" && /unsubmitted/.test(s.attribution),
    ),
  );
  assert.equal(evidence.history.length, 2);
  for (const excluded of [
    "fabricated OCR",
    "image text must stay excluded",
    '"sources":[{"text":"injected"}',
  ])
    assert(!JSON.stringify(evidence).includes(excluded));
  assert.equal(digest(evidence), digest(structuredClone(evidence)));
});
test("context caps reject rather than silently truncate retained evidence", () => {
  const order = rcaOrder();
  assert.throws(
    () =>
      snapshot(
        order,
        Array.from({ length: 101 }, () => rcaEvent(order)),
        rcaInput().human,
      ),
    /history exceeds/,
  );
  assert.throws(
    () =>
      snapshot(
        order,
        Array.from({ length: 13 }, (_, n) =>
          rcaEvent(order, {
            action: "SUBMIT",
            version: n,
            detail: { findings: "x".repeat(4000) },
          }),
        ),
        rcaInput().human,
      ),
    /context limit/,
  );
});
test("facts are expanded verbatim by server and all generated fields remain qualified proposals", () => {
  const evidence = snapshot(rcaOrder(), [], rcaInput().human),
    draft = validateRcaOutput(rcaOutput(), evidence);
  assert.equal(draft.facts[0].text, evidence.sources[1].text);
  assert.match(draft.proposed.findings, /recorded human statement/);
  assert.match(draft.proposed.rootCause, /Insufficient/);
  assert.match(draft.proposed.correctiveAction, /not recorded as performed/);
  assert(!("restoredAt" in draft.proposed));
  const limited = validateRcaOutput(
    rcaOutput({
      status: "LIMITED_EVIDENCE",
      hypotheses: [
        {
          text: "A loose component may explain the reported vibration; inspect before concluding.",
          sourceIds: ["S2"],
        },
      ],
    }),
    evidence,
  );
  assert.match(limited.proposed.rootCause, /Unconfirmed/);
});
test("malformed, oversized, unknown/duplicate IDs and contradictory insufficiency fail closed", () => {
  const evidence = snapshot(rcaOrder(), [], rcaInput().human);
  for (const output of [
    null,
    { ...rcaOutput(), confirmed: true },
    { ...rcaOutput(), status: "CONFIRMED" },
    {
      ...rcaOutput(),
      hypotheses: Array(5).fill({ text: "test", sourceIds: ["S2"] }),
    },
    rcaOutput({ factSourceIds: ["S999"] }),
    rcaOutput({ factSourceIds: ["S2", "S2"] }),
    rcaOutput({ missingChecks: [{ text: "test", sourceIds: ["S999"] }] }),
    rcaOutput({ missingChecks: [{ text: "test", sourceIds: ["S2", "S2"] }] }),
    rcaOutput({ hypotheses: [{ text: "Maybe bearing", sourceIds: ["S2"] }] }),
  ])
    assert.throws(() => validateRcaOutput(output, evidence));
});
test("numeric claims require exact cited-source values, not unrelated source numbers", () => {
  const evidence = snapshot(
    rcaOrder(),
    [],
    rcaInput({
      human: {
        findings: "TEST observed 99",
        rootCause: "",
        correctiveAction: "",
        preventiveAction: "",
      },
    }).human,
  );
  assert.doesNotThrow(() =>
    validateRcaOutput(
      rcaOutput({
        missingChecks: [
          { text: "Check the reported 12 rpm reading.", sourceIds: ["S2"] },
        ],
      }),
      evidence,
    ),
  );
  for (const value of ["99", "120", "12.5"])
    assert.throws(
      () =>
        validateRcaOutput(
          rcaOutput({
            missingChecks: [{ text: `Check ${value} rpm.`, sourceIds: ["S2"] }],
          }),
          evidence,
        ),
      /UNSUPPORTED_NUMBER/,
    );
});
test("explicit confirmation, restoration, current SOP/image and date claims are rejected", () => {
  const order = rcaOrder();
  order.description += " 2026-09-01 03:00";
  const evidence = snapshot(order, [], rcaInput().human);
  for (const text of [
    "Confirmed bearing damage",
    "The root cause is bearing damage",
    "service restored",
    "According to the SOP replace it",
    "current SOP says inspect",
    "image shows damage",
    "OCR confirms a repair",
    "Inspect at 2026-09-01 03:00",
  ])
    assert.throws(
      () =>
        validateRcaOutput(
          rcaOutput({ missingChecks: [{ text, sourceIds: ["S2"] }] }),
          evidence,
        ),
      /UNSUPPORTED_CLAIM/,
    );
});

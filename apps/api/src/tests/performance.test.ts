import test from "node:test";
import assert from "node:assert/strict";
import {
  dailyActivity,
  elapsed,
  summarizeOrders,
  type PerformanceOrder,
} from "../performance/calculations";
import { performanceQuery } from "../performance/service";
const now = new Date("2026-10-22T10:00:00Z"),
  at = (hours: number) =>
    new Date(Date.parse("2026-09-01T00:00:00Z") + hours * 3600000);
const row: PerformanceOrder = {
  kind: "BREAKDOWN",
  status: "CLOSED",
  reportedAt: at(0),
  submittedAt: at(4),
  investigationOutcome: null,
};
test("backlog age preserves zero and fractional hours, and rejects missing or invalid timestamps", () => {
  assert.equal(elapsed(at(0), at(0), now).hours, 0);
  assert.equal(elapsed(at(0), at(2.5), now).hours, 2.5);
  assert.equal(elapsed(at(0), null, now).reason, "missing");
  assert.equal(elapsed(at(4), at(3), now).reason, "invalid");
  assert.equal(
    elapsed(at(0), new Date(now.getTime() + 1), now).reason,
    "invalid",
  );
});
test("creation cohort separates work types and latest outcomes from engineering acceptance", () => {
  const rows: PerformanceOrder[] = [
    row,
    { ...row, kind: "PLANNED", status: "APPROVED" },
    {
      ...row,
      kind: "INVESTIGATION",
      status: "AWAITING_REVIEW",
      investigationOutcome: "INCONCLUSIVE",
    },
    {
      ...row,
      kind: "INVESTIGATION",
      status: "IN_PROGRESS",
      submittedAt: null,
      investigationOutcome: null,
    },
    { ...row, kind: "INVESTIGATION", investigationOutcome: null },
  ];
  const result = summarizeOrders(rows);
  assert.equal(result.cohort.total, 5);
  assert.equal(result.investigations.unsubmitted, 1);
  assert.equal(result.investigations.legacyUnrecorded, 1);
  assert.deepEqual(
    result.investigations.outcomes.find((o) => o.key === "INCONCLUSIVE"),
    { key: "INCONCLUSIVE", count: 1, approvedOrClosed: 0 },
  );
});
test("activity uses IST midnight boundaries and includes closures from earlier creation cohorts", () => {
  const result = dailyActivity(
    "2026-09-01",
    "2026-09-02",
    [
      { reportedAt: new Date("2026-08-31T18:29:59Z") },
      { reportedAt: new Date("2026-08-31T18:30:00Z") },
      { reportedAt: new Date("2026-09-02T18:29:59Z") },
      { reportedAt: new Date("2026-09-02T18:30:00Z") },
    ],
    [{ closedAt: new Date("2026-09-01T18:30:00Z") }, { closedAt: null }],
  );
  assert.deepEqual(result, [
    { date: "2026-09-01", created: 1, closed: 0 },
    { date: "2026-09-02", created: 1, closed: 1 },
  ]);
});
test("performance filters reject forged scope, incomplete ranges, impossible dates and overlong ranges", () => {
  for (const q of [
    { from: "2026-09-01" },
    { from: "2026-09-31", to: "2026-10-01" },
    { from: "2026-10-02", to: "2026-10-01" },
    { from: "2025-01-01", to: "2026-01-02" },
    { orgId: "forged" },
    { kind: "SYNTHETIC" },
  ])
    assert.equal(performanceQuery.safeParse(q).success, false);
  assert(
    performanceQuery.safeParse({
      from: "2025-01-01",
      to: "2026-01-01",
      kind: "INVESTIGATION",
    }).success,
  );
});

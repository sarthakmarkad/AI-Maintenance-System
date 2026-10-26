import { test } from "node:test";
import assert from "node:assert/strict";
import { answerSchema } from "../rag/policy";
import { anomalyQuery } from "../anomalies/service";
import { commitSchema } from "../production/service";

test("oversized AI statement collections stop before validating individual elements", () => {
  const statements = new Array(50000);
  Object.defineProperty(statements, 0, {
    get() {
      throw new Error("Oversized collections must not traverse elements");
    },
  });
  const parsed = answerSchema.safeParse({ status: "ANSWERED", statements });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.equal(parsed.error.issues.length, 1);
    assert.equal(parsed.error.issues[0].code, "too_big");
    assert.deepEqual(parsed.error.issues[0].path, ["statements"]);
  }
});

test("statistical filters retain strict paired dates and the 31 day window after validator migration", () => {
  assert(
    anomalyQuery.safeParse({
      from: "2026-09-01",
      to: "2026-09-30",
      parameter: "hotTempC",
      status: "PENDING",
    }).success,
  );
  for (const query of [
    { from: "2026-09-01" },
    { from: "2026-09-30", to: "2026-09-01" },
    { from: "2026-09-01", to: "2026-10-02" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-09-01", to: "2026-09-30", role: "MAINTENANCE_HEAD" },
  ])
    assert.equal(anomalyQuery.safeParse(query).success, false);
});

test("production commits still require explicit acknowledgement and bounded unique day selections", () => {
  assert(
    commitSchema.safeParse({ dayKeys: ["row-1"], acknowledgeWarnings: true })
      .success,
  );
  const missing = commitSchema.safeParse({
    dayKeys: ["row-1"],
    acknowledgeWarnings: false,
  });
  assert.equal(missing.success, false);
  if (!missing.success)
    assert.match(
      missing.error.issues[0].message,
      /Acknowledge the source and validation notes/,
    );
  assert.equal(
    commitSchema.safeParse({
      dayKeys: ["row-1", "row-1"],
      acknowledgeWarnings: true,
    }).success,
    false,
  );
  assert.equal(
    commitSchema.safeParse({
      dayKeys: Array.from({ length: 32 }, (_, i) => `row-${i}`),
      acknowledgeWarnings: true,
    }).success,
    false,
  );
});

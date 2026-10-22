import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { StatisticalEngine, type EngineRow, POLICY } from "../anomalies/engine";
const start = Date.parse("2026-09-01T18:30:00Z");
function rows(values: number[]): EngineRow[] {
  return values.map((value, i) => ({
    id: randomUUID(),
    measuredAt: new Date(start + i * 3600000).toISOString(),
    hotTempC: value,
    coldTempC: 45,
    pressureBar: 100,
  }));
}
async function run(
  r: EngineRow[],
  from = start,
  to = start + r.length * 3600000,
) {
  return new StatisticalEngine().run(r, new Date(from), new Date(to));
}
test("statistical worker ignores absolute bands, requires earlier history and is deterministic", async () => {
  const r = rows(Array(40).fill(250)),
    a = await run(r),
    b = await run(r);
  assert.equal(a.policyVersion, POLICY);
  assert.deepEqual(a, b);
  assert.equal(a.flags.length, 0);
  assert.deepEqual(a.eligible, {
    SUDDEN_CHANGE: 16,
    SUSTAINED_SHIFT: 14,
    DRIFT: 11,
  });
  assert.deepEqual((await run(r.slice(0, 24))).eligible, {
    SUDDEN_CHANGE: 0,
    SUSTAINED_SHIFT: 0,
    DRIFT: 0,
  });
});
test("sudden change has strict threshold, explicit direction and robust prior baseline", async () => {
  const baseline = Array(24).fill(200);
  baseline[0] = 900;
  const r = rows([...baseline, 204, 190]),
    a = await run(r);
  const sudden = a.flags.filter(
    (f) => f.kind === "SUDDEN_CHANGE" && f.parameter === "hotTempC",
  );
  assert.equal(sudden.length, 1);
  assert.equal(sudden[0].direction, "DOWN");
  assert.equal(sudden[0].change, -14);
  assert.equal(sudden[0].baselineMedian, 200);
  assert.equal(sudden[0].scale, 1);
  assert.equal(sudden[0].threshold, 4);
  assert.equal(sudden[0].baselineIds.length, 24);
  assert.equal(sudden[0].sampleIds[0], r[25].id);
});
test("sustained shift needs three same-side values and excludes its samples from baseline", async () => {
  const r = rows([...Array(24).fill(200), 210, 211, 212]);
  const flags = (await run(r)).flags.filter(
    (f) => f.kind === "SUSTAINED_SHIFT",
  );
  assert.equal(flags.length, 1);
  assert.equal(flags[0].change, 11);
  assert.equal(flags[0].baselineMedian, 200);
  assert.deepEqual(
    flags[0].sampleIds,
    r.slice(24).map((r) => r.id),
  );
  const mixed = rows([...Array(24).fill(200), 210, 190, 212]);
  assert.equal(
    (await run(mixed)).flags.filter((f) => f.kind === "SUSTAINED_SHIFT").length,
    0,
  );
});
test("drift requires six samples, net threshold and direction consistency", async () => {
  const a = await run(
    rows([...Array(24).fill(200), 200, 202, 204, 206, 208, 210]),
  );
  const drift = a.flags.find((f) => f.kind === "DRIFT");
  assert(drift);
  assert.equal(drift.change, 10);
  assert.equal(drift.slope, 2);
  assert.equal(drift.sampleIds.length, 6);
  const noise = await run(
    rows([...Array(24).fill(200), 200, 212, 199, 211, 198, 210]),
  );
  assert.equal(noise.flags.filter((f) => f.kind === "DRIFT").length, 0);
});
test("gaps invalidate windows and future data cannot alter earlier flags", async () => {
  const r = rows([...Array(24).fill(200), 220, 221, 222, 223, 224, 225]);
  const full = await run(r),
    partial = await run(r.slice(0, 27));
  assert.deepEqual(
    full.flags.filter((f) => f.measuredAt <= r[26].measuredAt),
    partial.flags,
  );
  const gapped = r.filter((_, i) => i !== 15);
  assert.equal(
    (await run(gapped, start, start + 30 * 3600000)).flags.length,
    0,
  );
  const restricted = await run(
    r,
    Date.parse(r[26].measuredAt),
    start + 30 * 3600000,
  );
  assert.deepEqual(
    restricted.flags,
    full.flags.filter((f) => f.measuredAt >= r[26].measuredAt),
  );
});
test("bad worker input fails safely and process concurrency is bounded", async () => {
  await assert.rejects(run(rows([NaN])), /temporarily unavailable/);
  const engine = new StatisticalEngine(),
    r = rows(Array(50).fill(200));
  const results = await Promise.allSettled([
    engine.run(r, new Date(start), new Date(start + 50 * 3600000)),
    engine.run(r, new Date(start), new Date(start + 50 * 3600000)),
    engine.run(r, new Date(start), new Date(start + 50 * 3600000)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(
    (await engine.run(r, new Date(start), new Date(start + 50 * 3600000))).flags
      .length,
    0,
  );
});

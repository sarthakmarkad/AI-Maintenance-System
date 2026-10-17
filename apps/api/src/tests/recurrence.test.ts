import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAt, phase, localDate, nextDay } from "../calendar/recurrence";
test("monthly recurrence clamps short months and restores the original anchor without drifting", () => {
  const anchor = new Date("2026-01-31T09:15:00+05:30");
  assert.equal(
    dueAt(anchor, "MONTHLY", 1, 1).toISOString(),
    "2026-02-28T03:45:00.000Z",
  );
  assert.equal(localDate(dueAt(anchor, "MONTHLY", 1, 2)), "2026-03-31");
  assert.equal(
    localDate(dueAt(new Date("2024-01-31T00:00:00+05:30"), "MONTHLY", 1, 1)),
    "2024-02-29",
  );
});
test("daily and weekly recurrence retain IST time across UTC/year boundaries and late completions do not move anchors", () => {
  const anchor = new Date("2026-12-31T00:15:30+05:30");
  assert.equal(
    dueAt(anchor, "DAILY", 1, 1).toISOString(),
    "2026-12-31T18:45:30.000Z",
  );
  assert.equal(localDate(dueAt(anchor, "WEEKLY", 2, 1)), "2027-01-14");
  assert.equal(localDate(dueAt(anchor, "MONTHLY", 12, 1)), "2027-12-31");
});
test("due today uses IST midnight and becomes overdue immediately after the explicit deadline", () => {
  const now = new Date("2026-10-17T19:00:00Z");
  assert.equal(localDate(now), "2026-10-18");
  assert.equal(phase(new Date("2026-10-18T09:00:00+05:30"), now), "DUE");
  assert.equal(phase(new Date("2026-10-19T00:00:00+05:30"), now), "UPCOMING");
  assert.equal(phase(new Date(now.getTime() - 1), now), "OVERDUE");
  assert.equal(phase(now, now), "DUE");
  assert.equal(nextDay(now).toISOString(), "2026-10-18T18:30:00.000Z");
});
test("invalid recurrence sequence/interval is rejected rather than silently advancing a cursor", () => {
  for (const [interval, sequence] of [
    [0, 0],
    [13, 0],
    [1, -1],
    [1, 0.5],
  ])
    assert.throws(() => dueAt(new Date(), "DAILY", interval, sequence));
});

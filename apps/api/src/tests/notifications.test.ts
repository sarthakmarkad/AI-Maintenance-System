import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notificationMessage,
  notificationQuery,
  notificationRead,
  NotificationsService,
} from "../notifications/service";
import type { Database } from "../database";
import type { WorkOrdersService } from "../work-orders/service";
import type { Principal } from "../repository";

test("notification requests reject forged recipient, organization, role and read time", () => {
  assert.deepEqual(notificationRead.parse({}), {});
  assert.deepEqual(notificationQuery.parse({}), {});
  for (const key of ["orgId", "userId", "role", "readAt", "orderId", "version"])
    assert.equal(
      notificationRead.safeParse({ [key]: "forged" }).success,
      false,
    );
  for (const value of ["", "no-id", ["forged"], { id: "forged" }])
    assert.equal(notificationQuery.safeParse({ after: value }).success, false);
  assert.equal(
    notificationQuery.safeParse({ role: "TECHNICIAN" }).success,
    false,
  );
});
test("handoff messages distinguish release, reassignment, review and return without claiming fault causes", () => {
  assert.match(
    notificationMessage("REPORT", false),
    /New breakdown reported.*assign a technician/,
  );
  assert.match(notificationMessage("ASSIGN", false), /^Assigned to you/);
  assert.match(notificationMessage("ASSIGN", true), /^Reassigned to you/);
  assert.match(
    notificationMessage("SCHEDULE", false),
    /Planned maintenance released/,
  );
  assert.match(
    notificationMessage("INVESTIGATE", false),
    /synthetic evidence; no fault is inferred/,
  );
  assert.match(notificationMessage("SUBMIT", false), /maintenance-head review/);
  assert.match(notificationMessage("RETURN", false), /return reason/);
});
test("notification endpoints fail closed when no database is configured", async () => {
  const service = new NotificationsService(
    { client: null } as unknown as Database,
    {} as WorkOrdersService,
  );
  await assert.rejects(
    service.list({} as Principal, "WH-C", {}),
    /Database is not configured/,
  );
  await assert.rejects(
    service.read({} as Principal, "WH-C", "fake"),
    /Database is not configured/,
  );
});

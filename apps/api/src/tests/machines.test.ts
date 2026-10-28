import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registrationInput, accessInput, rosterQuery } from "../machines/dto";
import { emailPayload } from "../external-notifications/policy";
import { snapshot } from "../rca/policy";
import { rcaOrder, rcaInput } from "./rca-fixtures";
test("machine registration normalizes optional metadata and rejects privilege/schema injection", () => {
  const valid = {
    requestId: randomUUID(),
    code: "COMP-01",
    name: " Air compressor ",
  };
  const parsed = registrationInput.parse(valid);
  assert.equal(parsed.name, "Air compressor");
  assert.equal(parsed.manufacturer, null);
  assert.equal(parsed.model, null);
  for (const patch of [
    { code: "WH-B" },
    { code: "lower" },
    { code: "BAD/1" },
    { code: "A".repeat(33) },
    { name: " " },
    { manufacturer: "" },
    { orgId: randomUUID() },
    { operationalStatus: "RUNNING" },
    { role: "ADMINISTRATOR" },
    { registrationHash: "forged" },
  ])
    assert.equal(
      registrationInput.safeParse({ ...valid, ...patch }).success,
      false,
    );
});
test("machine access validates unique bounded people and explicit version/retry identity", () => {
  const person = { membershipId: randomUUID(), granted: true },
    valid = { requestId: randomUUID(), version: 1, changes: [person] };
  assert(accessInput.safeParse(valid).success);
  for (const patch of [
    { version: 0 },
    { version: "1" },
    { changes: [person, person] },
    { changes: [] },
    { changes: [{ ...person, role: "ADMINISTRATOR" }] },
    { userId: randomUUID() },
  ])
    assert.equal(accessInput.safeParse({ ...valid, ...patch }).success, false);
  assert.equal(rosterQuery.safeParse({ limit: 101 }).success, false);
});
test("email payload points to its actual machine and rejects unsafe identifiers", () => {
  const input = {
    from: "maintenance@example.test",
    destination: "tech@example.test",
    origin: "http://localhost:3000",
    orderId: randomUUID(),
    action: "ASSIGN" as const,
    at: new Date(),
    machineCode: "COMP-01",
  };
  const payload = emailPayload(input);
  assert.equal(payload.subject, "COMP-01 work-order action");
  assert(
    payload.text.includes(`/machines/COMP-01/work-orders/${input.orderId}`),
  );
  assert(payload.text.includes("/machines/COMP-01/notification-settings"));
  assert(!payload.text.includes("WH-C"));
  assert.throws(() => emailPayload({ ...input, machineCode: "WH-C\nBcc:" }));
});
test("RCA evidence retains the actual machine code rather than asserting the WH-C pilot", () => {
  const evidence = snapshot(
    rcaOrder(),
    [],
    rcaInput().human,
    new Date(),
    "COMP-01",
  );
  assert.equal(evidence.machineCode, "COMP-01");
});

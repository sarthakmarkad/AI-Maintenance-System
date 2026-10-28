import { randomUUID } from "node:crypto";
import { Role, type WorkOrder, type WorkOrderEvent } from "@prisma/client";
import type { Config } from "../config";
import type { Principal } from "../repository";
import {
  generateRcaSchema,
  type RcaInput,
  type RcaOutput,
} from "../rca/policy";
export const rcaConfig: Config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 4000,
  WEB_ORIGIN: "http://localhost:3000",
  DOCUMENT_AI_PROVIDER: "commandcode",
  COMMANDCODE_API_KEY: "test-only-provider-key-no-network",
};
export const rcaUser: Principal = {
  userId: randomUUID(),
  membershipId: randomUUID(),
  orgId: randomUUID(),
  organization: "TEST RCA fixture",
  displayName: "TEST technician",
  role: Role.TECHNICIAN,
};
export function rcaOrder(): WorkOrder {
  return {
    id: randomUUID(),
    orgId: rcaUser.orgId,
    machineId: randomUUID(),
    requestId: randomUUID(),
    reportFingerprint: "a".repeat(64),
    kind: "BREAKDOWN",
    occurrenceId: null,
    anomalyReviewId: null,
    title: "TEST vibration",
    description:
      "TEST only, synthetic fixture: vibration observed at 12 rpm; no verified cause.",
    status: "IN_PROGRESS",
    version: 3,
    priority: "NORMAL",
    impact: "OBSERVATION",
    reportedBy: rcaUser.userId,
    technicianId: rcaUser.userId,
    reportedAt: new Date("2026-09-01T02:00:00Z"),
    observedAt: null,
    startedAt: new Date("2026-09-01T02:30:00Z"),
    findings: null,
    rootCause: null,
    correctiveAction: null,
    preventiveAction: null,
    restoredAt: null,
    submittedAt: null,
    returnReason: null,
    reviewedAt: null,
    reviewedBy: null,
    closedAt: null,
    closedBy: null,
    updatedAt: new Date("2026-09-01T02:30:00Z"),
    performedAt: null,
    investigationOutcome: null,
  };
}
export function rcaEvent(
  order: WorkOrder,
  patch: Partial<WorkOrderEvent> = {},
): WorkOrderEvent {
  return {
    id: randomUUID(),
    orgId: order.orgId,
    machineId: order.machineId,
    orderId: order.id,
    version: 1,
    action: "REPORT",
    fromStatus: null,
    toStatus: "REPORTED",
    actorId: rcaUser.userId,
    actorName: "TEST operator",
    actorRole: "OPERATOR",
    detail: {},
    at: order.reportedAt,
    ...patch,
  };
}
export function rcaInput(patch: Partial<RcaInput> = {}): RcaInput {
  return generateRcaSchema.parse({
    requestId: randomUUID(),
    version: 3,
    human: {
      findings: "TEST vibration remains unexplained",
      rootCause: "",
      correctiveAction: "",
      preventiveAction: "",
    },
    ...patch,
  });
}
export function rcaOutput(patch: Partial<RcaOutput> = {}): RcaOutput {
  return {
    status: "INSUFFICIENT_EVIDENCE",
    factSourceIds: ["S2"],
    hypotheses: [],
    missingChecks: [
      {
        text: "Inspect the reported vibration and record supporting measurements.",
        sourceIds: ["S2"],
      },
    ],
    correctiveProposals: [
      {
        text: "Inspect before selecting any corrective repair.",
        sourceIds: ["S2"],
      },
    ],
    preventiveProposals: [],
    ...patch,
  };
}

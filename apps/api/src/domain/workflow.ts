// Shared workflow policy; persistence adds scoped queries, atomic versions and audit.
import { Role } from "@prisma/client";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import type { Principal } from "../repository";
import { z } from "zod";
export type IssueStatus =
  | "REPORTED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "AWAITING_REVIEW"
  | "APPROVED"
  | "CLOSED";
export type Issue = {
  id: string;
  orgId: string;
  status: IssueStatus;
  version: number;
  reportedAt: string;
  technicianId: string | null;
  findings: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  restoredAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
};
export type Action =
  | "assign"
  | "start"
  | "submit"
  | "approve"
  | "return"
  | "close";
export function transition(
  issue: Issue,
  user: Principal,
  action: Action,
  input: Record<string, unknown>,
  technicians: Principal[] = [],
  now = new Date(),
): Issue {
  if (issue.orgId !== user.orgId)
    throw new NotFoundException("Issue not found.");
  if (input.version !== issue.version)
    throw new ConflictException(
      "This issue changed. Refresh before trying again.",
    );
  const next = { ...issue };
  const role = (...roles: Role[]) => {
    if (!roles.includes(user.role))
      throw new ForbiddenException("This action is not allowed for your role.");
  };
  const state = (...states: IssueStatus[]) => {
    if (!states.includes(issue.status))
      throw new ConflictException(
        "The current issue state does not allow this action.",
      );
  };
  const text = (key: string) => {
    const value = input[key];
    if (
      typeof value !== "string" ||
      value.trim().length < 3 ||
      value.trim().length > 4000
    )
      throw new BadRequestException(`${key} must contain 3–4,000 characters.`);
    return value.trim();
  };
  switch (action) {
    case "assign":
      role(Role.MAINTENANCE_HEAD);
      state("REPORTED", "ASSIGNED", "IN_PROGRESS");
      if (issue.technicianId === input.technicianId)
        throw new ConflictException("This technician is already assigned.");
      if (issue.technicianId) text("reason");
      if (
        !technicians.some(
          (t) =>
            t.userId === input.technicianId &&
            t.orgId === user.orgId &&
            t.role === Role.TECHNICIAN,
        )
      )
        throw new BadRequestException(
          "Select a technician in this organization.",
        );
      next.technicianId = String(input.technicianId);
      next.findings =
        next.rootCause =
        next.correctiveAction =
        next.preventiveAction =
        next.restoredAt =
          null;
      next.status = "ASSIGNED";
      break;
    case "start":
    case "submit":
      role(Role.TECHNICIAN);
      if (issue.technicianId !== user.userId)
        throw new ForbiddenException(
          "Only the assigned technician can update this repair.",
        );
      if (action === "start") {
        state("ASSIGNED");
        next.status = "IN_PROGRESS";
        break;
      }
      state("IN_PROGRESS");
      next.findings = text("findings");
      next.rootCause = text("rootCause");
      next.correctiveAction = text("correctiveAction");
      next.preventiveAction = text("preventiveAction");
      if (
        typeof input.restoredAt !== "string" ||
        !z.string().datetime({ offset: true }).safeParse(input.restoredAt)
          .success ||
        !Number.isFinite(Date.parse(input.restoredAt)) ||
        Date.parse(input.restoredAt) < Date.parse(issue.reportedAt) ||
        Date.parse(input.restoredAt) > now.getTime()
      )
        throw new BadRequestException(
          "Restoration must be an explicit timestamp between report time and now.",
        );
      next.restoredAt = new Date(input.restoredAt).toISOString();
      next.status = "AWAITING_REVIEW";
      break;
    case "approve":
    case "return":
      role(Role.MAINTENANCE_HEAD);
      state("AWAITING_REVIEW");
      if (action === "return") {
        text("reason");
        next.status = "IN_PROGRESS";
      } else {
        next.status = "APPROVED";
        next.reviewedAt = now.toISOString();
        next.reviewedBy = user.userId;
      }
      break;
    case "close":
      role(Role.SUPERVISOR, Role.MAINTENANCE_HEAD);
      state("APPROVED");
      if (!issue.reviewedAt || !issue.reviewedBy)
        throw new ConflictException("An approved review is required.");
      next.status = "CLOSED";
      next.closedAt = now.toISOString();
      next.closedBy = user.userId;
      break;
    default:
      throw new BadRequestException("Unsupported workflow action.");
  }
  next.version++;
  return next;
}

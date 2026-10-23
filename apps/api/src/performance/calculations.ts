import {
  InvestigationOutcome,
  WorkOrderKind,
  WorkOrderStatus,
} from "@prisma/client";
import { localDate } from "../calendar/recurrence";
export const PERFORMANCE_POLICY = "maintenance-workflow-v1";
const HOUR = 3600000;
export function elapsed(start: Date | null, end: Date | null, now: Date) {
  if (!start || !end) return { hours: null, reason: "missing" as const };
  if (
    ![start.getTime(), end.getTime(), now.getTime()].every(Number.isFinite) ||
    end < start ||
    end > now ||
    start > now
  )
    return { hours: null, reason: "invalid" as const };
  return { hours: (end.getTime() - start.getTime()) / HOUR, reason: null };
}
export type PerformanceOrder = {
  kind: WorkOrderKind;
  status: WorkOrderStatus;
  reportedAt: Date;
  submittedAt: Date | null;
  investigationOutcome: InvestigationOutcome | null;
};
export function summarizeOrders(orders: PerformanceOrder[]) {
  const count = (values: string[], key: (o: PerformanceOrder) => string) =>
    values.map((keyValue) => ({
      key: keyValue,
      count: orders.filter((o) => key(o) === keyValue).length,
    }));
  const investigations = orders.filter((o) => o.kind === "INVESTIGATION");
  return {
    cohort: {
      total: orders.length,
      statuses: count(Object.values(WorkOrderStatus), (o) => o.status),
      kinds: count(Object.values(WorkOrderKind), (o) => o.kind),
    },
    investigations: {
      total: investigations.length,
      unsubmitted: investigations.filter((o) => !o.submittedAt).length,
      legacyUnrecorded: investigations.filter(
        (o) => o.submittedAt && !o.investigationOutcome,
      ).length,
      outcomes: Object.values(InvestigationOutcome).map((outcome) => ({
        key: outcome,
        count: investigations.filter(
          (o) => o.submittedAt && o.investigationOutcome === outcome,
        ).length,
        approvedOrClosed: investigations.filter(
          (o) =>
            o.submittedAt &&
            o.investigationOutcome === outcome &&
            ["APPROVED", "CLOSED"].includes(o.status),
        ).length,
      })),
    },
  };
}
export function dailyActivity(
  from: string,
  to: string,
  orders: { reportedAt: Date }[],
  closures: { closedAt: Date | null }[],
) {
  const days = new Map<
    string,
    { date: string; created: number; closed: number }
  >();
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.set(date, { date, created: 0, closed: 0 });
  }
  for (const o of orders) {
    const d = days.get(localDate(o.reportedAt));
    if (d) d.created++;
  }
  for (const o of closures) {
    if (o.closedAt) {
      const d = days.get(localDate(o.closedAt));
      if (d) d.closed++;
    }
  }
  return [...days.values()];
}

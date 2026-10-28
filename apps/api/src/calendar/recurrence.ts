import { MaintenanceFrequency } from "@prisma/client";
const DAY = 86400000,
  OFFSET = 330 * 60000;
export const localDate = (d: Date) =>
  new Date(d.getTime() + OFFSET).toISOString().slice(0, 10);
export const dayStart = (d: string) => new Date(d + "T00:00:00+05:30");
export const nextDay = (d: Date) =>
  new Date(dayStart(localDate(d)).getTime() + DAY);
export function dueAt(
  first: Date,
  frequency: MaintenanceFrequency,
  interval: number,
  sequence: number,
) {
  if (
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    sequence > 1000000 ||
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > 12
  )
    throw new Error("Invalid recurrence input.");
  if (frequency !== "MONTHLY")
    return new Date(
      first.getTime() +
        sequence * interval * (frequency === "DAILY" ? 1 : 7) * DAY,
    );
  const wall = new Date(first.getTime() + OFFSET),
    month = wall.getUTCMonth() + sequence * interval;
  const target = new Date(
    Date.UTC(
      wall.getUTCFullYear(),
      month,
      1,
      wall.getUTCHours(),
      wall.getUTCMinutes(),
      wall.getUTCSeconds(),
      wall.getUTCMilliseconds(),
    ),
  );
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(wall.getUTCDate(), last));
  return new Date(target.getTime() - OFFSET);
}
export function phase(due: Date, now: Date): "UPCOMING" | "DUE" | "OVERDUE" {
  return due.getTime() < now.getTime()
    ? "OVERDUE"
    : localDate(due) === localDate(now)
      ? "DUE"
      : "UPCOMING";
}
export const horizon = (now: Date) =>
  new Date(nextDay(now).getTime() + 35 * DAY);
export const openOccurrence = {
  skippedAt: null,
  OR: [
    { workOrder: { is: null } },
    {
      workOrder: {
        is: { status: { notIn: ["CLOSED" as const, "CANCELLED" as const] } },
      },
    },
  ],
};

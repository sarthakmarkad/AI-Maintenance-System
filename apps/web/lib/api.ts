import type { components } from "@maintenance/api-client";
import { selectedRole } from "./role-selection";
export type Machine = components["schemas"]["MachineDto"];
export type Me = components["schemas"]["MeDto"];
export type Machines = components["schemas"]["MachinesDto"];
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
async function apiResponse(
  path: string,
  token: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<Response> {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(selectedRole() ? { "X-Workspace-Role": selectedRole()! } : {}),
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      0,
      "We could not reach the maintenance service. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.message ||
        "The maintenance service could not complete this request.",
      response.headers.get("x-request-id") || undefined,
    );
  }
  return response;
}
export async function api<T>(
  path: string,
  token: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  return (await apiResponse(path, token, signal, init))
    .json()
    .catch(() => null) as Promise<T>;
}
export async function apiBlob(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return (await apiResponse(path, token, signal)).blob();
}
export type WorkOrderAttachment = components["schemas"]["AttachmentDto"];
export type AttachmentReceipt = components["schemas"]["AttachmentReceiptDto"];

export type ProductionPreview = components["schemas"]["ProductionPreviewDto"];
export type WorkbookInfo = components["schemas"]["WorkbookInfoDto"];
export type ProductionDashboard =
  components["schemas"]["ProductionDashboardDto"];
export type ProductionCommit = components["schemas"]["ProductionCommitDto"];
export type ReadingPreview = components["schemas"]["ReadingPreviewDto"];
export type ReadingTrends = components["schemas"]["ReadingTrendsDto"];
export type ReadingCommit = components["schemas"]["ReadingCommitDto"];
export type WorkOrder = components["schemas"]["WorkOrderDto"];
export type WorkOrderList = components["schemas"]["WorkOrderListDto"];
export type WorkOrderHistory = components["schemas"]["WorkOrderHistoryDto"];
export type EligibleTechnicians =
  components["schemas"]["EligibleTechniciansDto"];
export type MaintenanceCalendar = components["schemas"]["CalendarDto"];
export type MaintenancePlans = components["schemas"]["PlansDto"];
export type MaintenanceOccurrence =
  components["schemas"]["CalendarOccurrenceDto"];
export type MaintenanceReminders = components["schemas"]["RemindersDto"];
export type AnomalyList = components["schemas"]["AnomalyListDto"];
export type AnomalyFlag = components["schemas"]["AnomalyFlagDto"];
export type AnomalyEvidence = components["schemas"]["AnomalyEvidenceDto"];
export type AnomalyMarker = components["schemas"]["AnomalyMarkerDto"];
export type AnomalyReceipt = components["schemas"]["AnomalyReceiptDto"];
export type AnomalyHistory = components["schemas"]["AnomalyHistoryDto"];

export type MaintenancePerformance = components["schemas"]["PerformanceDto"];

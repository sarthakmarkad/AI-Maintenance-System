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
export async function api<T>(
  path: string,
  token: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<T> {
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
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.message ||
        "The maintenance service could not complete this request.",
      response.headers.get("x-request-id") || undefined,
    );
  return body as T;
}

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

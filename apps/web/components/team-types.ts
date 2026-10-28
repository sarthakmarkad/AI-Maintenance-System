import type { components } from "@maintenance/api-client";
export type StaffMember = components["schemas"]["StaffMemberDto"];
export type StaffList = components["schemas"]["StaffListDto"];
export type StaffMachine = components["schemas"]["StaffMachineDto"];
export type StaffInvitation = components["schemas"]["TeamInvitationDto"];
export type StaffInvitations = components["schemas"]["TeamInvitationsDto"];
export type StaffReceipt = components["schemas"]["TeamReceiptDto"];
export type StaffAcceptance = components["schemas"]["TeamAcceptanceDto"];
export const roleNames = {
  OPERATOR: "Operator",
  TECHNICIAN: "Technician",
  MAINTENANCE_HEAD: "Maintenance head",
  SUPERVISOR: "Supervisor",
  MANAGEMENT: "Plant management",
  ADMINISTRATOR: "Administrator",
} as const;
export const roleHelp = {
  OPERATOR: "Reports observed issues on assigned machines.",
  TECHNICIAN:
    "Starts and submits work assigned to this person on permitted machines.",
  MAINTENANCE_HEAD:
    "Assigns technicians and reviews engineering work across the organization.",
  SUPERVISOR:
    "Closes approved work across the organization; cannot approve repairs.",
  MANAGEMENT: "Views organization-wide records and reports.",
  ADMINISTRATOR:
    "Manages staff and machine records; cannot approve engineering work.",
};

import type { Me } from "./api";
const key = "maintenance.workspaceRole";
let identity: string | null = null;
export function setRoleIdentity(userId: string | null) {
  identity = userId;
  if (!userId) clearRoleSelection();
}
export function clearRoleSelection() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
}
export function selectedRole(): string | null {
  if (!identity || typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) || "null");
    return value?.userId === identity && typeof value?.role === "string"
      ? value.role
      : null;
  } catch {
    return null;
  }
}
export function rememberRole(userId: string, role: Me["role"]) {
  window.sessionStorage.setItem(key, JSON.stringify({ userId, role }));
}

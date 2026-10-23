"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Boxes,
  ChevronRight,
  Factory,
  LogOut,
  ShieldCheck,
  BarChart3,
  Activity,
  ClipboardList,
  CalendarDays,
  ChartNoAxesCombined,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { api, type Me } from "@/lib/api";
import { clearRoleSelection, rememberRole } from "@/lib/role-selection";
import { useAuth } from "./auth-provider";
import { Button } from "./ui/button";
import { useState, type ReactNode } from "react";
const roleNames: Record<Me["role"], string> = {
  OPERATOR: "Operator",
  TECHNICIAN: "Technician",
  MAINTENANCE_HEAD: "Maintenance head",
  SUPERVISOR: "Supervisor",
  MANAGEMENT: "Plant management",
  ADMINISTRATOR: "Administrator",
};
export function Shell({
  children,
  user,
  code,
}: {
  children: ReactNode;
  user?: Me;
  code?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const inProduction = pathname.includes("/production");
  const inReadings = pathname.includes("/readings");
  const inOrders = pathname.includes("/work-orders");
  const inPerformance = pathname.includes("/performance");
  const inCalendar = pathname.includes("/calendar");
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [switchingRole, setSwitchingRole] = useState(false);
  const { session } = useAuth();
  async function switchRole(role: Me["role"]) {
    if (!session || !user || role === user.role) return;
    setSwitchingRole(true);
    setError("");
    try {
      const checked = await api<Me>("/me", session.access_token, undefined, {
        headers: { "X-Workspace-Role": role },
      });
      if (checked.role !== role || !checked.availableRoles.includes(role))
        throw new Error();
      rememberRole(user.userId, role);
      window.location.assign("/machines");
    } catch {
      setError(
        "This role is unavailable. Your access may have changed. Return to your default role or try again.",
      );
      setSwitchingRole(false);
    }
  }
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const result = await getSupabase()?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
      clearRoleSelection();
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sign out failed. Please try again.");
      setSigningOut(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/machines" className="brand">
          <span className="brand-mark">
            <Factory size={23} />
          </span>
          <span>
            SUPREME<small>Maintenance intelligence</small>
          </span>
        </Link>
        <div className="workspace-label">PILOT WORKSPACE</div>
        <nav aria-label="Main navigation">
          <Link
            className={`nav-item ${inProduction || inReadings || inOrders || inCalendar || inPerformance ? "" : "active"}`}
            href="/machines"
          >
            <Boxes size={18} />
            Asset registry
            <span className="nav-dot" />
          </Link>
          {code && (
            <Link
              className={`nav-item ${inProduction ? "active" : ""}`}
              href={`/machines/${code}/production`}
            >
              <BarChart3 size={18} />
              Production
            </Link>
          )}
          {code && (
            <Link
              className={`nav-item ${inReadings ? "active" : ""}`}
              href={`/machines/${code}/readings`}
            >
              <Activity size={18} />
              Process trends
            </Link>
          )}
          {code && (
            <Link
              className={`nav-item ${inOrders ? "active" : ""}`}
              href={`/machines/${code}/work-orders`}
            >
              <ClipboardList size={18} />
              Work orders
            </Link>
          )}
          {code && (
            <Link
              className={`nav-item ${inCalendar ? "active" : ""}`}
              href={`/machines/${code}/calendar`}
            >
              <CalendarDays size={18} />
              Maintenance calendar
            </Link>
          )}
          {code && (
            <Link
              className={`nav-item ${inPerformance ? "active" : ""}`}
              href={`/machines/${code}/performance`}
            >
              <ChartNoAxesCombined size={18} />
              Maintenance performance
            </Link>
          )}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={20} />
          <strong>Built on trusted records</strong>
          <p>One pilot line. A clear foundation for maintenance decisions.</p>
        </div>
        <div className="sidebar-footer">
          <span className="tiny-dot" />
          WH-C pilot · Maintenance
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <Link href="/machines">Asset registry</Link>
            {code && (
              <>
                <ChevronRight size={14} />
                <span>{code}</span>
              </>
            )}
          </div>
          <div className="account">
            <span className="avatar">
              {user?.displayName.slice(0, 1).toUpperCase() || "S"}
            </span>
            <div>
              <strong>{user?.displayName || "Maintenance workspace"}</strong>
              {user && (user.availableRoles?.length ?? 0) > 1 ? (
                <label className="role-selector">
                  <span>Active role</span>
                  <select
                    aria-label="Active role"
                    value={user.role}
                    disabled={switchingRole}
                    onChange={(e) =>
                      void switchRole(e.target.value as Me["role"])
                    }
                  >
                    {user.availableRoles.map((role) => (
                      <option key={role} value={role}>
                        {roleNames[role]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <small>
                  {user ? roleNames[user.role] : "Authenticated access"}
                </small>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </Button>
          </div>
        </header>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <main className="main-content">{children}</main>
        <footer className="workspace-footer">
          <span>
            Supreme Industries · Machine maintenance & performance intelligence
          </span>
          <span>Local pilot / v0.7</span>
        </footer>
      </div>
    </div>
  );
}

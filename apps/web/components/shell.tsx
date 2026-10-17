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
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import type { Me } from "@/lib/api";
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
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const result = await getSupabase()?.auth.signOut({ scope: "local" });
      if (result?.error) throw result.error;
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
            className={`nav-item ${inProduction || inReadings ? "" : "active"}`}
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
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={20} />
          <strong>Built on trusted records</strong>
          <p>One pilot line. A clear foundation for maintenance decisions.</p>
        </div>
        <div className="sidebar-footer">
          <span className="tiny-dot" />
          WH-C pilot · Process trends
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
              <small>
                {user ? roleNames[user.role] : "Authenticated access"}
              </small>
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
          <span>Local pilot / v0.3</span>
        </footer>
      </div>
    </div>
  );
}

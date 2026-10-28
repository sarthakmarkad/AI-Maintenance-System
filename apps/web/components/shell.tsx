"use client";
import Link from "next/link";
import { WorkOrderNotifications } from "./work-order-notifications";
import { PageFinder } from "./page-finder";
import { useRouter, usePathname } from "next/navigation";
import {
  Users,
  Boxes,
  ChevronRight,
  ScanLine,
  Menu,
  X,
  Home,
  BookOpen,
  Sparkles,
  LogOut,
  ShieldCheck,
  BarChart3,
  Activity,
  ClipboardList,
  CalendarDays,
  ChartNoAxesCombined,
  FileText,
  Mail,
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
  const inAssistant = pathname.includes("/assistant");
  const [menuOpen, setMenuOpen] = useState(false);
  const sections = [
    {
      name: "Workspace",
      links: [
        { title: "Asset registry", href: "/machines", icon: Boxes },
        ...(user?.role === "ADMINISTRATOR"
          ? [{ title: "Team", href: "/team", icon: Users }]
          : []),
        ...(code
          ? [
              {
                title: "Machine overview",
                href: `/machines/${code}`,
                icon: ScanLine,
              },
            ]
          : []),
      ],
    },
    ...(code
      ? [
          {
            name: "Operations",
            links: [
              {
                title: "Work orders",
                href: `/machines/${code}/work-orders`,
                icon: ClipboardList,
              },
              {
                title: "Maintenance calendar",
                href: `/machines/${code}/calendar`,
                icon: CalendarDays,
              },
              ...(user && ["TECHNICIAN", "MAINTENANCE_HEAD"].includes(user.role)
                ? [
                    {
                      title: "Email alerts",
                      href: `/machines/${code}/notification-settings`,
                      icon: Mail,
                    },
                  ]
                : []),
            ],
          },
          {
            name: "Insights",
            links: [
              {
                title: "Production",
                href: `/machines/${code}/production`,
                icon: BarChart3,
              },
              {
                title: "Process trends",
                href: `/machines/${code}/readings`,
                icon: Activity,
              },
              {
                title: "Maintenance performance",
                href: `/machines/${code}/performance`,
                icon: ChartNoAxesCombined,
              },
              {
                title: "Maintenance reports",
                href: `/machines/${code}/reports`,
                icon: FileText,
              },
            ],
          },
          {
            name: "Knowledge",
            links: [
              {
                title: "Manuals & SOPs",
                href: `/machines/${code}/documents`,
                icon: BookOpen,
              },
              {
                title: "AI assistant",
                href: `/machines/${code}/assistant`,
                icon: Sparkles,
              },
            ],
          },
        ]
      : []),
  ];
  const activeTitle =
    sections
      .flatMap((section) => section.links)
      .find(
        (link) =>
          link.href === pathname ||
          (link.title === "Work orders" &&
            pathname.startsWith(link.href + "/")),
      )?.title ?? "Workspace";
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
    <div
      className={`app-shell ${inAssistant ? "chat-shell" : ""} ${menuOpen ? "navigation-open" : ""}`}
    >
      <a href="#workspace-content" className="skip-link">
        Skip to workspace
      </a>
      <aside
        className="sidebar"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setMenuOpen(false);
            document.getElementById("workspace-menu-toggle")?.focus();
          }
        }}
      >
        <div className="sidebar-brand-row">
          <Link href="/" className="brand" aria-label="Supreme home">
            <span className="brand-mark">
              <ScanLine size={23} />
            </span>
            <span>
              SUPREME<small>Maintenance intelligence</small>
            </span>
          </Link>
          <button
            id="workspace-menu-toggle"
            type="button"
            className="mobile-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        <div className="workspace-context">
          <span className="signal-square" />
          <div>
            <strong>{code || "Asset workspace"}</strong>
            <small>
              {code ? "Selected machine" : "Your authorized assets"}
            </small>
          </div>
          <span className="workspace-context-tag">ASSETS</span>
        </div>
        <nav
          id="workspace-navigation"
          aria-label="Main navigation"
          className="sidebar-navigation"
        >
          {sections.map((section) => (
            <div className="nav-group" key={section.name}>
              <span className="nav-group-label">{section.name}</span>
              {section.links.map(({ href, title, icon: Icon }) => {
                const active =
                  href === pathname ||
                  (title === "Work orders" && pathname.startsWith(href + "/"));
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`nav-item ${active ? "active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon size={17} />
                    <span>{title}</span>
                    {active && <span className="nav-active-marker" />}
                  </Link>
                );
              })}
            </div>
          ))}
          <Link
            href="/"
            className="nav-item nav-home"
            onClick={() => setMenuOpen(false)}
          >
            <Home size={17} />
            <span>Back to website</span>
          </Link>
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={19} />
          <strong>Built on trusted records</strong>
          <p>
            Connected evidence.
            <br />
            Human decisions.
          </p>
        </div>
        <div className="sidebar-footer">
          <span className="signal-square" /> {code || "ASSET REGISTRY"} /
          MAINTENANCE
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <Link href="/machines">Asset registry</Link>
            {code && (
              <>
                <ChevronRight size={13} />
                <Link href={`/machines/${code}`}>{code}</Link>
              </>
            )}
            {activeTitle !== "Asset registry" &&
              activeTitle !== "Machine overview" && (
                <>
                  <ChevronRight size={13} />
                  <span>{activeTitle}</span>
                </>
              )}
          </div>
          {user && (
            <PageFinder
              key={`${user.userId}:${user.role}`}
              sections={sections}
              onNavigate={() => setMenuOpen(false)}
            />
          )}
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
              size="icon"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Sign out"
              title="Sign out"
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
        <main className="main-content" id="workspace-content" tabIndex={-1}>
          {code &&
            user &&
            !inAssistant &&
            session &&
            ["TECHNICIAN", "MAINTENANCE_HEAD"].includes(user.role) && (
              <WorkOrderNotifications
                key={`${user.userId}:${user.role}:${code}`}
                code={code}
                user={user}
                token={session.access_token}
              />
            )}
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Supreme Industries · Maintenance intelligence</span>
          <span>MACHINE RECORDS / HUMAN DECISIONS</span>
        </footer>
      </div>
    </div>
  );
}

"use client";
import { TeamWorkspace } from "./team-workspace";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  Box,
  CircleHelp,
  Factory,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { api, ApiError, type Machine, type Machines, type Me } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { MachineEditor, MachinePicture } from "./machine-details";
import { MachineRegistry, MachineLifecycle } from "./machine-registry";
import { MachineAccess } from "./machine-access";
import { Shell } from "./shell";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { ProductionWorkspace } from "./production-workspace";
import { ReadingsWorkspace } from "./readings-workspace";
import { WorkOrdersWorkspace } from "./work-orders-workspace";
import { PerformanceWorkspace } from "./performance-workspace";
import { DocumentAssistant } from "./document-assistant";
import { DocumentLibraryWorkspace } from "./document-library";
import { ReportsWorkspace } from "./reports-workspace";
import { CalendarWorkspace } from "./calendar-workspace";
import { clearRoleSelection } from "@/lib/role-selection";
type Result =
  | { kind: "loading" }
  | { kind: "error"; message: string; requestId?: string }
  | { kind: "ready"; user: Me; machines: Machine[]; nextCursor: string | null };
export function MachineWorkspace({
  code,
  team = false,
  production = false,
  readings = false,
  workOrders = false,
  calendar = false,
  performance = false,
  reports = false,
  documents = false,
  assistant = false,
  orderId,
}: {
  code?: string;
  team?: boolean;
  production?: boolean;
  readings?: boolean;
  workOrders?: boolean;
  calendar?: boolean;
  performance?: boolean;
  reports?: boolean;
  documents?: boolean;
  assistant?: boolean;
  orderId?: string;
}) {
  const { session, loading, expired, expire } = useAuth();
  const router = useRouter();
  const token = session?.access_token;
  const authUserId = session?.user.id;
  const [result, setResult] = useState<Result>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (loading) return;
    if (!token) {
      router.replace(expired ? "/login?reason=expired" : "/login");
      return;
    }
    const controller = new AbortController();
    setResult((current) =>
      current.kind === "ready" &&
      current.user.userId === authUserId &&
      (!code || current.machines[0]?.code === code)
        ? current
        : { kind: "loading" },
    );
    Promise.all([
      api<Me>("/me", token, controller.signal),
      code
        ? api<Machine>(
            `/machines/${encodeURIComponent(code)}`,
            token,
            controller.signal,
          ).then((x) => ({ machines: [x], nextCursor: null }))
        : api<Machines>("/machines", token, controller.signal).then((x) => ({
            machines: x.items,
            nextCursor: x.nextCursor,
          })),
    ])
      .then(([user, listing]) => {
        if (!controller.signal.aborted)
          setResult({ kind: "ready", user, ...listing });
      })
      .catch(async (error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          await expire();
          router.replace("/login?reason=expired");
          return;
        }
        setResult({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load machine records.",
          requestId: error instanceof ApiError ? error.requestId : undefined,
        });
      });
    return () => controller.abort();
  }, [token, authUserId, loading, expired, expire, code, attempt, router]);
  return (
    <Shell user={result.kind === "ready" ? result.user : undefined} code={code}>
      {result.kind === "ready" && code && result.machines[0]?.archivedAt && (
        <p className="info-strip" role="note">
          Archived machine · Read only. Historical records remain available.{" "}
          {result.machines[0].archiveReason}
        </p>
      )}
      {!session ||
      loading ||
      result.kind === "loading" ||
      (result.kind === "ready" && code && result.machines[0]?.code !== code) ? (
        <div className="loading-state" role="status">
          <p>Loading your machine records…</p>
          <div className="workspace-skeleton">
            <Skeleton className="skeleton-title" />
            <Skeleton className="skeleton-subtitle" />
            <div className="skeleton-grid">
              {[0, 1, 2].map((index) => (
                <Skeleton className="skeleton-card" key={index} />
              ))}
            </div>
            <Skeleton className="skeleton-panel" />
          </div>
        </div>
      ) : result.kind === "error" ? (
        <section className="state-card" role="alert">
          <CircleHelp size={30} />
          <h1>We couldn’t load this workspace</h1>
          <p>{result.message}</p>
          {result.requestId && <small>Reference: {result.requestId}</small>}
          <Button onClick={() => setAttempt((x) => x + 1)}>
            <RefreshCw size={16} />
            Try again
          </Button>
          <Link href="/machines">Back to asset registry</Link>
          <Button
            variant="outline"
            onClick={() => {
              clearRoleSelection();
              window.location.assign("/machines");
            }}
          >
            Return to default role
          </Button>
        </section>
      ) : team ? (
        <TeamWorkspace
          key={`${result.user.userId}:${result.user.role}`}
          user={result.user}
          token={session.access_token}
        />
      ) : code && result.machines[0] ? (
        assistant ? (
          <DocumentAssistant
            key={`${result.user.userId}:${result.user.role}:${result.machines[0].id}`}
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
          />
        ) : documents ? (
          <DocumentLibraryWorkspace
            key={result.machines[0].id}
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
          />
        ) : reports ? (
          <ReportsWorkspace
            key={result.machines[0].id}
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
          />
        ) : performance ? (
          <PerformanceWorkspace
            key={result.machines[0].id}
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
          />
        ) : calendar ? (
          <CalendarWorkspace
            key={result.machines[0].id}
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
          />
        ) : workOrders ? (
          <WorkOrdersWorkspace
            key={result.machines[0].id}
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
            orderId={orderId}
          />
        ) : readings ? (
          <ReadingsWorkspace
            key={result.machines[0].id}
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
          />
        ) : production ? (
          <ProductionWorkspace
            key={result.machines[0].id}
            machine={result.machines[0]}
            user={result.user}
            token={session!.access_token}
          />
        ) : (
          <MachineDetail
            machine={result.machines[0]}
            organization={result.user.organization}
            user={result.user}
            token={session.access_token}
          />
        )
      ) : (
        <MachineRegistry
          initial={{ items: result.machines, nextCursor: result.nextCursor }}
          key={`${result.user.userId}:${result.user.role}`}
          user={result.user}
          token={session.access_token}
        />
      )}
    </Shell>
  );
}
function MachineDetail({
  machine: initialMachine,
  organization,
  user,
  token,
}: {
  machine: Machine;
  organization: string;
  user: Me;
  token: string;
}) {
  const [machine, setMachine] = useState(initialMachine);
  return (
    <>
      <Link href="/machines" className="back-link">
        <ArrowLeft size={14} />
        All assets
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MACHINE WORKSPACE</div>
          <h1>
            {machine.code}
            <span className="heading-divider">/</span>
            <span className="heading-name">{machine.name}</span>
          </h1>
          <p>{organization} · Machine registry</p>
        </div>
        <span className="pill">
          <span className="status-dot" />
          Live status unavailable
        </span>
      </div>
      <section className="machine-hero">
        <div className="hero-copy">
          <span className="tag">REGISTERED MACHINE</span>
          <h2>{machine.name}</h2>
          <p>
            Maintenance work, planned tasks and approved references for{" "}
            {machine.code}.
          </p>
          <div className="hero-meta">
            <span>
              <Factory size={16} />
              {machine.manufacturer || "Manufacturer not recorded"}
            </span>
            <span>
              <MapPin size={16} />
              {machine.location?.name || "Location not confirmed"}
            </span>
          </div>
        </div>
        <div className="hero-art">
          <MachinePicture
            code={machine.code}
            token={token}
            revision={machine.version}
            photo={machine.photo}
          />
        </div>
      </section>
      {user.role === "ADMINISTRATOR" && (
        <div className="machine-access-toolbar">
          {!machine.archivedAt && (
            <>
              <MachineEditor
                machine={machine}
                token={token}
                onSaved={setMachine}
              />
              <MachineAccess key={machine.id} machine={machine} token={token} />
            </>
          )}
          <MachineLifecycle
            machine={machine}
            token={token}
            onSaved={() => window.location.reload()}
          />
        </div>
      )}
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Machine profile</h2>
            <Box size={18} />
          </div>
          <dl className="profile-list">
            <div>
              <dt>Machine identifier</dt>
              <dd>{machine.code}</dd>
            </div>
            <div>
              <dt>Manufacturer</dt>
              <dd>{machine.manufacturer || "Manufacturer not recorded"}</dd>
            </div>
            <div>
              <dt>Equipment type</dt>
              <dd>{machine.name}</dd>
            </div>
            <div>
              <dt>Exact model</dt>
              <dd>{machine.model || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{machine.department?.name || "Not recorded"}</dd>
            </div>
            <div>
              <dt>Monitoring status</dt>
              <dd>Not connected to live telemetry</dd>
            </div>
          </dl>
        </section>
        <section className="panel records-panel">
          <div className="panel-heading">
            <h2>Machine records</h2>
            <Activity size={18} />
          </div>
          <div className="empty-records">
            <div className="record-actions">
              <Button asChild>
                <Link href={`/machines/${machine.code}/work-orders`}>
                  Open work orders
                </Link>
              </Button>
              <>
                <Button asChild variant="outline">
                  <Link href={`/machines/${machine.code}/production`}>
                    <ArrowDownToLine size={14} />
                    Open production records
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/machines/${machine.code}/readings`}>
                    <Activity size={14} />
                    Open process trends
                  </Link>
                </Button>
              </>
              <Button asChild variant="outline">
                <Link href={`/machines/${machine.code}/calendar`}>
                  Maintenance calendar
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/machines/${machine.code}/documents`}>
                  Manuals & SOPs
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/machines/${machine.code}/performance`}>
                  Maintenance performance
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/machines/${machine.code}/reports`}>
                  Maintenance reports
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

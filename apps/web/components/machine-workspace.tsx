"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Box,
  CircleHelp,
  Factory,
  FileSpreadsheet,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { api, ApiError, type Machine, type Machines, type Me } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { Shell } from "./shell";
import { Button } from "./ui/button";
import { ProductionWorkspace } from "./production-workspace";
import { ReadingsWorkspace } from "./readings-workspace";
import { WorkOrdersWorkspace } from "./work-orders-workspace";
import { clearRoleSelection } from "@/lib/role-selection";
type Result =
  | { kind: "loading" }
  | { kind: "error"; message: string; requestId?: string }
  | { kind: "ready"; user: Me; machines: Machine[] };
export function MachineWorkspace({
  code,
  production = false,
  readings = false,
  workOrders = false,
  orderId,
}: {
  code?: string;
  production?: boolean;
  readings?: boolean;
  workOrders?: boolean;
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
          ).then((x) => [x])
        : api<Machines>("/machines", token, controller.signal).then(
            (x) => x.items,
          ),
    ])
      .then(([user, machines]) => {
        if (!controller.signal.aborted)
          setResult({ kind: "ready", user, machines });
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
      {!session || loading || result.kind === "loading" ? (
        <div className="loading-state" role="status">
          <div className="loader" />
          <p>Loading your machine records…</p>
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
      ) : code && result.machines[0] ? (
        workOrders ? (
          <WorkOrdersWorkspace
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
            orderId={orderId}
          />
        ) : readings ? (
          <ReadingsWorkspace
            machine={result.machines[0]}
            user={result.user}
            token={session.access_token}
          />
        ) : production ? (
          <ProductionWorkspace
            machine={result.machines[0]}
            user={result.user}
            token={session!.access_token}
          />
        ) : (
          <MachineDetail
            machine={result.machines[0]}
            organization={result.user.organization}
          />
        )
      ) : (
        <>
          <div className="eyebrow">YOUR OPERATIONS, IN FOCUS</div>
          <div className="page-heading">
            <div>
              <h1>Asset registry</h1>
              <p>The machines your team is authorized to access.</p>
            </div>
            <span className="pill">
              <Box size={14} />
              {result.machines.length} accessible{" "}
              {result.machines.length === 1 ? "asset" : "assets"}
            </span>
          </div>
          {result.machines.length === 0 ? (
            <section className="state-card">
              <Factory size={34} />
              <h2>No machines assigned yet</h2>
              <p>
                Ask your administrator to grant access to the WH-C pilot
                machine.
              </p>
            </section>
          ) : (
            <div className="machine-grid">
              {result.machines.map((machine) => (
                <Link
                  className="asset-card"
                  key={machine.id}
                  href={`/machines/${machine.code}`}
                >
                  <div className="asset-card-top">
                    <span className="machine-code">{machine.code}</span>
                    <ArrowRight size={20} />
                  </div>
                  <Factory size={46} strokeWidth={1.2} />
                  <h2>{machine.name}</h2>
                  <p>{machine.manufacturer}</p>
                  <div className="asset-card-bottom">
                    <span>
                      <span className="status-dot" />
                      Registry record
                    </span>
                    <span>View machine</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <div className="info-strip">
            <ShieldCheck size={20} />
            <p>
              Access follows your organization and assigned machine permissions.
            </p>
          </div>
        </>
      )}
    </Shell>
  );
}
function LineIllustration() {
  return (
    <svg
      viewBox="0 0 440 260"
      className="line-illustration"
      role="img"
      aria-label="Concept illustration of a blown-film line; not the exact WH-C model"
    >
      <defs>
        <pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse">
          <path
            d="M 22 0 L 0 0 0 22"
            fill="none"
            stroke="#cde0d8"
            strokeWidth=".5"
          />
        </pattern>
      </defs>
      <rect width="440" height="260" fill="url(#grid)" />
      <g fill="none" stroke="#2b6658" strokeWidth="2" strokeLinejoin="round">
        <path d="M85 222H365M160 220V58H280V220M151 58H289M169 58V39H270V58M178 39V27H261V39M165 98H276M165 159H276M185 159L202 70H239L256 159Z" />
        <path d="M192 166H248V185H192Z" fill="#d4e7df" />
        <path d="M216 185V201H136V182H98V214H136V202M248 177H302V205H331" />
        <rect x="309" y="198" width="43" height="22" rx="3" fill="#d4e7df" />
        <circle cx="330" cy="209" r="6" />
        <path d="M170 211H269M171 179H184M257 179H270M174 98L194 153M266 98L246 153" />
        <path
          strokeDasharray="4 5"
          stroke="#71a793"
          d="M220 85V146M296 90H360M96 150H140"
        />
      </g>
      <g fill="#2b6658">
        <circle cx="360" cy="90" r="3" />
        <circle cx="96" cy="150" r="3" />
      </g>
      <text x="24" y="244" fill="#6d8b7e" fontSize="9" letterSpacing="2">
        BLOWN-FILM LINE / CONCEPT VIEW
      </text>
    </svg>
  );
}
function MachineDetail({
  machine,
  organization,
}: {
  machine: Machine;
  organization: string;
}) {
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
          <p>{organization} · Pilot machine registry</p>
        </div>
        <span className="pill">
          <span className="status-dot" />
          Live status unavailable
        </span>
      </div>
      <section className="machine-hero">
        <div className="hero-copy">
          <span className="tag">PILOT ASSET</span>
          <h2>
            A clearer picture of
            <br />
            your production line.
          </h2>
          <p>
            Your machine record, production history and synthetic process trends
            are connected. Track operator reports and maintenance work below.
          </p>
          <div className="hero-meta">
            <span>
              <Factory size={16} />
              {machine.manufacturer}
            </span>
            <span>
              <MapPin size={16} />
              {machine.location?.name || "Location not confirmed"}
            </span>
          </div>
        </div>
        <div className="hero-art">
          <LineIllustration />
        </div>
      </section>
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
              <dd>{machine.manufacturer}</dd>
            </div>
            <div>
              <dt>Equipment type</dt>
              <dd>{machine.name}</dd>
            </div>
            <div>
              <dt>Exact model</dt>
              <dd>{machine.model || "Not yet confirmed"}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{machine.department?.name || "Not yet confirmed"}</dd>
            </div>
            <div>
              <dt>Monitoring status</dt>
              <dd>Not connected to live telemetry</dd>
            </div>
          </dl>
        </section>
        <section className="panel records-panel">
          <div className="panel-heading">
            <h2>Performance records</h2>
            <Activity size={18} />
          </div>
          <div className="empty-records">
            <div className="empty-icon">
              <FileSpreadsheet size={28} strokeWidth={1.4} />
            </div>
            <h3>Production records, with source context</h3>
            <p>
              Preview a production workbook, review flagged date blocks and see
              totals from saved records. Explore synthetic hourly process trends
              separately.
            </p>
            <Button asChild>
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
          </div>
        </section>
      </div>
      <section className="workflow-panel">
        <div>
          <span className="eyebrow">PEOPLE KEEP THE PROCESS MOVING</span>
          <h2>A clear maintenance handoff</h2>
          <p>
            Report, assign, repair, review and close with a traceable history.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/machines/${machine.code}/work-orders`}>
            Open work orders
            <ArrowRight size={14} />
          </Link>
        </Button>
        <div className="workflow-steps">
          <div>
            <span>01</span>
            <strong>Report</strong>
            <small>Operator</small>
          </div>
          <ArrowRight size={16} />
          <div>
            <span>02</span>
            <strong>Investigate & repair</strong>
            <small>Assigned technician</small>
          </div>
          <ArrowRight size={16} />
          <div>
            <span>03</span>
            <strong>Review</strong>
            <small>Maintenance head</small>
          </div>
          <ArrowRight size={16} />
          <div>
            <span>04</span>
            <strong>Close</strong>
            <small>Supervisor or head</small>
          </div>
        </div>
      </section>
      <div className="info-strip">
        <Wrench size={19} />
        <p>
          WH-C is the newer Windmöller & Hölscher pilot line. The exact model is
          unconfirmed. WH-B remains reference-only.
        </p>
      </div>
    </>
  );
}

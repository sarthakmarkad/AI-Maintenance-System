import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { PoolConfig } from "pg";

export function postgresOptions(connection: string) {
  let url: URL;
  try {
    url = new URL(connection);
  } catch {
    throw new Error("Invalid PostgreSQL connection configuration.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    throw new Error("Expected a PostgreSQL host and database.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const mode = url.searchParams.get("sslmode");
  if (!local && mode && !["require", "verify-ca", "verify-full"].includes(mode))
    throw new Error("Remote PostgreSQL connections require verified TLS.");
  if (url.searchParams.get("sslaccept") === "accept_invalid_certs")
    throw new Error("Certificate verification cannot be disabled.");
  const schema = url.searchParams.get("schema") ?? "maintenance";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid PostgreSQL schema configuration.");
  const limit = Number(url.searchParams.get("connection_limit") ?? "5");
  const timeout = Number(url.searchParams.get("connect_timeout") ?? "15");
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    !Number.isFinite(timeout) ||
    timeout <= 0 ||
    timeout > 60
  )
    throw new Error("Use a bounded PostgreSQL pool and connection timeout.");
  const certificate =
    url.searchParams.get("sslrootcert") ?? url.searchParams.get("sslcert");
  const tls = !local || (mode && mode !== "disable" && mode !== "prefer");
  const pool: PoolConfig = {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || "5432"),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    max: limit,
    connectionTimeoutMillis: timeout * 1000,
    idleTimeoutMillis: 30000,
    // The adapter serializes date parameters as UTC and expects UTC result text.
    // Enforce it per connection regardless of the server/host default timezone.
    options: "-c timezone=UTC",
    // Parse fields explicitly: connection-string SSL flags must never override verification.
    ssl: tls
      ? {
          rejectUnauthorized: true,
          ...(certificate ? { ca: readFileSync(certificate, "utf8") } : {}),
        }
      : false,
  };
  return { pool, schema };
}

export function postgresAdapter(connection: string) {
  const { pool, schema } = postgresOptions(connection);
  return new PrismaPg(pool, { schema });
}

export function postgresClient(connection: string) {
  return new PrismaClient({ adapter: postgresAdapter(connection) });
}

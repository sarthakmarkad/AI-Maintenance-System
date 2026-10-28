// Keep credentials out of command arguments and preserve libpq TLS settings.
function connectionUrl(connection) {
  try {
    return new URL(connection);
  } catch {
    throw new Error("Invalid PostgreSQL connection configuration.");
  }
}
export function postgresEnvironment(connection, inherited = process.env) {
  const url = connectionUrl(connection);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    throw new Error(
      "Expected a PostgreSQL connection with a host and database.",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const requestedMode =
    url.searchParams.get("sslmode") ??
    inherited.PGSSLMODE ??
    (local ? "prefer" : "verify-full");
  const sslmode =
    requestedMode === "require" &&
    url.searchParams.get("sslaccept") === "strict"
      ? "verify-full"
      : requestedMode;
  if (!local && !["require", "verify-ca", "verify-full"].includes(sslmode))
    throw new Error("Remote PostgreSQL administration requires TLS.");
  const root =
    url.searchParams.get("sslrootcert") ?? url.searchParams.get("sslcert");
  return {
    ...inherited,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: sslmode,
    ...(root ? { PGSSLROOTCERT: root } : {}),
  };
}

export function postgresRole(connection) {
  const url = connectionUrl(connection);
  const username = decodeURIComponent(url.username);
  // Supavisor's login suffix identifies the project; it is not part of the SQL role.
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    const match = username.match(/^(.+)\.([a-z0-9]{20})$/);
    if (!match)
      throw new Error(
        "Expected a Supabase pooler login with its project suffix.",
      );
    return match[1];
  }
  return username;
}

// A hosted application must never become the target of native local bootstrap.
export function nativeDatabaseConfig(env) {
  const operational = connectionUrl(env.DIRECT_URL);
  const hosted = !["localhost", "127.0.0.1", "[::1]"].includes(
    operational.hostname,
  );
  const owner = hosted ? connectionUrl(env.TEST_DATABASE_URL) : operational;
  const runtime = connectionUrl(
    hosted ? env.TEST_RUNTIME_DATABASE_URL : env.DATABASE_URL,
  );
  if (
    [owner, runtime].some(
      (url) =>
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        url.hostname !== "127.0.0.1" ||
        url.port !== "55432",
    ) ||
    owner.username !== "maintenance_owner" ||
    runtime.username !== "maintenance_runtime" ||
    (hosted &&
      (owner.pathname !== runtime.pathname ||
        !/^\/[a-zA-Z0-9_]+_test$/.test(owner.pathname))) ||
    !/^[a-f0-9]+$/.test(decodeURIComponent(runtime.password))
  )
    throw new Error(
      "Local bootstrap requires its generated local credentials; hosted apps need matching local *_test URLs.",
    );
  return {
    owner,
    runtime,
    databases: hosted
      ? [owner.pathname.slice(1)]
      : ["maintenance", "maintenance_test"],
    testOnly: hosted,
  };
}

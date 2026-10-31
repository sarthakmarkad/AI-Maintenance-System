// Production boundaries shared by deployment preflight and the production launcher.
const runtimeKeys = [
  "NODE_ENV",
  "HOST",
  "PORT",
  "WEB_ORIGIN",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "DOCUMENT_AI_PROVIDER",
  "COMMANDCODE_API_KEY",
  "COMMANDCODE_MODEL",
  "COMMANDCODE_BASE_URL",
  "LOCAL_EMBEDDING_DIGEST",
  "OPENAI_API_KEY",
  "OPENAI_EMBEDDING_MODEL",
  "OPENAI_ANSWER_MODEL",
  "DOCUMENT_AI_ENABLED",
  "RCA_AI_ENABLED",
  "EXTERNAL_NOTIFICATIONS_ENABLED",
  "NOTIFICATION_EMAIL_PROVIDER",
  "RESEND_API_KEY",
  "NOTIFICATION_EMAIL_FROM",
  "TEAM_PASSWORD_EMAIL_READY",
  "TEAM_INVITATION_SECRET",
];
function publicUrl(value, key, path = "") {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error(`${key} must be a public HTTPS URL.`);
  }
  const host = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example") ||
    !host.includes(".") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":") ||
    u.pathname !== (path || "/")
  )
    throw Error(
      `${key} must use a public HTTPS hostname and the expected path.`,
    );
  return u;
}
function publicKey(value, key) {
  if (!value || value.startsWith("sb_secret_"))
    throw Error(`${key} requires a Supabase publishable key.`);
  if (value.startsWith("sb_publishable_") && value.length >= 20) return;
  try {
    const p = JSON.parse(
      Buffer.from(value.split(".")[1], "base64url").toString(),
    );
    if (p.role === "anon") return;
  } catch {}
  throw Error(
    `${key} requires a publishable key or legacy anon key, never service-role credentials.`,
  );
}
export function webDeploymentConfig(env) {
  publicUrl(env.NEXT_PUBLIC_API_URL, "NEXT_PUBLIC_API_URL", "/api");
  publicUrl(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  publicKey(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const forbidden = Object.keys(env).filter(
    (k) =>
      k.startsWith("NEXT_PUBLIC_") &&
      /SECRET|PASSWORD|DATABASE|DIRECT_URL|COMMANDCODE|RESEND|OPENAI|SERVICE_ROLE/.test(
        k,
      ),
  );
  if (forbidden.length)
    throw Error(
      "Remove private credentials from NEXT_PUBLIC_ environment variables.",
    );
  return { apiOrigin: new URL(env.NEXT_PUBLIC_API_URL).origin };
}
export function productionEnvironment(env) {
  publicUrl(env.WEB_ORIGIN, "WEB_ORIGIN");
  publicUrl(env.SUPABASE_URL, "SUPABASE_URL");
  publicKey(env.SUPABASE_PUBLISHABLE_KEY, "SUPABASE_PUBLISHABLE_KEY");
  let db;
  try {
    db = new URL(env.DATABASE_URL);
  } catch {
    throw Error(
      "DATABASE_URL requires a restricted PostgreSQL runtime connection.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    !db.hostname ||
    db.pathname.length < 2 ||
    /^(postgres|maintenance_owner)(\.|$)/i.test(decodeURIComponent(db.username))
  )
    throw Error(
      "DATABASE_URL must use a dedicated restricted runtime login, not the database owner.",
    );
  if (
    !["require", "verify-ca", "verify-full"].includes(
      db.searchParams.get("sslmode"),
    ) ||
    db.searchParams.get("sslaccept") === "accept_invalid_certs"
  )
    throw Error("Production DATABASE_URL requires verified TLS configuration.");
  if (env.DATABASE_URL === env.DIRECT_URL)
    throw Error("Runtime and migration credentials must be separate.");
  if (!/^[a-f0-9]{64}$/.test(env.TEAM_INVITATION_SECRET ?? ""))
    throw Error(
      "Configure the existing persistent TEAM_INVITATION_SECRET before production startup.",
    );
  const result = Object.fromEntries(
    runtimeKeys.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]),
  );
  for (const k of [
    "PATH",
    "HOME",
    "LANG",
    "TZ",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ])
    if (env[k]) result[k] = env[k];
  return {
    ...result,
    NODE_ENV: "production",
    HOST: env.HOST || "0.0.0.0",
    PORT: env.PORT || "4000",
  };
}

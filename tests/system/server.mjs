// Isolated acceptance server. This verifier exists only here, never in application code.
import "dotenv/config";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PrismaClient, Role } = require("@prisma/client");
const { Test } = require("@nestjs/testing");
const { UnauthorizedException } = require("@nestjs/common");
const { appModule, configure } = require("../../apps/api/dist/app");
const {
  NOTIFICATION_CONTACT,
} = require("../../apps/api/dist/external-notifications/contact");
const { VERIFIER } = require("../../apps/api/dist/auth");
const owner = process.env.TEST_DATABASE_URL,
  runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (!owner || !runtime) throw Error("Test owner/runtime connections required");
const a = new URL(owner),
  b = new URL(runtime);
if (
  !a.pathname.endsWith("_test") ||
  a.host !== b.host ||
  a.pathname !== b.pathname
)
  throw Error("Refusing operational or mismatched database");
const db = new PrismaClient({ datasources: { db: { url: owner } } });
const org = await db.organization.create({
  data: {
    slug: "system-" + randomUUID(),
    name: "TEST acceptance organization",
  },
});
const machine = await db.machine.create({
  data: {
    orgId: org.id,
    code: "QA-01",
    name: "TEST acceptance machine",
    manufacturer: "Synthetic fixture",
  },
});
const users = {};
for (const [key, role] of Object.entries({
  operator: Role.OPERATOR,
  technician: Role.TECHNICIAN,
  head: Role.MAINTENANCE_HEAD,
  supervisor: Role.SUPERVISOR,
  management: Role.MANAGEMENT,
  admin: Role.ADMINISTRATOR,
})) {
  const user = await db.appUser.create({
    data: { id: randomUUID(), displayName: "TEST " + key },
  });
  const member = await db.membership.create({
    data: { orgId: org.id, userId: user.id, role },
  });
  if (["operator", "technician"].includes(key))
    await db.machineAccess.create({
      data: { orgId: org.id, machineId: machine.id, membershipId: member.id },
    });
  users[key] = { id: user.id, role };
}
users.invitee = { id: randomUUID(), role: Role.TECHNICIAN };
const config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 4301,
  WEB_ORIGIN: "http://127.0.0.1:3130",
  DATABASE_URL: runtime,
  EXTERNAL_NOTIFICATIONS_ENABLED: "false",
  DOCUMENT_AI_ENABLED: "false",
  RCA_AI_ENABLED: "false",
  TEAM_INVITATION_SECRET: "f".repeat(64),
  TEAM_PASSWORD_EMAIL_READY: "true",
};
const module = await Test.createTestingModule({ imports: [appModule(config)] })
  .overrideProvider(VERIFIER)
  .useValue({
    async verify(token) {
      const parts = token.split(".");
      if (parts.length !== 3 || parts[2] !== "system-test-signature")
        throw new UnauthorizedException();
      let id;
      try {
        id = JSON.parse(Buffer.from(parts[1], "base64url").toString()).sub;
      } catch {
        throw new UnauthorizedException();
      }
      if (!Object.values(users).some((u) => u.id === id))
        throw new UnauthorizedException();
      return id;
    },
  })
  .overrideProvider(NOTIFICATION_CONTACT)
  .useValue({
    async resolve(_token, userId) {
      const entry = Object.entries(users).find(([, u]) => u.id === userId);
      if (!entry) throw new UnauthorizedException();
      return entry[0] + "@example.test";
    },
  })
  .compile();
const app = module.createNestApplication();
app.useLogger(false);
configure(app, config);
mkdirSync(".local", { recursive: true });
writeFileSync(
  ".local/system-fixture.json",
  JSON.stringify({ orgId: org.id, machineId: machine.id, users }),
  { mode: 0o600 },
);
await app.listen(4301, "127.0.0.1");
console.log("Isolated acceptance API ready; external providers disabled.");
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await app.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

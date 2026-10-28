import { test } from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import {
  SupabaseNotificationContactResolver,
  verifiedContact,
} from "../external-notifications/contact";
import {
  emailConfigured,
  emailPayload,
  preferenceInput,
  retryDelay,
  supportsEmail,
  type EmailConfig,
} from "../external-notifications/policy";
import {
  ResendNotificationEmailProvider,
  RESEND_ENDPOINT,
} from "../external-notifications/provider";
import { ExternalNotificationsService } from "../external-notifications/service";
import { ExternalNotificationsWorker } from "../external-notifications/worker";
import type { Database } from "../database";
import type { WorkOrdersService } from "../work-orders/service";
import type { Principal } from "../repository";
const uid = "43c14612-d50b-4d58-b57d-bc663dc9408e";
const config: EmailConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 4000,
  WEB_ORIGIN: "http://localhost:3000",
  EXTERNAL_NOTIFICATIONS_ENABLED: "true",
  NOTIFICATION_EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "unit-test-key-never-live",
  NOTIFICATION_EMAIL_FROM: "maintenance@example.test",
};
const payload = () =>
  emailPayload({
    from: config.NOTIFICATION_EMAIL_FROM!,
    destination: "confirmed@example.test",
    origin: config.WEB_ORIGIN,
    orderId: uid,
    action: "ASSIGN",
    at: new Date("2026-10-27T04:30:15Z"),
  });

test("email enrollment input accepts only own active-role intent and exact retry identity", () => {
  const valid = { enabled: true, version: 0, requestId: uid };
  assert.deepEqual(preferenceInput.parse(valid), valid);
  for (const key of [
    "email",
    "destination",
    "userId",
    "orgId",
    "role",
    "verifiedAt",
    "enabledAt",
    "eventId",
    "machineId",
  ])
    assert.equal(
      preferenceInput.safeParse({ ...valid, [key]: "forged" }).success,
      false,
      key,
    );
  for (const change of [
    { enabled: "true" },
    { version: -1 },
    { version: 1.2 },
    { version: "1" },
    { requestId: "bad" },
  ])
    assert.equal(
      preferenceInput.safeParse({ ...valid, ...change }).success,
      false,
    );
});
test("only Technician/Head roles support personal email handoffs", () => {
  for (const role of Object.values(Role))
    assert.equal(
      supportsEmail(role),
      ["TECHNICIAN", "MAINTENANCE_HEAD"].includes(role),
    );
});
test("every explicit provider setting is required, with no fallback to other AI secrets", () => {
  assert.equal(emailConfigured(config), true);
  for (const key of [
    "EXTERNAL_NOTIFICATIONS_ENABLED",
    "NOTIFICATION_EMAIL_PROVIDER",
    "RESEND_API_KEY",
    "NOTIFICATION_EMAIL_FROM",
  ])
    assert.equal(emailConfigured({ ...config, [key]: undefined }), false, key);
  for (const from of [
    "bad",
    "a@example.test\r\nBcc:x@evil.test",
    "A <a@example.test>",
    "",
  ])
    assert.equal(
      emailConfigured({ ...config, NOTIFICATION_EMAIL_FROM: from }),
      false,
    );
  assert.equal(
    emailConfigured({ ...config, EXTERNAL_NOTIFICATIONS_ENABLED: "false" }),
    false,
  );
  assert.equal(emailConfigured({ ...config, RESEND_API_KEY: "   " }), false);
});
test("confirmed contact matches the exact authenticated UUID and ignores metadata", () => {
  assert.equal(
    verifiedContact(
      {
        id: uid,
        email: "Person@example.test",
        email_confirmed_at: "2026-10-27T04:30:00Z",
      },
      uid,
    ),
    "Person@example.test",
  );
  for (const user of [
    null,
    {
      id: "other",
      email: "a@example.test",
      email_confirmed_at: "2026-10-27T04:30:00Z",
    },
  ])
    assert.throws(() => verifiedContact(user, uid), /does not match/);
  assert.throws(
    () =>
      verifiedContact(
        {
          id: "not-a-uuid",
          email: "a@example.test",
          email_confirmed_at: "2026-10-27T04:30:00Z",
        },
        "not-a-uuid",
      ),
    /does not match/,
  );
  for (const partial of [
    { email: undefined },
    { email: "invalid" },
    { email: "a@example.test\r\n" },
    { email_confirmed_at: undefined },
    { email_confirmed_at: "fake" },
  ])
    assert.throws(
      () =>
        verifiedContact(
          {
            id: uid,
            email: "a@example.test",
            email_confirmed_at: "2026-10-27T04:30:00Z",
            ...partial,
          },
          uid,
        ),
      /Confirm your account email/,
    );
});
test("contact resolver fails closed without Supabase configuration", async () => {
  await assert.rejects(
    new SupabaseNotificationContactResolver(config).resolve(
      "never-stored",
      uid,
    ),
    /not configured/,
  );
});
test("contact resolver calls configured Auth getUser and sanitizes provider errors", async () => {
  const old = global.fetch;
  const calls: string[] = [];
  const cfg = {
    ...config,
    SUPABASE_URL: "https://auth.example.test",
    SUPABASE_PUBLISHABLE_KEY: "unit-test-public-key",
  };
  try {
    global.fetch = async (input, init) => {
      calls.push(String(input));
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-bearer",
      );
      return Response.json({
        id: uid,
        email: "verified@example.test",
        email_confirmed_at: "2026-10-27T04:30:00Z",
        user_metadata: {
          email: "forged@example.test",
          role: "MAINTENANCE_HEAD",
        },
      });
    };
    assert.equal(
      await new SupabaseNotificationContactResolver(cfg).resolve(
        "test-bearer",
        uid,
      ),
      "verified@example.test",
    );
    assert.deepEqual(calls, ["https://auth.example.test/auth/v1/user"]);
    global.fetch = async () =>
      Response.json({ message: "SECRET provider error" }, { status: 401 });
    await assert.rejects(
      new SupabaseNotificationContactResolver(cfg).resolve("test-bearer", uid),
      (e) =>
        e instanceof Error &&
        /session is invalid/.test(e.message) &&
        !e.message.includes("SECRET"),
    );
    global.fetch = async () => {
      throw new Error("SECRET transport");
    };
    await assert.rejects(
      new SupabaseNotificationContactResolver(cfg).resolve("test-bearer", uid),
      (e) =>
        e instanceof Error &&
        /unavailable/.test(e.message) &&
        !e.message.includes("SECRET"),
    );
  } finally {
    global.fetch = old;
  }
});
test("templates contain only fixed action, immutable reference, IST and safe origin links", () => {
  for (const action of [
    "REPORT",
    "ASSIGN",
    "SCHEDULE",
    "INVESTIGATE",
    "SUBMIT",
    "RETURN",
  ] as const) {
    const data = emailPayload({
      from: "m@example.test",
      destination: "a@example.test",
      origin: "https://maintenance.example.test",
      orderId: uid,
      action,
      at: new Date("2026-10-27T04:30:15Z"),
    });
    assert.deepEqual(Object.keys(data).sort(), [
      "from",
      "subject",
      "text",
      "to",
    ]);
    assert.match(data.text, /10:00:15 am IST/i);
    assert.match(data.text, new RegExp(`/machines/WH-C/work-orders/${uid}`));
    assert.match(data.text, /notification-settings/);
    assert.equal(data.subject, "WH-C work-order action");
    assert.equal(data.text.includes("symptoms"), false);
  }
  assert.match(
    emailPayload({
      from: "m@example.test",
      destination: "a@example.test",
      origin: "https://maintenance.example.test",
      orderId: uid,
      action: "INVESTIGATE",
      at: new Date(),
    }).text,
    /Synthetic evidence does not establish a fault cause/,
  );
});
test("templates reject injected references, invalid contacts and unsafe URL origins", () => {
  const input = {
    from: "m@example.test",
    destination: "a@example.test",
    origin: config.WEB_ORIGIN,
    orderId: uid,
    action: "ASSIGN" as const,
    at: new Date(),
  };
  for (const origin of [
    "https://example.test/path",
    "https://example.test/",
    "javascript:alert(1)",
    "http://evil.test",
    "https://user:password@example.test",
  ])
    assert.throws(() => emailPayload({ ...input, origin }));
  assert.throws(() => emailPayload({ ...input, orderId: "../injected" }));
  assert.throws(() =>
    emailPayload({ ...input, destination: "x\r\n@example.test" }),
  );
});
test("retry delays are bounded and respect numeric provider backoff", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((a) => retryDelay(a)),
    [30, 60, 120, 240, 480, 960],
  );
  assert.equal(retryDelay(1, 120), 120);
  assert.equal(retryDelay(99, 99999), 3600);
  assert.equal(retryDelay(1, -2), 30);
});
test("Resend uses fixed HTTPS endpoint, no redirect, timeout and stable exact body/idempotency key", async () => {
  const old = global.fetch;
  const calls: { input: string; init?: RequestInit }[] = [];
  try {
    global.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return Response.json({ id: uid });
    };
    const provider = new ResendNotificationEmailProvider(config);
    assert.deepEqual(await provider.send(uid, payload()), {
      outcome: "SENT",
      providerId: uid,
    });
    await provider.send(uid, payload());
    assert.equal(calls.length, 2);
    assert.equal(calls[0].input, RESEND_ENDPOINT);
    assert.equal(calls[0].init?.redirect, "error");
    assert(calls[0].init?.signal instanceof AbortSignal);
    assert.equal(
      new Headers(calls[0].init?.headers).get("idempotency-key"),
      `maintenance-email/${uid}`,
    );
    assert.equal(calls[0].init?.body, calls[1].init?.body);
  } finally {
    global.fetch = old;
  }
});
for (const status of [400, 401, 403, 404, 422, 429, 500, 503])
  test(`Resend HTTP ${status} has safe retry/terminal handling`, async () => {
    const old = global.fetch;
    try {
      global.fetch = async () =>
        Response.json(
          { message: "SECRET address@example.test" },
          { status, headers: { "Retry-After": "90" } },
        );
      const result = await new ResendNotificationEmailProvider(config).send(
        uid,
        payload(),
      );
      assert.equal(
        result.outcome,
        status === 429 || status >= 500 ? "RETRY" : "FAILED",
      );
      assert.equal(JSON.stringify(result).includes("SECRET"), false);
      assert.equal(result.retryAfterSeconds, 90);
    } finally {
      global.fetch = old;
    }
  });
test("only concurrent-key 409 is retryable; payload conflict is terminal", async () => {
  const old = global.fetch;
  try {
    for (const name of [
      "concurrent_idempotent_requests",
      "invalid_idempotent_request",
      "SECRET",
    ]) {
      global.fetch = async () => Response.json({ name }, { status: 409 });
      const result = await new ResendNotificationEmailProvider(config).send(
        uid,
        payload(),
      );
      assert.equal(
        result.outcome,
        name === "concurrent_idempotent_requests" ? "RETRY" : "FAILED",
      );
    }
  } finally {
    global.fetch = old;
  }
});
test("provider sanitizes network/invalid/oversized responses and missing configuration never fetches", async () => {
  const old = global.fetch;
  try {
    global.fetch = async () => {
      throw new Error("SECRET url/token");
    };
    assert.deepEqual(
      await new ResendNotificationEmailProvider(config).send(uid, payload()),
      { outcome: "RETRY", code: "NETWORK_UNCERTAIN" },
    );
    for (const response of [
      new Response("bad JSON"),
      Response.json({ id: "\r\nsecret" }),
      new Response(" ".repeat(9000)),
    ]) {
      global.fetch = async () => response;
      assert.deepEqual(
        await new ResendNotificationEmailProvider(config).send(uid, payload()),
        { outcome: "RETRY", code: "INVALID_PROVIDER_RESPONSE" },
      );
    }
    global.fetch = async () => {
      assert.fail("Disabled delivery must never fetch");
    };
    assert.deepEqual(
      await new ResendNotificationEmailProvider({
        ...config,
        EXTERNAL_NOTIFICATIONS_ENABLED: undefined,
      }).send(uid, payload()),
      { outcome: "FAILED", code: "NOT_CONFIGURED" },
    );
  } finally {
    global.fetch = old;
  }
});
test("disabled/missing-config jobs never touch DB, contacts or provider", async () => {
  for (const cfg of [
    { ...config, EXTERNAL_NOTIFICATIONS_ENABLED: "false" as const },
    { ...config, RESEND_API_KEY: undefined },
  ]) {
    const service = new ExternalNotificationsService(
      {} as Database,
      {} as WorkOrdersService,
      cfg,
      { resolve: async () => assert.fail("No contact") },
      { send: async () => assert.fail("No sends") },
    );
    await service.runJobs();
    assert.equal(await service.enqueue(), 0);
  }
});
test("settings fail closed when DB is absent", async () => {
  const service = new ExternalNotificationsService(
    {} as Database,
    {} as WorkOrdersService,
    config,
    { resolve: async () => "a@example.test" },
    { send: async () => ({ outcome: "SENT", providerId: uid }) },
  );
  await assert.rejects(
    service.settings({} as Principal, "WH-C"),
    /Database is not configured/,
  );
});
test("worker never runs immediately at bootstrap, in tests, or without configuration", async () => {
  let calls = 0;
  for (const cfg of [
    config,
    { ...config, NODE_ENV: "development" as const },
    {
      ...config,
      NODE_ENV: "development" as const,
      DATABASE_URL: "postgresql://unused/test",
      EXTERNAL_NOTIFICATIONS_ENABLED: "false" as const,
    },
    {
      ...config,
      NODE_ENV: "development" as const,
      DATABASE_URL: "postgresql://unused/test",
    },
  ]) {
    const worker = new ExternalNotificationsWorker(cfg, {
      runJobs: async () => {
        calls++;
      },
    } as unknown as ExternalNotificationsService);
    worker.onApplicationBootstrap();
    assert.equal(calls, 0);
    await worker.onApplicationShutdown();
  }
});

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { SupabaseVerifier } from "../auth";
import type { Config } from "../config";
let server: Server;
let verifier: SupabaseVerifier;
let seen = "";
const calls = new Map<string, number>();
const id = "f03eb9af-73c3-4a1b-abda-753c169265b2";
before(async () => {
  server = createServer((req, res) => {
    seen = req.headers.authorization || "";
    const count = (calls.get(seen) ?? 0) + 1;
    calls.set(seen, count);
    res.setHeader("content-type", "application/json");
    if (req.url !== "/auth/v1/user") {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    if (seen === "Bearer timeout-once" && count === 1) return;
    if (seen === "Bearer disconnect-once" && count === 1) {
      req.socket.destroy();
      return;
    }
    if (
      seen === "Bearer unavailable" ||
      (seen === "Bearer unavailable-once" && count === 1) ||
      (seen === "Bearer revoked-after-retry" && count === 1)
    ) {
      res.statusCode = 503;
      res.end(JSON.stringify({ message: "Temporarily unavailable" }));
      return;
    }
    if (seen === "Bearer rate-limited") {
      res.statusCode = 429;
      res.end(JSON.stringify({ message: "Too many requests" }));
      return;
    }
    if (
      ![
        "Bearer accepted",
        "Bearer unavailable-once",
        "Bearer disconnect-once",
        "Bearer timeout-once",
      ].includes(seen)
    ) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({ message: "invalid token", error_code: "bad_jwt" }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        id,
        aud: "authenticated",
        role: "authenticated",
        user_metadata: { role: "ADMINISTRATOR", orgId: "untrusted" },
        app_metadata: {},
        created_at: new Date().toISOString(),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  verifier = new SupabaseVerifier({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
    SUPABASE_URL: `http://127.0.0.1:${address.port}`,
    SUPABASE_PUBLISHABLE_KEY: "test-public-key",
  } as Config);
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
});
test("Supabase verifier calls the Auth user endpoint and returns only the verified UUID", async () => {
  assert.equal(await verifier.verify("accepted"), id);
  assert.equal(seen, "Bearer accepted");
});
test("Supabase rejects invalid tokens, including browser-forged role metadata", async () => {
  await assert.rejects(
    verifier.verify("forged"),
    (e) => (e as { status: number }).status === 401,
  );
  assert.equal(calls.get("Bearer forged"), 1);
});
for (const token of ["unavailable-once", "disconnect-once", "timeout-once"])
  test(`identity verification recovers from ${token} with one read-only retry`, async () => {
    assert.equal(await verifier.verify(token), id);
    assert.equal(calls.get(`Bearer ${token}`), 2);
  });
test("persistent Auth outages stop after two attempts without accepting an identity", async () => {
  await assert.rejects(
    verifier.verify("unavailable"),
    (e) => (e as { status: number }).status === 503,
  );
  assert.equal(calls.get("Bearer unavailable"), 2);
});
test("Auth rate limits preserve the session and do not retry immediately", async () => {
  await assert.rejects(
    verifier.verify("rate-limited"),
    (e) => (e as { status: number }).status === 503,
  );
  assert.equal(calls.get("Bearer rate-limited"), 1);
});
test("a rejected session on the recovery attempt is never admitted", async () => {
  await assert.rejects(
    verifier.verify("revoked-after-retry"),
    (e) => (e as { status: number }).status === 401,
  );
  assert.equal(calls.get("Bearer revoked-after-retry"), 2);
});
test("unconfigured authentication never admits a development user", async () => {
  const unconfigured = new SupabaseVerifier({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 4000,
    WEB_ORIGIN: "http://localhost:3000",
  });
  await assert.rejects(
    unconfigured.verify("anything"),
    (e) => (e as { status: number }).status === 503,
  );
});

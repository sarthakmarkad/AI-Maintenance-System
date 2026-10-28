import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { postgresTlsBridge } from "./postgres-tls-bridge.mjs";

let dir, cert, context;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "maintenance-bridge-test-"));
  cert = join(dir, "server.crt");
  const key = join(dir, "server.key");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  context = tls.createSecureContext({
    key: readFileSync(key),
    cert: readFileSync(cert),
  });
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function remoteServer(acceptTls = true, secureContext = context) {
  const sockets = new Set();
  const received = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", (request) => {
      assert.equal(request.length, 8);
      assert.equal(request.readInt32BE(4), 80877103);
      socket.write(acceptTls ? "S" : "N");
      if (!acceptTls) return;
      const secured = new tls.TLSSocket(socket, {
        isServer: true,
        secureContext,
      });
      sockets.add(secured);
      secured.on("error", () => {});
      secured.once("close", () => sockets.delete(secured));
      secured.on("data", (data) => {
        received.push(data.toString());
        secured.write(data);
      });
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    received,
    connection: `postgresql://owner.project:TEST%40password@127.0.0.1:${server.address().port}/postgres?schema=maintenance&sslaccept=strict&sslrootcert=${encodeURIComponent(cert)}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
async function connect(bridge) {
  const local = new URL(bridge.url);
  const socket = net.connect(Number(local.port), local.hostname);
  socket.on("error", () => {});
  await once(socket, "connect");
  return socket;
}

test("native administration forwards only through verified PostgreSQL TLS", async () => {
  const remote = await remoteServer();
  const bridge = await postgresTlsBridge(
    remote.connection + "&host=%2Fignored%2Fsocket",
  );
  try {
    const url = new URL(bridge.url);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(decodeURIComponent(url.password), "TEST@password");
    assert.equal(url.searchParams.get("schema"), "maintenance");
    assert.equal(url.searchParams.get("host"), null);
    assert.equal(url.searchParams.get("sslrootcert"), null);
    assert.equal(url.searchParams.get("sslmode"), "disable");
    const client = await connect(bridge);
    const response = once(client, "data");
    client.write("TEST PostgreSQL startup bytes");
    assert.equal(
      (await response)[0].toString(),
      "TEST PostgreSQL startup bytes",
    );
    assert.deepEqual(remote.received, ["TEST PostgreSQL startup bytes"]);
    assert.equal(bridge.failed(), false);
    client.destroy();
  } finally {
    await bridge.close();
    await remote.close();
  }
});

test("untrusted remote certificates reject before forwarding authentication bytes", async () => {
  const remote = await remoteServer();
  const url = new URL(remote.connection);
  url.searchParams.delete("sslrootcert");
  const bridge = await postgresTlsBridge(url.toString());
  try {
    const client = await connect(bridge);
    const closed = once(client, "close");
    client.write("TEST credential bytes must remain local");
    await closed;
    assert.equal(bridge.failed(), true);
    assert.equal(remote.received.length, 0);
  } finally {
    await bridge.close();
    await remote.close();
  }
});

test("a server declining PostgreSQL TLS cannot receive startup bytes", async () => {
  const remote = await remoteServer(false);
  const bridge = await postgresTlsBridge(remote.connection);
  try {
    const client = await connect(bridge);
    const closed = once(client, "close");
    client.write("TEST startup must not downgrade to plaintext");
    await closed;
    assert.equal(bridge.failed(), true);
    assert.equal(remote.received.length, 0);
  } finally {
    await bridge.close();
    await remote.close();
  }
});

test("a trusted certificate for another host cannot receive startup bytes", async () => {
  const wrongCert = join(dir, "wrong-host.crt");
  const wrongKey = join(dir, "wrong-host.key");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      wrongKey,
      "-out",
      wrongCert,
      "-subj",
      "/CN=wrong.example.test",
      "-addext",
      "subjectAltName=DNS:wrong.example.test",
    ],
    { stdio: "ignore" },
  );
  const remote = await remoteServer(
    true,
    tls.createSecureContext({
      key: readFileSync(wrongKey),
      cert: readFileSync(wrongCert),
    }),
  );
  const url = new URL(remote.connection);
  url.searchParams.set("sslrootcert", wrongCert);
  const bridge = await postgresTlsBridge(url.toString());
  try {
    const client = await connect(bridge);
    const closed = once(client, "close");
    client.write("TEST credential bytes must not reach another host");
    await closed;
    assert.equal(bridge.failed(), true);
    assert.equal(remote.received.length, 0);
  } finally {
    await bridge.close();
    await remote.close();
  }
});

test("TLS bridge rejects unsafe or malformed administrative configuration safely", async () => {
  for (const connection of [
    "TEST-secret-invalid",
    "https://example.test/postgres",
    "postgresql://owner:TEST@example.test/postgres?sslaccept=accept_invalid_certs",
  ])
    await assert.rejects(
      () => postgresTlsBridge(connection),
      (error) => !error.message.includes("TEST-secret"),
    );
});

import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";

// Native Prisma connects only to a temporary loopback listener. The remote leg
// negotiates PostgreSQL TLS and verifies both the CA and original hostname.
// This bridge never inspects authentication messages or SQL.
export async function postgresTlsBridge(connection) {
  let remote;
  try {
    remote = new URL(connection);
  } catch {
    throw new Error("Invalid PostgreSQL administrative connection.");
  }
  if (
    !["postgres:", "postgresql:"].includes(remote.protocol) ||
    !remote.hostname ||
    remote.pathname.length < 2 ||
    remote.searchParams.get("sslaccept") === "accept_invalid_certs"
  )
    throw new Error(
      "A verified PostgreSQL administrative connection is required.",
    );
  const cert =
    remote.searchParams.get("sslrootcert") ??
    remote.searchParams.get("sslcert");
  const ca = cert ? readFileSync(cert, "utf8") : undefined;
  const sockets = new Set();
  let failure = false;
  const server = net.createServer((client) => {
    // Keep the native startup packet buffered until remote TLS is established.
    client.pause();
    const upstream = net.connect({
      host: remote.hostname.replace(/^\[|\]$/g, ""),
      port: Number(remote.port || "5432"),
    });
    sockets.add(client);
    sockets.add(upstream);
    const timer = setTimeout(() => fail(), 15000);
    timer.unref();
    function fail() {
      failure = true;
      client.destroy();
      upstream.destroy();
      clearTimeout(timer);
    }
    client.on("error", fail);
    upstream.on("error", fail);
    client.on("close", () => {
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
      clearTimeout(timer);
    });
    upstream.once("connect", () => {
      const request = Buffer.alloc(8);
      request.writeInt32BE(8);
      request.writeInt32BE(80877103, 4); // PostgreSQL SSLRequest
      upstream.write(request);
    });
    upstream.once("data", (reply) => {
      if (reply.length !== 1 || reply[0] !== 83) return fail();
      const secured = tls.connect({
        socket: upstream,
        servername: net.isIP(remote.hostname) ? undefined : remote.hostname,
        // Check against the original destination even if it is an IP address.
        checkServerIdentity: (_host, certificate) =>
          tls.checkServerIdentity(remote.hostname, certificate),
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
      });
      sockets.add(secured);
      secured.on("error", fail);
      secured.on("close", () => {
        client.destroy();
        sockets.delete(secured);
        clearTimeout(timer);
      });
      secured.once("secureConnect", () => {
        clearTimeout(timer);
        client.pipe(secured);
        secured.pipe(client);
        client.resume();
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = new URL(remote);
  url.hostname = "127.0.0.1";
  url.port = String(server.address().port);
  // No native engine query parameter may route around the verified bridge.
  for (const key of [
    "sslrootcert",
    "sslcert",
    "sslaccept",
    "sslidentity",
    "sslpassword",
    "host",
  ])
    url.searchParams.delete(key);
  url.searchParams.set("sslmode", "disable");
  return {
    url: url.toString(),
    failed: () => failure,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// Test-only prelude: the verification launcher imports it when the caller
// forwards SAGAX_TEST_NETWORK_AUDIT (a file path). Every outbound socket this
// server process opens, and every request the Sagax block refuses, is
// appended there as one JSON line, so a test can prove that starting the
// server and running a chat turn never even tried to reach a blocked host.
import { appendFileSync } from "node:fs";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";

const file = process.env.SAGAX_TEST_NETWORK_AUDIT;
const LOOPBACK = /^(?:localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|::ffff:127\.\d+\.\d+\.\d+)$/i;

function record(entry) {
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  } catch {
    /* the audit never changes behavior */
  }
}

function connectHost(args) {
  const [first, second] = args;
  if (Array.isArray(first)) return connectHost(first);
  if (first && typeof first === "object") {
    if (first.path) return null;
    return first.host ?? first.hostname ?? "localhost";
  }
  if (typeof first === "number" || /^\d+$/.test(String(first ?? ""))) return typeof second === "string" ? second : "localhost";
  return null; // a pipe or UNIX socket path
}

if (file) {
  record({ kind: "armed", pid: process.pid });
  globalThis[Symbol.for("sagax.networkAudit")] = (entry) => record(entry);
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const host = connectHost(args);
    if (host && !LOOPBACK.test(host)) record({ kind: "connect", host });
    return originalConnect.apply(this, args);
  };
  const originalTls = tls.connect;
  tls.connect = function (...args) {
    const host = connectHost(args) ?? args[0]?.servername;
    if (host && !LOOPBACK.test(host)) record({ kind: "tls", host });
    return originalTls.apply(this, args);
  };
  const originalLookup = dns.lookup;
  dns.lookup = function (hostname, ...rest) {
    if (hostname && !LOOPBACK.test(hostname)) record({ kind: "lookup", host: hostname });
    return originalLookup.call(this, hostname, ...rest);
  };
  const originalPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = function (hostname, ...rest) {
    if (hostname && !LOOPBACK.test(hostname)) record({ kind: "lookup", host: hostname });
    return originalPromiseLookup.call(this, hostname, ...rest);
  };
}

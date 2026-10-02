// The desktop's side of the network tunnel (organization server, desktop
// bridge; the server side is server/desktop-egress.ts). One WebSocket out to
// the server, signed in as the person (their session cookie) and bound to
// this desktop's private bridge secret. For each connection the server asks
// for, THIS computer decides and connects: through the operating system's
// proxy settings (resolveProxy) and its routes, so a VPN applies.
//
// Never reachable from elsewhere: no port is opened here. The person's own
// option "local network only" is applied on this side too.
import dns from "node:dns/promises";
import net from "node:net";

export const TUNNEL = { OPEN: 1, OPENED: 2, FAILED: 3, DATA: 4, END: 5 };
const MAX_STREAMS = 256;
const PAUSE_ABOVE = 4 * 1024 * 1024;

export function tunnelMessage(type, stream, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(stream >>> 0, 1);
  return Buffer.concat([header, Buffer.from(payload)]);
}

const PRIVATE_V4 = [[0x0a000000, 8], [0xac100000, 12], [0xc0a80000, 16], [0x64400000, 10]];
const v4 = address => address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
const inV4 = (address, [base, bits]) => ((v4(address) & ((~0 << (32 - bits)) >>> 0)) >>> 0) === base;

/** A local-network address (RFC 1918, CGNAT/VPN overlays, IPv6 ULA). */
export function isLanAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return PRIVATE_V4.some(range => inV4(address, range));
  if (family === 6) return /^f[cd][0-9a-f]{2}:/i.test(address);
  return false;
}

/** Addresses no bot reaches through this computer: this computer itself
 * (its own services), link-local (cloud metadata) and the unspecified,
 * multicast and broadcast ranges. */
export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    return [[0x7f000000, 8], [0xa9fe0000, 16], [0x00000000, 8], [0xe0000000, 4], [0xf0000000, 4]].some(range => inV4(address, range));
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (/^fe[89ab][0-9a-f]:/.test(lower) || lower.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    return mapped ? isBlockedAddress(mapped[1]) : false;
  }
  return true;
}

/** Whether this computer opens host:port for a bot, given the person's
 * network option. Resolves names with this computer's own resolver (its
 * VPN's DNS included). */
export async function tunnelVerdict(host, port, network, lookup = dns.lookup) {
  if (typeof host !== "string" || !host || host.length > 253 || !Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, code: "bad", message: "Invalid destination" };
  let addresses;
  try {
    addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address);
  } catch {
    return { ok: false, code: "unresolved", message: `${host} could not be resolved on this computer` };
  }
  if (!addresses.length) return { ok: false, code: "unresolved", message: `${host} could not be resolved on this computer` };
  if (addresses.some(isBlockedAddress)) return { ok: false, code: "blocked", message: "This computer's own services and link-local addresses are not reachable through it" };
  if (network === "lan" && !addresses.every(isLanAddress)) return { ok: false, code: "outside-lan", message: "Outside this computer's local network" };
  return { ok: true, address: addresses[0] };
}

/** Parse a PAC answer ("DIRECT", "PROXY host:port; DIRECT", ...): the first
 * HTTP proxy, or null for direct. SOCKS is not used: direct instead. */
export function proxyFromPac(answer) {
  for (const part of String(answer ?? "").split(";")) {
    const match = /^\s*(PROXY|HTTPS)\s+([^\s:]+):(\d+)\s*$/i.exec(part);
    if (match) return { host: match[2], port: Number(match[3]) };
    if (/^\s*DIRECT\s*$/i.test(part)) return null;
  }
  return null;
}

/** Open host:port, through the OS proxy when it names one (HTTP CONNECT). */
async function openConnection(host, port, address, resolveProxy, connect) {
  const proxy = resolveProxy ? proxyFromPac(await resolveProxy(`https://${host}:${port}`).catch(() => "DIRECT")) : null;
  if (!proxy) return connect({ host: address ?? host, port });
  const socket = await connect({ host: proxy.host, port: proxy.port });
  socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  return new Promise((resolve, reject) => {
    let head = Buffer.alloc(0);
    const onData = chunk => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) { if (head.length > 16_384) { socket.destroy(); reject(new Error("proxy answer too long")); } return; }
      socket.off("data", onData);
      if (!/^HTTP\/1\.[01] 2\d\d/.test(head.subarray(0, end).toString("latin1"))) { socket.destroy(); reject(new Error("the system proxy refused the connection")); return; }
      const rest = head.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

const defaultConnect = ({ host, port }) => new Promise((resolve, reject) => {
  const socket = net.connect({ host, port });
  socket.once("connect", () => { socket.off("error", reject); resolve(socket); });
  socket.once("error", reject);
});

/** One tunnel. `WebSocketImpl` is the platform WebSocket (Node's global in
 * Electron's main process), given headers: the session cookie, the origin
 * and the bridge secret. Resolves once open; `closed` settles when it ends. */
export function openDesktopTunnel({ url, headers, network = () => "all", resolveProxy, lookup, connect = defaultConnect, record = () => {}, WebSocketImpl = globalThis.WebSocket }) {
  const streams = new Map();
  const socket = new WebSocketImpl(url, { headers });
  socket.binaryType = "arraybuffer";
  let closedResolve;
  const closed = new Promise(resolve => { closedResolve = resolve; });
  const send = (type, stream, payload) => { try { socket.send(tunnelMessage(type, stream, payload)); } catch { /* closing */ } };
  const fail = (stream, code, message) => send(TUNNEL.FAILED, stream, Buffer.from(JSON.stringify({ code, message })));
  const ready = new Promise((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("The tunnel was refused"));
  });
  socket.onclose = () => { for (const entry of streams.values()) entry.destroy(); streams.clear(); closedResolve(); };
  socket.onmessage = event => {
    const data = Buffer.from(event.data);
    if (data.length < 5) return;
    const type = data[0];
    const stream = data.readUInt32BE(1);
    const payload = data.subarray(5);
    if (type === TUNNEL.OPEN) {
      let target;
      try { target = JSON.parse(payload.toString("utf8")); } catch { fail(stream, "bad", "Invalid request"); return; }
      if (streams.size >= MAX_STREAMS) { fail(stream, "busy", "Too many connections"); return; }
      void (async () => {
        const verdict = await tunnelVerdict(target?.host, target?.port, network(), lookup);
        if (!verdict.ok) {
          record({ host: String(target?.host ?? ""), port: Number(target?.port) || 0, ok: false, error: verdict.message });
          fail(stream, verdict.code, verdict.message);
          return;
        }
        let upstream;
        try { upstream = await openConnection(target.host, target.port, verdict.address, resolveProxy, connect); }
        catch (error) {
          record({ host: target.host, port: target.port, ok: false, error: error.message });
          fail(stream, "refused", `Could not connect to ${target.host}:${target.port} from this computer`);
          return;
        }
        record({ host: target.host, port: target.port, ok: true });
        streams.set(stream, upstream);
        upstream.on("data", chunk => {
          send(TUNNEL.DATA, stream, chunk);
          if (socket.bufferedAmount > PAUSE_ABOVE) {
            upstream.pause();
            const wait = setInterval(() => { if (socket.bufferedAmount < PAUSE_ABOVE / 2 || socket.readyState !== 1) { clearInterval(wait); upstream.resume(); } }, 50);
          }
        });
        upstream.on("end", () => send(TUNNEL.END, stream));
        upstream.on("close", () => streams.delete(stream));
        upstream.on("error", () => { streams.delete(stream); send(TUNNEL.END, stream); });
        send(TUNNEL.OPENED, stream);
      })();
    } else if (type === TUNNEL.DATA) {
      streams.get(stream)?.write(payload);
    } else if (type === TUNNEL.END) {
      streams.get(stream)?.end();
    }
  };
  return {
    ready, closed,
    close() { try { socket.close(); } catch { /* gone */ } for (const entry of streams.values()) entry.destroy(); streams.clear(); },
  };
}

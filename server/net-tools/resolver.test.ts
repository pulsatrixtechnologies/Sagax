import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DNS_SERVERS,
  DEFAULT_DOH_URLS,
  classifyNodeDnsError,
  configuredDohUrls,
  configuredDnsServers,
  createDefaultResolver,
  createNetResolver,
  dohPin,
  parseDohJson,
  ptrQueryName,
  queryDohEndpoints,
  recordsFromNodeReply,
  type DohFetch,
  type NodeDnsPort,
} from "./resolver.ts";

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("node DNS errors and records", () => {
  it("classifies resolver errors and leaves the deadline to the caller", () => {
    expect(classifyNodeDnsError(coded("ENOTFOUND"))).toBe("NXDOMAIN");
    expect(classifyNodeDnsError(coded("ENODATA"))).toBe("NODATA");
    expect(classifyNodeDnsError(coded("ESERVFAIL"))).toBe("SERVFAIL");
    expect(classifyNodeDnsError(coded("EREFUSED"))).toBe("REFUSED");
    expect(classifyNodeDnsError(coded("ETIMEOUT"))).toBe("TIMEOUT");
    expect(classifyNodeDnsError(coded("ETIMEDOUT"))).toBe("TIMEOUT");
    expect(classifyNodeDnsError(coded("ECONNREFUSED"))).toBe("NO_EGRESS");
    expect(classifyNodeDnsError(coded("ENETUNREACH"))).toBe("NO_EGRESS");
    expect(classifyNodeDnsError(coded("EHOSTUNREACH"))).toBe("NO_EGRESS");
    expect(classifyNodeDnsError(coded("EAI_AGAIN"))).toBe("NO_EGRESS");
    expect(classifyNodeDnsError(coded("EFORMERR"))).toBe("UNKNOWN");
    expect(classifyNodeDnsError(coded("EBADRESP"))).toBe("UNKNOWN");
    expect(classifyNodeDnsError(new Error("other"))).toBe("UNKNOWN");
    const abort = new Error("stop");
    abort.name = "AbortError";
    expect(classifyNodeDnsError(abort)).toBe("UNKNOWN");
  });

  it("reads node replies and reports a TTL only for addresses", () => {
    expect(recordsFromNodeReply("A", [{ address: "1.2.3.4", ttl: 30 }])).toEqual([{ type: "A", value: "1.2.3.4", ttl: 30 }]);
    expect(recordsFromNodeReply("AAAA", "2001:db8::1")).toEqual([{ type: "AAAA", value: "2001:db8::1" }]);
    expect(recordsFromNodeReply("TXT", [["hello", "world"]])).toEqual([{ type: "TXT", value: "helloworld" }]);
    expect(recordsFromNodeReply("NS", ["ns.example.com."])).toEqual([{ type: "NS", value: "ns.example.com" }]);
    expect(recordsFromNodeReply("MX", [{ exchange: "mail.example.com.", priority: 10 }])).toEqual([
      { type: "MX", value: "mail.example.com", priority: 10 },
    ]);
    expect(recordsFromNodeReply("SOA", {
      nsname: "ns.example.com.", hostmaster: "host.example.com.", serial: 3, refresh: 1, retry: 2, expire: 3, minttl: 4,
    })).toEqual([{ type: "SOA", value: "ns.example.com. host.example.com. 3 1 2 3 4" }]);
    expect(recordsFromNodeReply("CAA", [{ critical: 0, issue: "example.com" }])).toEqual([
      { type: "CAA", value: '0 issue "example.com"' },
    ]);
    expect(recordsFromNodeReply("CNAME", [])).toEqual([]);
  });
});

describe("DNS over HTTPS documents", () => {
  it("maps status codes and keeps only the asked type", () => {
    expect(parseDohJson({ Status: 0 }, "A")).toMatchObject({ status: "NODATA", records: [], via: "doh" });
    expect(parseDohJson({ status: 0, AD: true, Answer: [{ type: 1, TTL: 30, data: "1.2.3.4" }, { type: 28, data: "2001:db8::1" }] }, "A")).toEqual({
      status: "NOERROR",
      records: [{ type: "A", value: "1.2.3.4", ttl: 30 }],
      authenticated: true,
      via: "doh",
    });
    expect(parseDohJson({ Status: 2, Answer: [{ type: 1, data: "1.2.3.4" }] }, "A")).toMatchObject({ status: "SERVFAIL", records: [] });
    expect(parseDohJson({ Status: 3 }, "A")?.status).toBe("NXDOMAIN");
    expect(parseDohJson({ Status: 5 }, "A")?.status).toBe("REFUSED");
    expect(parseDohJson({ Status: 4 }, "A")?.status).toBe("SERVFAIL");
    expect(parseDohJson({ Status: 0, Answer: [{ type: 15, TTL: 20, data: "10 mail.example.com." }] }, "MX")?.records).toEqual([
      { type: "MX", value: "mail.example.com", priority: 10, ttl: 20 },
    ]);
    expect(parseDohJson({ Status: 0, Answer: [{ type: 16, data: '"hello" "world"' }] }, "TXT")?.records[0]?.value).toBe("helloworld");
    expect(parseDohJson(null, "A")).toBeUndefined();
    expect(parseDohJson({}, "A")).toBeUndefined();
  });

  it("pins the first address only when every address is public", () => {
    expect(dohPin([])).toBeNull();
    expect(dohPin(["1.2.3.4", "10.0.0.1"])).toBeNull();
    expect(dohPin(["3fff::1"])).toBeNull();
    expect(dohPin(["1.2.3.4", "1.2.3.5"])).toBe("1.2.3.4");
  });

  it("asks the pinned endpoint and stops on a real status", async () => {
    const fetched: { url: string; pinned: string; accept: string | null }[] = [];
    const fetchImpl: DohFetch = async (url, init, pinned) => {
      fetched.push({ url, pinned, accept: new Headers(init.headers).get("accept") });
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, TTL: 30, data: "1.2.3.4" }] }), { status: 200 });
    };
    const answer = await queryDohEndpoints({
      urls: ["https://dns.example/dns-query"],
      name: "example.com",
      type: "A",
      lookupHost: async () => ["1.2.3.4"],
      fetchImpl,
    });
    expect(answer?.records[0]).toMatchObject({ value: "1.2.3.4", ttl: 30 });
    expect(fetched).toEqual([{
      url: "https://dns.example/dns-query?name=example.com&type=A",
      pinned: "1.2.3.4",
      accept: "application/dns-json",
    }]);

    let calls = 0;
    const stopped = await queryDohEndpoints({
      urls: ["https://dns.example/a", "https://dns.example/b"],
      name: "example.com",
      type: "A",
      lookupHost: async () => ["1.2.3.4"],
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ Status: 2 }), { status: 200 });
      },
    });
    expect(calls).toBe(1);
    expect(stopped).toMatchObject({ status: "SERVFAIL", records: [] });

    let tries = 0;
    const next = await queryDohEndpoints({
      urls: ["https://dns.example/a", "https://dns.example/b"],
      name: "example.com",
      type: "TXT",
      lookupHost: async () => ["1.2.3.4"],
      fetchImpl: async () => {
        tries += 1;
        return tries === 1
          ? new Response("no", { status: 500 })
          : new Response(JSON.stringify({ Status: 0 }), { status: 200 });
      },
    });
    expect(tries).toBe(2);
    expect(next?.status).toBe("NODATA");

    let fetchedPrivate = false;
    expect(await queryDohEndpoints({
      urls: ["https://dns.example/dns-query"],
      name: "example.com",
      type: "A",
      lookupHost: async () => ["1.2.3.4", "10.0.0.1"],
      fetchImpl: async () => {
        fetchedPrivate = true;
        return new Response("{}", { status: 200 });
      },
    })).toBeUndefined();
    expect(fetchedPrivate).toBe(false);
  });
});

describe("configured resolvers", () => {
  it("keeps public addresses and falls back when nothing usable is set", () => {
    expect(configuredDnsServers("")).toEqual([...DEFAULT_DNS_SERVERS]);
    expect(configuredDnsServers("")).toHaveLength(6);
    expect(configuredDnsServers("1.2.3.4:53")).toEqual(["1.2.3.4:53"]);
    expect(configuredDnsServers("1.2.3.4:99999")).toEqual([...DEFAULT_DNS_SERVERS]);
    expect(configuredDnsServers("resolver.example")).toEqual([...DEFAULT_DNS_SERVERS]);
    expect(configuredDnsServers("10.0.0.1")).toEqual([...DEFAULT_DNS_SERVERS]);
    expect(configuredDnsServers("[2001:4860:4860::8888]:53")).toEqual(["[2001:4860:4860::8888]:53"]);
    expect(configuredDnsServers("1.2.3.4, 1.2.3.5")).toEqual(["1.2.3.4", "1.2.3.5"]);
  });

  it("keeps https endpoints and drops the rest", () => {
    expect(configuredDohUrls("")).toEqual([...DEFAULT_DOH_URLS]);
    expect(configuredDohUrls("http://dns.example/dns-query")).toEqual([...DEFAULT_DOH_URLS]);
    expect(configuredDohUrls("https://user:pass@dns.example/dns-query")).toEqual([...DEFAULT_DOH_URLS]);
    expect(configuredDohUrls("https://localhost/dns-query")).toEqual([...DEFAULT_DOH_URLS]);
    expect(configuredDohUrls("https://127.0.0.1/dns-query")).toEqual([...DEFAULT_DOH_URLS]);
    expect(configuredDohUrls("https://dns.example/dns-query")).toEqual(["https://dns.example/dns-query"]);
  });

  it("builds the reverse name DoH must query", () => {
    expect(ptrQueryName("192.0.2.1")).toBe("1.2.0.192.in-addr.arpa");
    const v6 = ptrQueryName("::1");
    expect(v6.endsWith(".ip6.arpa")).toBe(true);
    expect(v6.replace(/\.ip6\.arpa$/, "").split(".")).toHaveLength(32);
    expect(v6.startsWith("1.0.0.0.")).toBe(true);
  });
});

describe("resolver fallback", () => {
  function port(impl: Partial<NodeDnsPort> & Pick<NodeDnsPort, "resolve">): NodeDnsPort {
    return { resolveAt: async () => [], ...impl };
  }

  it("requires an injected node port under the test runner", () => {
    expect(() => createNetResolver()).toThrow(/inject the node port/);
    expect(() => createDefaultResolver()).toThrow(/inject the node port/);
  });

  it("falls back after a transport or server failure and not after a real code", async () => {
    const asked: string[] = [];
    const resolver = createNetResolver({
      servers: ["1.2.3.4"],
      node: port({
        resolve: async () => { throw coded("ESERVFAIL"); },
      }),
      dohQuery: async (name) => {
        asked.push(name);
        return { status: "NOERROR", records: [{ type: "A", value: "9.9.9.9" }], authenticated: true, via: "doh" };
      },
    });
    expect(await resolver.query("example.com", "A")).toMatchObject({ via: "doh", authenticated: true, records: [{ value: "9.9.9.9" }] });
    expect(asked).toEqual(["example.com"]);

    const refused = createNetResolver({
      node: port({ resolve: async () => { throw coded("EREFUSED"); } }),
      dohQuery: async () => { throw new Error("should not ask"); },
    });
    expect(await refused.query("example.com", "A")).toMatchObject({ status: "REFUSED", via: "node", records: [] });

    const missing = createNetResolver({
      node: port({ resolve: async () => { throw coded("ENOTFOUND"); } }),
      dohQuery: async () => { throw new Error("should not ask"); },
    });
    expect(await missing.query("example.com", "A")).toMatchObject({ status: "NXDOMAIN", via: "node" });

    const ptrAsked: string[] = [];
    const ptr = createNetResolver({
      node: port({ resolve: async () => { throw coded("ESERVFAIL"); } }),
      dohQuery: async (name) => {
        ptrAsked.push(name);
        return { status: "NODATA", records: [], authenticated: false, via: "doh" };
      },
    });
    expect((await ptr.query("192.0.2.1", "PTR")).via).toBe("doh");
    expect(ptrAsked).toEqual(["1.2.0.192.in-addr.arpa"]);
  });

  it("does not use the fallback for one name server, and rethrows the deadline", async () => {
    let fallback = 0;
    const resolver = createNetResolver({
      node: port({
        resolve: async () => ["1.2.3.4"],
        resolveAt: async () => { throw coded("ESERVFAIL"); },
      }),
      dohQuery: async () => {
        fallback += 1;
        return undefined;
      },
    });
    expect(await resolver.query("example.com", "A")).toMatchObject({ status: "NOERROR", via: "node" });
    expect(await resolver.queryServer?.("1.2.3.4", "example.com", "SOA")).toMatchObject({ status: "SERVFAIL", via: "node" });
    expect(fallback).toBe(0);

    const abort = new Error("stop");
    abort.name = "AbortError";
    const dying = createNetResolver({
      node: port({ resolve: async () => { throw abort; } }),
    });
    await expect(dying.query("example.com", "A")).rejects.toMatchObject({ name: "AbortError" });

    const controller = new AbortController();
    controller.abort();
    let called = false;
    const closed = createNetResolver({
      node: port({
        resolve: async () => {
          called = true;
          return [];
        },
      }),
    });
    await expect(closed.query("example.com", "A", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });

  it("imports the node resolver from one file", () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(root);
    const hits = files.filter((path) => readFileSync(path, "utf8").includes('from "node:dns'));
    expect(hits).toEqual([join(root, "resolver.ts")]);
  });
});

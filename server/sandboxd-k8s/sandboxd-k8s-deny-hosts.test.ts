import { describe, expect, it } from "vitest";

import { denyHostsFromEnv, resolveDenyHosts } from "./sandboxd-k8s-deny-hosts.ts";

describe("the cluster API is denied to every sandbox", () => {
  it("reads the hosts, IPv4 or names, and refuses anything else", () => {
    expect(denyHostsFromEnv({})).toEqual([]);
    expect(denyHostsFromEnv({ SAGAX_SANDBOX_K8S_DENY_HOSTS: "API.Example.test, 203.0.113.10" }))
      .toEqual(["api.example.test", "203.0.113.10"]);
    expect(() => denyHostsFromEnv({ SAGAX_SANDBOX_K8S_DENY_HOSTS: "http://x" })).toThrow(/not a host name/);
  });

  it("resolves each host to /32s and fails on a host with no address", async () => {
    const lookup = async (host: string) => (host === "api.test" ? ["203.0.113.10", "203.0.113.11", "::1"] : []);
    expect(await resolveDenyHosts(["api.test", "1.2.3.4"], async (host) => (host === "1.2.3.4" ? ["1.2.3.4"] : lookup(host))))
      .toEqual(["1.2.3.4/32", "203.0.113.10/32", "203.0.113.11/32"]);
    await expect(resolveDenyHosts(["gone.test"], lookup)).rejects.toThrow(/no IPv4/);
  });
});

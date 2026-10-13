import { describe, expect, it } from "vitest";

import { classifyTailscaleStderr, explainTailscaleFailure, parseTailscaleStatus } from "./tailscale.ts";

describe("tailscale helpers", () => {
  it("reads the MagicDNS name, addresses and state from status --json", () => {
    const status = parseTailscaleStatus("/usr/bin/tailscale", JSON.stringify({
      BackendState: "Running",
      Self: { DNSName: "mini.tail1234.ts.net.", TailscaleIPs: ["100.64.0.7", "fd7a:115c:a1e0::7"] },
    }));
    expect(status).toEqual({ cli: "/usr/bin/tailscale", dnsName: "mini.tail1234.ts.net", addresses: ["100.64.0.7", "fd7a:115c:a1e0::7"], backendState: "Running" });
    expect(parseTailscaleStatus("t", "{}")?.dnsName).toBeNull();
    expect(parseTailscaleStatus("t", "not json")).toBeNull();
  });

  it("keeps only this tailnet's own MagicDNS name", () => {
    const foreign = parseTailscaleStatus("t", JSON.stringify({
      BackendState: "Running",
      CurrentTailnet: { MagicDNSSuffix: "mine.ts.net" },
      Self: { DNSName: "other.evil.ts.net." },
      Peer: { "nodekey:peer": { DNSName: "peer.mine.ts.net." } },
    }));
    expect(foreign?.dnsName).toBeNull();
    const own = parseTailscaleStatus("t", JSON.stringify({
      BackendState: "Running",
      CurrentTailnet: { MagicDNSSuffix: "mine.ts.net" },
      Self: { DNSName: "laptop.mine.ts.net." },
      Peer: { "nodekey:peer": { DNSName: "peer.mine.ts.net." } },
    }));
    expect(own?.dnsName).toBe("laptop.mine.ts.net");
    const peerOnly = parseTailscaleStatus("t", JSON.stringify({
      CurrentTailnet: { MagicDNSSuffix: "mine.ts.net" },
      Peer: { "nodekey:peer": { DNSName: "peer.mine.ts.net." } },
    }));
    expect(peerOnly?.dnsName).toBeNull();
  });

  it("classifies stderr into a closed set and never needs the raw text again", () => {
    expect(classifyTailscaleStderr("Logged out.\nLog in at: https://login.tailscale.com/a/tskey-auth-secret")).toBe("not-logged-in");
    expect(classifyTailscaleStderr("failed to connect to local tailscaled; is Tailscale running?")).toBe("not-running");
    expect(classifyTailscaleStderr("Access denied: serve config denied; use 'sudo tailscale set --operator=USER'")).toBe("needs-operator");
    expect(classifyTailscaleStderr("error: HTTPS is not enabled for this tailnet")).toBe("https-not-enabled");
    expect(classifyTailscaleStderr("something else entirely")).toBe("unknown");
    for (const reason of ["not-installed", "not-logged-in", "not-running", "no-magicdns", "needs-operator", "https-not-enabled", "unknown"] as const) {
      expect(explainTailscaleFailure(reason).length).toBeGreaterThan(20);
      expect(explainTailscaleFailure(reason)).not.toContain("tskey");
    }
  });
});

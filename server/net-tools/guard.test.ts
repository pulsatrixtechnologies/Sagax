import { describe, expect, it } from "vitest";

import {
  PORT_CONNECT_TIMEOUT_MS,
  PORT_MAX_EXPLICIT,
  PORT_MAX_PARALLEL,
  PORT_PRESETS,
  guardConnectTarget,
  hostAppearsInText,
  parsePortSelection,
  publicAddressRefusal,
  typedTargetAllows,
} from "./guard.ts";

describe("public address guard", () => {
  const refused: Array<[string, string]> = [
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.5.5", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "metadata"],
    ["169.254.1.1", "link-local"],
    ["168.63.129.16", "metadata"],
    ["100.64.1.1", "cgnat"],
    ["192.0.2.1", "reserved"],
    ["198.51.100.1", "reserved"],
    ["203.0.113.1", "reserved"],
    ["224.0.0.1", "multicast"],
    ["0.0.0.0", "unspecified"],
    ["::1", "loopback"],
    ["fc00::1", "ula"],
    ["fe80::1", "link-local"],
    ["::ffff:127.0.0.1", "ipv4-mapped"],
    ["64:ff9b::7f00:1", "ipv4-mapped"],
    ["2001:db8::1", "reserved"],
    ["3fff::1", "reserved"],
  ];

  it.each(refused)("refuses %s as %s", (address, reason) => {
    expect(publicAddressRefusal(address)).toBe(reason);
  });

  it("accepts a public unicast address", () => {
    expect(publicAddressRefusal("1.2.3.4")).toBeNull();
    expect(publicAddressRefusal("2001:4860:4860::8888")).toBeNull();
  });
});

describe("connect target", () => {
  it("refuses the name when any address is private and pins nothing", async () => {
    const result = await guardConnectTarget("example.com", async () => ["1.2.3.4", "10.0.0.5"]);
    expect(result).toEqual({ ok: false, code: "target.refused_address", reason: "private", address: "10.0.0.5" });
  });

  it("treats an empty lookup and a thrown lookup as unresolved", async () => {
    expect(await guardConnectTarget("example.com", async () => [])).toEqual({
      ok: false, code: "target.refused_address", reason: "unresolved", address: "",
    });
    expect(await guardConnectTarget("example.com", async () => { throw new Error("down"); })).toEqual({
      ok: false, code: "target.refused_address", reason: "unresolved", address: "",
    });
  });

  it("does not look up an address literal and strips brackets", async () => {
    let calls = 0;
    const lookup = async () => {
      calls += 1;
      return ["10.0.0.1"];
    };
    expect(await guardConnectTarget("1.2.3.4", lookup)).toEqual({ ok: true, pinned: "1.2.3.4", addresses: ["1.2.3.4"] });
    expect(await guardConnectTarget("[2001:4860:4860::8888]", lookup)).toEqual({
      ok: true, pinned: "2001:4860:4860::8888", addresses: ["2001:4860:4860::8888"],
    });
    expect(calls).toBe(0);
  });

  it("looks the name up once and keeps the first address to pin", async () => {
    let calls = 0;
    const result = await guardConnectTarget("example.com", async () => {
      calls += 1;
      return ["1.2.3.5", "1.2.3.4", "1.2.3.5"];
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ ok: true, pinned: "1.2.3.5", addresses: ["1.2.3.5", "1.2.3.4"] });
  });
});

describe("port policy", () => {
  it("groups about twenty ports and never a range", () => {
    expect(PORT_PRESETS.mail).toHaveLength(7);
    expect(new Set(Object.values(PORT_PRESETS).flat()).size).toBe(23);
    expect(PORT_CONNECT_TIMEOUT_MS).toBe(3_000);
    expect(PORT_MAX_EXPLICIT).toBe(10);
    expect(PORT_MAX_PARALLEL).toBe(5);
  });

  it("takes a preset or an explicit list, never both", () => {
    expect(parsePortSelection({ preset: "web" })).toEqual({ ok: true, ports: [80, 443, 8080, 8443] });
    expect(parsePortSelection({ ports: [443, 80, 443] })).toEqual({ ok: true, ports: [443, 80] });
    expect(parsePortSelection({ preset: "web", ports: [80] }).ok).toBe(false);
    expect(parsePortSelection({ preset: "web", ports: [] })).toEqual({ ok: false, code: "target.invalid" });
    expect(parsePortSelection({ preset: "nope" })).toEqual({ ok: false, code: "target.invalid" });
    expect(parsePortSelection({})).toEqual({ ok: false, code: "target.invalid" });
    expect(parsePortSelection({ ports: [] })).toEqual({ ok: false, code: "target.invalid" });
    expect(parsePortSelection({ ports: [0] })).toEqual({ ok: false, code: "target.bad_port" });
    expect(parsePortSelection({ ports: [1.5] })).toEqual({ ok: false, code: "target.bad_port" });
    expect(parsePortSelection({ ports: [65_536] })).toEqual({ ok: false, code: "target.bad_port" });
    expect(parsePortSelection({ ports: Array.from({ length: 11 }, (_, index) => index + 1) })).toEqual({ ok: false, code: "target.invalid" });
  });
});

describe("typed target", () => {
  it("lets a person through and requires the host in a bot's message", () => {
    expect(typedTargetAllows("person", "example.com", "")).toBe(true);
    expect(typedTargetAllows("bot", "example.com", undefined)).toBe(false);
    expect(hostAppearsInText("example.com", "check example.com:443")).toBe(true);
    expect(hostAppearsInText("example.com", "EXAMPLE.COM")).toBe(true);
    expect(hostAppearsInText("example.com", "example.com.evil.test")).toBe(false);
    expect(hostAppearsInText("example.com", "notexample.com")).toBe(false);
    // A dot before the name is a boundary, so a child name still matches the parent.
    expect(hostAppearsInText("example.com", "not.example.com")).toBe(true);
    expect(hostAppearsInText("2001:db8::1", "open [2001:db8::1]")).toBe(true);
    expect(hostAppearsInText("2001:db8::1", "2001:db8::1.example.com")).toBe(false);
  });

  it("matches a two-label public suffix until a suffix list exists", () => {
    // "co.uk" is not a registrable domain. The parent walk still matches it.
    expect(hostAppearsInText("shop.example.co.uk", "please check co.uk")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { canonicalJson, cardContentText, requiredClasses, stepUpClassesForCard, usableRpId } from "./step-up.ts";
import type { OptionCardData } from "./wire.ts";

const base: OptionCardData = { title: "Allow?", subtitle: "", options: ["Allow", "Deny"], requestType: "permission", requestId: "r1" };

describe("step-up classes", () => {
  it("takes the call's risk classes as read by the rules", () => {
    expect(stepUpClassesForCard({ ...base, tool: "Bash" }, ["irreversible", "money"])).toEqual(["irreversible", "money"]);
  });

  it("reads destructive and sending from the card itself", () => {
    expect(stepUpClassesForCard({ ...base, tool: "x", toolHints: { destructive: true } })).toContain("destructive");
    expect(stepUpClassesForCard({ ...base, ownerRule: { tool: "t", scope: {}, destructive: "external-message", description: "" } })).toEqual(["external-send"]);
    expect(stepUpClassesForCard({ ...base, outboundRequest: { tool: "send_mail", app: null } })).toEqual(["external-send"]);
  });

  it("knows a page being published", () => {
    expect(stepUpClassesForCard({ ...base, tool: "Artifact", toolInput: JSON.stringify({ file_path: "a.html" }) })).toEqual(["publish-page"]);
    expect(stepUpClassesForCard({ ...base, tool: "Artifact", toolInput: JSON.stringify({ action: "read" }) })).toEqual([]);
    expect(stepUpClassesForCard({ ...base, tool: "mcp__site__publish_page" })).toEqual(["publish-page"]);
  });

  it("knows a change to rules, never a read of them", () => {
    expect(stepUpClassesForCard({ ...base, tool: "mcp__admin__update_permissions" })).toEqual(["rule-change"]);
    expect(stepUpClassesForCard({ ...base, tool: "mcp__admin__list_permissions" })).toEqual([]);
  });

  it("counts what the answer remembers", () => {
    expect(stepUpClassesForCard({ ...base, tool: "Read" }, [], { always: true })).toEqual(["always-grant"]);
    expect(stepUpClassesForCard({ ...base, tool: "Read" }, [], { alwaysAllowKey: "Read" })).toEqual(["always-grant"]);
    expect(stepUpClassesForCard({ ...base, tool: "Read" }, [], { rule: "allow" })).toEqual(["always-grant", "rule-change"]);
    expect(stepUpClassesForCard({ ...base, tool: "Read" }, [], {})).toEqual([]);
  });

  it("asks only for the classes the person chose", () => {
    expect(requiredClasses(["money"], ["destructive", "money"])).toEqual(["money"]);
    expect(requiredClasses([], ["destructive"])).toEqual([]);
  });
});

describe("card content", () => {
  it("is stable whatever the key order, and ignores status fields", () => {
    const card: OptionCardData = { ...base, tool: "x", toolInput: '{"a":1}' };
    expect(cardContentText(card)).toBe(cardContentText({ ...card, answered: "allow", held: "mode", answeredBy: { kind: "loopback" } as never }));
    expect(cardContentText(card)).not.toBe(cardContentText({ ...card, toolInput: '{"a":2}' }));
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
  });
});

describe("RP ID", () => {
  it("is never an IP address, and needs https off this computer", () => {
    expect(usableRpId("localhost", "http:")).toBe("localhost");
    expect(usableRpId("127.0.0.1", "http:")).toBeNull();
    expect(usableRpId("sagax.example.com", "https:")).toBe("sagax.example.com");
    expect(usableRpId("sagax.example.com", "http:")).toBeNull();
    expect(usableRpId("::1", "http:")).toBeNull();
  });
});

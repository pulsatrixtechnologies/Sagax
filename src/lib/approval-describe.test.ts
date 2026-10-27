import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import {
  dateRange,
  describeApproval,
  isTechnicalText,
  parseToolId,
  productFor,
  riskFor,
} from "./approval-describe";

// The service desk sends UTC; the summary reads in the viewer's zone (ET here).
beforeAll(() => {
  process.env.TZ = "America/Toronto";
});
afterEach(() => {
  setLocale("en");
});

const NOW = new Date(2026, 9, 2, 12);
const SCREENSHOT_TOOL = "mcp__perspicax_example_flow__acme_desk__query_schedule";
const scheduleArgs = JSON.stringify({
  conditions: "member/identifier='amartin' and dateStart >= [2026-10-02T04:00:00Z] and dateStart < [2026-10-04T04:00:00Z]",
  fields: "id,dateStart,dateEnd,member/identifier",
  orderBy: "dateStart asc",
});

describe("parseToolId", () => {
  it("keeps underscores inside the server id and double underscores inside the tool", () => {
    expect(parseToolId(SCREENSHOT_TOOL)).toEqual({ server: "perspicax_example_flow", name: "acme_desk__query_schedule" });
    expect(parseToolId("mcp__ogb__computer_batch")).toEqual({ server: "ogb", name: "computer_batch" });
    expect(parseToolId("Bash")).toEqual({ name: "Bash" });
  });
});

describe("productFor", () => {
  it("names the product the server declared, else the tool prefix, else the server", () => {
    expect(productFor(parseToolId(SCREENSHOT_TOOL)).product).toBe("Acme Desk");
    expect(productFor(parseToolId("mcp__claude_ai_Acme_Desk__api_search")).product).toBe("Acme Desk");
    expect(productFor(parseToolId("mcp__claude_ai_Microsoft_365__outlook_email_search")).product).toBe("Microsoft 365");
    expect(productFor(parseToolId("mcp__unifi_network__list_sites")).product).toBe("Unifi Network");
    expect(productFor(parseToolId("mcp__ogb__computer_batch")).product).toBeUndefined();
    // the server declared the product and its id: the name is the server's
    expect(productFor(parseToolId("mcp__gw__acme_desk_ticket_get"), { product: "AcmeDesk Pro", productId: "acme_desk" })).toEqual({ product: "AcmeDesk Pro", prefixTokens: 2 });
    expect(productFor(parseToolId("mcp__gw__acme_desk__query"), { product: "AcmeDesk Pro" }).product).toBe("AcmeDesk Pro");
  });
});

describe("describeApproval titles", () => {
  it("reads the screenshot's schedule query as a plain sentence (FR)", () => {
    setLocale("fr");
    const described = describeApproval(SCREENSHOT_TOOL, scheduleArgs, undefined, NOW);
    expect(described.action).toBe("consulter l'horaire");
    expect(described.product).toBe("Acme Desk");
    expect(described.risk).toBe("read");
    // 04:00Z is local midnight: the exclusive end means through Oct 3
    expect(described.summary).toBe("amartin, 2 oct. au 3 oct.");
    expect(described.server).toBe("perspicax_example_flow");
    expect(described.argsJson).toContain('\n  "conditions": ');
  });

  it("reads the same request in English", () => {
    const described = describeApproval(SCREENSHOT_TOOL, scheduleArgs, undefined, NOW);
    expect(described.action).toBe("view the schedule");
    expect(described.summary).toBe("amartin, Oct 2 to Oct 3");
  });

  it("takes a generic write's operation and resource from its arguments", () => {
    setLocale("fr");
    const args = JSON.stringify({ resource: "time/entries", operation: "create", body: { chargeToId: 287826, member: { identifier: "amartin" }, timeStart: "2026-10-02T13:00:00Z" } });
    const described = describeApproval("mcp__perspicax_example_flow__acme_desk__write", args, undefined, NOW);
    expect(described.action).toBe("créer une saisie de temps");
    expect(described.risk).toBe("write");
    expect(described.summary).toBe("amartin, #287826, 2 oct.");
  });

  it("maps verbs to read, change, delete and run", () => {
    const cases: Array<[string, string | undefined, string, string]> = [
      ["mcp__claude_ai_Acme_Desk__acme_desk__query", JSON.stringify({ resource: "service/tickets" }), "view tickets", "read"],
      ["mcp__pulsatrix__acme_desk__tickets_update", undefined, "change tickets", "write"],
      ["mcp__pulsatrix__acme_desk__write", JSON.stringify({ resource: "companies", method: "DELETE" }), "delete companies", "destructive"],
      ["mcp__pulsatrix__acme_desk__action", JSON.stringify({ action: "isolate" }), "run the isolate action", "execute"],
      ["mcp__unifi__list_sites", undefined, "view sites", "read"],
      ["mcp__pulsatrix__acme_desk__action", undefined, "run an action", "execute"],
    ];
    for (const [tool, args, action, risk] of cases) {
      const described = describeApproval(tool, args, undefined, NOW);
      expect(described.action, tool).toBe(action);
      expect(described.risk, tool).toBe(risk);
    }
  });

  it("falls back to the tool's words when it carries no known verb", () => {
    const described = describeApproval("mcp__ogb__computer_batch", undefined);
    expect(described.action).toBe("computer batch");
    expect(described.product).toBeUndefined();
    expect(described.risk).toBeUndefined();
  });

  it("still summarizes a subtitle cut at 200 characters (old cards)", () => {
    setLocale("fr");
    const cut = scheduleArgs.slice(0, 199) + "…";
    const described = describeApproval(SCREENSHOT_TOOL, cut, undefined, NOW);
    expect(described.summary).toBe("amartin, 2 oct. au 3 oct.");
    expect(described.argsJson).toBe(cut);
  });
});

describe("risk", () => {
  it("lets MCP annotations win over the verb", () => {
    expect(riskFor("update", { readOnly: true })).toBe("read");
    expect(riskFor("read", { destructive: true })).toBe("destructive");
    expect(riskFor("read", { readOnly: false })).toBe("write");
    expect(riskFor(undefined, undefined, "execute")).toBe("execute");
    expect(describeApproval("mcp__x__do_thing", undefined, { readOnly: true }).risk).toBe("read");
  });

  it("knows the built-in tools", () => {
    expect(describeApproval("Read", "/etc/hosts").risk).toBe("read");
    expect(describeApproval("Edit", "src/a.ts").risk).toBe("write");
    expect(describeApproval("Bash", "pnpm test").risk).toBe("execute");
    expect(describeApproval("delete", "a.txt").risk).toBe("destructive");
  });
});

describe("dates and text", () => {
  it("keeps a single day as one day", () => {
    const range = dateRange("dateStart = [2026-10-02T13:00:00Z]");
    expect(range?.from.getDate()).toBe(2);
    expect(range?.to.getDate()).toBe(2);
  });

  it("tells raw JSON from a readable command", () => {
    expect(isTechnicalText('{"a":1}')).toBe(true);
    expect(isTechnicalText("pnpm test")).toBe(false);
    expect(isTechnicalText(undefined)).toBe(false);
  });
});

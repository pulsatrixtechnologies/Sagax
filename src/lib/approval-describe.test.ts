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

// ConnectWise sends UTC; the summary reads in the viewer's zone (ET here).
beforeAll(() => {
  process.env.TZ = "America/Toronto";
});
afterEach(() => {
  setLocale("en");
});

const NOW = new Date(2026, 9, 2, 12);
const SCREENSHOT_TOOL = "mcp__perspicax_pulsatrix_flow_jc__cw_psa_schedule__query";
const scheduleArgs = JSON.stringify({
  conditions: "member/identifier='jcproulx' and dateStart >= [2026-10-02T04:00:00Z] and dateStart < [2026-10-04T04:00:00Z]",
  fields: "id,dateStart,dateEnd,member/identifier",
  orderBy: "dateStart asc",
});

describe("parseToolId", () => {
  it("keeps underscores inside the server id and double underscores inside the tool", () => {
    expect(parseToolId(SCREENSHOT_TOOL)).toEqual({ server: "perspicax_pulsatrix_flow_jc", name: "cw_psa_schedule__query" });
    expect(parseToolId("mcp__ogb__computer_batch")).toEqual({ server: "ogb", name: "computer_batch" });
    expect(parseToolId("Bash")).toEqual({ name: "Bash" });
  });
});

describe("productFor", () => {
  it("names the product from the tool prefix, else the server", () => {
    expect(productFor(parseToolId(SCREENSHOT_TOOL)).product).toBe("ConnectWise PSA");
    expect(productFor(parseToolId("mcp__claude_ai_Connectwise_PSA__api_search")).product).toBe("ConnectWise PSA");
    expect(productFor(parseToolId("mcp__claude_ai_Microsoft_365__outlook_email_search")).product).toBe("Microsoft 365");
    expect(productFor(parseToolId("mcp__unifi_network__list_sites")).product).toBe("Unifi Network");
    expect(productFor(parseToolId("mcp__ogb__computer_batch")).product).toBeUndefined();
  });
});

describe("describeApproval titles", () => {
  it("reads the screenshot's schedule query as a plain sentence (FR)", () => {
    setLocale("fr");
    const described = describeApproval(SCREENSHOT_TOOL, scheduleArgs, undefined, NOW);
    expect(described.action).toBe("consulter l'horaire");
    expect(described.product).toBe("ConnectWise PSA");
    expect(described.risk).toBe("read");
    // 04:00Z is local midnight: the exclusive end means through Oct 3
    expect(described.summary).toBe("jcproulx, 2 oct. au 3 oct.");
    expect(described.server).toBe("perspicax_pulsatrix_flow_jc");
    expect(described.argsJson).toContain('\n  "conditions": ');
  });

  it("reads the same request in English", () => {
    const described = describeApproval(SCREENSHOT_TOOL, scheduleArgs, undefined, NOW);
    expect(described.action).toBe("view the schedule");
    expect(described.summary).toBe("jcproulx, Oct 2 to Oct 3");
  });

  it("takes a generic write's operation and resource from its arguments", () => {
    setLocale("fr");
    const args = JSON.stringify({ resource: "time/entries", operation: "create", body: { chargeToId: 287826, member: { identifier: "jcproulx" }, timeStart: "2026-10-02T13:00:00Z" } });
    const described = describeApproval("mcp__perspicax_pulsatrix_flow_jc__cw_psa__write", args, undefined, NOW);
    expect(described.action).toBe("créer une entrée de temps");
    expect(described.risk).toBe("write");
    expect(described.summary).toBe("jcproulx, #287826, 2 oct.");
  });

  it("maps verbs to read, change, delete and run", () => {
    const cases: Array<[string, string | undefined, string, string]> = [
      ["mcp__claude_ai_Connectwise_PSA__cw_psa__query", JSON.stringify({ resource: "service/tickets" }), "view tickets", "read"],
      ["mcp__pulsatrix__cw_psa_tickets__update", undefined, "change tickets", "write"],
      ["mcp__pulsatrix__cw_psa__write", JSON.stringify({ resource: "companies", method: "DELETE" }), "delete companies", "destructive"],
      ["mcp__pulsatrix__cw_psa__action", JSON.stringify({ action: "isolate" }), "run the isolate action", "execute"],
      ["mcp__unifi__list_sites", undefined, "view sites", "read"],
      ["mcp__pulsatrix__cw_psa__action", undefined, "run an action", "execute"],
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
    expect(described.summary).toBe("jcproulx, 2 oct. au 3 oct.");
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

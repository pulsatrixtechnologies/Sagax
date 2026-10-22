import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { clearConnectorPreferences, slugsWithDisabledTools, connectorToolRows, loadConnectorTools, saveDisabledTools, toggledDisabledTools } from "./connector-tool-switches";

describe("a connected app's tool switches", () => {
  beforeEach(() => fixture.api.mockReset());

  it("shows every tool on unless the workspace turned it off", () => {
    const inventory = {
      services: { gmail: [{ name: "GMAIL_SEND_EMAIL", description: "Send" }, { name: "GMAIL_FETCH_EMAILS" }] },
      disabledTools: { gmail: ["GMAIL_SEND_EMAIL"] },
    };
    expect(connectorToolRows(inventory, "gmail")).toEqual([
      { name: "GMAIL_SEND_EMAIL", description: "Send", enabled: false },
      { name: "GMAIL_FETCH_EMAILS", enabled: true },
    ]);
    expect(connectorToolRows(inventory, "slack")).toEqual([]);
  });

  it("moves one switch at a time", () => {
    expect(toggledDisabledTools(undefined, "GMAIL_SEND_EMAIL", false)).toEqual(["GMAIL_SEND_EMAIL"]);
    expect(toggledDisabledTools(["GMAIL_SEND_EMAIL", "GMAIL_A"], "GMAIL_SEND_EMAIL", true)).toEqual(["GMAIL_A"]);
    expect(toggledDisabledTools(["GMAIL_B"], "GMAIL_A", false)).toEqual(["GMAIL_A", "GMAIL_B"]);
  });

  it("reads the inventory and saves one app's list", async () => {
    fixture.api.mockResolvedValueOnce({ configured: true, services: { gmail: [] } });
    expect(await loadConnectorTools()).toEqual({ services: { gmail: [] }, disabledTools: {} });
    fixture.api.mockResolvedValueOnce({ disabledTools: { gmail: ["GMAIL_SEND_EMAIL"] } });
    expect(await saveDisabledTools("gmail", ["GMAIL_SEND_EMAIL"])).toEqual({ gmail: ["GMAIL_SEND_EMAIL"] });
    expect(fixture.api).toHaveBeenLastCalledWith("/api/connectors/gmail/tools", {
      method: "PUT",
      body: JSON.stringify({ disabledTools: ["GMAIL_SEND_EMAIL"] }),
    });
  });
});

describe("clearing connector preferences", () => {
  it("lists only the apps with a tool off", () => {
    expect(slugsWithDisabledTools({ github: ["a"], slack: [], linear: ["x", "y"] })).toEqual(["github", "linear"]);
  });

  it("puts every off tool back on, app by app, and says how many apps it touched", async () => {
    const save = vi.fn(async () => ({}));
    const load = async () => ({ services: {}, disabledTools: { github: ["a"], slack: [], linear: ["x"] } });
    expect(await clearConnectorPreferences(load, save)).toBe(2);
    expect(save.mock.calls).toEqual([["github", []], ["linear", []]]);
    expect(await clearConnectorPreferences(async () => ({ services: {}, disabledTools: {} }), save)).toBe(0);
  });

  it("is all or nothing: a failing app puts back the ones already reset", async () => {
    const calls: Array<[string, string[]]> = [];
    const save = vi.fn(async (slug: string, tools: string[]) => {
      calls.push([slug, tools]);
      if (slug === "linear") throw new Error("refused");
    });
    const load = async () => ({ services: {}, disabledTools: { github: ["a", "b"], linear: ["x"], slack: ["s"] } });
    await expect(clearConnectorPreferences(load, save)).rejects.toThrow("refused");
    expect(calls).toEqual([["github", []], ["linear", []], ["github", ["a", "b"]]]);
  });
});

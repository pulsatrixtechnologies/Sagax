import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { connectorToolRows, loadConnectorTools, saveDisabledTools, toggledDisabledTools } from "./connector-tool-switches";

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

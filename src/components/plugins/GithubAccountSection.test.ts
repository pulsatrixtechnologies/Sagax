// @vitest-environment happy-dom
// Connect apps > Providers > GitHub (2026-10-28): the one GitHub
// connection, and one list of other credentials beside it. A member changes
// their own with no admin, sees the organization's marked and read only; an
// admin may add one for the whole organization. No token is ever on the
// page: a label and a hint. A proxy's bare 502 is never shown.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setGithubCredentialsForTest, type GithubCredentialsView } from "@/lib/github-credentials";
import { setLocale } from "@/lib/i18n";
import { GithubAccountSection } from "./GithubAccountSection";
import { MyGithubConnection } from "../settings/MyConnectionsSettings";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(async () => { throw new Error("no server in this test"); }),
}));

afterEach(() => {
  setGithubCredentialsForTest(null);
  setLocale("en");
  document.body.innerHTML = "";
});

const view = (canManageOrg: boolean): GithubCredentialsView => ({
  canManageOrg,
  deviceFlow: false,
  credentials: [
    { id: "gt_0000000000000001", label: "Other organization", hint: "1111", owner: "mine", chosenBy: 0 },
    { id: "gt_0000000000000002", label: "example-org/team-market (Rocket)", hint: "2222", owner: "mine", onlyWhereChosen: true, chosenBy: 1 },
    { id: "gt_0000000000000003", label: "Repository group", hint: "saved", owner: "org", chosenBy: 2 },
  ],
});

describe("Providers > GitHub", () => {
  it("shows the connection, then one list with the organization's marked, and no token", () => {
    setGithubCredentialsForTest(view(false));
    const html = renderToStaticMarkup(createElement(GithubAccountSection, { connection: createElement("div", { "data-test-connection": "" }) }));
    expect(html).toMatch(/data-accounts-github[\s\S]*data-github-connection[\s\S]*data-test-connection[\s\S]*data-github-credentials/);
    expect(html).toContain("private marketplaces, gh and git in your bots, and the GitHub plugin");
    expect(html).toContain("More credentials");
    expect(html).toContain('data-github-credential-owner="org"');
    expect(html).toContain("Organization");
    expect(html).toContain("Marketplace only");
    expect(html).toContain("Marketplaces that pick it: 2");
    expect(html).toContain("•••• 1111");
    expect(html).not.toContain('type="password"');
  });

  it("a member changes their own, not the organization's", () => {
    setGithubCredentialsForTest(view(false));
    const host = document.createElement("div");
    document.body.append(host);
    flushSync(() => createRoot(host).render(createElement(GithubAccountSection, {})));
    const mine = host.querySelector('[data-github-credential="gt_0000000000000001"]')!;
    expect(mine.textContent).toContain("Rename");
    expect(mine.textContent).toContain("Replace");
    expect(mine.textContent).toContain("Remove");
    const org = host.querySelector('[data-github-credential="gt_0000000000000003"]')!;
    expect(org.textContent).not.toContain("Rename");
    expect(org.querySelector("button")).toBeNull();
    // Add: the member's own list, no organization choice
    flushSync(() => (host.querySelector("[data-github-credential-add-open]") as HTMLElement).click());
    expect(host.querySelector("[data-github-credential-add]")).not.toBeNull();
    expect(host.querySelector("[data-github-credential-scope]")).toBeNull();
    expect(host.querySelector('[data-github-credential-add] input[type="password"]')).not.toBeNull();
  });

  it("an admin changes the organization's and may add one for everyone", () => {
    setGithubCredentialsForTest(view(true));
    const host = document.createElement("div");
    document.body.append(host);
    flushSync(() => createRoot(host).render(createElement(GithubAccountSection, {})));
    expect(host.querySelector('[data-github-credential="gt_0000000000000003"]')!.textContent).toContain("Rename");
    flushSync(() => (host.querySelector("[data-github-credential-add-open]") as HTMLElement).click());
    expect(host.querySelector('[data-github-credential-scope="mine"]')).not.toBeNull();
    expect(host.textContent).toContain("The whole organization");
  });

  it("one Connect GitHub: a token when the OAuth App is missing, with the sentence for an admin's link", () => {
    const initial = { github: { state: "none" as const, deviceFlow: false }, servers: [], sandbox: true };
    const admin = renderToStaticMarkup(createElement(MyGithubConnection, { initial, onEnableApp: () => {} }));
    expect(admin).toContain('data-github-connect="token"');
    expect(admin).toContain("An admin can turn on Connect GitHub");
    expect(admin).toMatch(/<button[^>]*>An admin can turn on Connect GitHub/);
    expect(admin).not.toContain("Use a token");
    const member = renderToStaticMarkup(createElement(MyGithubConnection, { initial }));
    expect(member).not.toMatch(/<button[^>]*>An admin can turn on/);
    const withApp = renderToStaticMarkup(createElement(MyGithubConnection, { initial: { ...initial, github: { state: "none" as const, deviceFlow: true } } }));
    expect(withApp).toContain('data-github-connect="device"');
    expect(withApp).toContain("Use a token");
    expect(withApp).not.toContain("An admin can turn on");
  });

  it("says it in French", () => {
    setLocale("fr");
    setGithubCredentialsForTest(view(false));
    const html = renderToStaticMarkup(createElement(GithubAccountSection, {}));
    expect(html).toContain("Identifiants supplémentaires");
    expect(html).toContain("Organisation");
  });

  it("a proxy's bare 502 while the server restarts is asked again, never shown", async () => {
    const { api } = await import("@/state/store");
    const mocked = vi.mocked(api);
    let calls = 0;
    mocked.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("502 Bad Gateway"), { status: 502 });
      return { github: { state: "connected", deviceFlow: true, login: "octo", via: "device", connectedAt: 1 }, servers: [], sandbox: true };
    });
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      document.body.append(host);
      flushSync(() => createRoot(host).render(createElement(MyGithubConnection, {})));
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.runOnlyPendingTimersAsync();
      expect(host.textContent).not.toMatch(/502|Bad Gateway/);
      expect(host.textContent).toContain("Connected as @octo");
    } finally {
      vi.useRealTimers();
      mocked.mockImplementation(async () => { throw new Error("no server in this test"); });
    }
  });

  it("a failure that stays is one plain line, never the status", async () => {
    const { api } = await import("@/state/store");
    const mocked = vi.mocked(api);
    mocked.mockImplementation(async () => { throw Object.assign(new Error("502 Bad Gateway"), { status: 502 }); });
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      document.body.append(host);
      flushSync(() => createRoot(host).render(createElement(MyGithubConnection, {})));
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.runOnlyPendingTimersAsync();
      expect(host.textContent).not.toMatch(/502|Bad Gateway/);
      expect(host.textContent).toContain("Something went wrong on the other end. Try again.");
    } finally {
      vi.useRealTimers();
      mocked.mockImplementation(async () => { throw new Error("no server in this test"); });
    }
  });
});

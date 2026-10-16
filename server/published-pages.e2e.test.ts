// Published pages through the real server (server/index.ts wiring): the
// reading link is answered before the auth gate with the sandbox CSP and no
// cookie, publish and revoke go through the person's API, and a revoked
// link is gone. The proposal is written to the fixture's own data folder,
// as the bot's card route would.
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { PublishedPages } from "./published-pages.ts";

it("serves a published page sandboxed, and stops at once when it is revoked", async () => {
  const fixture = await launchVerificationServer();
  try {
    const url = fixture.info.url;
    const pages = new PublishedPages(fixture.info.dataDir);
    const made = pages.propose({ botId: "b1", threadId: "t1", title: "Rapport", kind: "html", content: "<!doctype html><p>Bonjour</p><script>fetch('/api/config')</script>" });
    if (!made.ok) throw new Error(made.error);
    const id = made.page.id;
    const api = async (path: string, method = "GET", body?: unknown) => {
      const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      const response = await fetch(`${url}${path}`, init);
      return { status: response.status, body: await response.json() as any };
    };
    // nothing to read before the person publishes
    expect((await api(`/api/pages/${id}`)).body.page).toMatchObject({ status: "draft" });
    const published = await api(`/api/pages/${id}/publish`, "POST", { version: 1, access: "link", expiresAt: null });
    expect(published.status).toBe(200);
    const path: string = published.body.page.path;
    const read = await fetch(`${url}${path}`, { headers: { origin: "https://elsewhere.example" } });
    expect(read.status).toBe(200);
    const csp = read.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("connect-src 'none'");
    expect(read.headers.get("set-cookie")).toBeNull();
    expect(read.headers.get("access-control-allow-origin")).toBeNull();
    expect(await read.text()).toContain("<p>Bonjour</p>");
    expect((await api(`/api/pages/${id}/revoke`, "POST", {})).status).toBe(200);
    expect((await fetch(`${url}${path}`)).status).toBe(404);
  } finally {
    await fixture.close();
  }
}, 120_000);

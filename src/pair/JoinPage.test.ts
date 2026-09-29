import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { joinInvite, JoinView, previewInvite, type JoinState } from "./JoinPage";

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const view = (state: JoinState) => renderToStaticMarkup(createElement(JoinView, { state, onJoin: () => {} })).replace(/&#x27;/g, "'");
const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("join page", () => {
  it("shows the organization, the masked address and a Join button for an open invite", () => {
    const html = view({ kind: "open", orgName: "GOX", email: "z***@gox.ca" });
    expect(html).toContain("Join GOX");
    expect(html).toContain("Invited as z***@gox.ca");
    expect(html).toContain("ui-button ui-button-primary");
    expect(html).toContain(">Join<");
    expect(html).toContain("bg-app");
  });

  it("explains each closed invite, and offers sign-in where it helps", () => {
    expect(view({ kind: "expired" })).toContain("This invitation has expired");
    expect(view({ kind: "revoked" })).toContain("This invitation was cancelled");
    expect(view({ kind: "unknown" })).toContain("This invitation link is not valid");
    expect(view({ kind: "unknown" })).not.toContain('href="/pair"');
    const used = view({ kind: "used" });
    expect(used).toContain("already used");
    expect(used).toContain('href="/pair"');
    const member = view({ kind: "already-member" });
    expect(member).toContain("already a member");
    expect(member).toContain('href="/pair"');
    expect(member).toContain("Sign in");
  });

  it("keeps a failed join on screen with its error", () => {
    const html = view({ kind: "open", orgName: "GOX", email: "z***@gox.ca", error: "too many failed attempts" });
    expect(html).toContain("too many failed attempts");
    expect(html).toContain("Join GOX");
  });

  it("speaks Quebec French", () => {
    setLocale("fr");
    const html = view({ kind: "open", orgName: "GOX", email: "z***@gox.ca" });
    expect(html).toContain("Rejoindre GOX");
    expect(html).toContain("Invitation pour z***@gox.ca");
    expect(view({ kind: "already-member" })).toContain("Connecte-toi plutôt");
  });

  it("reads the preview and the join answers", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { status: "open", orgName: "GOX", email: "z***@gox.ca" }))
      .mockResolvedValueOnce(response(200, { status: "revoked" }))
      .mockResolvedValueOnce(response(200, { status: "joined", orgName: "GOX" }))
      .mockResolvedValueOnce(response(409, { status: "already-member" }))
      .mockResolvedValueOnce(response(410, { status: "used" }))
      .mockResolvedValueOnce(response(429, { error: "too many failed attempts" }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    expect(await previewInvite("tok")).toEqual({ kind: "open", orgName: "GOX", email: "z***@gox.ca" });
    expect(fetch).toHaveBeenLastCalledWith("/api/org/invites/tok/preview", expect.anything());
    expect(await previewInvite("tok")).toEqual({ kind: "revoked" });
    expect(await joinInvite("tok")).toEqual({ kind: "joined", orgName: "GOX" });
    expect(fetch).toHaveBeenLastCalledWith("/api/org/invites/tok/join", expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" } }));
    expect(await joinInvite("tok")).toEqual({ kind: "already-member" });
    expect(await joinInvite("tok")).toEqual({ kind: "used" });
    expect(await joinInvite("tok")).toEqual({ kind: "failed", error: "too many failed attempts" });
    expect(await joinInvite("tok")).toEqual({ kind: "failed", error: "Could not join right now. Try again in a moment." });
  });
});

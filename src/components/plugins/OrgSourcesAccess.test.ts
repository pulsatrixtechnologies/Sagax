// Organization sources and access: since 2026-10-27 in Connect apps >
// Sources, its admin part (JC: one place per subject, every GitHub setting
// together); Settings > Organization keeps one link there. An organization
// admin only, as before. A saved token is a label and a hint; the secret
// field is empty until the person types one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { PerspicaxOrg } from "@/lib/perspicax-org";
import { openSettings } from "@/lib/settings-link";
import { MAX_ORG_GITHUB_TOKENS, type OrgGithubTokenPublic } from "../../../shared/org-github-tokens";
import { PerspicaxOrgSettings } from "../PerspicaxOrgSettings";
import { marketplacePolicyBody, OrgSourcesAccess } from "./OrgSourcesAccess";

// an admin sees OrgTeamSecrets (#932), which reads the bots from the store
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [] }, dispatch: vi.fn() }),
}));

afterEach(() => setLocale("en"));

type Settings = PerspicaxOrg["settings"];
const base: Settings = { pluginMarketplaces: { mode: "any" }, github: { clientId: null, fromEnvironment: false } };

function page(settings: Partial<Settings> = {}) {
  return renderToStaticMarkup(createElement(OrgSourcesAccess, { initial: { ...base, ...settings } }));
}

function entry(index: number, hint = "1111"): OrgGithubTokenPublic {
  return { id: `gt_${index.toString(16).padStart(16, "0")}`, label: `Group ${index}`, hint };
}

const org = (viewerRole: "admin" | "member"): PerspicaxOrg => ({
  org: { name: "Acme", identity: { kind: "perspicax", issuer: "https://px.example.test" } },
  link: { state: "ok" },
  viewerRole,
  settings: { ...base, githubTokens: [entry(1)] },
});

describe("Organization sources and access", () => {
  it("is no longer in Settings > Organization: an admin finds one link to Connect apps > Sources, a member nothing", () => {
    const admin = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("admin"), onChanged: () => {} }));
    expect(admin).toContain('data-settings-card="organization.plugins"');
    expect(admin).toContain("data-org-sources-moved");
    expect(admin).toContain("managed in Connect Apps &gt; Sources");
    expect(admin).toContain("Open Sources");
    expect(admin).not.toContain("data-org-plugin-policy");
    expect(admin).not.toContain("data-github-token-add");
    expect(admin).not.toContain("Ov23li");
    const member = renderToStaticMarkup(createElement(PerspicaxOrgSettings, { org: org("member"), onChanged: () => {} }));
    expect(member).not.toContain("Allowed marketplaces");
    expect(member).not.toContain('data-settings-card="organization.plugins"');
  });

  it("keeps the three settings and offers an add form when nothing is saved", () => {
    const html = page();
    expect(html).toContain("data-plugins-org-access");
    expect(html).toContain("Organization sources and access");
    expect(html).toContain("Allowed marketplaces");
    expect(html).toContain("GitHub OAuth App (Connect GitHub)");
    expect(html).toContain('data-github-tokens="empty"');
    expect(html).toContain("No access token yet.");
    expect(html).toContain("data-github-token-add");
    expect(html).toContain('type="password"');
    expect(html).toContain("Add token");
    expect(html).not.toContain("data-github-token=");
  });

  it("lists the label and the hint, with edit, replace and remove, and never a token", () => {
    const html = page({ githubTokens: [entry(1, "1111"), { id: "gt_0000000000000002", label: "Depot interne", hint: "saved" }] });
    expect(html).toContain('data-github-token="gt_0000000000000001"');
    expect(html).toContain("Group 1");
    expect(html).toContain(">1111<");
    expect(html).toContain(">saved<");
    expect(html).toContain("Edit label");
    expect(html).toContain("Replace secret");
    expect(html).toContain("Remove");
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/);
  });

  it("says it in French", () => {
    setLocale("fr");
    const html = page({ githubTokens: [{ id: "gt_0000000000000002", label: "Depot interne", hint: "saved" }] });
    const shown = (text: string) => html.includes(text) || html.includes(text.replaceAll("'", "&#x27;"));
    expect(shown("Sources et accès de l'organisation")).toBe(true);
    expect(shown("Jetons d'accès GitHub")).toBe(true);
    expect(html).toContain("enregistré");
    expect(html).toContain("Ajouter un jeton");
    expect(html).toContain("Marketplaces autorisés");
  });

  it("hides the add form at the limit and when the list cannot be read", () => {
    const full = page({ githubTokens: Array.from({ length: MAX_ORG_GITHUB_TOKENS }, (_, index) => entry(index)) });
    expect(full).toContain('data-github-tokens="limit"');
    expect(full).not.toContain("data-github-token-add");
    const unread = page({ githubTokens: [], githubTokensUnavailable: true });
    expect(unread).toContain("data-github-tokens-unavailable");
    expect(unread).not.toContain("data-github-token-add");
  });

  it("sends the marketplace list the route accepts", () => {
    expect(marketplacePolicyBody("any", "ignored")).toEqual({ mode: "any" });
    expect(marketplacePolicyBody("list", " acme/tools \n\nexample-org/*, https://git.example.test/m.git ")).toEqual({
      mode: "list", allow: ["acme/tools", "example-org/*", "https://git.example.test/m.git"],
    });
  });

  it("an old link to the card opens Connect apps on Sources", () => {
    const actions: unknown[] = [];
    openSettings((action) => actions.push(action), "organization", "organization.plugins");
    expect(actions).toEqual([{ type: "togglePlugins", open: true, page: "sources" }]);
  });
});

// Settings > Organization > Plugins and GitHub: the access-token list stays
// on the same card as Allowed marketplaces. A saved token is a label and a
// hint. The secret field is empty until the person types one.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { MAX_ORG_GITHUB_TOKENS, type OrgGithubTokenPublic } from "../../../shared/org-github-tokens";
import { OrgPluginPolicy } from "./OrgPluginPolicy";

afterEach(() => setLocale("en"));

const github = { clientId: null, fromEnvironment: false };
const marketplaces = { mode: "any" as const };

function page(props: { tokens?: OrgGithubTokenPublic[]; tokensUnavailable?: boolean } = {}) {
  return renderToStaticMarkup(createElement(OrgPluginPolicy, { marketplaces, github, ...props }));
}

function entry(index: number, hint = "1111"): OrgGithubTokenPublic {
  return { id: `gt_${index.toString(16).padStart(16, "0")}`, label: `Group ${index}`, hint };
}

describe("Plugins and GitHub access tokens", () => {
  it("keeps Allowed marketplaces and offers an add form when nothing is saved", () => {
    const html = page();
    expect(html).toContain("Allowed marketplaces");
    expect(html).toContain("GitHub OAuth App (Connect GitHub)");
    expect(html).toContain('data-github-tokens="empty"');
    expect(html).toContain("No access token yet.");
    expect(html).toContain('data-github-token-add');
    expect(html).toContain('type="password"');
    expect(html).toContain("Add token");
    expect(html).not.toContain("data-github-token=");
  });

  it("lists the label and the hint, with edit, replace and remove", () => {
    const html = page({ tokens: [entry(1, "1111"), { id: "gt_0000000000000002", label: "Depot interne", hint: "saved" }] });
    expect(html).toContain('data-github-token="gt_0000000000000001"');
    expect(html).toContain("Group 1");
    expect(html).toContain(">1111<");
    expect(html).toContain("Depot interne");
    expect(html).toContain(">saved<");
    expect(html).toContain("Edit label");
    expect(html).toContain("Replace secret");
    expect(html).toContain("Remove");
    expect(html).toContain("Allowed marketplaces");
    expect(html).not.toContain("fake-alpha-token-1111");
  });

  it("says the list in French and translates the saved hint", () => {
    setLocale("fr");
    const html = page({ tokens: [{ id: "gt_0000000000000002", label: "Depot interne", hint: "saved" }] });
    const shown = (text: string) => html.includes(text) || html.includes(text.replaceAll("'", "&#x27;"));
    expect(shown("Jetons d'accès GitHub")).toBe(true);
    expect(html).toContain("Depot interne");
    expect(html).toContain("enregistré");
    expect(html).not.toContain(">saved<");
    expect(shown("Modifier l'étiquette")).toBe(true);
    expect(html).toContain("Remplacer le secret");
    expect(html).toContain("Ajouter un jeton");
    expect(html).toContain("Marketplaces autorisés");
  });

  it("hides the add form at the limit and when the list cannot be read", () => {
    const full = page({ tokens: Array.from({ length: MAX_ORG_GITHUB_TOKENS }, (_, index) => entry(index)) });
    expect(full).toContain('data-github-tokens="limit"');
    expect(full).toContain("The limit is 20 tokens. Remove one to add another.");
    expect(full).not.toContain("data-github-token-add");
    expect(full).toContain("Allowed marketplaces");
    const unread = page({ tokens: [], tokensUnavailable: true });
    expect(unread).toContain("data-github-tokens-unavailable");
    expect(unread).toContain("The saved tokens could not be read. Nothing was changed.");
    expect(unread).not.toContain("data-github-tokens-empty");
    expect(unread).not.toContain("data-github-token-add");
  });
});

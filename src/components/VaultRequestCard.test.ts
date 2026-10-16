// A bot's request_login card: pending it offers the person's matching
// logins (loaded after mount), answered it folds into one line that names
// the login and how it was allowed, never a value.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: vi.fn(), state: { bots: [{ id: "bot-1", name: "Ada" }] } }),
}));

import { SecretRequestCard } from "./SecretRequestCard";
import { matchingItems, createCredentialDraft } from "@/lib/credential-vault";
import type { VaultItemListing } from "../../shared/credential-vault";

const card = (secret: Record<string, unknown>): Message => ({
  id: "vault-card",
  role: "bot",
  kind: "secret",
  at: 1,
  text: "Login for example.test",
  secret: {
    target: "vaultLogin",
    label: "Login for example.test",
    description: "Ada asks to sign in to example.test.",
    placeholder: "",
    helpUrl: "",
    requestKey: "request-key-1",
    vault: { principalId: "local", domain: "example.test" },
    ...secret,
  },
} as Message);

const view = (secret: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(SecretRequestCard, { botId: "bot-1", threadId: "thread-1", message: card(secret) }));

beforeEach(() => { vi.stubGlobal("window", {}); });

describe("VaultRequestCard", () => {
  it("asks for a login, without a key field, while pending", () => {
    const html = view();
    expect(html).toContain("Login for example.test");
    expect(html).toContain("Ada asks to sign in to example.test");
    expect(html).not.toContain("Save securely");
    expect(html).not.toContain('type="password"');
  });

  it("folds into one line once allowed, naming the login and the grant", () => {
    const html = view({ provided: true, resumed: true, vault: { principalId: "local", domain: "example.test", itemId: "abc", itemName: "Example portal", mode: "always" } });
    expect(html).toContain("Login &quot;Example portal&quot; allowed");
    expect(html).toContain("always for Ada");
    expect(html).toContain('data-ask-card="settled"');
  });

  it("says when the person declined or a newer request replaced it", () => {
    expect(view({ dismissed: true, resumed: true })).toContain("Login for example.test not shared");
    expect(view({ superseded: true })).toContain("Replaced by a newer request");
  });
});

describe("vault helpers", () => {
  const item = (over: Partial<VaultItemListing>): VaultItemListing => ({
    id: "x", kind: "login", name: "Item", domains: [], hasPassword: true, hasTotp: false, hasApiKey: false, hasNotes: false,
    source: "local", grants: [], createdAt: 0, updatedAt: 0, ...over,
  });

  it("offers items bound to the asked site or named like the request, never notes", () => {
    const items = [
      item({ id: "a", name: "Portal", domains: ["example.test"] }),
      item({ id: "b", name: "Billing", domains: ["billing.test"] }),
      item({ id: "c", kind: "note", name: "Example note", domains: [] }),
      item({ id: "d", name: "Look-alike", domains: ["example.test.evil.test"] }),
    ];
    expect(matchingItems(items, { domain: "example.test" }).map((row) => row.id)).toEqual(["a"]);
    expect(matchingItems(items, { domain: "sso.example.test" })).toEqual([]);
    expect(matchingItems(items, { name: "bill" }).map((row) => row.id)).toEqual(["b"]);
    expect(matchingItems(items, { name: "example" }).map((row) => row.id)).toEqual([]);
  });

  it("leaves empty optional fields out of a new login", () => {
    expect(createCredentialDraft({ name: " Portal ", domains: ["example.test"], username: "", password: "fake-pass", totpSeed: " " }))
      .toEqual({ kind: "login", name: "Portal", domains: ["example.test"], password: "fake-pass" });
  });
});

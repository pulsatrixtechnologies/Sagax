// The Full access confirmation: localized, with an organization variant.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ api }));

import { setLocale } from "@/lib/i18n";
import { FullAccessWarning } from "./FullAccessWarning";

const render = (scope: "bot" | "thread" | "organization") =>
  renderToStaticMarkup(createElement(FullAccessWarning, { open: true, scope, onCancel: vi.fn(), onConfirm: vi.fn() }));

afterEach(() => { setLocale("en"); api.mockReset(); });

describe("Full access confirmation", () => {
  it("explains the risks and the organization's limits on an organization server", () => {
    const html = render("organization");
    expect(html).toContain("Enable Full access?");
    expect(html).toContain("You confirm this once for this bot");
    expect(html).toContain("nothing runs on the Sagax server itself");
    expect(html).toContain("Enable full access");
    expect(html).not.toContain("Apply to all existing and future threads");
  });

  it("speaks French", () => {
    setLocale("fr");
    const html = render("organization");
    expect(html).toContain("Activer l&#x27;accès complet ?");
    expect(html).toContain("Vous le confirmez une seule fois pour ce bot");
  });

  it("keeps the thread wording in the composer of a solo desktop", () => {
    expect(render("thread")).toContain("Enable Full access for this thread only");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AutoModelStatus } from "./AutoModelSettings";
import type { AutoModelPreview } from "../../../shared/auto-model";

const status: AutoModelPreview = { auto: true, pick: null, backups: [], chain: [
  { instanceId: "first", engineLabel: "My subscription", model: "large", modelLabel: "Large" },
  { instanceId: "second", engineLabel: "My computer", model: "small", modelLabel: "Small" },
], excluded: [
  { instanceId: "third", engineLabel: "Offline provider", reason: "offline" },
  { instanceId: "first", engineLabel: "My subscription", model: "old", modelLabel: "Old", reason: "modelOff" },
] };

describe("the Auto dispatch preview", () => {
  it("shows the server's ordered chain and exclusion reasons", () => {
    const html = renderToStaticMarkup(createElement(AutoModelStatus, { status }));
    expect(html.indexOf("Large")).toBeLessThan(html.indexOf("Small"));
    expect(html).toContain("data-auto-model-excluded");
    expect(html).toContain("Offline provider");
    expect(html).toContain("Old");
    expect(html).toContain("Model turned off");
    expect(html).not.toContain("/api/");
  });
  it("says when no model is eligible instead of presenting a base that cannot run", () => {
    const html = renderToStaticMarkup(createElement(AutoModelStatus, { status: { ...status, chain: [] } }));
    expect(html).toContain("No active model");expect(html).not.toContain("data-auto-model-chain");
  });
  it("identifies a preview still loading", () => {
    expect(renderToStaticMarkup(createElement(AutoModelStatus, { status: null }))).toContain('role="status"');
  });
});

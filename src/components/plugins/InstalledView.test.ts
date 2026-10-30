import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it } from "vitest";
import { capabilityFixture } from "@/lib/capabilities.fixture";
import { setLocale } from "@/lib/i18n";
import { installedEntries } from "@/lib/installed-model";
import { buildPluginItems } from "@/lib/plugins-model";
import { InstalledView, type InstalledViewProps } from "./InstalledView";

const noop = () => {};
const entries = installedEntries(buildPluginItems({ servers: [{ name: "Historical entry", enabled: true, url: "https://example.test/mcp", auth: "connected" }] }));
const render = (extra: Partial<InstalledViewProps> = {}) => renderToStaticMarkup(createElement(InstalledView, {
  entries, skills: [], sourceLabel: (source) => source, onOpenEntry: noop, onOpenSkill: noop, entryActions: () => ({}), ...extra,
}));
beforeEach(() => setLocale("en"));

it("keeps a bot's Installed view on the resolver through loading, error and recovery", () => {
  const pending = render({ resolved: null });
  expect(pending).toContain('role="status"');
  expect(pending).not.toContain("Historical entry");
  const failed = render({ resolved: null, resolvedError: "offline", onRetryResolved: noop });
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("Retry");
  expect(failed).not.toContain("Historical entry");
  const ready = render({ resolved: capabilityFixture() });
  expect(ready).toContain('data-capability="');
  expect(ready).not.toContain("Historical entry");
  expect(ready).not.toContain('role="alert"');
  // The organization scope still uses its own installation inventory.
  expect(render()).toContain("Historical entry");
});

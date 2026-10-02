import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThreadConcurrencySettings } from "./ThreadConcurrencySettings";

const fixture = vi.hoisted(() => ({ limit: undefined as number | undefined }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { config: { threads: fixture.limit === undefined ? undefined : { maxConcurrentPerBot: fixture.limit } } }, dispatch: vi.fn() }),
}));

describe("ThreadConcurrencySettings", () => {
  it("keeps three as the legacy default and offers one through ten", () => {
    fixture.limit = undefined;
    const markup = renderToStaticMarkup(createElement(ThreadConcurrencySettings));
    expect(markup).toContain('value="3" selected=""');
    const concurrency = markup.slice(markup.indexOf('id="thread-concurrency"'), markup.indexOf("</select>"));
    expect(concurrency.match(/<option /g)).toHaveLength(10);
    expect(markup).toContain('value="10"');
    expect(markup).toContain("Extra messages queue until a slot opens.");
    expect(markup).toContain("Maximum running threads per bot");
  });
  it("offers the busy-send default and the per-person parallel limit (three by default)", () => {
    fixture.limit = undefined;
    const markup = renderToStaticMarkup(createElement(ThreadConcurrencySettings));
    expect(markup).toContain('id="busy-send-default"');
    expect(markup).toContain('value="ask" selected=""');
    expect(markup).toContain("New task in parallel");
    const parallel = markup.slice(markup.indexOf('id="parallel-limit"'));
    expect(parallel).toContain('value="3" selected=""');
    expect(parallel.slice(0, parallel.indexOf("</select>")).match(/<option /g)).toHaveLength(10);
  });
  it("shows the confirmed server value", () => {
    fixture.limit = 10;
    expect(renderToStaticMarkup(createElement(ThreadConcurrencySettings))).toContain('value="10" selected=""');
  });
});

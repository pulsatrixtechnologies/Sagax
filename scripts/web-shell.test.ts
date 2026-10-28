import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("offline web shell", () => {
  const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("registers one shell worker and does not cache private API responses", () => {
    expect(page).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(worker).toContain('const CACHE = "sagax-shell-v1"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain("event.request.method !== \"GET\"");
    expect(worker).toContain('cache.match("/index.html")');
  });
});

// The sealed store: the key is encrypted at rest, per person on an
// organization server, and the view never carries it.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWebSearchStore, webSearchScope } from "./store.ts";

const KEY = "test-key-not-real-0000-wxyz";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-web-search-"));
  dirs.push(dir);
  const vault = randomBytes(32);
  return { dir, store: createWebSearchStore(dir, () => ({ kind: "key", key: vault })) };
}

describe("web search store", () => {
  it("seals the key and answers only whether one is saved", () => {
    const { dir, store } = setup();
    const solo = webSearchScope(false, null)!;
    const view = store.save(solo, { provider: "brave", key: KEY });
    expect(view).toEqual({ provider: "brave", baseUrl: null, keyConfigured: true, last4: "wxyz", ready: true });
    expect(JSON.stringify(view)).not.toContain(KEY);
    const raw = readFileSync(join(dir, "web-search.enc"), "utf8");
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain("brave");
    if (process.platform !== "win32") expect(statSync(join(dir, "web-search.enc")).mode & 0o777).toBe(0o600);
    expect(store.config(solo)).toEqual({ provider: "brave", key: KEY });
  });

  it("keeps the saved key when the provider stays, drops it when it changes", () => {
    const { store } = setup();
    const solo = webSearchScope(false, null)!;
    store.save(solo, { provider: "exa", key: KEY });
    expect(store.save(solo, { provider: "exa" }).keyConfigured).toBe(true);
    const moved = store.save(solo, { provider: "searxng", baseUrl: "https://s.example" });
    expect(moved).toMatchObject({ provider: "searxng", keyConfigured: false, ready: true, baseUrl: "https://s.example" });
    expect(store.save(solo, { provider: "brave" }).ready).toBe(false);
  });

  it("is one file per person on an organization server", () => {
    const { dir, store } = setup();
    expect(webSearchScope(true, null)).toBeNull();
    expect(webSearchScope(true, "../x")).toBeNull();
    const ada = webSearchScope(true, "pr_ada")!;
    const bob = webSearchScope(true, "pr_bob")!;
    store.save(ada, { provider: "firecrawl", key: KEY });
    expect(store.ready(ada)).toBe(true);
    expect(store.ready(bob)).toBe(false);
    expect(store.view(bob).provider).toBeNull();
    readFileSync(join(dir, "principals", "pr_ada", "web-search.enc"), "utf8");
    store.remove(ada);
    expect(store.config(ada)).toBeNull();
  });

  it("reads nothing under another vault key", () => {
    const { dir, store } = setup();
    const solo = webSearchScope(false, null)!;
    store.save(solo, { provider: "brave", key: KEY });
    const other = createWebSearchStore(dir, () => ({ kind: "key", key: randomBytes(32) }));
    expect(other.config(solo)).toBeNull();
    expect(other.ready(solo)).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOCAL_REFRESH_FRESH_MS, localModelRows, localRowUnavailable, refreshLocalModelsOnOpen, resetLocalRefreshCache, runsLoopbackModels } from "./local-models";
import { localModelLabels, localModelUnavailable } from "../../shared/local-model-engines";

const rows = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "dwarfstar::qwen3.8-flash-next", label: "DwarfStar: Qwen3.8 Flash Next", custom: true, local: true },
  { id: "deskab12cd8002::qwen3.8-flash-next-chat", label: "DwarfStar: Qwen3.8 Flash Next", custom: true, local: true },
  { id: "openrouter/some-model", label: "Some model", custom: true },
];

describe("local model rows", () => {
  it("groups this machine's and the person's computer's models in solo", () => {
    expect(localModelRows(rows, false).map((row) => row.id)).toEqual(["dwarfstar::qwen3.8-flash-next", "deskab12cd8002::qwen3.8-flash-next-chat"]);
  });

  it("keeps only the person's own computer on an organization server, even from an older server without the local flag", () => {
    expect(localModelRows(rows, true).map((row) => row.id)).toEqual(["deskab12cd8002::qwen3.8-flash-next-chat"]);
    expect(localModelRows([{ id: "deskab12cd8002::qwen3", label: "qwen3", custom: true }], true)).toHaveLength(1);
  });
});

describe("which engines run a local model", () => {
  it("lets every engine that takes an OpenAI-compatible base URL run both kinds", () => {
    for (const kind of ["piAgent", "codex", "grokAgent", "kimiAgent", "qwenAgent", "droidAgent", "hermesAgent", "opencodeGo"]) {
      expect(localModelUnavailable(kind, "loopback")).toBeNull();
      expect(localModelUnavailable(kind, "desktop")).toBeNull();
    }
  });

  it("lets Claude Code use a loopback server but not the computer link", () => {
    expect(localModelUnavailable("claudeAgent", "loopback")).toBeNull();
    expect(localModelUnavailable("claudeAgent", "desktop")).toBe("anthropic");
    expect(localRowUnavailable("claudeAgent", "deskab12cd8002::qwen3")).toBe("anthropic");
    expect(localRowUnavailable("claudeAgent", "dwarfstar::qwen3")).toBeNull();
  });

  it("refuses engines that keep their own endpoint", () => {
    for (const kind of ["geminiAgent", "openai-compat", "customAcp", "boxAgent", "grok", "cursorAgent", undefined]) {
      expect(localModelUnavailable(kind, "loopback")).toBe("engine");
      expect(runsLoopbackModels(kind)).toBe(false);
    }
    expect(runsLoopbackModels("piAgent")).toBe(true);
  });
});

describe("local model labels", () => {
  it("reads 'Server: Name' and keeps ids apart when several share a name", () => {
    const labels = localModelLabels("DwarfStar", [
      { id: "qwen3.8-flash-next", name: "Qwen3.8 Flash Next" },
      { id: "qwen3.8-flash-next-chat", name: "Qwen3.8 Flash Next" },
      { id: "solo", name: "Solo Model" },
      { id: "bare" },
    ]);
    expect([...labels.values()]).toEqual([
      "DwarfStar: Qwen3.8 Flash Next (qwen3.8-flash-next)",
      "DwarfStar: Qwen3.8 Flash Next (qwen3.8-flash-next-chat)",
      "DwarfStar: Solo Model",
      "DwarfStar: bare",
    ]);
    expect(localModelLabels("", [{ id: "x", name: "X" }]).get("x")).toBe("X");
  });
});

describe("refresh when the picker opens", () => {
  beforeEach(() => resetLocalRefreshCache());

  it("re-reads the engine catalog in solo, then reuses it while it is fresh", async () => {
    let now = 1_000;
    const refreshModels = vi.fn(() => Promise.resolve());
    await refreshLocalModelsOnOpen({ key: "claude", orgMode: false, refreshModels, now: () => now });
    await refreshLocalModelsOnOpen({ key: "claude", orgMode: false, refreshModels, now: () => now });
    expect(refreshModels).toHaveBeenCalledTimes(1);
    now += LOCAL_REFRESH_FRESH_MS;
    await refreshLocalModelsOnOpen({ key: "claude", orgMode: false, refreshModels, now: () => now });
    expect(refreshModels).toHaveBeenCalledTimes(2);
    // Another engine has its own cache entry.
    await refreshLocalModelsOnOpen({ key: "pi", orgMode: false, refreshModels, now: () => now });
    expect(refreshModels).toHaveBeenCalledTimes(3);
  });

  it("asks the desktop app to probe the person's computer, then reloads the server's catalog", async () => {
    const order: string[] = [];
    const bridgeRefresh = vi.fn(async () => { order.push("bridge"); return { refreshed: true }; });
    const reload = vi.fn(async () => { order.push("reload"); });
    const refreshModels = vi.fn(() => Promise.resolve());
    await refreshLocalModelsOnOpen({ key: "desktop", orgMode: true, bridgeRefresh, reload, refreshModels });
    expect(order).toEqual(["bridge", "reload"]);
    // The server's own machine is never probed for the picker.
    expect(refreshModels).not.toHaveBeenCalled();
  });

  it("shares one probe between overlapping opens and never rejects", async () => {
    let release!: () => void;
    const refreshModels = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = refreshLocalModelsOnOpen({ key: "claude", orgMode: false, refreshModels });
    const second = refreshLocalModelsOnOpen({ key: "claude", orgMode: false, refreshModels });
    expect(refreshModels).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    await expect(refreshLocalModelsOnOpen({ key: "down", orgMode: false, refreshModels: () => Promise.reject(new Error("offline")) })).resolves.toBeUndefined();
    await expect(refreshLocalModelsOnOpen({ key: "older-desktop", orgMode: true })).resolves.toBeUndefined();
  });
});

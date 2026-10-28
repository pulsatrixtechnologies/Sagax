import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applySignedBrowserHeaders } from "./web-bot-auth-apply.ts";
import { signBrowserVisit, verifyBrowserVisit, WebBotAuthStore, webBotAuthScope } from "./web-bot-auth.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function store() {
  const dir = mkdtempSync(join(tmpdir(), "sagax-web-bot-auth-"));
  dirs.push(dir);
  return new WebBotAuthStore(dir);
}

describe("web bot auth", () => {
  it("is on until the person turns it off, and one person does not change another", () => {
    const saved = store();
    const ada = webBotAuthScope(true, "pr_ada");
    const bob = webBotAuthScope(true, "pr_bob");
    expect(ada && bob).toBeTruthy();
    if (!ada || !bob) return;
    expect(saved.enabled(ada)).toBe(true);
    saved.setEnabled(ada, false);
    expect(saved.enabled(ada)).toBe(false);
    expect(saved.enabled(bob)).toBe(true);
    expect(saved.view(ada).enabled).toBe(false);
    expect(JSON.stringify(saved.view(ada))).not.toMatch(/pkcs8|private/i);
  });

  it("signs a visit the public key can verify, and never a login header", () => {
    const saved = store();
    const scope = webBotAuthScope(false, null);
    expect(scope).toEqual({ organization: false });
    if (!scope) return;
    const now = 1_700_000_000_000;
    const signed = signBrowserVisit(saved.material(scope), now);
    expect(Object.keys(signed.headers).sort()).toEqual(["Signature", "Signature-Agent", "Signature-Input"]);
    expect(verifyBrowserVisit(signed.headers, now)).toBe(true);
    expect(verifyBrowserVisit(signed.headers, now + 601_000)).toBe(false);
    const tampered = { ...signed.headers, Signature: signed.headers.Signature!.replace(/.$/, "A") };
    expect(verifyBrowserVisit(tampered, now)).toBe(false);
  });

  it("runs the engine with arguments, not a shell", async () => {
    const seen: Array<{ command: string; args: readonly string[]; shell: unknown }> = [];
    const spawnImpl = ((command: string, args: readonly string[], options: { shell?: unknown }) => {
      seen.push({ command, args, shell: options.shell });
      const handlers = new Map<string, (code?: number) => void>();
      return {
        kill() {},
        on(event: string, fn: (code?: number) => void) {
          handlers.set(event, fn);
          if (event === "close") queueMicrotask(() => fn(0));
          return this;
        },
      };
    }) as unknown as Parameters<typeof applySignedBrowserHeaders>[3];
    await applySignedBrowserHeaders("/engine/browser", { PATH: "/usr/bin" }, { "Signature-Agent": "data:application/json,{}" }, spawnImpl);
    expect(seen).toEqual([{
      command: "/engine/browser",
      args: ["set", "headers", JSON.stringify({ "Signature-Agent": "data:application/json,{}" })],
      shell: false,
    }]);
    await expect(applySignedBrowserHeaders("/engine/browser", {}, { Authorization: "Bearer x" }, spawnImpl)).rejects.toThrow(/not a login/);
  });
});

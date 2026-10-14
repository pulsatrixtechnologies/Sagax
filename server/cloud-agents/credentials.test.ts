import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CloudAgentCredentialStore } from "./credentials.ts";

const vaultKey = Buffer.alloc(32, 9);
const keySource = () => ({ kind: "key" as const, key: vaultKey });

describe("CloudAgentCredentialStore", () => {
  let dataDir = "";
  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    dataDir = "";
  });

  // Regression (2026-10-14): Settings showed
  // [{"expected":"object","code":"invalid_type","path":["providers","codex"],...}]
  // because the saved file had no codex entry and the schema required one.
  it("reads a saved file that has no entry for codex (or any other provider)", () => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-cloud-creds-"));
    const writer = new CloudAgentCredentialStore(dataDir, keySource);
    writer.set("pr_test", "cursor", "tok_cursor_1234");
    writer.set("pr_test", "claude", "tok_claude_5678");

    // A fresh store reads the encrypted file from disk, as after a restart.
    const reader = new CloudAgentCredentialStore(dataDir, keySource);
    expect(reader.list("pr_test")).toEqual([
      { provider: "cursor", configured: true, last4: "1234" },
      { provider: "claude", configured: true, last4: "5678" },
      { provider: "codex", configured: false },
    ]);
    expect(reader.token("pr_test", "codex")).toBeNull();
  });

  it("reads a file with only codex too", () => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-cloud-creds-"));
    new CloudAgentCredentialStore(dataDir, keySource).set("pr_test", "codex", "tok_codex_9999");
    const reader = new CloudAgentCredentialStore(dataDir, keySource);
    expect(reader.list("pr_test").filter((row) => row.configured).map((row) => row.provider)).toEqual(["codex"]);
  });

  it("says the keys could not be read, never the schema issue list", () => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-cloud-creds-"));
    const store = new CloudAgentCredentialStore(dataDir, keySource);
    store.set("pr_test", "cursor", "tok_cursor_1234");
    // Rewrite the file with a document of the wrong shape, encrypted the same way.
    const shaped = store as unknown as { write: (id: string, doc: unknown) => void };
    shaped.write("pr_test", { version: 1, providers: { cursor: { token: "" } } });
    const reader = new CloudAgentCredentialStore(dataDir, keySource);
    let message = "";
    try {
      reader.list("pr_test");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("The saved cloud agent keys could not be read.");
    expect(message).not.toContain("invalid_type");
  });

  it("starts empty when nothing was saved", () => {
    dataDir = mkdtempSync(join(tmpdir(), "sagax-cloud-creds-"));
    expect(new CloudAgentCredentialStore(dataDir, keySource).list("pr_none").every((row) => !row.configured)).toBe(true);
  });
});

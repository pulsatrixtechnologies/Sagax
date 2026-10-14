import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { combineTrivyignore } from "./combine-trivyignore.mjs";

const script = join(import.meta.dirname, "combine-trivyignore.mjs");

/** Fictional ids only. */
const PUBLIC_ID = "CVE-0000-1001";
const PRIVATE_ID = "CVE-0000-9001";
const OVERLAP_ID = "CVE-0000-1001";

function listed(id) {
  return `# Debian no-dsa. Review 2026-11-13\n${id}\n`;
}

function withTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), "combine-trivyignore-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runCli({ publicText, privateText, privateEnv, extraArgs = [] } = {}) {
  return withTemp((dir) => {
    const publicPath = join(dir, "public.ignore");
    const out = join(dir, "combined.ignore");
    writeFileSync(publicPath, publicText);
    const env = { ...process.env };
    const args = [script, "--public", publicPath, "--out", out, ...extraArgs];
    if (privateEnv) {
      env[privateEnv] = privateText;
      args.push("--private-env", privateEnv);
    } else if (privateText !== undefined) {
      const privatePath = join(dir, "private.ignore");
      writeFileSync(privatePath, privateText);
      args.push("--private-file", privatePath);
    } else {
      args.push("--private-env", "MISSING_PRIVATE_LIST");
      delete env.MISSING_PRIVATE_LIST;
    }
    const result = spawnSync(process.execPath, args, { encoding: "utf8", env });
    let combined = "";
    let publicAfter = publicText;
    let outMode = 0;
    try {
      combined = readFileSync(out, "utf8");
      publicAfter = readFileSync(publicPath, "utf8");
      outMode = statSync(out).mode & 0o777;
    } catch {
      combined = "";
    }
    return { ...result, out, publicPath, combined, publicAfter, outMode };
  });
}

describe("combineTrivyignore", () => {
  it("fails closed when the private list is missing or blank", () => {
    const publicText = listed(PUBLIC_ID);
    expect(combineTrivyignore({ publicText, privateText: "" }).ok).toBe(false);
    expect(combineTrivyignore({ publicText, privateText: "   \n" }).errors).toEqual([
      "private exception list is missing",
    ]);
    const missing = runCli({ publicText });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/private exception list is missing/);
  });

  it("fails closed on an unusable private list without echoing it", () => {
    const publicText = listed(PUBLIC_ID);
    const privateText = `${PRIVATE_ID}\n`;
    const result = combineTrivyignore({ publicText, privateText });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["private exception list is unusable"]);
    expect(result.errors.join("\n")).not.toContain(PRIVATE_ID);

    const cli = runCli({ publicText, privateText });
    expect(cli.status).not.toBe(0);
    expect(cli.stderr).toMatch(/private exception list is unusable/);
    expect(cli.stderr).not.toContain(PRIVATE_ID);
    expect(cli.stdout).not.toContain(PRIVATE_ID);
  });

  it("writes public then extra private ids and leaves the public file unchanged", () => {
    const publicText = listed(PUBLIC_ID);
    const privateText = listed(PRIVATE_ID);
    const result = combineTrivyignore({ publicText, privateText });
    expect(result.ok).toBe(true);
    expect(result.publicCount).toBe(1);
    expect(result.privateCount).toBe(1);
    expect(result.combinedCount).toBe(2);
    expect(result.text).toContain(PUBLIC_ID);
    expect(result.text).toContain(PRIVATE_ID);

    const cli = runCli({ publicText, privateText });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toMatch(/combined public=1 private=1 unique=2/);
    expect(cli.stdout).not.toContain(PRIVATE_ID);
    expect(cli.combined).toContain(PRIVATE_ID);
    expect(cli.publicAfter).toBe(publicText);
    expect(cli.outMode).toBe(0o600);
  });

  it("drops a private id already present in the public file", () => {
    const publicText = listed(PUBLIC_ID);
    const privateText = listed(OVERLAP_ID);
    const result = combineTrivyignore({ publicText, privateText });
    expect(result.ok).toBe(true);
    expect(result.combinedCount).toBe(1);
    expect(result.text.match(new RegExp(PUBLIC_ID, "g"))).toHaveLength(1);
  });
});

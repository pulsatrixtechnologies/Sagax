import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NPM_RUNTIME_PATCHES,
  PIP_RUNTIME_PATCHES,
  cmpVersion,
  findPackageDirs,
  findVenvPips,
  needsBump,
  parseArgs,
  patchNpmTree,
  patchPipTrees,
  readPackageVersion,
} from "./harden-image-deps.mjs";

describe("runtime overlay pins", () => {
  it("pins piscina and sharp to the releases that close the image scan, with sha512", () => {
    expect(NPM_RUNTIME_PATCHES.map((patch) => `${patch.name}@${patch.version}`)).toEqual([
      "piscina@4.9.4",
      "sharp@0.35.5",
    ]);
    for (const patch of NPM_RUNTIME_PATCHES) {
      expect(patch.integrity, patch.name).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    }
  });

  it("pins the Hermes venv packages that had a fix", () => {
    expect(PIP_RUNTIME_PATCHES.map((patch) => patch.spec)).toEqual([
      "PyJWT==2.15.1",
      "httpx2==2.13.1",
      "httpcore2==2.13.1",
    ]);
  });
});

describe("cmpVersion", () => {
  it("orders dotted versions", () => {
    expect(cmpVersion("4.9.3", "4.9.4")).toBe(-1);
    expect(cmpVersion("4.9.4", "4.9.3")).toBe(1);
    expect(cmpVersion("4.9.4", "4.9.4")).toBe(0);
    expect(cmpVersion("0.35.4", "0.35.5")).toBe(-1);
    expect(needsBump("4.9.3", "4.9.4")).toBe(true);
    expect(needsBump("4.9.4", "4.9.4")).toBe(false);
    expect(needsBump("5.0.0", "4.9.4")).toBe(false);
  });
});

describe("findPackageDirs", () => {
  it("returns each nested copy and skips a missing root", () => {
    expect(findPackageDirs("/no/such/root", "piscina")).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), "harden-find-"));
    try {
      const nested = join(root, "cursor", "node_modules", "piscina");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "piscina", version: "4.9.3" }));
      const extra = join(root, "other", "node_modules", "leftpad");
      mkdirSync(extra, { recursive: true });
      writeFileSync(join(extra, "package.json"), JSON.stringify({ name: "leftpad", version: "1.0.0" }));
      expect(findPackageDirs(root, "piscina")).toEqual([nested]);
      expect(readPackageVersion(nested)).toBe("4.9.3");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("patchNpmTree", () => {
  it("overlays only an older copy and checks integrity through fetchPkg", async () => {
    const root = mkdtempSync(join(tmpdir(), "harden-npm-"));
    try {
      const oldDir = join(root, "node_modules", "piscina");
      const currentDir = join(root, "keep", "node_modules", "piscina");
      mkdirSync(oldDir, { recursive: true });
      mkdirSync(currentDir, { recursive: true });
      writeFileSync(join(oldDir, "package.json"), JSON.stringify({ name: "piscina", version: "4.9.3" }));
      writeFileSync(join(currentDir, "package.json"), JSON.stringify({ name: "piscina", version: "4.9.4" }));
      const fetched = [];
      const extracted = [];
      const tarball = Buffer.from("package-tarball");
      const applied = await patchNpmTree(root, NPM_RUNTIME_PATCHES.filter((p) => p.name === "piscina"), {
        fetchPkg: async (name, version, integrity) => {
          fetched.push({ name, version, integrity });
          return tarball;
        },
        extract: (buffer, dir) => extracted.push({ buffer, dir }),
      });
      expect(fetched).toEqual([{
        name: "piscina",
        version: "4.9.4",
        integrity: NPM_RUNTIME_PATCHES[0].integrity,
      }]);
      expect(extracted).toEqual([{ buffer: tarball, dir: oldDir }]);
      expect(applied).toEqual([{ name: "piscina", from: "4.9.3", to: "4.9.4", dir: oldDir }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("patchPipTrees", () => {
  it("upgrades every venv pip with the pinned specs", () => {
    const root = mkdtempSync(join(tmpdir(), "harden-pip-"));
    try {
      const pip = join(root, "hermes", "0.21.5", "venv", "bin", "pip");
      mkdirSync(join(root, "hermes", "0.21.5", "venv", "bin"), { recursive: true });
      writeFileSync(pip, "#!/bin/sh\n", { mode: 0o755 });
      expect(findVenvPips(root)).toEqual([pip]);
      const runs = [];
      const applied = patchPipTrees(root, PIP_RUNTIME_PATCHES, {
        runPip: (bin, args) => runs.push({ bin, args }),
      });
      expect(applied).toEqual([{ pip, specs: PIP_RUNTIME_PATCHES.map((p) => p.spec) }]);
      expect(runs).toEqual([{
        bin: pip,
        args: ["install", "--no-cache-dir", "--disable-pip-version-check", "--upgrade", ...PIP_RUNTIME_PATCHES.map((p) => p.spec)],
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("parseArgs", () => {
  it("collects --root values and refuses a stray flag", () => {
    expect(parseArgs(["--root", "/opt/engines", "--root", "/usr/local/lib/node_modules"])).toEqual({
      roots: ["/opt/engines", "/usr/local/lib/node_modules"],
    });
    expect(() => parseArgs(["--root"])).toThrow(/--root needs a directory/);
    expect(() => parseArgs(["--latest"])).toThrow(/unknown argument/);
  });
});

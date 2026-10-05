import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  CLOUDFLARED_ASSETS,
  CLOUDFLARED_VERSION,
  executableTarget,
  parsePrepareCloudflaredArgs,
  releaseBytes,
  sha256,
  targetForCurrentHost,
  targetsForHost,
  targetsForPreparation,
  verifyPinnedBinary,
  verifySha256,
} from "./prepare-cloudflared.mjs";

describe("cloudflared download retries", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function mockDownload() {
    vi.useFakeTimers();
    vi.stubEnv("SAGAX_CLOUDFLARED_ARCHIVE_DIR", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("recovers from an HTTP 504 and verifies the recovered bytes normally", async () => {
    const fetchMock = mockDownload();
    const bytes = Buffer.from("downloaded release");
    fetchMock.mockResolvedValueOnce(new Response("gateway timeout", { status: 504 }))
      .mockResolvedValueOnce(new Response(bytes));
    const download = releaseBytes({ name: "cloudflared-linux-amd64" });
    await vi.runAllTimersAsync();
    const result = await download;
    expect(result).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(verifySha256(result, sha256(bytes))).toBe(sha256(bytes));
    expect(() => verifySha256(result, sha256(Buffer.from("other release")))).toThrow(/SHA-256 verification/);
  });

  it("retries a network error and an interrupted response body", async () => {
    const fetchMock = mockDownload();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => { throw new TypeError("terminated"); } })
      .mockResolvedValueOnce(new Response("complete"));
    const download = releaseBytes({ name: "cloudflared-linux-amd64" });
    await vi.runAllTimersAsync();
    expect(await download).toEqual(Buffer.from("complete"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops after three transient failures", async () => {
    const fetchMock = mockDownload();
    fetchMock.mockImplementation(async () => new Response("unavailable", { status: 503 }));
    const result = expect(releaseBytes({ name: "cloudflared-linux-amd64" })).rejects.toThrow(/HTTP 503/);
    await vi.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails immediately for a missing pinned asset", async () => {
    const fetchMock = mockDownload();
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(releaseBytes({ name: "missing" })).rejects.toThrow(/HTTP 404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

const PINNED_ASSETS = {
  "darwin-arm64": {
    name: "cloudflared-darwin-arm64.tgz",
    sha256: "587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095",
    binarySha256: "5472c1a01c84bc31b3021056a73b4e5774ddddefc572124ea8fdf6c340639f32",
    archive: true,
  },
  "darwin-x64": {
    name: "cloudflared-darwin-amd64.tgz",
    sha256: "d1155d0837487f261183b15c1eab6c4ebcad9dc49b94675f1524c3564cea3977",
    binarySha256: "ab588b3b4db9cdb4476c30a3db2a72635b1d8327d44741fee6799a0f37b0ec07",
    archive: true,
  },
  "linux-x64": {
    name: "cloudflared-linux-amd64",
    sha256: "77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2",
    binarySha256: "77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2",
    archive: false,
  },
  "linux-arm64": {
    name: "cloudflared-linux-arm64",
    sha256: "aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d",
    binarySha256: "aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d",
    archive: false,
  },
  "win32-x64": {
    name: "cloudflared-windows-amd64.exe",
    sha256: "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2",
    binarySha256: "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2",
    archive: false,
  },
  "win32-arm64": {
    name: "cloudflared-windows-amd64.exe",
    sha256: "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2",
    binarySha256: "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2",
    archive: false,
    executableTarget: "win32-x64",
  },
};

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function executableFixture(target) {
  const bytes = Buffer.alloc(128);
  if (target === "darwin-arm64" || target === "darwin-x64") {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(target === "darwin-arm64" ? 0x0100000c : 0x01000007, 4);
  } else if (target === "linux-x64" || target === "linux-arm64") {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(bytes);
    bytes.writeUInt16LE(target === "linux-arm64" ? 183 : 62, 18);
  } else if (target === "win32-x64" || target === "win32-arm64") {
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt32LE(0x40, 0x3c);
    bytes.write("PE\0\0", 0x40, "binary");
    bytes.writeUInt16LE(0x8664, 0x44);
  }
  return bytes;
}

describe("pinned cloudflared packaging", () => {
  it("stages both macOS architectures and only shipped desktop targets elsewhere", () => {
    expect(targetsForHost("darwin")).toEqual(["darwin-arm64", "darwin-x64"]);
    expect(targetsForHost("linux")).toEqual(["linux-x64"]);
    expect(targetsForHost("win32")).toEqual(["win32-x64", "win32-arm64"]);
    expect(() => targetsForHost("freebsd")).toThrow(/unsupported/);
  });

  it("stages the exact current target for development and self-hosting", () => {
    expect(targetForCurrentHost("darwin", "arm64")).toBe("darwin-arm64");
    expect(targetForCurrentHost("darwin", "x64")).toBe("darwin-x64");
    expect(targetForCurrentHost("linux", "x64")).toBe("linux-x64");
    expect(targetForCurrentHost("linux", "arm64")).toBe("linux-arm64");
    expect(targetForCurrentHost("win32", "x64")).toBe("win32-x64");
    expect(targetsForPreparation({ current: true, platform: "darwin", arch: "arm64" })).toEqual([
      "darwin-arm64",
    ]);
    expect(targetsForPreparation({ current: false, platform: "darwin", arch: "arm64" })).toEqual([
      "darwin-arm64",
      "darwin-x64",
    ]);
    expect(targetsForPreparation({ current: true, platform: "linux", arch: "arm64" })).toEqual([
      "linux-arm64",
    ]);
    expect(() => targetForCurrentHost("linux", "arm")).toThrow(/unsupported/);
  });

  it("accepts only the documented current-target CLI option", () => {
    expect(parsePrepareCloudflaredArgs([])).toEqual({ current: false });
    expect(parsePrepareCloudflaredArgs(["--current"])).toEqual({ current: true });
    expect(() => parsePrepareCloudflaredArgs(["--all"])).toThrow(/Usage:/);
    expect(() => parsePrepareCloudflaredArgs(["--current", "--current"])).toThrow(/Usage:/);
    // `openmausbot serve --tunnel` stages into its data dir
    expect(parsePrepareCloudflaredArgs(["--current", "--root", "/srv/omb"])).toEqual({ current: true, root: "/srv/omb" });
    expect(() => parsePrepareCloudflaredArgs(["--root"])).toThrow(/Usage:/);
    expect(() => parsePrepareCloudflaredArgs(["--root", "/a", "--root", "/b"])).toThrow(/Usage:/);
  });

  it("stages the current target for development without narrowing package preparation", () => {
    expect(packageJson.scripts["dev:desktop"]).toBe(
      "node scripts/prepare-cloudflared.mjs --current && node scripts/dev-desktop.mjs",
    );
    expect(packageJson.scripts["build:cloudflared"]).toBe(
      "node scripts/prepare-cloudflared.mjs",
    );
  });

  it("pins a complete release asset and digest for every supported target", () => {
    expect(CLOUDFLARED_VERSION).toBe("2026.9.3");
    expect(CLOUDFLARED_ASSETS).toEqual(PINNED_ASSETS);
  });

  it("rejects altered release bytes", () => {
    const payload = Buffer.from("official bytes");
    const digest = sha256(payload);
    expect(verifySha256(payload, digest)).toBe(digest);
    expect(() => verifySha256(Buffer.from("altered"), digest)).toThrow(/SHA-256 verification/);
  });

  it("recognizes only the executable formats and architectures we ship", () => {
    for (const target of Object.keys(PINNED_ASSETS)) {
      expect(executableTarget(executableFixture(target))).toBe(PINNED_ASSETS[target].executableTarget ?? target);
    }
    expect(() => executableTarget(Buffer.from("not an executable"))).toThrow(/unsupported/);
  });

  it("ships the emulated amd64 executable for Windows on Arm", () => {
    const bytes = executableFixture("win32-x64");
    expect(() => verifyPinnedBinary(bytes, "win32-arm64")).toThrow(/SHA-256 verification/);
    expect(() => verifyPinnedBinary(executableFixture("darwin-arm64"), "win32-arm64")).toThrow(/architecture mismatch/);
  });

  it("checks architecture before accepting a pinned executable", () => {
    const bytes = executableFixture("darwin-arm64");
    expect(() => verifyPinnedBinary(bytes, "darwin-x64")).toThrow(/architecture mismatch/);
    expect(() => verifyPinnedBinary(bytes, "darwin-arm64")).toThrow(/SHA-256 verification/);
  });

  it.each(["linux-x64", "linux-arm64"])("rejects the wrong architecture and unpinned bytes for %s", (target) => {
    const bytes = executableFixture(target);
    const other = target === "linux-arm64" ? "linux-x64" : "linux-arm64";
    expect(() => verifyPinnedBinary(bytes, other)).toThrow(/architecture mismatch/);
    expect(() => verifyPinnedBinary(bytes, target)).toThrow(/SHA-256 verification/);
  });

  it("does not mistake 32-bit, big-endian, truncated or unsupported ELF files for ARM64", () => {
    const arm32 = executableFixture("linux-arm64");
    arm32[4] = 1;
    const bigEndian = executableFixture("linux-arm64");
    bigEndian[5] = 2;
    bigEndian.writeUInt16BE(183, 18);
    const otherMachine = executableFixture("linux-arm64");
    otherMachine.writeUInt16LE(40, 18); // EM_ARM is not AArch64.
    const truncated = executableFixture("linux-arm64").subarray(0, 19);
    for (const bytes of [arm32, bigEndian, otherMachine, truncated]) {
      expect(() => executableTarget(bytes)).toThrow(/unsupported/);
    }
  });
});

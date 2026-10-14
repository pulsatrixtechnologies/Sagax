// Chrome for Testing zip URLs for the Linux architectures the image installs.
// linux-arm64 is published (same stable channel as linux64). The agent-browser
// 0.38.2 installer still refuses that zip, so the image downloads it itself.
export const CHROME_FOR_TESTING_VERSION = "155.0.8059.79";
export const CHROME_LINUX_PLATFORMS = ["linux64", "linux-arm64"];
export const CHROME_LINUX_SHA256 = Object.freeze({
  linux64: "bcd9a79130d7e44d70f93be87042e9bcee7fe0f0b3898e06b8c9bed5fb619dcd",
  "linux-arm64": "6ba365c60cb1cff5e742caaa1e8b6f2c019f93f7a644fa42ea0bcfcf029d7e67",
});

export function chromePlatformFromArch(arch) {
  const value = String(arch ?? "").trim();
  if (value === "arm64" || value === "aarch64") return "linux-arm64";
  if (value === "x64" || value === "amd64" || value === "x86_64") return "linux64";
  throw new Error("chrome architecture is not a Linux build");
}

export function chromeZipUrl(version, platform) {
  const ver = String(version ?? "").trim();
  const plat = String(platform ?? "").trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ver)) throw new Error("chrome version is not pinned");
  if (!CHROME_LINUX_PLATFORMS.includes(plat)) throw new Error("chrome platform is not a Linux build");
  return `https://storage.googleapis.com/chrome-for-testing-public/${ver}/${plat}/chrome-${plat}.zip`;
}

export function chromeZipSha256(platform) {
  const plat = String(platform ?? "").trim();
  const digest = CHROME_LINUX_SHA256[plat];
  if (!digest) throw new Error("chrome platform is not a Linux build");
  return digest;
}

export function chromePlatformsFromCatalog(catalog) {
  const chrome = catalog?.channels?.Stable?.downloads?.chrome;
  if (!Array.isArray(chrome)) return [];
  return chrome.map((row) => row?.platform).filter(Boolean);
}

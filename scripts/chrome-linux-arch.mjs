// Chrome for Testing zip URLs for the Linux architectures the image installs.
// linux-arm64 is published (same stable channel as linux64).
export const CHROME_FOR_TESTING_VERSION = "155.0.8059.79";
export const CHROME_LINUX_PLATFORMS = ["linux64", "linux-arm64"];

export function chromeZipUrl(version, platform) {
  const ver = String(version ?? "").trim();
  const plat = String(platform ?? "").trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ver)) throw new Error("chrome version is not pinned");
  if (!CHROME_LINUX_PLATFORMS.includes(plat)) throw new Error("chrome platform is not a Linux build");
  return `https://storage.googleapis.com/chrome-for-testing-public/${ver}/${plat}/chrome-${plat}.zip`;
}

export function chromePlatformsFromCatalog(catalog) {
  const chrome = catalog?.channels?.Stable?.downloads?.chrome;
  if (!Array.isArray(chrome)) return [];
  return chrome.map((row) => row?.platform).filter(Boolean);
}

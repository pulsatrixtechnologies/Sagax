import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("verify-linux-package cloudflared pin", () => {
  it("compares the packaged cloudflared license to LICENSE-APACHE, not repo LICENSE", () => {
    const src = readFileSync(new URL("./verify-linux-package.mjs", import.meta.url), "utf8");
    expect(src).toContain('sha256(path.join(root, "LICENSE-APACHE"))');
    expect(src).not.toMatch(/cloudflared-LICENSE\.txt"\)\) !== sha256\(path.join\(root, "LICENSE"\)\)/);
    const license = readFileSync(`${root}/LICENSE`, "utf8");
    const apache = readFileSync(`${root}/LICENSE-APACHE`, "utf8");
    expect(license).not.toBe(apache);
    expect(apache).toContain("Apache License");
  });

  it("pins DEB Maintainer to electron-builder.yml, not the upstream author", () => {
    const src = readFileSync(new URL("./verify-linux-package.mjs", import.meta.url), "utf8");
    const yml = readFileSync(`${root}/electron-builder.yml`, "utf8");
    const maintainer = yml.match(/^\s*maintainer:\s*(.+)$/m)?.[1]?.trim();
    expect(maintainer).toBeTruthy();
    expect(src).toContain(`Maintainer: ${maintainer}`);
    expect(src).not.toContain("Maintainer: Milind Soni");
  });

  it("pins the Linux desktop Name to electron-builder.yml", () => {
    const src = readFileSync(new URL("./verify-linux-package.mjs", import.meta.url), "utf8");
    expect(src).toContain('"Name=Pulsatrix Sagax"');
    expect(src).not.toContain('"Name=Sagax"');
  });

  it("points the CI installed-browser smoke at /opt/<productName>/resources", () => {
    const yml = readFileSync(`${root}/electron-builder.yml`, "utf8");
    const productName = yml.match(/^productName:\s*(.+)$/m)?.[1]?.trim();
    expect(productName).toBeTruthy();
    const ci = readFileSync(`${root}/.github/workflows/ci.yml`, "utf8");
    expect(ci).toContain(`node scripts/smoke-browser-bundle.mjs --resources "/opt/${productName}/resources"`);
    expect(ci).not.toContain('"/opt/Pulsa Bot/resources"');
  });
});

#!/usr/bin/env node
// The desktop half of the skin comparison: one page per skin, drawn by the
// desktop's own compiled stylesheet (`vite build`), screenshotted by headless
// Chrome at the iPhone 17 Pro size; then the colours it rendered are compared
// with the phone's tokens for the same skin (CompanionCore/Skins.swift, read
// through `swift run`-free means: the values are printed by the unit test
// table in DesktopSkins, mirrored here from the rendered pixels).
//
//   npx vite build --outDir <dist>
//   node ios/parity/desktop-skins.mjs <dist> <out-dir> [phone-captures-dir]
//
// Each page shows the chat surfaces the phone themes (app ground, an
// assistant card, the user's bubble, an approval card as ApprovalCard.tsx
// draws it) and a strip of solid swatches the script samples. With a phone
// captures folder (capture.sh PARITY_SKIN=<id> ... cards, one sub-folder per
// skin) it also reports the phone's ground for the same skin.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [distArg, outArg, phoneArg] = process.argv.slice(2);
if (!distArg || !outArg) {
  console.error("usage: desktop-skins.mjs <vite-dist> <out-dir> [phone-captures-dir]");
  process.exit(2);
}
const dist = resolve(distArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const css = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".css")).map((f) => join(dist, "assets", f));
const skins = ["pulsatrix", "pulsatrix-light", "midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "retro98"];
const swatches = [
  ["app", "bg-app"],
  ["card", "bg-card"],
  ["raised", "bg-raised"],
  ["bubble-user", "bg-bubble-user"],
  ["accent", "bg-accent"],
  ["ink", "text-ink"],
  ["ink-secondary", "text-ink-secondary"],
];
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const page = (skin) => `<!doctype html><html data-skin="${skin}"><head><meta charset="utf-8">
${css.map((f) => `<link rel="stylesheet" href="file://${f}">`).join("\n")}
<style>body{margin:0;width:402px;height:874px;overflow:hidden}.sw{display:flex;position:absolute;left:0;right:0;bottom:0;height:40px}.sw>div{flex:1}.ink{width:100%;height:100%;background:currentColor}</style>
</head><body class="bg-app text-ink" style="font-family:var(--font-sans)">
<div style="padding:60px 16px 0;display:flex;flex-direction:column;gap:12px">
  <div class="text-[15px] font-semibold text-ink">${skin}</div>
  <div class="w-full rounded-2xl border border-hairline/40 bg-bubble-user px-4 py-3 text-bubble-user-ink" style="align-self:flex-end;max-width:78%">Compare the final TestFlight checklist with Apple's requirements.</div>
  <div class="rounded-2xl bg-card px-4 py-3 text-ink" style="max-width:85%">I checked the signing, the privacy declarations and the review notes. <span class="text-ink-secondary">One gap remains.</span></div>
  <div class="w-full rounded-2xl border bg-card p-4 border-accent/40">
    <div class="text-[15px] font-semibold text-ink">Approval needed</div>
    <div class="mt-1 text-[13px] text-ink-secondary">Upload build 1 to TestFlight for internal testing?</div>
    <div class="mt-2 rounded-lg bg-inset px-3 py-2 font-mono text-[12.5px] text-ink">App Store Connect</div>
    <div class="mt-3 flex gap-2"><span class="rounded-lg bg-accent px-3 py-1.5 text-[13px] text-accent-ink">Allow</span><span class="rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink">Deny</span></div>
  </div>
</div>
<div class="sw">${swatches.map(([, cls], i) => { const at = `style="position:absolute;top:0;bottom:0;left:${i * 57}px;width:57px"`; return cls.startsWith("text-") ? `<div class="${cls}" ${at}><div class="ink"></div></div>` : `<div class="${cls}" ${at}></div>`; }).join("")}</div>
</body></html>`;

const rows = [];
for (const skin of skins) {
  const html = join(out, `desktop-${skin}.html`);
  const png = join(out, `desktop-${skin}.png`);
  writeFileSync(html, page(skin));
  try {
    execFileSync(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=3", "--window-size=402,874", `--screenshot=${png}`, `file://${html}`], { stdio: "ignore" });
  } catch (error) {
    // Chrome may exit non-zero on its teardown watchdog after writing the file.
    if (!existsSync(png)) throw error;
  }
  // sample the swatch strip centres with python (PIL), like diff.py does
  const xs = swatches.map((_, i) => (i * 57 + 28) * 3);
  const sampled = JSON.parse(
    execFileSync("python3", ["-c", `
import json,sys
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB')
print(json.dumps(['#%02x%02x%02x' % im.getpixel((x, 874*3-60)) for x in json.loads(sys.argv[2])]))`, png, JSON.stringify(xs)]).toString(),
  );
  const row = { skin, ...Object.fromEntries(swatches.map(([name], i) => [name, sampled[i]])) };
  if (phoneArg) {
    const phone = join(resolve(phoneArg), skin, "cards.png");
    if (existsSync(phone)) {
      row.phoneGround = execFileSync("python3", ["-c", `
import sys
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB')
print('#%02x%02x%02x' % im.getpixel((6, 400*3)))`, phone]).toString().trim();
    }
  }
  rows.push(row);
}
writeFileSync(join(out, "desktop-skins.json"), `${JSON.stringify(rows, null, 2)}\n`);
console.table(rows);

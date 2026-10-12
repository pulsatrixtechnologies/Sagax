#!/usr/bin/env node
/** Static HTML mock of BackgroundWorkPanel for walkthrough artifacts. */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.ARTIFACTS_DIR ?? join(root, "artifacts");
mkdirSync(join(outDir, "screenshots"), { recursive: true });

// Minimal inline mock of the panel card markup (matches BackgroundWorkPanel.test.ts).
const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>Activités en cours</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#0f1115;color:#e8eaed}
aside{width:300px;border-left:1px solid rgba(255,255,255,.08);min-height:100vh}
header{display:flex;align-items:center;gap:8px;height:48px;padding:0 12px;border-bottom:1px solid rgba(255,255,255,.08)}
.card{margin:8px 12px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#181b22}
.status{font-size:12px;color:#9aa0a6;margin-top:4px}
.model{font-size:11px;color:#6b7280;margin-top:4px}
</style></head><body>
<aside data-background-work-panel aria-label="Activités en cours">
<header><h2 style="font-size:13px;font-weight:500;margin:0">Activités en cours</h2></header>
<article class="card" data-background-work-card="run:r1">
<div style="display:flex;gap:10px"><div style="width:36px;height:36px;border-radius:8px;background:#252830"></div>
<div><div style="font-size:13px;font-weight:500">Tournée de répartition</div>
<div class="status">En cours · 1m 30s · Lecture du tableau</div>
<div class="model">claude-sonnet-5</div></div></div>
</article>
</aside></body></html>`;

writeFileSync(join(outDir, "screenshots", "background-work-panel.html"), html);
console.error(`wrote ${join(outDir, "screenshots", "background-work-panel.html")}`);

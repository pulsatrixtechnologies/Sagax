// Runs scripts/gen-owl-3d.ts: bundled first with esbuild (the owl art it
// reads uses extensionless imports, which plain Node cannot resolve).
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// inside node_modules so the bundle resolves "three" from the repository
const dir = new URL("../node_modules/.cache/gen-owl-3d/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const outfile = join(dir, "gen-owl-3d.mjs");
try {
  await build({
    entryPoints: [new URL("./gen-owl-3d.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    // three stays a package import, resolved from the repository
    external: ["three", "three/*", "@gltf-transform/*", "meshoptimizer"],
    logLevel: "warning",
  });
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

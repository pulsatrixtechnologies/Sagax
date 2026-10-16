// pdf.js data files served by the app itself, so every PDF renders without
// the network: the Adobe CMaps (CJK text), the standard fonts (PDFs that do
// not embed Helvetica, Times, Symbol...), the wasm decoders (JPEG 2000 with
// OpenJPEG, JBIG2, colour profiles with QCMS) and the ICC profiles.
//
// They are copied from the installed pdfjs-dist into the build under
// assets/pdfjs-<version>/ (served from the same origin as the page by the
// harness server, the desktop's bundled UI and the container image), and the
// dev server answers the same paths from node_modules. The version in the
// folder name keeps the /assets/ "never changes" caching rule true: a new
// pdf.js gets a new folder. The viewer builds the same URLs from
// pdfjs.version (src/lib/pdf-view.ts, pdfjsAssetOptions).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, sep } from "node:path";
import type { Plugin } from "vite";

export const PDFJS_ASSET_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"] as const;

const require = createRequire(import.meta.url);

function pdfjsRoot(): { root: string; version: string } {
  const manifest = require.resolve("pdfjs-dist/package.json");
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
  return { root: dirname(manifest), version };
}

/** Every file to ship, as [published path under the build, source path]. */
export function pdfjsAssetFiles(): Array<[string, string]> {
  const { root, version } = pdfjsRoot();
  const files: Array<[string, string]> = [];
  for (const dir of PDFJS_ASSET_DIRS) {
    const base = join(root, dir);
    for (const name of readdirSync(base).sort()) {
      const source = join(base, name);
      if (!statSync(source).isFile()) continue;
      files.push([`assets/pdfjs-${version}/${dir}/${name}`, source]);
    }
  }
  return files;
}

const DEV_TYPES: Record<string, string> = { ".wasm": "application/wasm", ".js": "text/javascript" };

export function pdfjsAssets(): Plugin {
  return {
    name: "sagax-pdfjs-assets",
    configureServer(server) {
      const { root, version } = pdfjsRoot();
      const prefix = `/assets/pdfjs-${version}/`;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        if (!url.startsWith(prefix)) return next();
        const rest = decodeURIComponent(url.slice(prefix.length));
        const [dir, name, extra] = rest.split("/");
        if (extra !== undefined || !name || !(PDFJS_ASSET_DIRS as readonly string[]).includes(dir ?? "")) return next();
        const file = join(root, dir!, name);
        if (relative(join(root, dir!), file).includes(sep) || name.startsWith(".")) return next();
        try {
          const data = readFileSync(file);
          res.setHeader("content-type", DEV_TYPES[extname(file)] ?? "application/octet-stream");
          res.end(data);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const [fileName, source] of pdfjsAssetFiles()) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(source) });
      }
    },
  };
}

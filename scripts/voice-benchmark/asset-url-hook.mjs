// Resolve `*.onnx?url` and `*.wasm?url` to a module whose default export is
// the file URL. The acceptance runner supplies its own voice detector, so
// these files are not executed. A custom resolver replaces Node's
// strip-types extension lookup, so extensionless relative imports get `.ts`.
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

const ASSET = /\.(?:onnx|wasm)(?:\?|$)/;

function typescriptSpecifier(specifier, parentURL) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const bare = specifier.split("?")[0];
  if (extname(bare)) return null;
  const parent = parentURL ?? import.meta.url;
  for (const candidate of [`${bare}.ts`, `${bare}.tsx`, `${bare}.mts`, `${bare}/index.ts`]) {
    const url = new URL(candidate, parent);
    if (url.protocol === "file:" && existsSync(fileURLToPath(url))) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (ASSET.test(specifier)) {
    const bare = specifier.split("?")[0];
    const parent = context.parentURL ?? import.meta.url;
    const url = new URL(bare, parent);
    return { url: `${url.href}?asset-url`, shortCircuit: true };
  }
  const rewritten = typescriptSpecifier(specifier, context.parentURL);
  if (rewritten) return nextResolve(rewritten, context);
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.includes("?asset-url") || !ASSET.test(url)) return nextLoad(url, context);
  const file = url.slice(0, url.indexOf("?"));
  return {
    format: "module",
    source: `export default ${JSON.stringify(file)};\n`,
    shortCircuit: true,
  };
}

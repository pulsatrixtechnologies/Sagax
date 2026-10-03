// Strips TypeScript from a source excerpt so a test can run it with
// `new Function`. TypeScript 7 (the native compiler) has no JavaScript API,
// so esbuild does what `ts.transpileModule` used to.
import { transformSync } from "esbuild";

export function transpileTs(code: string): string {
  return transformSync(code, { loader: "ts", target: "esnext" }).code;
}

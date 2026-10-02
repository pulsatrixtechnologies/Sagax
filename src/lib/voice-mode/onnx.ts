// The on-device models of a live call (Silero VAD, the CAM++ speaker
// embedding) run with onnxruntime-web's WebAssembly backend, loaded only when
// a call starts. Everything is served from this app's own bundle (the models
// and the runtime's .wasm), never from a CDN, so the bundled UI on an
// organization server works offline from the internet and nothing about the
// person's voice leaves the computer for them.
import type * as Ort from "onnxruntime-web";

export type OrtModule = typeof Ort;
export type OrtSession = Ort.InferenceSession;

export interface ModelSource {
  /** bytes (tests) or a URL in this app's bundle */
  model: Uint8Array | string;
}

let runtime: Promise<OrtModule> | null = null;

/** onnxruntime-web, single threaded (no cross-origin isolation needed), its
 * .wasm from this bundle. */
export function loadOrt(): Promise<OrtModule> {
  runtime ??= (async () => {
    const [ort, wasm] = await Promise.all([
      import("onnxruntime-web/wasm") as Promise<OrtModule & { default?: OrtModule }>,
      import("onnxruntime-web/ort-wasm-simd-threaded.wasm?url").then((m: { default: string }) => m.default),
    ]);
    const module = (ort.default ?? ort) as OrtModule;
    module.env.wasm.numThreads = 1;
    module.env.wasm.proxy = false;
    module.env.wasm.wasmPaths = { wasm };
    module.env.logLevel = "error";
    return module;
  })();
  runtime.catch(() => {
    runtime = null;
  });
  return runtime;
}

export async function createSession(ort: OrtModule, source: ModelSource["model"]): Promise<OrtSession> {
  const bytes = typeof source === "string" ? new Uint8Array(await (await fetch(source)).arrayBuffer()) : source;
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

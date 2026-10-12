// Node cannot import Vite's `file.onnx?url` specifiers. The acceptance CLI
// loads the voice call through this hook so those imports are URL strings.
import { register } from "node:module";

await register("./asset-url-hook.mjs", import.meta.url);

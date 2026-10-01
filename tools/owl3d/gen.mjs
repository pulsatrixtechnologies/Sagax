// `pnpm gen:owl3d`: builds the 3D Sagax owl in Blender (tools/owl3d/build_owl.py,
// headless) and compresses the export into
// src/components/floating-bots/owl3d/owl.glb: identical data shared, unused data
// dropped, redundant animation keys removed, geometry and animation quantized
// and compressed (EXT_meshopt_compression, decoded by three's MeshoptDecoder).
//
// Blender: `brew install --cask blender` (blender.org's build), or set BLENDER
// to its binary. Extra arguments go to the build script, for example
// `pnpm gen:owl3d --render /tmp/owl --size 480` also renders preview sheets.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const root = new URL("../../", import.meta.url).pathname;
const cache = join(root, "node_modules/.cache/owl3d");
const raw = join(cache, "owl-raw.glb");
const out = join(root, "src/components/floating-bots/owl3d/owl.glb");
mkdirSync(cache, { recursive: true });

const blender = process.env.BLENDER || "blender";
execFileSync(blender, ["-b", "--factory-startup", "--python", join(root, "tools/owl3d/build_owl.py"), "--", "--out", raw, ...process.argv.slice(2)], {
  stdio: ["ignore", "inherit", "inherit"],
});

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.readBinary(new Uint8Array(readFileSync(raw)));
await doc.transform(dedup(), prune({ keepAttributes: false }), resample({ tolerance: 1e-4 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
const glb = await io.writeBinary(doc);
writeFileSync(out, Buffer.from(glb));
const anims = doc.getRoot().listAnimations();
console.log(`owl.glb: ${(glb.byteLength / 1024).toFixed(1)} KB, ${doc.getRoot().listMeshes().length} meshes, ${anims.length} clips`);

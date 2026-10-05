# Cua Driver redistribution records

These files accompany the exact Cua Driver `0.33.0` Linux x64 runtime bundled by Sagax. The upstream release archive omits its own license, the embedded Inter font license, a dependency notice, an SBOM, and artifact provenance, so they are preserved here and verified during packaging.

Trust anchor:

- upstream commit: `1553a3f360ea12155be3bc77e27c427ca62f967a`;
- archive: `cua-driver-rs-0.33.0-linux-x86_64-binary.tar.gz`;
- archive SHA-256: `166869bd9920338e097050c0114c02d33fa59762a4ac7e690459725a204e91e5` (matches the release `SHA256SUMS` line and the GitHub asset digest);
- driver SHA-256: `7941c851069ed4b03608a16f2fdd4c905314748765afd6aba45733daab511956`;
- cursor-theme SHA-256: `f516d208440553d8b44e4e6786b20fa2ce995cbbd5895e51803bdb4e0b943b1b`;
- upstream `Cargo.lock` SHA-256: `522f756efb41d1545867f82ab0bb9bb203ecd65c5686433edcb623041f2b4297`;
- embedded Inter `4.001` SHA-256: `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031`.

`THIRD_PARTY_NOTICES.md`, `THIRD_PARTY_LICENSES.html`, and `SBOM.cdx.json` are generated from two root-scoped `cargo-about 0.8.4` JSON reports. Do not feed the virtual workspace's raw `cargo metadata` graph to the generator: Cargo unifies features enabled by unrelated workspace members, which overstates the two release binaries.

This 0.33.0 inventory was generated with cargo-about 0.8.4 from the official [`cargo-about-0.8.4-aarch64-apple-darwin.tar.gz`](https://github.com/EmbarkStudios/cargo-about/releases/download/0.8.4/cargo-about-0.8.4-aarch64-apple-darwin.tar.gz) archive, SHA-256 `d5255ead3ac861a11c785bf19d4f70f16e59ac8b9519c312da61213d3d57351d`. The same version's Linux musl build is [`cargo-about-0.8.4-x86_64-unknown-linux-musl.tar.gz`](https://github.com/EmbarkStudios/cargo-about/releases/download/0.8.4/cargo-about-0.8.4-x86_64-unknown-linux-musl.tar.gz), SHA-256 `c7381aa0cdc41fc0ee662cec8daa260da7817ad8ddea04cd4ddad425460adf14`. From the exact upstream checkout's `libs/cua-driver/rust` directory, run:

```bash
cargo-about generate \
  --locked \
  --target x86_64-unknown-linux-gnu \
  --manifest-path crates/cua-driver/Cargo.toml \
  --features portal-input \
  --config /path/to/OpenMausBot/third_party/cua-driver/about.toml \
  --format json \
  > cua-driver.cargo-about.json

cargo-about generate \
  --locked \
  --target x86_64-unknown-linux-gnu \
  --manifest-path crates/cursor-theme-cli/Cargo.toml \
  --config /path/to/OpenMausBot/third_party/cua-driver/about.toml \
  --format json \
  > cursor-theme.cargo-about.json

node /path/to/OpenMausBot/scripts/generate-cua-sbom.mjs \
  cua-driver.cargo-about.json \
  cursor-theme.cargo-about.json \
  Cargo.lock \
  /path/to/OpenMausBot/third_party/cua-driver
```

The generator fails unless the reports contain the reviewed root-scoped sets: 373 registry packages for the driver, 239 for the cursor-theme sidecar, and a 378-package union. The final CycloneDX inventory contains those 378 packages, eight Cua workspace packages, and the embedded Inter font. The MPL-2.0 set is exactly seven packages. The cursor-theme-only registry set is still `bumpalo` 3.20.2, `typed-path` 0.12.3, `zip` 8.6.0, `zlib-rs` 0.6.6, and `zopfli` 0.8.3. Regeneration is expected to produce a reviewed diff; no release process accepts new native inputs automatically.

`cua-telemetry` 0.1.0 is a private path dependency (`publish = false`) of the driver, linked with its default features off. `about.toml` ignores private crates, so it is not a cargo-about root and is not one of the eight enumerated workspace packages. It is Cua MIT code covered by the accompanying `LICENSE.md`. Its registry dependencies are in the 378-package union.

Sagax ships only the CLI and cursor-theme sidecar. The Linux SDK `.so`, Node `.node`, ABI header, and GNOME helper are not included because the current runtime does not load them and must not silently install a Shell extension.
The app's npm Cua SDK is used by the separate macOS integration and may have a different version; it is not loaded by this Linux CLI-spawn runtime. The Linux daemon contract accepted by Sagax for this pin is `0.8.0`.

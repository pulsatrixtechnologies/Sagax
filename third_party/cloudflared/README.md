# cloudflared release provenance

OpenMausBot stages the official `cloudflared` 2026.9.3 executable as a separate
process. The binaries come from Cloudflare's official GitHub release:

<https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3>

`scripts/prepare-cloudflared.mjs` verifies these SHA-256 digests before an
executable can be staged:

| OpenMausBot target | Release asset | Release asset SHA-256 | Extracted executable SHA-256 |
| --- | --- | --- | --- |
| macOS arm64 | `cloudflared-darwin-arm64.tgz` | `587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095` | `5472c1a01c84bc31b3021056a73b4e5774ddddefc572124ea8fdf6c340639f32` |
| macOS x64 | `cloudflared-darwin-amd64.tgz` | `d1155d0837487f261183b15c1eab6c4ebcad9dc49b94675f1524c3564cea3977` | `ab588b3b4db9cdb4476c30a3db2a72635b1d8327d44741fee6799a0f37b0ec07` |
| Linux x64 | `cloudflared-linux-amd64` | `77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2` | same as release asset |
| Linux arm64 | `cloudflared-linux-arm64` | `aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d` | same as release asset |
| Windows x64 | `cloudflared-windows-amd64.exe` | `f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2` | same as release asset |

The staged executables are generated build output and are intentionally not
checked into git. Set `OMB_CLOUDFLARED_ARCHIVE_DIR` to a directory containing
the exact official release assets to prepare a package from a reviewed local
download. Otherwise the preparation script downloads them from the release URL
above.

The macOS release process applies OpenMausBot's Developer ID signature to the
staged executable as part of signing the app bundle. It verifies the unsigned
upstream digest before that necessary packaging change, then verifies the
nested signature, signing team, and architecture before notarization. Linux
and Windows packages retain the exact reviewed upstream executable bytes.

cloudflared is licensed under Apache License 2.0. The distribution includes a
separately named copy of the complete Apache 2.0 text at
`resources/licenses/cloudflared-LICENSE.txt`.

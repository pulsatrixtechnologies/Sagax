#!/usr/bin/env bash
# Fails when a server image carries no engine (the GOX image main-20004735
# shipped engineSet "none" and broke Grok/Claude). Run after every
# organization build, before deploying:
#   scripts/check-image-engines.sh <image> [required-engine-id ...]
# Defaults to requiring claude and grok.
set -euo pipefail
image=${1:?usage: check-image-engines.sh <image> [engine-id ...]}; shift || true
required=("$@"); [ ${#required[@]} -gt 0 ] || required=(claude grok)
manifest=$(docker run --rm --entrypoint cat "$image" /app/engines/manifest.json)
MANIFEST="$manifest" node -e '
const m = JSON.parse(process.env.MANIFEST);
const ids = (m.installed ?? []).map((e) => e.id);
const missing = process.argv.slice(1).filter((id) => !ids.includes(id));
console.log(`engineSet=${m.engineSet} installed=${ids.join(",") || "(none)"}`);
if (m.engineSet === "none" || ids.length === 0) { console.error("FAIL: image has no engines (build with --build-arg ENGINE_SET=all --build-arg REQUIRE_ENGINES=1)"); process.exit(1); }
if (missing.length) { console.error(`FAIL: missing engines: ${missing.join(",")}`); process.exit(1); }
' "${required[@]}"

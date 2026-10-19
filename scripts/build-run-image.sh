#!/bin/sh
# Build the cloud agent run image (deploy/run/Dockerfile) as a local OCI
# archive, on top of a sandbox image (deploy/sandbox/Dockerfile) the builder
# can read. This script never pushes. A registry publish (digest pin,
# signature, scan, admission.allowedImages) is an operator step, from a
# controlled registry.
#
#   scripts/build-run-image.sh [dest] [sandbox-image]
#   default: dist/sagax-run.oci on sagax-sandbox:local, for linux/amd64 (the
#   runs node pool). RUN_IMAGE_PLATFORMS overrides the platforms; a
#   multi-platform build needs a multi-platform sandbox image reference.
set -eu
if [ "${RUN_IMAGE_PUSH:-}" = "1" ] || [ "${SANDBOX_IMAGE_PUSH:-}" = "1" ]; then
  echo "run image build refuses a push: this script never pushes" >&2
  exit 1
fi
dest="${1:-dist/sagax-run.oci}"
sandbox="${2:-sagax-sandbox:local}"
platforms="${RUN_IMAGE_PLATFORMS:-linux/amd64}"
mkdir -p "$(dirname "$dest")"
docker buildx build \
  --platform "${platforms}" \
  --build-arg "SANDBOX_IMAGE=${sandbox}" \
  -f deploy/run/Dockerfile \
  -o "type=oci,dest=${dest}" \
  .
echo "wrote ${dest} (not pushed, not signed, not scanned)"

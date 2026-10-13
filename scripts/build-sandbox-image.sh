#!/bin/sh
# Build the sandbox image as a local multi-arch OCI archive.
# This script never pushes. A registry publish is an operator step, after
# the scan and the signature, from a controlled registry.
set -eu
if [ "${SANDBOX_IMAGE_PUSH:-}" = "1" ]; then
  echo "sandbox image build refuses SANDBOX_IMAGE_PUSH: this script never pushes" >&2
  exit 1
fi
dest="${1:-dist/sagax-sandbox.oci}"
mkdir -p "$(dirname "$dest")"
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f deploy/sandbox/Dockerfile \
  -o "type=oci,dest=${dest}" \
  .
echo "wrote ${dest} (not pushed, not signed, not scanned)"

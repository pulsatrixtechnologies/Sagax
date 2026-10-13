#!/bin/sh
# Vulnerability scan of a local OCI archive. Fails closed: no trivy means
# the image was not scanned, and HIGH or CRITICAL findings fail the run.
# Nothing here pushes or deploys.
set -eu
archive="${1:-dist/sagax-sandbox.oci}"
if ! command -v trivy >/dev/null 2>&1; then
  echo "trivy is not installed; the image was not scanned" >&2
  exit 1
fi
trivy image --input "$archive" --severity HIGH,CRITICAL --exit-code 1 --quiet
echo "trivy reported no HIGH or CRITICAL findings in ${archive}"

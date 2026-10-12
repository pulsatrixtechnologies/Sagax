#!/bin/sh
# Build the Sagax server image with the full engine set.
#
# A bare `docker build` now does the same, because ENGINE_SET defaults to
# all and SAGAX_REQUIRE_ENGINES defaults to 1. Pass both here so a caller
# that exports an empty ENGINE_SET still cannot override the production
# build by accident: an empty ENGINE_SET= build-arg selects "none", and the
# require flag then fails the build instead of shipping an empty manifest.
#
#   scripts/build-production-image.sh [tag]
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TAG=${1:-pulsa-bot-server:production}
SHA=${SAGAX_COMMIT_SHA:-$(git -C "$ROOT" rev-parse HEAD)}
TIME=${SAGAX_BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}
exec docker build \
  --build-arg ENGINE_SET=all \
  --build-arg SAGAX_REQUIRE_ENGINES=1 \
  --build-arg SAGAX_COMMIT_SHA="$SHA" \
  --build-arg SAGAX_BUILD_TIME="$TIME" \
  -t "$TAG" \
  "$ROOT"

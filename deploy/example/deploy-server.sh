#!/bin/sh
# Deploy a Sagax server image on the host, or refuse it.
#
# The image must be the full engine set (engineSet all, every engine of
# engines.lock.json). A manifest of engineSet none is refused before the
# running container changes. After the switch, GET /healthz and the engine
# startup log are checked. Failure rolls back to the image in
# /opt/sagax/server-image.prev and recreates the edge with exactly:
#
#   docker compose up -d --force-recreate --no-deps pulsabot-caddy
#
# Prune keeps the running image and that previous image. A log line
# containing engine_missing is printed as "ALERT ..." and exits non-zero.
# Do not deploy an image this script refuses.
#
#   deploy/example/deploy-server.sh deploy --image pulsa-bot-server:main-<sha>
#   deploy/example/deploy-server.sh check --image pulsa-bot-server:main-<sha>
#   deploy/example/deploy-server.sh prune
#   deploy/example/deploy-server.sh alert --log /var/log/pulsabot.log
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
exec node "$ROOT/scripts/deploy-server.mjs" "$@"

#!/usr/bin/env bash
# Capture the 21 reference screens from the app against the fixture server.
#
#   ios/parity/capture.sh                       build, seed, capture every screen
#   ios/parity/capture.sh --skip-build          reuse the last build
#   ios/parity/capture.sh 02-chat 13-computer   only these screens
#   PARITY_WAIT=10 ios/parity/capture.sh         seconds to wait per screen
#
# Then: python3 ios/parity/diff.py [--gate]
#
# The simulator is a dedicated "parity-17pro" (iPhone 17 Pro, 402x874 pt @3x,
# the reference size) in dark mode with the status bar pinned to 6:54. The
# app is built for the simulator with CODE_SIGNING_ALLOWED=NO: the DEBUG
# parity launch keeps the bearer in memory, so the Keychain entitlement that
# pairing needs (see ios/TESTING.md, stage 3) is not involved.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IOS="$(cd "$HERE/.." && pwd)"
OUT="$HERE/out"
BUILD="$HERE/build"
DEVICE_NAME="${PARITY_DEVICE:-parity-17pro}"
BUNDLE_ID="com.openmausbot.app"
WAIT="${PARITY_WAIT:-7}"

SKIP_BUILD=0
SCREENS=()
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) SCREENS+=("$arg") ;;
  esac
done
if [ ${#SCREENS[@]} -eq 0 ]; then
  SCREENS=(
    01-home 02-chat 03-profile-info 04-profile-info-scrolled 05-routine-detail
    06-routine-instruction 07-profile-more-menu 08-profile-links 09-profile-media
    10-profile-files 11-computer-trackpad-toast 12-settings-top 13-computer
    14-settings-bottom 15-plugins 16-account 17-new-group-chat 18-home-plus-menu
    19-search 20-create-bot 21-bot-computer
  )
fi

mkdir -p "$OUT"
log() { printf '[capture] %s\n' "$*" >&2; }

# ── build ────────────────────────────────────────────────────────────────
APP="$BUILD/Build/Products/Debug-iphonesimulator/OpenMausCompanion.app"
if [ "$SKIP_BUILD" -eq 0 ] || [ ! -d "$APP" ]; then
  log "xcodegen + build (Debug, simulator, unsigned)"
  (cd "$IOS" && xcodegen generate >/dev/null)
  xcodebuild -project "$IOS/OpenMausCompanion.xcodeproj" -scheme OpenMausCompanion \
    -configuration Debug -sdk iphonesimulator \
    -destination "generic/platform=iOS Simulator" \
    -derivedDataPath "$BUILD" CODE_SIGNING_ALLOWED=NO build \
    > "$OUT/build.log" 2>&1 || { tail -40 "$OUT/build.log"; log "build failed (see $OUT/build.log)"; exit 1; }
fi

# ── simulator ────────────────────────────────────────────────────────────
UDID="$(xcrun simctl list devices -j | python3 -c "
import json, sys
name = sys.argv[1]
for runtime, devices in json.load(sys.stdin)['devices'].items():
    for d in devices:
        if d['name'] == name and d.get('isAvailable', True):
            print(d['udid']); sys.exit()
" "$DEVICE_NAME")"
if [ -z "$UDID" ]; then
  RUNTIME="$(xcrun simctl list runtimes -j | python3 -c "
import json, sys
rs = [r for r in json.load(sys.stdin)['runtimes'] if r['platform'] == 'iOS' and r['isAvailable']]
rs.sort(key=lambda r: [int(x) for x in r['version'].split('.')])
print(rs[-1]['identifier'])")"
  log "creating $DEVICE_NAME on $RUNTIME"
  UDID="$(xcrun simctl create "$DEVICE_NAME" "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" "$RUNTIME")"
fi
log "simulator $DEVICE_NAME ($UDID)"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance dark
# The references' keyboard: French (Canada) with English, no swipe-typing
# introduction, no dictation key.
xcrun simctl spawn "$UDID" defaults write -g AppleKeyboards -array \
  "fr_CA@sw=QWERTY-French-Canada;hw=Automatic" "en_US@sw=QWERTY;hw=Automatic" "emoji@sw=Emoji" >/dev/null 2>&1 || true
xcrun simctl spawn "$UDID" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true >/dev/null 2>&1 || true
xcrun simctl spawn "$UDID" defaults write com.apple.assistant.support "Dictation Enabled" -bool false >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" override --time "6:54" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 \
  --batteryState discharging --batteryLevel 9
xcrun simctl install "$UDID" "$APP"

# ── fixture server ──────────────────────────────────────────────────────
rm -f "$OUT/session.json"
node "$HERE/fixture-server.mjs" > "$OUT/fixture.log" 2>&1 &
SERVER_PID=$!
cleanup() {
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 240); do
  [ -f "$OUT/session.json" ] && break
  kill -0 "$SERVER_PID" 2>/dev/null || { cat "$OUT/fixture.log"; log "fixture server died"; exit 1; }
  sleep 0.5
done
[ -f "$OUT/session.json" ] || { cat "$OUT/fixture.log"; log "fixture server never became ready"; exit 1; }
read -r ENDPOINT TOKEN ENVIRONMENT < <(python3 -c "
import json; s = json.load(open('$OUT/session.json'))
print(s['endpoint'], s['token'], s.get('environmentId') or '')")
log "fixture at $ENDPOINT"

# ── screens ──────────────────────────────────────────────────────────────
for screen in "${SCREENS[@]}"; do
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  ARGS=(-parityEndpoint "$ENDPOINT" -parityToken "$TOKEN" -parityScreen "$screen")
  [ -n "$ENVIRONMENT" ] && ARGS+=(-parityEnvironment "$ENVIRONMENT")
  xcrun simctl launch "$UDID" "$BUNDLE_ID" "${ARGS[@]}" >/dev/null
  sleep "$WAIT"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$screen.png" >/dev/null 2>&1
  log "$screen -> out/$screen.png"
done
log "done; compare with: python3 $HERE/diff.py"

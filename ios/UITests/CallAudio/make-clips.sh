#!/bin/sh
# Recordings the call UI tests say into a call (App/Call/CallDebug.swift,
# -callInjectAudio DIR). Each clip is 16 kHz mono 16-bit PCM; its .txt holds
# the words the scripted recognizer returns for it (the simulator has no
# reliable on-device recognizer). bot/ is a one-to-one call (a question,
# then a barge-in), room/ a room's call (English: the desktop's spoken
# routing knows "everyone"). Regenerate on a Mac with:
#   sh ios/UITests/CallAudio/make-clips.sh
set -e
cd "$(dirname "$0")"
clip() {
  mkdir -p "$(dirname "$2")"
  say -v "$1" -o "$2.aiff" "$3"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$2.aiff" "$2.wav"
  rm "$2.aiff"
  printf '%s\n' "$3" > "$2.txt"
}
clip "Amélie" bot/01-question "Bonjour Ara, où en est le projet cette semaine?"
clip "Amélie" bot/02-barge-in "Attends, parle-moi plutôt de demain."
clip "Daniel" room/01-everyone "Everyone, give me a quick status."

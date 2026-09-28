---
name: verify-omb
description: "Verify Pulsa Bot server and conversation changes against an isolated fake-engine instance before claiming they work."
---

# Verify Pulsa Bot

Follow the canonical instructions in `docs/verification/README.md`. Use its
shared control tool; do not improvise raw API calls or drive the user's live
Pulsa Bot instance. The canonical feature map currently covers only the
server flows that tool can prove.

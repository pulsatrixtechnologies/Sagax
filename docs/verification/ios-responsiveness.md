# iOS responsiveness under busy-fleet traffic

Use synthetic data and disposable simulators, never the user's paired app or
conversations. These checks concern ordinary chats, not Live audio.

## Core regressions

From `ios/`, run `swift test`. In particular:

- `EventBatchTests` delivers 500 token frames across 20 threads in five
  deliveries, with every token and sequence retained. One delivery publishes
  state once, including its replay cursor and concurrent local edits. Controls
  flush immediately; a lone token flushes on its fixed deadline; transport
  errors flush the tail; cancellation stops the source without committing it.
- `WidgetSnapshotTests` checks compact snapshots, changed titles/options,
  unchanged-payload renewal, unchanged ten-minute answer expiry, off-main FIFO
  writes, unpair/re-pair ordering, and retry after a failed write.
- `StoreTests`, `MarkdownTests`, `ReasoningWindowTests` and
  `LiveActivityUpdatesTests` cover edit-version parity, bounded parse reuse,
  Unicode/CRLF reasoning, and one highest-priority activity per bot without
  dropping any thread from Updates.
- The compact-surface publisher regression delivers during continuous traffic,
  preserves the initial window, delivers final unpairing, and stops on cancellation.
  Widget and Dynamic Island subscribers use fixed 400 ms windows, not a debounce
  that can starve indefinitely. A window temporarily retains its incoming state
  values; it is not a hard limit on the number of values in that window.

The 100-frame limit bounds each staging batch, not the stream's entire
downstream backlog. No event is dropped to enforce a buffering limit.

## Native acceptance

Generate the project with `cd ios && xcodegen generate`. Create a disposable
iPhone simulator and use its explicit ID:

```sh
xcodebuild -project OpenMausCompanion.xcodeproj -scheme OpenMausCompanion \
  -configuration Debug -destination 'platform=iOS Simulator,id=SIMULATOR_ID' \
  -derivedDataPath /tmp/omb-ios-responsiveness-build \
  -resultBundlePath /tmp/omb-ios-responsiveness-iphone.xcresult \
  -parallel-testing-enabled NO \
  -only-testing:OpenMausCompanionUITests/ResponsivenessUITests \
  -only-testing:OpenMausCompanionUITests/ThreadNavigationUITests \
  -only-testing:OpenMausCompanionUITests/TranscriptPresentationUITests \
  -only-testing:OpenMausCompanionUITests/RosterDensityUITests \
  -only-testing:OpenMausCompanionUITests/SwipeBackUITests \
  CODE_SIGNING_ALLOWED=NO test
```

Repeat on a disposable iPad. Keep the result bundles and screenshots, then
shut down and delete only the simulator IDs created for these checks.

`ResponsivenessUITests` adds the Debug-only `-busy-fleet-preview` flag to the
existing offline thread fixture. Twenty other bots have fifty completed
messages each and target 400 token frames per second for a nominal 90 seconds.
Scheduling under host load can extend this; the test checks actual cursor
progress rather than assuming the producer kept its target rate. Frames
go through the same batching and atomic Session fold as the real stream;
there is no API client, token, provider, microphone or message send.

The native test types into a short Gmail chat, switches to iCloud, types a
separate draft and returns. It checks both draft isolation and the correct
transcript, with cursor advancement proving the flood remained active during
the actions. Per-action elapsed times and a screenshot are attached. Existing
suites protect tables, initial scroll landing, narration folds, reasoning,
roster density, search, navigation and swipe-back.

This proves the synthetic workload and native workflows, not the reported
physical iPhone freeze, real-network throughput, memory-pressure behavior or
hours-long stability. App Store users need a new iOS build containing these
changes; a desktop release does not update the installed iPhone app.

# Voice Benchmark and Acceptance Harness Design

## Purpose

Replace mutable, cross-turn benchmark bookkeeping with a reproducible harness
that can prove full-duplex voice behavior without using a microphone, sound
device, or live network in pull-request CI. The same report and gate code also
drives Task 48 live acceptance against real providers before release.

## Modes

### Deterministic CI

The CI profile runs 32 bilingual scripted turns against an isolated Sagax
server, fake engine, and fake xAI voice endpoints. It uses generated PCM for
English and Québec French and fixed provider delays. It exercises the real
`VoiceCall`, WebSocket STT, message routes, runtime stream, streaming TTS,
playback scheduler, full-duplex interruption, correction, topic concurrency,
and tool events.

This profile is a hard PR gate:

- end-of-speech to first audio p50 must be at most 800 ms;
- every complete turn must be at most 2,500 ms;
- spoken answer intervals must never overlap;
- all 32 turns must have a complete, internally consistent timing ledger;
- required interruption, correction, concurrent-topic, and tool scenarios must
  be observed.

The fake delays are part of the fixture contract, not measured provider claims.
The report identifies the profile as `synthetic` and records those configured
delays.

### Real-network observation

An opt-in mode runs the same script, ledger, report, and scorer against real
xAI voice and Grok providers. Pull-request CI does not run it and does not
derive a pass from synthetic values. Every invocation writes raw stage timings
and the gate result even when the result fails.

### Release acceptance (Task 48)

A reusable GitHub workflow supports manual dispatch, a nightly schedule, and a
release-workflow call. It runs the real-network profile with hard gates enabled,
uploads the JSON and Markdown reports, and fails on any gate violation.
Release packaging jobs depend on this reusable workflow, so voice cannot ship
without a passing real-provider run for the pinned release commit. There is no
emergency bypass for voice acceptance.

## Measurement Contract

Every utterance has a stable `utteranceId`. An append-only ledger records:

1. `speech-end`: the last generated voiced frame;
2. `endpoint`: VoiceCall confirms the endpoint;
3. `stt-final`: the final transcript is accepted;
4. `llm-first-token`: the first assistant text delta for that utterance;
5. `tts-first-byte`: the first non-empty PCM chunk for that answer;
6. `audio-start`: that PCM is scheduled to the output clock;
7. `audio-end`: the scheduled answer finishes or is cancelled.

Events also record transcript language, scenario ID, topic ID, turn state,
tool start/result, interruption target, and cancellation. Marks are immutable:
a duplicate can agree with the first mark but cannot replace it. The compiler
rejects a missing required mark, an unknown utterance, a completed cancelled
answer, or attribution to another turn. It requires TTS bytes after the
accepted answer's first token and audio output after those bytes. Endpoint,
final STT, and first token may overlap because speculation intentionally runs
them concurrently.

Each milestone is reported as elapsed time from `speech-end`:

- endpoint: `speech-end` to `endpoint`;
- STT final: `speech-end` to `stt-final`;
- LLM first token: `speech-end` to `llm-first-token`;
- TTS first byte: `speech-end` to `tts-first-byte`;
- first audio out: `speech-end` to `audio-start`;
- total: `speech-end` to `audio-start`.

The report also includes transition deltas between adjacent pipeline marks.
Speculation may make a milestone precede speech end or an adjacent transition
negative. Such overlap is represented explicitly as `leadMs`; values are
clamped only in the human summary, never in raw timestamps or JSON.

Each stage and total reports nearest-rank p50, p90, and max. Gates use warm
turns after one explicit warm-up turn but still require the warm-up ledger to
be valid. The maximum-turn gate covers every measured turn, including warm-up.

## Script

The committed script contains 32 turns with stable IDs:

- English and Québec French short and long requests;
- ordinary sequential turns;
- barge-in while thinking and while speaking;
- a correction that replaces the accepted transcript revision;
- two concurrent topics that both finish;
- simultaneous topic results that must be serialized in speech;
- tool calls with a tool-start filler and a final answer;
- a stop that cancels only the foreground topic;
- turns after interruption to detect leaked events or stale playback.

Generated PCM uses language-specific pitch and cadence envelopes but embeds the
fixture transcript out of band; fake STT consumes the scripted transcript, not
an acoustic recognizer. This tests the voice pipeline and timing attribution,
not speech-recognition quality, and the report says so.

## Report

The JSON report is versioned and includes:

- run ID, commit SHA, mode, engine/provider labels, and fixture configuration;
- raw ledger events;
- one row per turn with all timestamps, stages, flags, and scenario outcome;
- p50, p90, and max for every stage and total;
- spoken intervals and any overlap;
- every gate with threshold, observed value, and pass/fail;
- provider request-path audit proving xAI was used only for STT/TTS;
- optional reference comparison.

Markdown is derived from JSON and contains no independent calculations.

## Reference Recording

`--reference <path>` accepts an optional Grok Bot recording plus an adjacent
JSON sidecar containing measured speech-end and first-audio markers. The
harness validates the markers and reports the reference latency and delta from
the Sagax run. If no reference is supplied, the report contains
`reference.status = "not-provided"` and no numeric comparison. The harness
never infers or fabricates Grok Bot timings from an unmarked audio file.

## Components

- `scripts/voice-benchmark/model.ts`: report, ledger, statistics, gates, and
  reference types.
- `scripts/voice-benchmark/scenario.ts`: the 32-turn bilingual script and
  generated PCM.
- `scripts/voice-benchmark/run.ts`: isolated server and provider orchestration,
  VoiceCall driving, and raw event capture.
- `scripts/voice-benchmark/cli.ts`: mode selection, report output, exit status,
  and reference-sidecar loading.
- Focused Vitest files test ledger rejection, percentile/max calculations,
  threshold boundaries, overlap detection, script coverage, optional-reference
  behavior, and the full deterministic run.
- `docs/verification/voice-acceptance.md` documents local deterministic and
  Task 48 real-provider commands, evidence, and cleanup.

The old benchmark entrypoints become compatibility wrappers around the new
runner or are removed if no caller remains. They do not retain a second scorer.

## Failure and Cleanup

Every process, WebSocket, timer, and temporary directory is owned by one run
and closed in `finally`. A failed run writes a partial report with the failure
reason before returning nonzero. Secrets are never written to reports, command
lines, or logs. Real mode refuses to start when required credentials are
absent; it never silently falls back to synthetic providers.


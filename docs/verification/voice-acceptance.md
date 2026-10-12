# Voice acceptance

The voice benchmark proves a full-duplex call without a microphone, a sound
device, or the person's data. One script of 32 turns (English and Québec
French) drives the real `VoiceCall`, the message route, the runtime stream,
streaming speech, and playback. The ledger, the gates, and the report are the
same in every mode. Design:
[`docs/superpowers/specs/2026-10-12-voice-benchmark-acceptance-design.md`](../superpowers/specs/2026-10-12-voice-benchmark-acceptance-design.md).

## Commands

Synthetic profile, the pull-request gate. Fixed fake delays, a fake engine,
and a fake xAI. The process exits nonzero when any gate fails. The pnpm
script runs under Node's type transform, with a small hook that turns the
bundled `.onnx?url` imports into file URLs and resolves the voice call's
extensionless imports. The run uses the scripted detector, not those models.

```sh
pnpm voice:acceptance -- --out /tmp/sagax-voice-synthetic
```

Real providers, recorded and non-gating unless `--enforce` is set. Needs both
credentials before the server starts. A missing key is a refusal, never a
fallback to the synthetic profile. Without `--enforce` the process exits 0
even when the report's gates fail; the JSON still records `passed`.

```sh
SAGAX_XAI_VOICE_KEY=... XAI_API_KEY=... \
  pnpm voice:acceptance:real -- --enforce --out /tmp/sagax-voice-real
```

Optional Grok Bot reference. The sidecar is `<recording>.json` with
`version: 1`, `speechEndMs`, and `firstAudioMs` strictly after speech end.
A missing sidecar is an error. Omitting `--reference` writes
`reference.status: "not-provided"` and no numeric comparison. The harness
never invents Grok Bot timings from an unmarked file.

```sh
pnpm voice:acceptance -- --reference /path/to/grok.wav
```

`--out` writes `report.json` and `report.md`. Markdown is rendered from the
JSON. A run that throws before a report writes a partial
`{ version: 1, passed: false, error }` with secrets removed.

## What the gates require

- 32 turns, exactly one warmup.
- Warm turns only: end of speech to first audio, nearest-rank p50 at most
  800 ms.
- Every measured turn, warmup included: at most 2,500 ms.
- Spoken answer intervals never overlap.
- Interruptions while thinking and while speaking, one correction, two
  concurrent topics, and one tool call are observed.
- A cancelled turn has speech end and a cancellation. It is not also
  completed, and it carries no answer marks.
- A completed turn has every mark. Text-to-speech bytes are strictly after
  the first model token, and audio start is strictly after those bytes.

The synthetic delays are fixture settings, not a claim about xAI. The report
names the profile `synthetic` and records those delays.

## Provider audit

The synthetic run reads the fake xAI request log. A path is allowed only when
it is `/v1/stt`, `/v1/tts`, or `/v1/tts/voices`. Control routes under `/__`
are not provider paths. Both `/v1/stt` and `/v1/tts` must appear, and
`unexpectedPaths` must be empty.

A real run has no local request log. Its audit is
`{ paths: [], unexpectedPaths: [], pass: true }`. That does not prove which
xAI routes were called. Release acceptance still fails on latency, overlap,
turn count, and the scenario gates.

## Isolation and credentials

Each run creates `sagax-voice-acceptance-*` under the temporary directory,
picks free ports, and never reads `~/.sagax` or a live server. The synthetic
key is a fixture string. A real key is read from the environment and is not
printed: reports, the partial error, and the server log redact
`SAGAX_XAI_VOICE_KEY`, `XAI_API_KEY`, and any `xai-` token.

The real profile also needs `espeak-ng` and `ffmpeg` on `PATH` to render the
script. The release workflow installs both. The synthetic profile generates
PCM in process and does not call them.

## Where it runs

Pull-request CI runs only the synthetic command and uploads
`voice-acceptance-synthetic`. That job is part of the CI gate.

`pnpm voice:acceptance:real -- --enforce` runs in
`.github/workflows/voice-release-acceptance.yml` (manual dispatch, a nightly
schedule, and the release workflow). Release packaging waits on that job for
the pinned commit. `ship_without_ci` does not skip it. The workflow maps
`secrets.SAGAX_XAI_VOICE_KEY` onto both `SAGAX_XAI_VOICE_KEY` and
`XAI_API_KEY`.

## Failure

A nonzero synthetic exit means a gate failed or a turn never finished. Read
`report.json` when it exists: `gates`, `overlaps`, `scenarios`, and
`providerAudit.unexpectedPaths`. A thrown turn names which marks arrived
(`completed`, `llm`, `tts`, `audio`, `busy`, `player`). A partial report
means the process died before `compileVoiceBench`.

## Cleanup

The runner closes the event stream, ends the call, signals the server,
closes the fake xAI, and deletes only its temporary data directory, in
`finally`. Leave the `--out` directory; it is the evidence. Do not delete a
broad temp root and do not stop processes by name.

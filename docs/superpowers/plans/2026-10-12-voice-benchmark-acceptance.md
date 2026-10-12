# Voice Benchmark and Acceptance Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one reproducible 32-turn bilingual full-duplex benchmark that gates synthetic PR CI and real-provider release acceptance with trustworthy per-utterance timings.

**Architecture:** An append-only event ledger is compiled into immutable per-turn rows, stage summaries, overlap intervals, and gate outcomes. A portable scripted voice driver feeds the real VoiceCall/server path in synthetic and real-provider profiles; one CLI emits versioned JSON and derived Markdown, and one reusable workflow supplies manual, nightly, and release-blocking real acceptance.

**Tech Stack:** TypeScript, Vitest, Node 24, Sagax VoiceCall, loopback fake xAI/engine fixtures, WebSocket, GitHub Actions.

## Global Constraints

- Deterministic CI runs exactly 32 turns and enforces p50 total <= 800 ms, every turn <= 2,500 ms, and zero spoken-answer overlap.
- Real-network PR runs are non-gating observations; release acceptance enforces the same gates.
- Reports contain p50, p90, and max for endpoint, STT final, LLM first token, TTS first byte, first audio out, and total.
- English and Québec French, interruptions, corrections, two concurrent topics, and tool calls are mandatory.
- Missing reference input is recorded as `not-provided`; no Grok Bot number is inferred or fabricated.
- Every server and provider run is isolated from user data and cleaned up in `finally`.
- Credentials never appear in reports, logs, argv, or generated artifacts.

---

### Task 1: Immutable Timing Ledger and Gate Compiler

**Files:**
- Create: `scripts/voice-benchmark/model.ts`
- Create: `scripts/voice-benchmark/model.test.ts`

**Interfaces:**
- Produces:
  - `VoiceBenchLedger.record(event: VoiceBenchEvent): void`
  - `compileVoiceBench(input: CompileVoiceBenchInput): VoiceBenchReport`
  - `renderVoiceBenchMarkdown(report: VoiceBenchReport): string`
  - `VOICE_BENCH_THRESHOLDS = { p50Ms: 800, maxMs: 2500 }`

- [ ] **Step 1: Write failing tests for immutable marks and attribution**

```ts
it("does not let a later turn replace another utterance's first audio", () => {
  const ledger = new VoiceBenchLedger();
  ledger.record(mark("u1", "speech-end", 100));
  ledger.record(mark("u1", "audio-start", 700));
  expect(() => ledger.record(mark("u1", "audio-start", 900))).toThrow(/conflicting duplicate/);
  expect(ledger.events()).toContainEqual(mark("u1", "audio-start", 700));
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run scripts/voice-benchmark/model.test.ts`

Expected: FAIL because `model.ts` does not exist.

- [ ] **Step 3: Implement the event, row, report, summary, reference, and gate types**

```ts
export type VoiceBenchMark =
  | "speech-end" | "endpoint" | "stt-final" | "llm-first-token"
  | "tts-first-byte" | "audio-start" | "audio-end";

export class VoiceBenchLedger {
  #events: VoiceBenchEvent[] = [];
  #marks = new Map<string, number>();
  record(event: VoiceBenchEvent): void { /* immutable key validation */ }
  events(): readonly VoiceBenchEvent[] { return this.#events.map((event) => ({ ...event })); }
}
```

- [ ] **Step 4: Write failing tests for statistics, boundary gates, missing marks, cancellation, and overlap**

```ts
expect(compileVoiceBench(fixture({ totals: [400, 800, 900] })).summary.total)
  .toEqual({ p50: 800, p90: 900, max: 900 });
expect(compileVoiceBench(fixture({ totals: [400, 800] })).passed).toBe(true);
expect(compileVoiceBench(fixture({ totals: [400, 2501] })).passed).toBe(false);
expect(compileVoiceBench(fixture({ overlap: true })).gates.overlap.pass).toBe(false);
```

- [ ] **Step 5: Run RED, implement the compiler and Markdown renderer, then run GREEN**

Run: `pnpm exec vitest run scripts/voice-benchmark/model.test.ts`

Expected: PASS with all model tests green.

- [ ] **Step 6: Commit**

```bash
git add scripts/voice-benchmark/model.ts scripts/voice-benchmark/model.test.ts
git commit -m "test(voice): add immutable benchmark timing ledger"
```

### Task 2: Portable 32-Turn Bilingual Scenario

**Files:**
- Create: `scripts/voice-benchmark/scenario.ts`
- Create: `scripts/voice-benchmark/scenario.test.ts`

**Interfaces:**
- Produces:
  - `VOICE_ACCEPTANCE_SCRIPT: readonly VoiceScenarioTurn[]`
  - `syntheticVoiceFrames(turn: VoiceScenarioTurn): Float32Array[]`
  - `generateLiveVoiceFixture(turn, outputDir): string`

- [ ] **Step 1: Write failing coverage tests**

```ts
expect(VOICE_ACCEPTANCE_SCRIPT).toHaveLength(32);
expect(languages()).toEqual(new Set(["en", "fr-CA"]));
expect(kinds()).toEqual(expect.arrayContaining([
  "ordinary", "interrupt-thinking", "interrupt-speaking", "correction",
  "concurrent-topic", "tool", "stop",
]));
expect(topic("topic-a").some((turn) => turn.concurrentWith === "topic-b")).toBe(true);
```

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run scripts/voice-benchmark/scenario.test.ts`

Expected: FAIL because the scenario module is absent.

- [ ] **Step 3: Implement stable scenario data and generated PCM**

Use deterministic language-specific cadence and pitch envelopes at 16 kHz.
The first sample remains the scripted VAD probability used by the existing
headless VoiceCall fixture. Live mode invokes `espeak-ng -v en-us` or
`espeak-ng -v fr-ca` into an isolated WAV and uses ffmpeg only for fixed
16-kHz mono conversion; command arguments are arrays, never shell strings.

- [ ] **Step 4: Test PCM determinism and live-generator refusal**

```ts
expect(hashFrames(syntheticVoiceFrames(VOICE_ACCEPTANCE_SCRIPT[0]!)))
  .toBe(hashFrames(syntheticVoiceFrames(VOICE_ACCEPTANCE_SCRIPT[0]!)));
expect(() => liveVoiceCommand(turn, "/tmp/out.wav", { espeak: "" }))
  .toThrow(/espeak-ng is required/);
```

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm exec vitest run scripts/voice-benchmark/scenario.test.ts
git add scripts/voice-benchmark/scenario.ts scripts/voice-benchmark/scenario.test.ts
git commit -m "test(voice): script 32 bilingual acceptance turns"
```

### Task 3: Headless Synthetic Runner

**Files:**
- Create: `scripts/voice-benchmark/run.ts`
- Create: `scripts/voice-benchmark/run.test.ts`
- Modify: `server/testing/fake-xai-voice.ts`
- Modify: `server/testing/fake-xai-voice.test.ts`
- Modify: `scripts/voice-acceptance-call.ts`
- Modify: `scripts/voice-acceptance-call.test.ts`
- Modify: `scripts/voice-latency-bench.ts`
- Modify: `scripts/voice-latency-bench.test.ts`

**Interfaces:**
- Consumes: Task 1 ledger/compiler and Task 2 script/PCM.
- Produces: `runVoiceBenchmark(options: VoiceBenchmarkOptions): Promise<VoiceBenchReport>`.

- [ ] **Step 1: Add failing fake-provider tests for utterance-correlated timing events**

The fake STT and TTS controls accept stable scripted utterance IDs and expose
request timestamps without changing production routes.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run server/testing/fake-xai-voice.test.ts scripts/voice-benchmark/run.test.ts`

Expected: FAIL on missing runner and correlation support.

- [ ] **Step 3: Implement one-run resource ownership and event capture**

Start a disposable server through `verificationServerEnvironment`, open the
real STT/runtime/TTS sockets, drive the real `VoiceCall`, and map marks only
through the active immutable utterance ID. Capture tool start/result frames,
interrupt targets, cancellation, topic IDs, player start/end, and provider
path audit. Close sockets, child processes, timers, and temp data in `finally`.

- [ ] **Step 4: Add failing integration assertions**

```ts
const report = await runVoiceBenchmark({ profile: "synthetic" });
expect(report.turns).toHaveLength(32);
expect(report.passed).toBe(true);
expect(report.scenarios).toMatchObject({
  interruptions: { pass: true },
  correction: { pass: true },
  concurrentTopics: { pass: true },
  tools: { pass: true },
});
expect(report.overlaps).toEqual([]);
expect(report.providerAudit.unexpectedPaths).toEqual([]);
```

- [ ] **Step 5: Verify RED, implement minimal behavior, and verify GREEN**

Run: `pnpm exec vitest run scripts/voice-benchmark/run.test.ts scripts/voice-acceptance-call.test.ts scripts/voice-latency-bench.test.ts`

Expected: PASS; the synthetic run produces 32 complete rows under the gates.

- [ ] **Step 6: Keep old entrypoints as thin compatibility wrappers and commit**

```bash
git add scripts/voice-benchmark/run.ts scripts/voice-benchmark/run.test.ts \
  scripts/voice-acceptance-call.ts scripts/voice-acceptance-call.test.ts \
  scripts/voice-latency-bench.ts scripts/voice-latency-bench.test.ts \
  server/testing/fake-xai-voice.ts server/testing/fake-xai-voice.test.ts
git commit -m "test(voice): run deterministic full-duplex acceptance"
```

### Task 4: CLI, Reports, and Reference Comparison

**Files:**
- Create: `scripts/voice-benchmark/cli.ts`
- Create: `scripts/voice-benchmark/cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces commands:
  - `pnpm voice:acceptance`
  - `pnpm voice:acceptance:real`

- [ ] **Step 1: Write failing CLI tests**

Cover default synthetic hard gates, real observation without `--enforce`,
real hard gates with `--enforce`, partial-report writes, and credential
refusal before server launch.

- [ ] **Step 2: Write failing reference tests**

```ts
expect(loadReference(undefined)).toEqual({ status: "not-provided" });
expect(loadReference("grok.wav")).rejects.toThrow(/sidecar/);
expect(await loadReference("grok.wav")).toMatchObject({
  status: "measured", latencyMs: 640,
});
```

The fixture sidecar is `grok.wav.json` with:

```json
{"version":1,"speechEndMs":1240,"firstAudioMs":1880}
```

- [ ] **Step 3: Run RED, implement argument parsing/report writes/exit status, and run GREEN**

Run: `pnpm exec vitest run scripts/voice-benchmark/cli.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/voice-benchmark/cli.ts scripts/voice-benchmark/cli.test.ts package.json
git commit -m "feat(voice): add acceptance benchmark CLI and reports"
```

### Task 5: CI and Release-Blocking Real Acceptance

**Files:**
- Create: `.github/workflows/voice-release-acceptance.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/ci-workflow.test.ts`

**Interfaces:**
- Synthetic CI executes `pnpm voice:acceptance -- --out "$RUNNER_TEMP/voice-acceptance"`.
- Reusable workflow input `ref` checks out the pinned SHA.
- Real workflow executes `pnpm voice:acceptance:real -- --enforce`.

- [ ] **Step 1: Write failing workflow source assertions**

Assert the CI gate needs the synthetic job, the real workflow has
`workflow_call`, `workflow_dispatch`, and nightly `schedule`, artifacts upload
under `always()`, and release `assemble` needs `voice-acceptance`.

- [ ] **Step 2: Run RED**

Run: `pnpm exec vitest run scripts/ci-workflow.test.ts`

Expected: FAIL because the jobs/workflow are absent.

- [ ] **Step 3: Add the synthetic job and reusable real workflow**

Real mode maps the one repository secret to both server voice and Grok model
credentials without printing it:

```yaml
env:
  SAGAX_XAI_VOICE_KEY: ${{ secrets.SAGAX_XAI_VOICE_KEY }}
  XAI_API_KEY: ${{ secrets.SAGAX_XAI_VOICE_KEY }}
```

Install `espeak-ng` for the bilingual live fixtures. Upload JSON and Markdown
for both success and failure.

- [ ] **Step 4: Make release assembly depend on the reusable workflow**

Add a `voice-acceptance` call using the pinned SHA from `prepare`, then include
it in `assemble.needs`. Do not connect it to `ship_without_ci`.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm exec vitest run scripts/ci-workflow.test.ts
git add .github/workflows/voice-release-acceptance.yml .github/workflows/ci.yml \
  .github/workflows/release.yml scripts/ci-workflow.test.ts
git commit -m "ci(voice): block releases on real acceptance"
```

### Task 6: Verification Recipe and Final Evidence

**Files:**
- Create: `docs/verification/voice-acceptance.md`
- Modify: `docs/verification/README.md`
- Modify: `docs/voice-mode-xai.md`
- Modify: `.github/pull_request_template.md` only if a voice acceptance checkbox is required by existing release policy tests.

**Interfaces:**
- Documents exact commands, artifacts, isolation, credentials, reference
  sidecar, failure interpretation, and cleanup.

- [ ] **Step 1: Add the recipe and documentation links**

Document:

```sh
pnpm voice:acceptance -- --out /tmp/sagax-voice-synthetic
SAGAX_XAI_VOICE_KEY=... XAI_API_KEY=... \
  pnpm voice:acceptance:real -- --enforce --out /tmp/sagax-voice-real
pnpm voice:acceptance -- --reference /path/to/grok.wav
```

- [ ] **Step 2: Run focused tests and type/lint checks**

```bash
pnpm exec vitest run scripts/voice-benchmark/*.test.ts \
  scripts/voice-acceptance-call.test.ts scripts/voice-latency-bench.test.ts \
  server/testing/fake-xai-voice.test.ts scripts/ci-workflow.test.ts
pnpm typecheck
pnpm lint
```

- [ ] **Step 3: Run the synthetic acceptance command as the isolated live workflow proof**

```bash
pnpm voice:acceptance -- --out /tmp/sagax-voice-synthetic
```

Expected: 32 complete turns, p50 <= 800 ms, max <= 2,500 ms, no overlap,
all required scenarios pass, and no unexpected provider path.

- [ ] **Step 4: Inspect generated JSON and Markdown, then commit**

```bash
git add docs/verification/voice-acceptance.md docs/verification/README.md docs/voice-mode-xai.md
git commit -m "docs(voice): document Task 48 release acceptance"
```

- [ ] **Step 5: Push and update the draft pull request**

```bash
git push -u origin cursor/voice-acceptance-harness-f608
```


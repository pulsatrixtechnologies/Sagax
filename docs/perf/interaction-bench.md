# Interaction bench: Sagax desktop against Grok Bot

`scripts/perf/interaction-bench.mjs` measures the same interactions in the
Sagax desktop app and in Grok Bot, launched in alternation on the same
machine, and writes every sample to a JSON file with a median/p95 summary.
The goal it serves: every interaction of Sagax desktop at least as fast as
Grok Bot's.

## What it measures

| Key | Interaction | Sagax | Grok Bot |
|---|---|---|---|
| `startup` | Launch to an interactive window (sidebar rows and composer on screen) | yes | yes |
| `bot` | Click a bot in the sidebar until its conversation is rendered | yes | yes |
| `thread` | Pick another thread in the header's thread list until it is rendered | yes | n/a (one conversation per bot) |
| `botMenu` | Open a bot's menu (Sagax: the row's "…"; Grok Bot: right click) | yes | yes |
| `avatar` | Open the avatar menu | yes | yes |
| `settings` | Settings from the avatar menu until the dialog shows its first page | yes | yes |
| `settingsPage` | Change Settings page (Sagax: Appearance; Grok Bot: Computer) | yes | yes |
| `apps` | Open Connect apps | yes | yes |
| `typing` | Key to painted character in the composer (median of 13 keys) | yes | yes |
| `model` | Open the model picker of the composer | yes | n/a (no picker) |
| `send` | Enter to the local bubble of the sent message | yes | n/a (never sends) |
| `scroll` | Wheel up a long conversation for 2.6 s: p95 frame gap, dropped frames, long tasks | yes | yes |
| memory | RSS of the whole process tree (main, renderers, GPU, utilities, Sagax's local server) 5 s after launch and after the scenarios | yes | yes |

Latency is taken from the input event's own timestamp (`Event.timeStamp`,
stamped when the browser receives the input) to the first animation frame
after the expected result is in the DOM, plus one task so that frame's paint
is under way. Beside it each sample keeps the longest Event Timing entry
(`eventMax`, the INP-like number) and the long tasks that overlapped the
interaction. A sample whose expected result is already on screen before the
input is refused rather than recorded as a fast one.

Each round launches both apps (the order alternates every round) and runs
every scenario twice in each process: the first run is reported as `cold`
(code not yet loaded or optimized, lazy chunks fetched), the second as
`warm`. Before the rounds, each app is launched once unmeasured, so what a
launch finds (code caches, HTTP cache, the version stamp) is the same for
both, as on a computer where both are in daily use.

The 1-minute load average is recorded with every sample. On a shared
machine set `BENCH_LOAD_MAX` to wait (up to 3 minutes) for the load to come
down before each launch.

## Safety

- **Grok Bot** runs from the installed app on a throwaway copy of a profile
  (`--grok-profile`). The bench only reads: it never sends a message and
  never changes a setting; a typed draft is erased with select all and
  delete, never Enter. Make the copy with Grok Bot's caches left out:
  `rsync -a --exclude 'Singleton*' --exclude Cache --exclude 'Code Cache' --exclude GPUCache --exclude Crashpad "~/Library/Application Support/Grok Bot/" <dir>/`.
- **Sagax** runs a staged copy of the app (`stage-app.mjs`) with
  `SAGAX_PERF_BENCH=1`: its logs stay in its own userData, it never takes
  the `sagax://` links, never runs the updater, and its local server listens
  on `SAGAX_PERF_PORT` (18999), away from the installed app's ports. Its data
  is a copy of the seeded fixture, its keychain is Chromium's mock keychain,
  and `HOME` is a scratch folder. Nothing of the installed Sagax is read or
  written.

## Running it

```sh
# 1. The fixture: nine bots, a few threads, a 120-turn conversation with
#    tables and code (fake engine, no provider, no network).
node --experimental-strip-types scripts/perf/seed-fixture.ts /tmp/sagax-fixture --turns 120

# 2. A runnable copy of Sagax built from this checkout (UI, server and
#    Electron main replaced inside an APFS clone of the installed app).
node scripts/perf/stage-app.mjs /tmp/Sagax-bench.app

# 3. The bench.
node scripts/perf/interaction-bench.mjs --rounds 10 --out results.json \
  --sagax-app /tmp/Sagax-bench.app --fixture /tmp/sagax-fixture \
  --grok-profile /tmp/grok-profile --verbose
```

Options: `--apps sagax` (or `grok`) to run one app, `--scenarios
startup,bot,typing` to run a subset, `--label` to name the run, `--keep` to
keep the per-launch folders.

`results.json` holds every sample (`apps.<app>.cold|warm.<scenario>[]`, the
startup and memory samples) and `summary`, the median and p95 per scenario.
Compare two builds in the same run, in alternation with Grok Bot as the
reference: stage each into its own `.app`, then
`--apps sagax:before,sagax:after,grok --sagax-app before=/tmp/A.app,after=/tmp/B.app`.

## Limits

- macOS only (APFS clones, `ps`, the staged bundle).
- The conversations are not the same: Sagax's come from the fixture, Grok
  Bot's from the copied profile. The scroll scenario reports the size of
  each transcript (`scrollHeight`, `transcriptNodes`) beside its numbers.
- Grok Bot's startup includes its own account and sync work; Sagax's
  includes starting its local server. Neither is a network-free launch.

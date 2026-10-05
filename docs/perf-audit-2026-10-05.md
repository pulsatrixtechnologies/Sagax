# Sagax desktop performance audit, 2026-10-05

Branch `perf/desktop-audit` in `/Users/Repository/_worktrees/sagax-perf-audit`, based on `33f593a1b` (PR #133, idle chat-header owl). These commits stay on this branch. They are not pushed and not merged. Sagax 0.4.6 ships from `main` without them.

The owner's machine is slow and Sagax stays open all day. PR #133 removed a 60 fps owl under the glass bars that was holding about 35% GPU and 15% renderer CPU while the app was idle. This pass looked for the same class of cost, measured it, and fixed the ones with a clear win and a small behavior risk.

## How it was measured

Two instruments, plus a read of the always-on paths.

**Electron frame meter** (`app.getAppMetrics()`, one focused visible window, `backgroundThrottling: true`, 3.0 s sample after 400 ms warmup). The page is one small SVG, or one WebGL clear. This Mac's display is faster than 60 Hz: the requestAnimationFrame gate recorded 257 callbacks and 86 draws in 3 s (about 86 Hz callbacks, about 29 draws/s). Absolute percents are for that tiny page on a fast Mac. PR #133's 35% was many larger owls in the real window. The ordering is the evidence.

The GPU process is shared across modes. Its idle-wakeup count jumps at the first animated mode (158/s) and stays near 155/s afterwards. Later GPU wakeup numbers are not a per-mode rate. Tab CPU, tab wakeups, and `percentCPUUsage` do reset per mode.

| Mode | Callbacks | Draws | GPU CPU | Tab CPU | Tab wakeups/s |
|---|---:|---:|---:|---:|---:|
| static | 0 | 0 | 0.01% | 0% | 2 |
| css-bob (infinite CSS under glass) | 0 | 0 | 0.74% | 0.49% | 24 |
| raf-gate-30 (rAF every vsync, draw at 30) | 257 | 86 | 0.30% | 0.27% | 30 |
| paced-30 (setTimeout then one rAF) | 128 | 128 | 0.47% | 0.36% | 75 |
| webgl-raf-30 | 256 | 86 | 0.41% | 0.27% | 34 |
| webgl-paced-30 | 129 | 129 | 0.57% | 0.28% | 67 |
| webgl-paced-12 | 46 | 46 | 0.26% | 0.12% | 29 |

**Room-handoff tick bench** (Node, `process.cpuUsage`, 4000 tight `tick()` calls, this worktree after the pump change). A tight loop does not include the cost of waking the process. It measures the JavaScript inside one tick.

| Tree | Per tick | CPU if that tick ran at 4 Hz |
|---|---:|---:|
| empty | 0.74 µs | 0.0003% |
| 800 terminal nodes | 20.1 µs | 0.008% |
| 1000 terminal nodes | 21.8 µs | 0.009% |

There is no Chrome trace of the real renderer with a long conversation, a full sidebar, and the panel open. The synthetic page is the instrument for the animation-under-glass mechanism. css-bob versus static shows the meter works (GPU 0.74% versus 0.01%, tab 0.49% versus 0%).

## Ranked findings

| Rank | Finding | Impact | Evidence | Where | Status |
|---|---|---|---|---|---|
| 1 | Resting and held-unread owls still ran at the display rate under the glass bars | High while any unread or breathing owl is on screen all day. Same mechanism as PR #133. | css-bob: one infinite animation under glass costs 0.74% GPU and 0.49% tab on a tiny SVG. A 12 Hz pace is the profile that cut tab CPU (0.27% to 0.12% on the WebGL clear). | `src/lib/owl/owl-loop.ts:71` (70 ms rest gap), `:250` (skip an unchanged transform), `:288` (full rate only while something moves). Glass: `src/styles.css:1422`. | Fixed, `21d552cb0` |
| 2 | Sidebar phone status polled twice, and every reply called setState | Medium. Two `companion.state()` IPCs every 15 s for the whole session, plus a render when nothing changed. | The phone button and the profile menu each mounted the hook. No visibility check. | `src/components/SidebarPhoneButton.tsx:11`, `:150` | Fixed, `d581ee4ea` |
| 3 | Room-handoff timer every 250 ms for the life of the process | Low CPU (about 0.01% at 4 Hz even with 1000 settled nodes), high wakeups: 4/s on every Sagax process, including people who never hand off a room. | Bench above. The old `setInterval` in `server/index.ts` was unconditional. | `server/room-handoffs.ts:429` `needsPump`, `:448` `start`, `server/index.ts:14982` | Fixed, `6fb353c70` |
| 4 | Desktop-bridge poll stored a new object every 20 s | Low. One composer re-render every 20 s while an organization desktop exists. Hidden windows already skipped the poll. | `JSON.stringify` equality. The hook is mounted from the composer all day. | `src/lib/desktop-bridge.ts:81`, `:97`, `:102` | Fixed, `052ecfc7d` |
| 5 | `server.log` grew without a cap | Low CPU, real disk. The main process appended every server-child stdout line for the whole session. Diagnostics read a 256 KB tail, so one backup is enough. | No rotation on the slog path. Crash log already capped itself by wiping. | `electron/log-file.mjs:7` (8 MB plus `.1`), `electron/main.mjs:881` | Fixed, `9d3675b0a` |
| 6 | Floating pets request a frame every vsync and draw at 30 Hz while idle | High only when a pet sits on screen all day. On this meter the skipped callbacks are cheap. | raf-gate-30: tab 0.27%, GPU 0.30%, 86 draws / 3 s. paced-30 drew 128 times and woke the tab 75/s. Worse. webgl-paced-12 was cheaper because it drew less often, and it would coarsen a 150 ms blink. | `src/components/floating-bots/behavior.ts:350` (`mascotFrameRate` idle 30). Windows: `electron/floating-bot-window.mjs:506` (`backgroundThrottling: true`). | Left as-is. Optional later: drop idle draws to 12 Hz inside the existing gate if the owner accepts coarser blinks. |
| 7 | `MessagesList` is memoized and also calls `useStore()` | Medium while a turn streams or any store update lands. React reconciles the visible bubbles on every store change. `ChatMarkdown` still skips a reparse when text and peers are unchanged. | `useStore` is `useContext` (`src/state/store.tsx:4395`). The provider value is memoized (`:4384`), so this is subscription breadth, not a new object every render. | `src/components/ChatView.tsx:704`, `:739` | Proposed. Pass the few fields the list reads, or a narrow transcript context. Do not rewrite it in this pass. |
| 8 | Transcripts longer than the window | The mounted set is already capped at 120 messages. A 1k-message thread does not mount 1k rows. | `TRANSCRIPT_WINDOW_SIZE = 120` in `src/lib/transcript-window.ts:5`, applied at `src/components/ChatView.tsx:1090`. Hydration page is 200 (`src/state/store.tsx:2751`). | Same | Proposed only after a trace of a 120-row window of heavy markdown. Variable-height rows are the hard part. The window is the mitigation that already shipped. |
| 9 | Shiki `codeToHtml` on the main thread the first time a language is seen | Medium on the first fenced block of a language. Later hits are cached (cap 200). Streaming fences wait 250 ms. | Singleton highlighter, `src/components/ChatMarkdown.tsx:74`, `:290` | Same | Proposed: highlight in a worker, or pre-warm the two themes off the open path. |
| 10 | Eager weight on the first paint | Startup parse and download, not idle CPU. The HTML modulepreloads the entry, every locale, and KaTeX. Owl 3D, ELK, cytoscape, and the Shiki grammars are separate chunks and are not in that list. | `pnpm build` (vite 8.3.2, 1.75 s, 5560 modules): entry `index-DRM3sQ4L.js` 2,708 kB (gzip 735 kB); `i18n-Mpa7kDAj.js` 1,957 kB (gzip 521 kB); `katex-Cex5txLj.js` 259 kB (gzip 77 kB); main CSS 250 kB (gzip 43 kB). `dist/` is 49 MB with fonts and lazy chunks. All ten locale JSON files are static imports. | `dist/index.html` modulepreloads. Locales: `src/locales/index.ts:6`. KaTeX CSS: `src/main.tsx:17`. `CURSOR_STATES`: `src/lib/mascot.ts:1`. | Proposed: load the active locale plus English, and dynamic-import KaTeX with the math path. Move `CURSOR_STATES` out of the avatar module. |
| 11 | Retro assistant window sets `backgroundThrottling: false` | Unknown until that window is on screen. Flipping the flag without a trace can freeze a visible pet-style window. | `electron/retro-assistant-window.mjs:50` | Same | Proposed. Trace a visible Hibou 98 before changing it. |
| 12 | Gaze IPC every 200 ms per visible floating pet | About 5 IPCs/s while a pet is visible and awake. Hidden windows are already Chromium-throttled. | `src/components/floating-bots/FloatingBotView.tsx:49`, `:429` | Same | Accepted. Optional later: 1 s when the last distance was far, 200 ms when near. |

## Fixes, before and after

**Resting owls** (`21d552cb0`). Working, success, the unread shake (first 0.65 s of the 1.8 s alert cycle), blinks, and wing moves stay on `requestAnimationFrame`, so the look is unchanged while something is happening. A breath, or an unread face after the shake, waits 70 ms and then takes one frame (about 12 Hz). Identical transform strings are not written again, so a settled hold does not dirty the glass. The owl-loop change itself was not re-traced inside the full app. The meter that justifies it is css-bob versus static, and the 12 Hz sample versus the display-rate gate.

**Sidebar phone** (`d581ee4ea`). One shared poll. The IPC is skipped while `document.visibilityState` is `"hidden"`, and a refresh runs when the window becomes visible. An equal snapshot does not notify React. The last subscriber clears the timer.

**Desktop bridge** (`052ecfc7d`). An equal payload keeps the previous object. A solo server still stops polling after the first null.

**Server log** (`9d3675b0a`). Rotate at 8 MB, keep `server.log.1`. Writes are synchronous `writeSync` so a line is on disk if the process dies before an async flush, and the descriptor is closed before the rename (Windows will not rename an open file). The tradeoff is a short synchronous append on the main process per server-stdout line. That stream is not 60 fps. Logging errors are swallowed.

**Room handoffs** (`6fb353c70`). `start(250)` arms a timer only while some node can still dispatch, resume, expire, or report. `enqueue` kicks it. The timer disarms at the end of the tick that finds the tree idle. Completion of `run()` is async, so one extra tick runs after the last node settles, then the timer stops. `stop()` exists so a test can drop the timer if it fails mid-way. An empty tree, and a restarted file that is already settled, do not arm it.

## Tried and rejected

A setTimeout-then-one-rAF clock for the floating mascots (Owl 2.5D, Owl 3D, the other 2.5D mascots). The meter above: paced-30 overshot the 30 Hz target (128 draws in 3 s, about 43 fps) and raised tab wakeups from 30/s to 75/s. WebGL showed the same pattern. The files were restored to `33f593a1b`. `mascotFrameRate`'s idle 30 is unchanged. Tests in `behavior.test.ts` still expect idle 30.

## Checked, and left alone

These are on the hunt list. They are already gated, or they only run while the feature is on screen.

- Header and sidebar owls join the frame loop only for working, unread, or a real motion beat (`src/lib/mascot-animate.ts:13`). A bot whose name contains "working" does not animate the row by itself.
- Unread owls still animate on purpose. The shake stays at display rate. The hold after it does not.
- Owl skins with `data-owl-fx="live"` are a chosen skin, and reduced motion forces `still` (`src/components/OwlAvatar.tsx`). Floating 2.5D marks a chosen skin live. That cost exists only while that pet is visible.
- `.maus-motion--working` infinite CSS runs only in the working pose (`src/styles.css:1868`).
- Turn presence, mention lists, the bot picker, voice bars, the launch screen, and the call view animate only while those views are mounted.
- Stream token deltas batch on one frame, or at 64 KiB, or at 100 ms (`src/state/store.tsx:3015`). SSE pings do not render. The stale checker wakes every 10 s and returns immediately when the window is hidden (`src/lib/live-events.ts:335`, `:351`).
- Relative times share one 30 s clock that pauses while hidden. Snooze is a single timeout.
- Activity panel: 4 s while something is active, 30 s when idle. The 1 s clock runs only while an item is active. Computer screenshots are that tab only, and rate-limited.
- Floating-bot behavior clock is 250 ms and skips while `document.hidden` (`FloatingBotView.tsx:390`). Call level samples are 50 ms only during a call on a mascot (`FloatingBots.tsx`).
- Plan usage's 30 s clock, settings polls (connections, engines, MCP, plugins), and the remote-desktop 1 s shot are mounted with those panels.
- Main process: hardware acceleration is disabled on Linux only (`electron/main.mjs:275`), after GPU-process crashes on the supported machine. `powerSaveBlocker` runs while companion keep-awake is on (`:841`) or a plugged-in routine is due. The updater checks once after 15 s, then hourly, and the timer is unref'd (`electron/updater.mjs:151`). No chokidar. Offscreen browse and proxy-password windows are created per use and destroyed. Floating windows keep `backgroundThrottling: true`.
- Messages DB is WAL with `synchronous = NORMAL`, thread index, and FTS5 (`server/message-db.ts:44`, `:57`, `:144`). Deltas are inserts. `saveBots` rewrites `bots.json` on a bot mutation (`server/store.ts:1116`), which is event-driven.
- Server timers that stay: routines 10 s in memory, memory upkeep 10 min, turn watchdog 60 s, calendar calls 10 s when that feature is on, IdP sweep 60 s only if an IdP is configured, sandbox sweep 60 s. Screen polling is 6 s only while a turn owns a screen.
- Companion: mDNS advertise every 30 s, unref'd (`companion/src/advertise-watch.ts:45`). The control page polls `/state` only while that page is open. The viewer relay interval exists only during a viewer session.
- Object URLs for attachments, export, and speech have a revoke path (`src/lib/composer-attachments.ts:796`, `src/lib/export-transcript.ts:184`, `src/lib/tts/index.ts:130`). No leaked URL was proven. IPC listeners in main are per window, not per render.
- `three`, mermaid, and onnx are dynamic or feature-gated. They are not the idle frame loop.

## Tests and gates

- `pnpm lint` (`oxlint --deny-warnings`): exit 0.
- `pnpm typecheck` (`tsc -b && tsc -p tsconfig.server.json`): exit 0. The phone-poll test had to keep its fake timer on an object property. A `let` assigned inside the interval callback was narrowed to `null`.
- `pnpm exec vitest run server/room-handoffs.test.ts`: 45 passed, including "does not keep a timer while the tree is idle" (real 20 ms timers; fake timers had hung this test and the next one) and "shares one identity across one call's recipients".
- `pnpm exec vitest run` of `OwlAvatar.test.ts`, `owl-wings.test.ts`, `SidebarPhoneButton.test.ts`, `desktop-bridge.test.ts`, `electron/log-file.test.mjs`, `behavior.test.ts`, `mascot-animate.test.ts`, `Avatar.test.ts`: 8 files, 105 passed. `SidebarPhoneButton.test.ts` again after the type fix: 10 passed.
- `pnpm build` (`tsc -b && tsc -p tsconfig.server.json && vite build`): exit 0. Lock acquired 23:55:14 local, released on exit. Vite reported two pre-existing CSS warnings (`::highlight(...)` is not a recognized pseudo-element to the minifier). They are not from this branch.

## Build

`pnpm build` took the shared heavy lock, which another session had held for TestFlight archives, and released it when the command exited.

Vite 8.3.2 transformed 5560 modules and finished in 1.75 s. `dist/` is 49 MB on disk. First paint, from `dist/index.html` modulepreload and stylesheet links:

| Asset | Raw | Gzip | On first paint |
|---|---:|---:|---|
| `index-DRM3sQ4L.js` | 2,708 kB | 735 kB | yes, the entry |
| `i18n-Mpa7kDAj.js` | 1,957 kB | 521 kB | yes, modulepreload |
| `katex-Cex5txLj.js` | 259 kB | 77 kB | yes, modulepreload |
| `index-DQBls_Hk.css` | 250 kB | 43 kB | yes |
| `Owl3D-CAmbJTav.js` | 660 kB | 168 kB | no |
| `elk-IJKZMXRS-j1KTJyCv.js` | 1,463 kB | 456 kB | no |
| `cytoscape.esm-Yq6u8L66.js` | 435 kB | 138 kB | no |
| `wasm-BnjxR4X6.js` | 622 kB | 232 kB | no |

Shiki grammars are already one chunk per language (the largest single grammar in the top 25 was about 770 KB) and are not preloaded. The startup cost that is still eager is the entry, all ten locale packs (`src/locales/index.ts:6` through `:15`), and KaTeX.

## Commits

| Commit | Subject |
|---|---|
| `21d552cb0` | Pace resting owls below the display rate. |
| `d581ee4ea` | Poll the sidebar phone once, and only while the window is visible. |
| `052ecfc7d` | Skip a desktop-bridge refresh that did not change. |
| `9d3675b0a` | Cap the desktop server log. |
| `6fb353c70` | Stop the room-handoff timer while nothing is in flight. |

This document is the last commit on the branch.

## What remains

- A trace of the real idle window (long thread, full sidebar, panel open) on the owner's machine. The synthetic page does not reproduce the 35% GPU figure, and it should not be asked to.
- Rows 7, 8, 9, and 11. They need that trace, or a worker design, before anyone rewrites them.
- Row 10, now measured: the eager i18n chunk (gzip 521 kB, all ten locales) and KaTeX (gzip 77 kB) on first paint. Split locales and load KaTeX with the math path. That is a loading change, so it stays a proposal.
- Floating-pet idle rate (row 6) and gaze IPC (row 12), if the owner wants a coarser pet in exchange for fewer draws.

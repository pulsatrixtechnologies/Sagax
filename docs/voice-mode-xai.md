# Voice mode with xAI

Voice mode is the floating voice bar above the composer: the bot's name on
top, its avatar, a live waveform, then settings (Voice, Speed, Language),
transcript, mute and end. xAI does the voice; the bot stays the brain.

## The bot answers, xAI only listens and speaks

A call talks to the app's bot: its engine, instructions, memory, tools, MCP
servers, approvals and payer rules, with the transcript in the thread. xAI is
used only as speech to text and text to speech. Voice mode never uses xAI's
realtime voice agent, Grok responses, chat completions or function calling,
nor any mode where xAI writes the reply. Every accepted utterance becomes an
ordinary bot turn through the normal send route (attributed to the person who
spoke, private-thread rules applied), and only the bot's own reply text is
synthesized. `server/voice-call.e2e.test.ts` and `scripts/verify-voice-mode.ts`
fail if a call reaches any xAI path other than `/v1/stt`, `/v1/tts` and
`/v1/tts/voices`.

## The bot knows it is on the phone

Every turn said on a call is sent with `voiceCall` (`{ callId, interrupted?,
language? }`, stored on the person's message as `Message.voiceCall`; words
typed to a bot while its call is live carry the call id too). For such a turn
the server adds a hidden "Phone call" section to the bot's system prompt
(`server/voice-call-prompt.ts`): a live phone call with the person, words from
speech recognition that may be misheard (infer the meaning, never mention a
transcript, dictation or voice mode, never ask to type), short spoken answers
of one to three sentences, no markdown, lists, tables, code, emojis or URLs,
numbers said aloud, one clarifying question at a time, a short spoken note
before slow tool work, and at the end of the call an optional written
follow-up below a line of `---` that is never spoken. The bot's own persona,
instructions and language stay; only formatting and turn-taking change. When
the person cut the bot's previous answer (barge-in or the interrupt button),
the turn says so, and the bot drops that thought.

The section is a volatile one (`server/system-prompt.ts`), so each engine
gets it through its own channel for changed context: Claude's appended system
prompt on a new session or the context note of a live one, Codex's turn
input next to its developer instructions, the newest user message of an API
driver, the session note of ACP agents and pi. An interrupted turn always
carries it. It is never stored as the person's text and never shown in the
thread. The first written turn after a call is told the call ended. Words
that join a running turn are marked as said on the call. Tests:
`server/voice-call-prompt.test.ts`, `server/voice-call-prompt.e2e.test.ts`,
the per-driver cases in `server/drivers/{claude,codex,openai-compat}.test.ts`.

A live session gets the volatile section only when it changed, so every call
turn's own words also carry a short bracketed call mark
(`voiceCallTurnPrompt`, never stored). The server keeps the call's state
per thread (`server/voice-call-session.ts`): LiveCall says when its call
starts, stays alive and ends (`POST /api/bots/<id>/voice/call`
`{threadId, callId, state}`), and every send to that thread while the call
lasts is a call turn, whatever path it takes (typed words, a queued line
steered with the Steer button, a retry). A call never closed expires after
20 minutes without a turn. On a call, words sent while the bot works always
join its turn (no parallel or after chooser).

Each utterance has an `utteranceId` (also its `sendId`): the server
delivers it once, and answers a second send of it with the first receipt.
Words steered into a running turn are counted as received once the engine
says a model call took them in (Claude's `--replay-user-messages` echo,
`steer.received`), so the next turn never offers them again as a message
"you may already have".

On a barge-in the player reports what played by its audio clock: the
sentences heard, the share of the one cut (at a word), and the rest, plus
what the bot wrote but had not yet handed to the voice. The turn that cut
the bot carries `voiceCall.heard` and `voiceCall.unheard`; the bot reads
"They heard up to: '...'. They did not hear: '...'", the person's message
keeps both, and the call transcript shows the unheard words, marked.

A call turn is never left unanswered (`server/voice-call-watchdog.ts`):
2.5 s after a direct turn settles on a thread on a call, the person's
newest call words with no written answer after them (nothing running or
queued, no open question, not words they cut on purpose) run once more,
told to answer briefly or ask. Words sent while a turn is being stopped
wait for the next turn; words whose steer raced the turn's end start the
next one. A send that fails is retried once with the same utterance, then
the call says it did not get through.

Before synthesis the call strips any markdown, emoji, URL or HTML the bot
still wrote, and stops at the follow-up rule (`src/lib/voice-mode/spoken.ts`,
then the server's `server/tts/speech-text.ts`).

## A live call, like a phone

The person presses the call button on a bot. When the server reports
`GET /api/bots/<id>/voice/status` `available: true`, the call runs in voice
mode on any desktop (macOS, Windows) or browser, server mode included
(`src/components/voice-mode/LiveCall.tsx`, engine `src/lib/voice-mode/call.ts`).
Without it, a solo Mac keeps the older call (the macOS dictation helper and
the configured TTS provider, half duplex).

- **Full duplex.** The microphone stays open for the whole call. While the bot
  speaks, the person can talk over it: on the first voiced frame (32 ms) the
  bot is ducked to 12% within 30 ms; once speech is confirmed (160 ms of
  voice over the bot) its voice fades out in 60 ms, every queued sentence is
  dropped, and the bot's running turn is interrupted (`/interrupt`) if it is
  still writing. What it had written stays in the transcript, marked
  interrupted, and the new words become the next turn. A cough or a click
  only ducks it for a moment.
- **Turns.** Silero VAD v5 (on this computer, `models/silero-vad-v5.onnx`)
  gives a voice probability per 32 ms frame; `turns.ts` starts a turn after
  about 190 ms of voice and ends it after an adaptive silence. Settings >
  End of turn picks the range: Short (420 to 800 ms), Normal (560 to
  1100 ms, 700 to start) or Patient (800 to 1500 ms). The streaming words
  move it: an unfinished clause (no final punctuation and a trailing "and",
  "to", "the", "de", "pour"..., a trailing comma or filler, or one or two
  words) waits 500 to 1000 ms longer. A turn that starts within 1.5 s of
  the last one, before the bot said anything, is the same utterance: it is
  sent whole (`voiceCall.continues`) and the fragment's turn is stopped. A
  lone short token no one says alone ("dwad"), under two letters, or a word
  or two xAI itself doubts (its confidence, passed through the listen
  socket) is never a turn. Talking while the bot works silently joins its
  turn; only talking over its voice stops it.
- **Streaming speech to text.** While a turn is spoken its 16 kHz PCM streams
  over one WebSocket per call, `GET /api/bots/<id>/voice/listen`, which the
  server bridges to `wss://api.x.ai/v1/stt` with the key; the moment the turn
  ends the page sends `{"type":"finalize"}` and the words come back. A final
  chunk is one xAI will not revise, not the end of the utterance: only
  `speech_final` closes it, and late words of an utterance the timeout
  settled are kept out of the next one. Silence
  and room noise are never sent. Without the socket (an old server, a proxy
  without WebSockets) each turn is uploaded whole to `/voice/transcribe`.
- **The answer while it is written.** The bot's streaming text is cut into
  sentences (`sentences.ts`); each one is synthesized as soon as it is complete
  by `POST /api/bots/<id>/voice/stream` (xAI `POST /v1/tts` with raw PCM out,
  streamed back as xAI makes it, the person's Voice, Speed and Language) and
  played on Web Audio, the next sentence fetched while this one plays.
  The server opens a pooled connection to xAI at the start of each call.
- **Noise.** `getUserMedia` asks for echo cancellation, noise suppression and
  auto gain, and for `voiceIsolation` where Chromium offers it. On a Mac,
  Control Center > Mic Mode > Voice Isolation filters the room further (apps
  cannot set it). The neural VAD ignores steady noise, keyboards and music;
  a level gate ignores far-field voices once the person's level is known.
- **Echo.** Beside Chromium's echo canceller, `echo.ts` learns the echo
  path's coupling while the bot speaks and refuses voice frames that are no
  louder than the bot's own residue, so the bot never interrupts itself.
- **Only my voice.** Optional: the person records about six seconds of speech
  once (Settings in the bar, "Record my voice"); a CAM++ speaker embedding
  (3D-Speaker, Apache-2.0, int8, `models/campplus-sv-en-int8.onnx`) makes a
  voiceprint kept in this computer's localStorage
  (`omb.voiceCall.voiceprint.v1`, never synced or sent). Turns that do not
  match (cosine under 0.5, 0.38 for turns under 1.5 s) are ignored with a
  soft tone. On by default once enrolled; "Forget my voice" deletes it.
- **Phone UX.** States connecting, listening, hearing, thinking, speaking,
  interrupted and on hold; earcons (connect, interrupt, ignored voice, hold,
  end; can be turned off); a compact call pill centered under the name chip:
  avatar (state and timer in its tooltip), a dotted waveform of both sides
  (the bot's voice in the accent), Settings, Transcript, mute and end; the
  card it opens holds the transcript as bubbles or the settings (with hold);
  hands-free or push to talk (hold Space or the hand button), set per
  computer in `omb.voiceCall.v1`.
- **Approvals** are read aloud and answered by a spoken yes or no (English
  or French), as in calls.

Models run with onnxruntime-web (MIT) from this app's own bundle; no CDN.
Sizes: Silero VAD 2.3 MB, CAM++ int8 8.9 MB, the runtime's WebAssembly
14 MB, loaded when a call starts. Licenses: `src/lib/voice-mode/models/NOTICE.txt`.

## Latency

The pause the person hears is measured stage by stage for every call turn,
under the turn's `utteranceId` (ids and milliseconds, never the words):

- The page (`src/lib/voice-mode/latency.ts`): `endpoint` (last voiced frame
  to the detector's end of turn), `stt` (to the words), `dispatch` (to the
  send), `firstToken` (to the answer's first streamed text), `firstSentence`
  (to a speakable clause), `tts` (to its first audio bytes), `playback` (to
  audible), and `total`. With `localStorage["omb.voiceCall.debug"]` set to
  `"1"` the console logs a `[voice-latency]` line per turn and the call's
  settings card shows the last answer's stages.
- The server (`server/voice-latency.ts`) logs, under the same id,
  `received->dispatch`, `dispatch->engine` (warm, or cold start) and
  `engine->first-token`. A Claude relaunch logs which spawn contract fields
  changed (names only, `server/drivers/spawn-contract.ts`).

What keeps it short:

- **A warm engine for the whole call.** Every turn used to relaunch the
  Claude CLI (the agents proxy's per-turn comms token was part of the spawn
  contract): a 2.5 to 3 s cold start on each answer (process boot, MCP
  servers, the session read back; measured from native logs). While the
  thread is on a call the turn carries `keepWarm`: the token rides a 0600
  per-thread file (`SAGAX_COMMS_TOKEN_FILE`, read on each request) and
  leaves the contract, so only the call's first turn starts a process
  (`server/voice-call-latency.e2e.test.ts`). Only Claude pools a process per
  thread; Codex and the API drivers are unchanged.
- **A finished sentence ends sooner.** When the streamed words close with
  final punctuation and the silence is confident (Silero under 0.15), the
  turn ends after 288, 352 or 576 ms (Short, Normal, Patient) instead of the
  adaptive endpoint. A pause inside a sentence never ends it early; words
  said right after are joined back (`voiceCall.continues`).
- **Sent on the stable words.** A turn whose streamed words are a stable
  sentence is sent at once; the final words are checked when they come. A
  material difference (any word beyond case, punctuation, accents and
  fillers) stops that answer before it is spoken and sends the final words
  as its complete version (`voiceCall.continues`).
- **The first clause speaks first.** The first sentence is cut at a comma
  after about six words.
- **A warm connection to xAI's speech.** Each turn's end (`finalize`) opens
  a pooled connection to api.x.ai (at most every 2 s), so the first
  sentence does not pay a new TLS handshake after the person spoke.
- **Short context on a call.** A call turn recalls at most two notes in
  1,200 characters and no other conversation, and skips the recent-work
  brief.
- **A thinking tone.** When nothing is audible 1.2 s after the person
  stopped, a soft two-note tone plays (Settings, "Soft tone while a slow
  answer is coming", on by default).

Bench: `SAGAX_VOICE_BENCH=1 BENCH_OUT=out.json pnpm exec vitest run
scripts/voice-latency-bench.test.ts` runs the call engine against the real
server, a fake xAI and the fake CLI in `FAKE_CLAUDE_MODE=voice`
(`FAKE_CLAUDE_COLD_MS`, `FAKE_CLAUDE_FIRST_TOKEN_MS`, `FAKE_CLAUDE_TOKEN_MS`).

xAI also offers a text to speech WebSocket (`wss://api.x.ai/v1/tts`,
`text.delta` in, `audio.delta` out, `optimize_streaming_latency` 0 to 2,
`text.clear` for barge-in:
<https://docs.x.ai/developers/model-capabilities/audio/text-to-speech>). It
is not used yet; it could start the voice on the first words rather than
the first clause.

## Stable tools during a call

On an organization server each turn used to exchange the speaker's sign-in
for a fresh Perspicax MCP token per profile and revoke it after the turn; a
call's quick turns hit the rate limit and a refused exchange left the
profile out of that turn. While the thread is on a call, a turn's tokens
(and their Perspicax MCP session) are kept for the call's next turn and
reused without an exchange (`PerspicaxMcp` `keepWarm`), then revoked when
the call ends. An exchange refused for now is retried once. A call turn
whose MCP set changed is logged (`[voice-call]`), and so are the servers
added or removed when the Claude CLI relaunches.

## Who pays, and the key

The key never reaches the client. Order for the person who speaks
(`server/voice-mode.ts` `resolveVoiceKey`):

- Organization server: their own xAI key in Perspicax (provider `xai`), else
  the organization's xAI key (Settings > Connections, `config.xai.key` or
  `XAI_API_KEY`), else refused with an access card shown in their bar only,
  under the audience rule of every access card (`accessCardAudience`: the
  person it is about; the organization's key hint only for an admin).
  A disabled person is refused and never falls back on the organization.
- Solo server: the server's xAI key.

Each speak and transcribe is booked in the usage ledger (`driverKind`
`xai-voice`, model `grok-tts` or `grok-stt`, `access` = the via,
`payerPrincipalId` when the speaker's own key paid; no price: unpriced).

Perspicax does not list `xai` keys yet (its provider keys are `anthropic`
and `openai`), so today the organization's key serves everyone. Sagax
already reads an `xai` key from the directory when Perspicax offers one.

## The call button on an organization server

The client never decides alone: it asks `GET /api/bots/<id>/voice/status`
(again at each click while voice mode is unavailable, so a key just added
works at once). With a key the button opens the bar. Without one it shows
the speaker's access card in its popover ("You don't have xAI access for
voice mode: add your xAI key in Perspicax."; an admin also reads the
organization's key hint and gets "Open Settings > Connections"). If the
server cannot answer, the popover says so with the error and a retry. The
legacy call gate (macOS dictation, "Choose This computer") never shows on an
organization server.

## Settings

Voice ("Not set" is xAI's default voice), Speed (0.75x, 1x, 1.25x, 1.5x) and
Language (Auto-detect and the languages of `shared/voice-mode.ts`) live in
localStorage under `omb.voiceMode.v1`, which travels with the person on an
organization server (`shared/user-preferences.ts`). The call's own settings
(hands-free or push to talk, Only my voice, call sounds) and the voiceprint
stay on the computer (`omb.voiceCall.v1`, `omb.voiceCall.voiceprint.v1`). A language xAI text to
speech does not take is spoken as `auto`; speech to text gets the base
language as a hint when xAI supports it, else it detects.

## Desktop permissions

- macOS: `NSMicrophoneUsageDescription` (electron-builder.yml) and the
  `com.apple.security.device.audio-input` entitlement
  (build/entitlements.mac.plist) are in the signed build; macOS asks once.
- Windows: Settings > Privacy & security > Microphone must allow desktop
  apps. No macOS helper is involved.
- Electron grants the microphone to the local UI and, in server mode, to the
  organization server's origin drawn with the bundled UI, audio only
  (`electron/app-permissions.mjs`, `microphoneOrigins`).

## xAI endpoints and key

An xAI API key from console.x.ai with access to the voice endpoints:

- Streaming speech to text, `wss://api.x.ai/v1/stt` (query `model`,
  `encoding=pcm`, `sample_rate=16000`, `interim_results`, `endpointing`,
  `language`; events `transcript.created`, `transcript.partial` with
  `is_final` and `speech_final`, `transcript.done`; `{"type":"finalize"}` ends
  an utterance and the session goes on), and `POST https://api.x.ai/v1/stt`
  (multipart `file`, `language`) for a whole turn:
  <https://docs.x.ai/developers/model-capabilities/audio/speech-to-text>
- `POST https://api.x.ai/v1/tts` (`text`, `voice_id`, `language`, `speed`
  0.7 to 1.5, `output_format` `{codec: "pcm", sample_rate: 24000}` for a live
  call; the response body streams the audio as it is made), and
  `GET https://api.x.ai/v1/tts/voices`:
  <https://docs.x.ai/developers/model-capabilities/audio/text-to-speech>.
  xAI also offers a text to speech WebSocket (`wss://api.x.ai/v1/tts`, text
  deltas in, audio deltas out); sentence requests on a pooled connection give
  the same first-audio time here and cancel by aborting one request.

xAI's ephemeral client secrets (`POST /v1/realtime/client_secrets`,
<https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens>)
open only the realtime speech-to-speech agent
(<https://docs.x.ai/developers/model-capabilities/audio/voice-agent>), where
Grok answers by itself instead of the bot, its tools, approvals and memory;
voice mode never uses it. The key stays on the server: the page talks only to
the server's own voice routes.

## Checks

- `server/voice-mode.test.ts`: authorization, payer order, refusal card, no
  key in any answer, validation, rate limit, usage.
- `server/voice-call.e2e.test.ts`: the listen WebSocket and the streamed
  speech over real sockets against a fake xAI, same-origin only, and no xAI
  path but speech to text and text to speech.
- `server/tts/grok.test.ts`: the xAI requests (speed, language, STT form).
- `src/lib/voice-mode/call-logic.test.ts`: the call's state machine (barge-in,
  cancellation, hold, mute), endpointing and its adaptation, the echo guard,
  the sentence splitter.
- `server/voice-call-reliability.e2e.test.ts`: every call turn marked on
  every path, no duplicate steer, heard and unheard, the unanswered
  watchdog, words sent while a turn stops; `server/org-mcp.e2e.test.ts`:
  one Perspicax exchange for a whole call; `server/delta-context.e2e.test.ts`:
  a steer the engine echoed is never offered again.
- `src/lib/voice-mode/player.test.ts`, `stt-stream.test.ts`: what was heard
  at a cut, xAI finalize semantics.
- `src/lib/voice-mode/call.test.ts`: the call with fake devices (one turn,
  barge-in under 160 ms, a cough, the streamed answer, Only my voice, push to
  talk, mute, hold, a language change, the upload fallback).
- `src/lib/voice-mode/models.test.ts`: the real models on recorded fixtures
  (speech, noise, keyboard, music, a TV across the room, echo, barge-in;
  speaker accept and reject; the filter bank against kaldi-native-fbank).
- `src/components/voice-mode/*.test.ts`, `src/lib/voice-mode/voice-mode.test.ts`.
- `electron/app-permissions.node-test.mjs`: the microphone in server mode.
- Real Electron, server mode, fake xAI (`server/testing/fake-xai-voice.ts`),
  a recorded sentence as the microphone: first audio of the answer after the
  person stops, barge-in, hold, and no xAI path but voice:
  `pnpm exec vite build && node --experimental-strip-types scripts/verify-voice-mode.ts`.
  It drives the call through `window.__sagaxVoiceCall`, which exists only
  when `localStorage["omb.voiceCall.debug"]` is `"1"`.

A change to the server routes needs the server image redeployed.

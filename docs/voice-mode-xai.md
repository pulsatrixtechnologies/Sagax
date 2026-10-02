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
  about 190 ms of voice and ends it after an adaptive silence (600 ms to start,
  480 to 900 ms as it learns the person's pauses).
- **Streaming speech to text.** While a turn is spoken its 16 kHz PCM streams
  over one WebSocket per call, `GET /api/bots/<id>/voice/listen`, which the
  server bridges to `wss://api.x.ai/v1/stt` with the key; the moment the turn
  ends the page sends `{"type":"finalize"}` and the words come back. Silence
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
  end; can be turned off); a waveform of both sides (the bot above the line,
  the person below); hold, mute, end; hands-free or push to talk (hold Space
  or the hand button), set per computer in `omb.voiceCall.v1`.
- **Approvals** are read aloud and answered by a spoken yes or no (English
  or French), as in calls.

Models run with onnxruntime-web (MIT) from this app's own bundle; no CDN.
Sizes: Silero VAD 2.3 MB, CAM++ int8 8.9 MB, the runtime's WebAssembly
14 MB, loaded when a call starts. Licenses: `src/lib/voice-mode/models/NOTICE.txt`.

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

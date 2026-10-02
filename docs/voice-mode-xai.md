# Voice mode with xAI

Voice mode is the floating voice bar above the composer: the bot's name on
top, its avatar, a live waveform, then settings (Voice, Speed, Language),
transcript, mute and end. xAI does the voice; the bot stays the brain.

## How a turn works

1. The person presses the call button on a bot. When the server reports
   `GET /api/bots/<id>/voice/status` `available: true`, the call runs in
   voice mode on any desktop (macOS, Windows) or browser, server mode
   included. Without it, a solo Mac keeps the older call (the macOS
   dictation helper and the configured TTS provider).
2. The microphone is the window's own (`getUserMedia`, echo cancellation on,
   the system's default input device). A small endpointer
   (`src/lib/voice-mode/audio.ts`) ends the turn after 850 ms of silence.
3. The turn is sent as a 16 kHz mono WAV to
   `POST /api/bots/<id>/voice/transcribe`; the server calls xAI speech to
   text and answers the text.
4. The text goes to the bot as an ordinary message through the normal send
   route, so the turn is the speaker's, private-thread rules apply and
   approvals work as on a typed message (spoken yes or no, as in calls).
5. The bot's answer is read with `POST /api/bots/<id>/voice/speak` (xAI text
   to speech, with the person's Voice, Speed and Language). The voice
   preview buttons use the same route.

The microphone is closed while the bot speaks (half duplex, as in calls).

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

## Settings

Voice ("Not set" is xAI's default voice), Speed (0.75x, 1x, 1.25x, 1.5x) and
Language (Auto-detect and the languages of `shared/voice-mode.ts`) live in
localStorage under `omb.voiceMode.v1`, which travels with the person on an
organization server (`shared/user-preferences.ts`). A language xAI text to
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

- `POST https://api.x.ai/v1/stt` (multipart `file`, `language`), speech to
  text: <https://docs.x.ai/developers/model-capabilities/audio/speech-to-text>
- `POST https://api.x.ai/v1/tts` (`text`, `voice_id`, `language`, `speed`
  0.7 to 1.5), and `GET https://api.x.ai/v1/tts/voices`, text to speech:
  <https://docs.x.ai/developers/model-capabilities/audio/text-to-speech>

xAI's ephemeral client secrets (`POST /v1/realtime/client_secrets`,
<https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens>)
open only the realtime speech-to-speech agent
(<https://docs.x.ai/developers/model-capabilities/audio/voice-agent>), where
Grok answers by itself instead of the bot, its tools, approvals and memory;
xAI's speech to text guidance is to proxy through a backend. Voice mode
therefore keeps the key on the server and sends one recorded turn at a time.

## Checks

- `server/voice-mode.test.ts`: authorization, payer order, refusal card, no
  key in any answer, validation, rate limit, usage.
- `server/tts/grok.test.ts`: the xAI requests (speed, language, STT form).
- `src/lib/voice-mode/voice-mode.test.ts`,
  `src/components/voice-mode/VoiceModeSettingsPanel.test.ts`.
- `electron/app-permissions.node-test.mjs`: the microphone in server mode.
- Real Electron, server mode, fake xAI (`server/testing/fake-xai-voice.ts`):
  `pnpm exec vite build && node --experimental-strip-types scripts/verify-voice-mode.ts`.

A change to the server routes needs the server image redeployed.

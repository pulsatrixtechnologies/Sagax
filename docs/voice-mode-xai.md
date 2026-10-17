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
language?, duplex? }`, stored on the person's message as `Message.voiceCall`; words
typed to a bot while its call is live carry the call id too). For such a turn
the server adds a hidden "Phone call" section to the bot's system prompt
(`server/voice-call-prompt.ts`): a live phone call with the person, words from
speech recognition that may be misheard (infer the meaning, never mention a
transcript, dictation or voice mode, never ask to type), the voice output
contract (verdict first, one to four short spoken sentences, no markdown,
lists, tables, code, emojis, URLs or file paths, never an identifier read
aloud, times and numbers said the way a person says them in the language of
the last message, at most one question per turn and only for a real
decision, one short sentence before a slow step and a progress line only at
a real milestone, a failure said in one sentence with what to do next, then
silence), and at the end of the call an optional written follow-up below a
line of `---` that is never spoken.

Under that contract, every speech path removes identifiers on its own
(`shared/spoken-identifiers.ts`: UUIDs, hashes, tokens, JWTs, `#1234`
numbers, `id: 42` labels; absolute and home paths keep their last name):
the page's sentence cleaner (`src/lib/voice-mode/spoken.ts`), the server's
speakable text (`server/tts/speech-text.ts`) and the iPhone's
(`SpokenText.speakableSentence`, same rules in Swift). The streaming
voice's appended words (`speakableDelta`) arrive in pieces that may cut a
word in two, so the server holds the last unfinished word of an open
utterance, and an `id:` label before it, until a space or a sentence end
follows or the utterance finishes (`splitHeldDelta`, at most 400
characters), then cleans it whole. The opening `say` of an answer is not
held: its first words are the call's first audio.

An approval on a call is spoken as a question with its two options ("Allow
once, or deny?", `approval.voice.commandAsk`). The answer must pick one
(`spokenConsent(said, "voice")`, `shared/call-consent.ts`; the iPhone's
`CallAnswers.decision`; the GPT-Live call too, `server/live-call-controller.ts`,
whose voice is told the same two options): a whole-utterance yes in English or French allows
once; a no, with a reason or not, denies; a hedge ("okay", "d'accord"), a
mix ("no wait, yes"), a condition ("yes, but rename it"), a question or
"always allow" asks the options again (`voiceMode.allowOnceOrDeny`). Always
allow is never reachable by voice, and a card that needs a security key is
refused on the server whatever was said. The bot's own persona,
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
per thread (`server/voice-call-session.ts`): LiveCall and the older call say when their call
starts, stays alive and ends (`POST /api/bots/<id>/voice/call`
`{threadId, callId, state}`), and every send to that thread while the call
lasts is a call turn, whatever path it takes (typed words, a queued line
steered with the Steer button, a retry). A call never closed expires after
20 minutes without a turn. The person hangs up with `state: "end"` for that
call id only: the session drops, the idle warm process is released, and
the person's other devices get `voice.call.ended` (`by: "person"`). The
bot hangs up with `end_call`, offered only while the thread is on a live
call. That request does not drop the session yet: the goodbye is still
being written. When the turn finishes, the same cleanup runs and the frame
says `by: "bot"`. A goodbye that fails or is interrupted drops the
request and keeps the call, so a later turn does not inherit the hang-up.
The page mutes at once and lets that goodbye finish before it leaves the
call. A newer call is not ended by the old turn. The next written turn
gets the ended note. On a call, words sent while the bot works join its
turn (no parallel or after chooser). Advanced > "Full-duplex conversation"
is off by default on every channel. When the person turns it on and the
server has `SAGAX_VOICE_FULL_DUPLEX=1`, a new utterance interrupts the
in-flight turn, discards the steer queue, and starts only those words
(issue #292). Otherwise the page's duplex and speculative marks are
dropped and the send takes the steer path. Typed chat still keeps its
queue on Stop.

## Progress lines

A call turn that runs tools can leave the person in silence for half a
minute. The call (desktop `LiveCall`, `src/lib/voice-mode/progress.ts`;
the Mac's older dictation call `CallView` and its room call
`GroupCallView`; iPhone `CallProgress` in `CallConversation`) then says a
short line of its own, never a canned filler: each line comes from a tool
event of this turn, the activity rows after the person's last line. None of
these desktop calls reads the server's English chip narration (the chip's
`spoken` text, which can name a tool).

- What is said: the category of the tool still running ("Je vérifie.", "I'm
  looking it up.", "Je fais la modification.", from `progressKind`: built-in
  tool names first, then the first verb of a connector tool's name), or,
  for the same work again, the number of steps finished ("3 étapes faites,
  je continue.") or "still on it". Never the tool's name, its arguments or
  an identifier (the words also go through `stripSpokenIdentifiers`).
  Tools whose own card or words are spoken (`end_call`, questions, plans)
  get none.
- Language: the call's chosen language, else (Auto) French when the
  person's last words are French and the page is in English or French,
  else the page's (`progressLocale`, `tIn`, keys `voiceMode.progress.*`). A
  language whose pack lacks the words says nothing: silence beats the wrong
  language. `CallView` and `GroupCallView` have no call language: the
  same rule with Auto. The iPhone follows the same rule
  (`CallProgress.language`), with the words of that language's
  `Localizable.xcstrings` entry, never simply the app's language.
- A room call: one turn may reach several members, so a line stays
  generic. It is said in a member's voice only when every tool row of the
  turn is that member's (`turnToolAuthor`), otherwise in the call's own
  voice, never another bot's.
- When: only in the call's thinking phase with the bot busy, nothing
  audible, nothing else queued and no approval or question waiting. The
  first line of a turn once a tool has run 1.5 s with nothing said: this is
  the quick first sentence before a slow step on every engine (Claude,
  Codex, ACP, API). Later lines need 7 s of silence (the bot's own words
  reset it) and 9 s since the last line; five a turn at most. A 500 ms tick
  asks.
- Barge-in, an interrupt or a new turn: a line being said is cut like any
  speech (it is a filler clip, never the answer's utterance and never the
  turn's first audio), and no line follows until the next turn is sent.

The model's own parallel opener (`voice.opener`, one sentence from a fast
model beside the turn) stays with HTTP Grok on a full-duplex call;
`server/voice-first-sentence.ts` says why Claude, Codex and ACP engines do
not get one.

## Full-duplex conversation (issue #292)

The stacked answers JC heard were not the TTS sentence queue (that is
one reply's clauses, cancelled on barge-in). They were the harness
steer queue: talking while the bot was thinking did not interrupt
(`call-machine.ts`), a send that raced `stoppingThreads` was
`queueSteeredMessage`, and drain played each leftover utterance as
the next answer.

`CallSettings.fullDuplex` (device-local, `omb.voiceCall.v1`, default
off on every channel; rev 3 drops the on that 0.5.x stored) plus
`voiceCall.duplex` on the send, and only while `SAGAX_VOICE_FULL_DUPLEX=1`:
confirmed speech while the bot is busy or speaking cancels that turn; the
server never steers or queues those words. The thinking cue is 400 ms
instead of 1200 ms so
the line is not dead air. Approvals stay spoken yes or no and are not
cancelled. Tools still run on the bot. A "stop" is a stop only when it is
the whole utterance ("stop", "arrête", "arrête ça", "ok stop", "stop
please", with at most two filler or polite words around it,
`voice-topics.ts` `isStopUtterance`): "Stop le service CrowdStrike sur
SRV-01" is work for the bot, sent like any other request, never swallowed.
The call speaks no canned filler
and no tool-chip narration; the prompt asks the bot to say so once, in
its own words, only when something will genuinely take a while. What the
call does say on its own while the bot works in silence is a progress
line built from the turn's real tool events (see "Progress lines" below). A duplex
send that races another is latest-wins (the slower one is superseded, never queued).
`startTurn` thread_busy is retried until the interrupt cap. Cancelled
turns stop streaming (`content.delta` of that turnId is not broadcast).
The client speech fence (`speech-fence.ts`, iOS `CallConversation`)
keeps `dropOldReply` across the send, so a dying answer that lands
after the new user line is marked interrupted and never spoken.

xAI Speech-to-Speech (`wss://api.x.ai/v1/realtime`, grok-voice-latest)
is still not the brain: it would drop Sagax tools, memory, approvals
and MCP. Tests: `src/lib/voice-mode/duplex-policy.test.ts`,
`speech-fence.test.ts`, `call-logic.test.ts`,
`server/voice-call-duplex.test.ts`,
`scripts/voice-duplex-harness.test.ts`,
`server/voice-call-reliability.e2e.test.ts` (duplex case).

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
then the server's `server/tts/speech-text.ts`; words appended to an open
utterance are cleaned the same way with their edges kept, `speakableDelta`,
so " pense" never glues to the word before it). A French call (`language`
`fr` or `fr-*`), or an automatic one whose text looks French (an accented
letter, or at least two French function words and more of them than English
ones, `looksFrench`), then reads times, prices, short ordinals and titles
aloud (`server/tts/french-reading.ts`: "14 h 30" as "14 heures 30", "25 $" as
"25 dollars"); an appended piece is judged with the utterance before it. A
spoken note sent with `/voice/speak` stays verbatim.

## A live call, like a phone

The person presses the call button on a bot. When the server reports
`GET /api/bots/<id>/voice/status` `available: true`, the call runs in voice
mode on any desktop (macOS, Windows) or browser, server mode included
(`src/components/voice-mode/LiveCall.tsx`, engine `src/lib/voice-mode/call.ts`).
Without it, a solo Mac keeps the older call (the macOS dictation helper and
the configured TTS provider, half duplex). That call marks its turns like
the live call (`useVoiceCallMark`, `src/lib/voice-mode/call-mark.ts`): each
send carries `voiceCall`, the server knows the thread is on a call (so
`end_call` is offered and hangs it up after the goodbye), and it speaks only
`spokenPart` of an answer.

- **Full duplex.** The microphone stays open for the whole call. While the bot
  speaks, the person can talk over it: on the first voiced frame (32 ms) the
  bot is ducked within 10 ms to about -6 dB (it may still be a cough,
  `DUCK_SOFT`), then to 12% once the voice is confirmed (128 ms), and it
  stays ducked, nothing cancelled,
  while the call checks that this is the person talking to it
  (`call-machine.ts` `bargePending`). The bot is cut (its voice fades out in
  12 ms, every queued sentence is dropped, and its running turn is
  interrupted with `/interrupt` if it is still writing) as soon as the
  streamed words are real words (not a sound the recognizer spelled, not a
  backchannel such as "mm-hmm", "uh-huh", "hum", "euh") and, with Only my
  voice, match the voiceprint; or, when no words have come yet, after
  400 ms of voiced speech (`BARGE_IN_CONFIRM_MS`). Worst case for a real
  barge-in: ducked by 42 ms, silent by 412 ms (400 ms plus the 12 ms
  fade, `call.test.ts`); usually sooner, when xAI's first words arrive
  first. With Only my voice the check of the voiceprint adds the
  embedding's time, and a clip too short to judge waits for more audio. A
  cough, a chair or a "mm-hmm" never cuts the answer: when the turn ends
  without real words (or in another voice) the bot is unducked and goes on.
  Short words that end before the check ("stop") still cut the bot before
  they are sent. What the bot had written stays in the transcript, marked
  interrupted, and the new words become the next turn.
- **Turns.** Silero VAD v5 (on this computer, `models/silero-vad-v5.onnx`)
  gives a voice probability per 32 ms frame; `turns.ts` starts a turn after
  about 190 ms of voice and ends it after an adaptive silence. Settings >
  End of turn picks the range: Short (420 to 800 ms), Normal (560 to
  1100 ms, 700 to start) or Patient (800 to 1500 ms). The streaming words
  move it: an unfinished clause (no final punctuation and a trailing "and",
  "to", "the", "de", "pour"..., a trailing comma or filler, or one or two
  words) waits 500 to 1000 ms longer. The socket asks xAI to keep fillers
  (`filler_words=true`), so a trailing "euh" or "um" is seen; they are
  removed only from the text the bot gets (`shared/voice-mode.ts`
  `stripFillers`), and a turn of fillers alone is no turn. A candidate too
  short to be a turn ("Ok..." then a pause) keeps its frames in the
  pre-roll, so the next turn starts with them and "Ok... regarde" keeps
  "Ok". A turn that starts within 1.5 s of
  the last one, before the bot said anything, is the same utterance: it is
  sent whole (`voiceCall.continues`) and the fragment's turn is stopped. A
  lone short token no one says alone ("dwad"), under two letters, or a word
  or two xAI itself doubts (its confidence, passed through the listen
  socket) is never a turn. Talking while the bot works silently joins its
  turn; only talking over its voice stops it.
- **Streaming speech to text.** While a turn is spoken its 16 kHz PCM streams
  over one WebSocket per call, `GET /api/bots/<id>/voice/listen`, which the
  server bridges to `wss://api.x.ai/v1/stt` with the key; the moment the turn
  ends the page sends `{"type":"finalize"}` and the words come back. The
  server asks xAI for French with formatting (`language=fr`, `format=true`,
  "deux cents" written 200) when the Language is Auto-detect and the
  person's browser or app locale is French (`fr-CA`, `fr-FR`: the page
  sends `locale`, the server keeps only a well formed one,
  `sttRequest`); a picked English or French gets `format=true` too; any
  other case stays pure detection. Smart Turn is requested with a
  threshold of 0.9 and a 5 s timeout, so xAI never ends a turn itself; its
  `end_of_turn_confidence` is passed to the page (see Latency). A final
  chunk is one xAI will not revise, not the end of the utterance: only
  `speech_final` closes it, and late words of an utterance the timeout
  settled are kept out of the next one. Silence
  and room noise are never sent. Without the socket (an old server, a proxy
  without WebSockets) each turn is uploaded whole to `/voice/transcribe`.
  A socket that drops is opened again by itself (see "A call recovers by
  itself" below), so one drop never turns the rest of the call into uploads.
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
  When the capture cannot run at 16 kHz (the fallback at 44.1 or 48 kHz),
  the page downsamples through a windowed-sinc low-pass (Blackman, cut at
  7.2 kHz), so hiss above 8 kHz is not folded back into the voice band.
- **Echo.** Beside Chromium's echo canceller, `echo.ts` keeps 512 ms of
  playback and lines the microphone up with it (a delay of up to 384 ms, so
  a speakerphone or a Bluetooth speaker is still the bot). It learns the
  coupling and refuses frames no louder than that delayed residue. For the
  first second the coupling stays at least at its prior. The person barging
  in is far louder at once, so the bot never interrupts itself.
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
  hands-free or push to talk (hold Space or the hand button; a press over
  the bot cuts it at once, with no check of the words, so a short "stop" is
  a turn), set per computer in `omb.voiceCall.v1`. On the desktop the pill is the whole call
  UI: it floats over the top of the thread and never becomes a full-column
  stage (0.4.9 had one; the 0.4.8 pill came back on 2026-10-08). The iPhone
  has its own call screen and shows the call as a card in the conversation.
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
  changed (names only, `server/drivers/spawn-contract.ts`). A Grok turn is
  "warm" when it prompts the live native session as is (no handshake, no
  `session/load`).

What keeps it short:

- **A warm engine for the whole call.** Every turn used to relaunch the
  Claude CLI (the agents proxy's per-turn comms token was part of the spawn
  contract): a 2.5 to 3 s cold start on each answer (process boot, MCP
  servers, the session read back; measured from native logs). While the
  thread is on a call the turn carries `keepWarm`: the token rides a 0600
  per-thread file (`SAGAX_COMMS_TOKEN_FILE`, read on each request) and
  leaves the contract. Claude starts that process when the call is accepted
  (`POST /voice/call`), before the first utterance, and the first spoken
  turn reuses it (`server/voice-call-latency.e2e.test.ts`). A hangup closes
  the idle process.
- **Grok keeps one native session for the call.** Grok runs over ACP: one
  pooled process per thread, whose native session is re-established
  (`session/load`, every MCP server reconnected, the history read back)
  whenever its session inputs change. The comms token was one of them, so
  every Grok call turn paid a `session/load`. On a call the token now rides
  the same token file and is masked out of the session inputs: a call turn
  is a bare `session/prompt`. Grok is also warmed when the call is
  accepted: the process pays initialize, authenticate and `session/load`
  (or `session/new` for a new conversation) with no prompt and no event in
  the thread, so the first spoken turn is a bare prompt too
  (`AcpSupport.warmSession`). What is warm, then: Claude (one process) and
  Grok (one process, one native session) for the whole call; Codex and the
  API drivers are not warmed (a Codex warm would need its handshake and
  `session/new`, not done here; API drivers cannot start without a prompt,
  and no hidden prompt is sent).
- **Low reasoning effort on a call.** A call turn, and the warm that starts
  its process (so both share one spawn contract), runs at the engine's low
  effort: Grok `--reasoning-effort low`, Claude `--effort low`, Codex
  `effort: low` (`server/voice-call-effort.ts`). The rule: "low" where the
  engine offers it, else its lowest level but "none" (which turns reasoning
  off: another answer, not a faster one); a bot already set lower keeps its
  level; a Codex bot with no effort is left alone, since Codex would keep
  the call's level for the turns after the call. Written turns keep the
  bot's own effort, so the first written turn after a call starts a new
  Grok or Claude process. The model is not changed here: a faster model
  for calls belongs to the Auto mode (PR #153).
- **The server environment stays up.** sandboxd stops a person's
  environment after 10 minutes without use. The call's start and each
  heartbeat (about every 5 minutes) count as use of the environment the
  call's turns work in (`UserSandboxManager.markUsed`, sandboxd
  `POST /v1/sandboxes/<key>/used`), which starts nothing.
- **xAI Smart Turn.** When a partial carries xAI's end of turn confidence,
  the turn detector reads it: an early end (punctuation, contour or the
  words' meaning, below) needs at least 0.6, and under 0.3 the turn waits
  `incompleteMs` longer. The confidence belongs to its words: the same
  words again (a final chunk, a probe's answer) keep it, new words without
  one drop it. No confidence: the rules below alone.
- **A finished sentence ends sooner.** When the streamed words close with
  final punctuation and the silence is confident (Silero under 0.15), the
  turn ends after 288, 352 or 576 ms (Short, Normal, Patient) instead of the
  adaptive endpoint. A pause inside a sentence never ends it early; words
  said right after are joined back (`voiceCall.continues`). A long Québec
  sentence (eight words, or about three seconds of French, such as "Combien
  de temps pour aller de Montréal à Québec en voiture?") does not use that
  short window: with final punctuation it needs 512 ms of confident silence,
  and while the partial still ends on a linking word ("à", "de", "pis",
  "faque") the extra wait is capped at 400 ms past the endpoint. A short
  question stays on the short window. After 128 ms of confident silence the
  call sends one `finalize` so the last word can arrive during the wait; a
  second finalize with no new audio is not sent.
- **The voice's ending counts ("Faster end of turn", Advanced, on by
  default).** The call reads the pitch and energy of the last 400 ms of
  speech before a silence, on this computer (`src/lib/voice-mode/prosody.ts`:
  a normalized autocorrelation pitch over 70 to 400 Hz per 32 ms frame,
  octave slips dropped, the least squares slope in semitones). A fall of
  1.5 semitones or more that fades out (a statement), or a rise of 3 or more
  (a question), is finished: the turn ends on the same short confident
  window as final punctuation (288 or 352 ms, Short or Normal) even before the
  words carry any. A flat pitch held on a filler or a linking word ("euh",
  "um", "de", "pour") keeps the long delay (the endpoint plus
  `incompleteMs`), and so does a filler that falls and fades out ("euh..."
  trailing off): a person thinking, never a statement ending. A French linking word ending a sentence the contour says
  is finished ("on se voit demain puis") waits half of `incompleteMs`; an
  English one keeps all of it. Anything else (too few voiced frames, a pitch
  that wobbles, a sound cut at full strength as in the middle of a word)
  changes nothing. Safety: every frame of the short window must be under
  Silero 0.15, so a word is never cut in its middle; and a person who speaks
  again within 600 ms of any early end (contour, the words' meaning, or
  final punctuation on the short window) continues it
  (`EARLY_CUT_CONTINUATION_MS`, `voiceCall.continues`), even over the bot's
  first words, which stop: a wrong cut costs only those words. A short
  question or request without punctuation may end on its meaning alone
  ("what time is it", "can you check the ticket"); in French that needs
  the long French quiet (512 ms), so "peux-tu regarder le billet" is not
  cut before "de CONTOSO". Patient is never affected, nor push to talk. Off:
  the endpoint is the one above.
- **Full duplex guesses only at a pause.** With full duplex the bot may
  start on a stable partial (four words, not an unfinished clause, or a
  closed sentence) once the person pauses, never while they are still
  talking; its voice is held until the turn really ends. A guess never
  ends the turn sooner: the detector keeps its own rules. A revised
  partial replaces the guess after 320 ms of stability, and the final
  words replace it when they differ.
- **Sent on the stable words.** A turn whose streamed words are a stable
  sentence is sent at once; the final words are checked when they come. A
  material difference (any word beyond case, punctuation, accents and
  fillers) stops that answer before it is spoken and sends the final words
  as its complete version (`voiceCall.continues`).
- **The first clause speaks first.** Over POST, the first sentence is cut at
  a comma after about six words (36 characters). With the streaming voice
  there is no character wait: the first clause goes at a one-word
  punctuated opener ("Well,", "Sure,") or at a space after two words
  (`STREAMING_CLAUSES`; words are counted by whitespace, so "C'est fait."
  is never cut after "C'est"), and no short sentence is held back to join
  the next, since the socket is already open. The first grok token
  ("Four") already opens the answer's utterance (`say` with `more: true`,
  xAI `text.delta` only) so TTS starts while the rest is being written.
  Those words are first cleaned like a clause (`src/lib/voice-mode/tts-lead.ts`
  `leadText`): nothing opens until they hold a letter ("**Oui**" never
  opens on a lone "*"), and a lead stops before a link, code, a table, or a
  last word with a digit or a currency ("14h30", "25 $" go whole).
- **Streaming voice (Advanced, on by default).** One socket for the call:
  the page opens `GET /voice/speech` (voice, speed and language in the
  query) when the call starts, and the server opens xAI's streaming text to
  speech socket for it (`wss://api.x.ai/v1/tts`, `codec=pcm`,
  `sample_rate=24000`, `optimize_streaming_latency=2`, the key in the
  `Authorization` header; `server/tts/grok.ts` `openSpeechStream`). **One
  answer is one xAI utterance**, like one person talking: its first words
  open it (`{"type":"say","more":true}`, `text.delta`), every later clause
  is appended the moment it is written (`{"type":"append"}`, `text.delta`,
  with no wait for the audio of the one before, so the intonation runs on
  and no gap opens between clauses), and `{"type":"finish"}` (`text.done`)
  comes only when the answer is done (`replyDone`), or, past 1,500
  characters, at the end of a sentence, where the next utterance begins.
  Each append is cut at 500 characters. A whole text said at once (a
  prompt, a settled answer) is one `say` per 480 characters or so. PCM comes
  back to the page as binary frames between `start` and `done` and plays
  through the same player as a POST body
  (`src/lib/voice-mode/speech-stream.ts`): one sentence whose words grow
  (`PcmPlayer.extend`), captioned clause by clause when the voice should
  reach them (by speaking rate, then by the audio's real length). While the
  open answer's audio has run dry and the bot is still writing or working,
  the call counts the bot as silent (`onStarved`, `onResume`), and the call
  bar never waits for that silence to deliver the answer's end
  (`VoiceCall.replyOpen`). Barge-in, hold, hang-up and a reissued turn
  cancel the utterance (`{"type":"cancel"}`): dropped from the queue, or,
  when it is the one speaking, cleared at xAI (`text.clear`, confirmed by
  `audio.clear`); nothing of it reaches the page after, and what was heard
  is measured on the whole utterance's words. The server session is
  `server/voice-speech-session.ts`. Safety nets: the page falls back to POST
  `/voice/stream` for the rest of the call when the socket is not ready
  within 1.5 s, errors twice in one call, closes, or when the server gives
  up; the server reopens a dropped xAI socket with a backoff (250, 750,
  2000 ms), at most 3 times in a row (a reopen counts as working once
  audio came on it or it lived 10 s) and 6 times a minute, then sends
  `fallback` and logs it once. An utterance the socket failed goes on over POST into the same
  audio: what the audio received did not cover yet (assuming a slow 10
  characters a second, and from the start of the clause that point falls
  in, a sentence end or an appended clause, so words may be said twice but
  none is skipped), then what the answer appends, a sentence at a
  time. An utterance with audio still owed (text.done sent, or text its
  audio does not cover at 30 characters a second) and no progress for 8 s,
  or a clear not confirmed in 2 s, counts as a dropped socket; an open one
  whose audio has caught up waits for the bot's next words as long as they
  take (the player checks it again every 10 s and gives it up only once it
  is no longer open). The page pings the speech socket every 10 s
  (`{"type":"ping"}`, the server answers `pong`); a server that answered
  before and then sends nothing for a whole period is gone (a half-dead
  socket after a network switch or sleep never closes), and the call
  speaks over POST from there, its open answer included. Nothing is left open at xAI: a new
  turn sent ends the last answer's utterance, a bot turn that ends
  (finished, cancelled, failed, stopped) without its answer's `replyDone`
  within 3 s ends it too (`REPLY_END_GRACE_MS`), and on the server an open
  utterance with no new text and no audio owed for 20 s gets its
  `text.done` (`SPEECH_IDLE_FINISH_MS`); words appended after that open a
  new xAI utterance under the same id, and anything queued behind it ends
  it (the page then opens it again with the next words, into the same
  audio). A whole text said while an answer's utterance is open (an
  approval prompt, a notice) goes over POST, so it never waits behind that
  utterance on the server; the player still plays it after the answer. xAI closes a streaming socket around 600 s;
  while nothing is in flight the server rotates it at 540 s and does not
  count that as a failure. Changing the voice, speed or language mid-call
  reopens the socket at once when nothing is in flight, so the next answer
  does not pay the reconnect before its first audio; an answer begun while
  another is still in flight goes over POST. Hold, mute,
  hang-up, the transcript card and the thread card are the same either way.
- **A warm connection to xAI's speech.** Each turn's end (`finalize`) opens
  a pooled connection to api.x.ai (at most every 2 s), so the first
  sentence does not pay a new TLS handshake after the person spoke.
- **Short context on a call.** A call turn recalls at most two notes in
  1,200 characters and no other conversation, and skips the recent-work
  brief.
- **The voice's playback.** The page plays the voice on an audio context at
  24 kHz (xAI's rate, so the browser resamples once, at the output; the
  device's rate when the browser refuses). An answer's first chunk starts
  70 ms ahead of the audio clock (a prebuffer); later chunks join the audio
  before them, each on a gain of its own that fades out over its last 3 ms
  unless the next chunk joins in time, and the chunk after a gap fades in
  over 3 ms, so a gap never clicks. A chunk that comes after the audio ran
  out, including the first chunk of a later sentence, is an underrun: the
  start lead (15 ms) grows by how late it was, up to 120 ms, and gives back
  5 ms for every 2 s of audio without a gap; a gap over 500 ms is the bot
  writing, not the network, and changes nothing. On the iPhone
  (`ios/App/Call/CallSpeech.swift`, `CallAudioIO.swift`) the first audio
  after a silence waits for 60 ms of it, each sentence's resampler is
  drained at its end (its last samples used to be lost), the volume ramps
  over 10 ms to duck and unduck, and a cut fades over 12 ms before it stops.
- **A thinking tone.** When nothing is audible 1.2 s after the person
  stopped, a soft two-note tone plays (Settings, "Soft tone while a slow
  answer is coming", on by default).

Bench: `SAGAX_VOICE_BENCH=1 BENCH_OUT=out.json pnpm exec vitest run
scripts/voice-latency-bench.test.ts` runs the call engine against the real
server (given the fake key as `SAGAX_XAI_VOICE_KEY`), a fake xAI and, for
each engine of `BENCH_ENGINES` (`claude,grok`), the fake Claude CLI in
`FAKE_CLAUDE_MODE=voice` (`FAKE_CLAUDE_COLD_MS`, `FAKE_CLAUDE_FIRST_TOKEN_MS`,
`FAKE_CLAUDE_TOKEN_MS`) or the fake ACP CLI in `FAKE_ACP_MODE=voice`
(`FAKE_ACP_COLD_MS`, `FAKE_ACP_LOAD_MS`, `FAKE_ACP_FIRST_TOKEN_MS`,
`FAKE_ACP_TOKEN_MS`). The Grok report counts each turn's ACP session
establishments (`establishPerTurn`): 0 on a warm call turn.

The bench's knobs for the two switches: `BENCH_SPEECH` (`socket`, the
default, or `post`), `BENCH_FASTER_END` (1 or 0), `BENCH_UNPUNCTUATED=1`
(the words never carry punctuation) and `BENCH_REPLY` (the engine's
answer). Its microphone's voiced frames are a voice-like tone whose last
400 ms fall and fade, so the pitch reading sees a statement end.

Release acceptance is a separate 32-turn run with hard gates (p50 at most
800 ms, every turn at most 2,500 ms, no spoken overlap). Pull-request CI
enforces those gates on the synthetic profile only.
`pnpm voice:acceptance:real -- --enforce` is the real-provider run, and a
release waits on it. Recipe: [docs/verification/voice-acceptance.md](verification/voice-acceptance.md).

## A call recovers by itself

A call must never hang, go silent, lose a turn or drop. Each part that can
fail recovers on its own:

- **The listen socket (page side).** When `/voice/listen` drops (a Wi-Fi
  switch, a sleep, the server restarting), the page opens it again after
  250, 750 and 2,000 ms, then every 5 s for the rest of the call; the count
  starts over once a socket is ready (`src/lib/voice-mode/stt-stream.ts`,
  `RECONNECT_BACKOFF_MS`, `RECONNECT_EVERY_MS`). Only the utterances already
  finished and still waiting for their words are uploaded whole; the one
  being spoken is sent again from its first frame on the new socket, with
  its words, interim, finalize and probe state reset. Late words of an
  utterance the timeout settled are no longer awaited, so they never eat the
  next turn's words. A socket that never opened (an old server) gets the
  backoff only, then the call uploads.
- **xAI's speech to text (server side).** The page's socket outlives xAI's
  (`server/voice-listen-session.ts`). When xAI's socket closes, the server
  opens a new one behind the same page socket (250, 750, 2,000 ms) and sends
  the page `{"type":"reconnected"}`; the page sends the open utterance again
  and uploads the finished ones that were waiting. Only when those three
  tries fail does the page socket close (1011), and the page reconnects on
  its own. A reopened socket counts as working only once xAI sent words on
  it or it lived 10 s (accepting then closing at once still fails), and
  more than 6 reopens in a minute close the page socket too, so a flapping
  socket is never reopened forever. Like the streaming voice, xAI's socket is rotated at 540 s, once
  nothing was heard or sent for 3 s (no utterance open); audio that arrives
  while the next socket opens is held and sent to it, so the page never
  notices.
- **A failed upload.** A whole-turn upload is tried twice (a refusal once),
  each try given up after 20 s (`TRANSCRIBE_TIMEOUT_MS`). When both fail,
  the call reports `transcribe-failed`: the bar shows "That didn't come
  through" and the call says "That did not get through. Could you say it
  again?". A turn is never dropped silently. The iPhone does the same when
  it uploads a turn.
- **A stalled voice.** A clause spoken over POST `/voice/stream` with no
  first byte, or no next chunk, for 8 s is aborted with an error
  (`SPEECH_STALL_MS` in `api.ts`); the player has its own 10 s backstop for
  any sentence whose audio stops coming (`READ_TIMEOUT_MS`). The player then
  plays the next clause, and the call is never stuck "busy".
- **Audio contexts.** The output and the capture contexts are resumed when
  the system suspends or interrupts them (`statechange`). A player whose
  audio clock stopped resets its schedule when it goes idle, so the next
  answer does not wait on audio that will never play.
- **The microphone.** A track that ends (unplugged, taken by the system)
  or a `devicechange` that removes the call's microphone opens the capture
  again (`MIC_REOPEN_MS`: at once, then 0.5, 1.5 and 3 s, the later tries on
  the default device); the call says the microphone is unavailable only
  when every try failed. Retry opens a microphone whose stream died. Five
  frames in a row that fail (a model that broke mid-call) switch the call to
  the level detector instead of leaving it deaf.
- **The call's record on the server.** Besides the heartbeat every 5
  minutes, the page says `alive` the moment it is visible again or the
  network comes back (`src/lib/voice-mode/call-alive.ts`), so a laptop that
  slept past the 20 minute expiry is on its call again at once. An expired
  call is also registered again by the next turn that carries its call id;
  a call id that hung up never comes back that way. A send's 800 ms retry
  dies with the call, so nothing is sent under an old call id after a
  hang-up.
- **iPhone.** An audio interruption that ends without `.shouldResume` (the
  other app kept the audio) leaves the call on hold with "The call was
  interrupted. Tap Resume the call to continue."; it resumes by itself when
  the app is active again, or on the tap. After
  `mediaServicesWereResetNotification` the audio session is configured
  again and the audio engine rebuilt with a new engine and new player
  nodes (the old ones are invalid after a reset). The reply to the call's
  `POST /voice/call` `start` carries `keyterms`, the same list the server
  gives xAI (`server/voice-keyterms.ts`: the bot's name, the person's, the
  organization's terms, the thread's proper nouns; at most 100, only to a
  person allowed on that thread, and never a token that looks like a
  secret: a key prefix such as AKIA, sk-, ghp_ or xai-, a long or random
  mix of letters and digits, a word glued to a year such as "Summer2024";
  product names such as "Microsoft 365", "SRV-01" or "X360Recover" stay); the phone's recognizer starts at once and
  uses them from the next turn as contextual strings
  (`SFSpeechAudioBufferRecognitionRequest.contextualStrings`, or an
  `AnalysisContext` for the `.general` tag set with
  `SpeechAnalyzer.setContext` on iOS 26). An empty list or a failed start
  leaves recognition as it was; an uploaded turn is biased on the server.

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
  the organization's xAI key (Settings > Models and voice, `config.xai.key`
  or `XAI_API_KEY`), else refused with an access card shown in their bar only,
  under the audience rule of every access card (`accessCardAudience`: the
  person it is about; the organization's key hint only for an admin).
  A disabled person is refused and never falls back on the organization.
- Solo server: the server's xAI key.

Since 2026-10-14 Grok voice has no key of its own: it uses the xAI key, the
one Grok bots use. A Grok voice key saved by an older build
(`config.tts.xaiKey`, `SAGAX_XAI_VOICE_KEY`, the desktop's `xaiVoiceKey`)
becomes the xAI key when none is saved; otherwise the xAI key stays and the
duplicate is dropped. Both cases are logged without the value
(`server/config.ts` `migrateGrokVoiceKey`, `electron/workspace-credentials.mjs`
`foldGrokVoiceCredential`).

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
(hands-free or push to talk, Only my voice, call sounds, and under
Advanced "Streaming voice" and "Faster end of turn", both on by default)
and the voiceprint
stay on the computer (`omb.voiceCall.v1`, `omb.voiceCall.voiceprint.v1`). A language xAI text to
speech does not take is spoken as `auto`; speech to text gets the base
language as a hint when xAI supports it, else it detects (Auto-detect on a
French locale: French, see Streaming speech to text).

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
  `language`, `format` (only with a language), `filler_words=true`,
  `keyterm`, `smart_turn=0.9`, `smart_turn_timeout=5000`; events
  `transcript.created`, `transcript.partial` with `is_final`,
  `speech_final` and `end_of_turn_confidence`, `transcript.done`;
  `{"type":"finalize"}` ends an utterance and the session goes on), and
  `POST https://api.x.ai/v1/stt` (multipart `language`, `format`,
  `filler_words`, `keyterm`, then `file` last) for a whole turn; the
  route hands back its words without fillers:
  <https://docs.x.ai/developers/model-capabilities/audio/speech-to-text>
- `POST https://api.x.ai/v1/tts` (`text`, `voice_id`, `language`, `speed`
  0.7 to 1.5, `output_format` `{codec: "pcm", sample_rate: 24000}` for a live
  call; the response body streams the audio as it is made), and
  `GET https://api.x.ai/v1/tts/voices`:
  <https://docs.x.ai/developers/model-capabilities/audio/text-to-speech>.
- Streaming text to speech, `wss://api.x.ai/v1/tts` (query `language`,
  `voice`, `codec=pcm`, `sample_rate=24000`, `speed`,
  `optimize_streaming_latency=2`; client `text.delta`, `text.done`,
  `text.clear`; server `audio.delta` base64, `audio.done`, `audio.clear`,
  `error`; the socket stays open between utterances):
  <https://docs.x.ai/developers/model-capabilities/audio/text-to-speech#streaming-tts-websocket>.
  The live call's "Streaming voice" uses it; POST `/v1/tts` is its fallback.

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
- `server/voice-call.e2e.test.ts`: the listen WebSocket, the streamed
  speech and the streaming voice socket (clauses, barge-in `text.clear`, a
  dropped xAI socket reconnected, a refused one answered 502) over real
  sockets against a fake xAI, same-origin only, and no xAI path but speech
  to text and text to speech.
- `server/voice-speech-session.test.ts`: the streaming voice's server
  session (one utterance per answer with appends sent at once, appended
  text cleaned with its edges kept and cut at 500 characters, an open
  utterance with nothing to say yet, whole texts one at a time, clear, drop
  and backoff, three failed reconnects then fallback, the stall watchdog
  only while audio is owed, a clear never confirmed).
- `src/lib/voice-mode/speech-stream.test.ts`: the page's side (open,
  stream, cancel, an answer's utterance begun, grown and finished, a
  socket failing mid-answer going on over POST from what was not covered,
  two errors, the 1.5 s open, a server fallback) and the clauses without
  the 36 character wait (words counted by whitespace).
- `src/lib/voice-mode/tts-lead.test.ts`: what goes to the voice for an
  answer (begin, appends with captions, one finish, the 1,500 character
  roll, markdown never opening it, the POST switch mid-answer).
- `server/tts/french-reading.test.ts`, `speech-text.test.ts`: French
  reading (also for an automatic language that looks French) and the
  appended text's cleaning.
- `src/lib/voice-mode/prosody.test.ts`: the pitch estimate and the contour
  verdict on synthetic contours (falling, rising, flat filler, mid-word),
  and the turn detector using it.
- `server/tts/grok.test.ts`: the xAI requests (speed, language, STT form,
  fillers kept, format, Smart Turn and its confidence passed through).
- `src/lib/voice-mode/duplex-policy.test.ts`, `call-logic.test.ts` duplex
  cases, `server/voice-call-duplex.test.ts`, `scripts/voice-duplex-harness.test.ts`:
  full-duplex barge-in while thinking, admit never queues, one active turn.
- `src/lib/voice-mode/call-logic.test.ts`: the call's state machine (barge-in,
  cancellation, hold, mute), endpointing and its adaptation, the echo guard,
  the sentence splitter.
- `server/voice-call-reliability.e2e.test.ts`: every call turn marked on
  every path, no duplicate steer, heard and unheard, the unanswered
  watchdog, words sent while a turn stops; `server/org-mcp.e2e.test.ts`:
  one Perspicax exchange for a whole call; `server/delta-context.e2e.test.ts`:
  a steer the engine echoed is never offered again.
- `src/lib/voice-mode/player.test.ts`, `stt-stream.test.ts`: what was heard
  at a cut (also in an utterance that grows), the 24 kHz context, the
  prebuffer, the fades around a gap, the jitter buffer, captions, a starved
  utterance, the two ducks, xAI finalize semantics; a stalled clause given
  up and the next one played (an open utterance is never timed out), a
  suspended context resumed, a stopped clock not busy; an idle drop that
  streams the next turn on a new socket, a mid-utterance drop (each
  utterance its own words, one upload), the server's `reconnected`, two
  failed uploads reported.
- `server/voice-listen-session.test.ts`: xAI's speech to text dropped and
  reopened behind the page's socket, the page closed only after the
  backoff, the 540 s rotation while idle.
- `src/lib/voice-mode/api.test.ts`, `call-alive.test.ts`,
  `server/voice-call-session.test.ts`: the 8 s stall and 20 s upload
  timeouts, the heartbeat on visibility and online, a retry that dies with
  the call, an expired call registered again.
- `src/lib/voice-mode/call.test.ts`: the call with fake devices (one turn,
  barge-in cut on the first real words or by 412 ms, a cough or a "mm-hmm"
  never cutting the answer, another voice over the bot, the rejoin after
  any early end, fillers kept from the bot, Smart Turn, the pre-roll of a
  cancelled candidate, the anti-alias resampler, the streamed answer, Only
  my voice, push to talk, mute, hold, a language change, the upload
  fallback, an upload that fails twice, a suspended capture context, an
  ended track or an unplugged microphone opened again, frames that keep
  failing).
- `src/lib/voice-mode/voice-topics.test.ts`: a stop is the whole utterance.
- `src/lib/voice-mode/models.test.ts`: the real models on recorded fixtures
  (speech, noise, keyboard, music, a TV across the room, echo, barge-in;
  speaker accept and reject; the filter bank against kaldi-native-fbank).
- `src/components/voice-mode/*.test.ts`, `src/lib/voice-mode/voice-mode.test.ts`.
- `electron/app-permissions.node-test.mjs`: the microphone in server mode.
- Real Electron, server mode, fake xAI (`server/testing/fake-xai-voice.ts`),
  a recorded sentence as the microphone: first audio of the answer after the
  person stops, the turn ended on the voice's falling end with no
  punctuation, the answer over one streaming voice socket, barge-in cleared
  at xAI, hold, the POST fallback after xAI's socket drops for good, and no
  xAI path but voice:
  `pnpm exec vite build && node --experimental-strip-types scripts/verify-voice-mode.ts`.
  It drives the call through `window.__sagaxVoiceCall`, which exists only
  when `localStorage["omb.voiceCall.debug"]` is `"1"`.

- Voice acceptance (`pnpm voice:acceptance`, and
  `pnpm voice:acceptance:real -- --enforce` before a release): the 32-turn
  ledger, the latency gates, and the provider-path audit. Recipe:
  [docs/verification/voice-acceptance.md](verification/voice-acceptance.md).

A change to the server routes needs the server image redeployed.

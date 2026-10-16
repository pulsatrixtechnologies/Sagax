// The page scripts that drive a Google Meet guest join in the bot's own
// browser (agent_browser_eval), and the pure reading of what they return.
//
// Every script is a synchronous expression that answers one JSON string:
// the harness parses it (parseEvalJson) and never trusts it as anything but
// data from a web page. Text the server puts into a page (the guest name, the
// announcement) goes in through JSON.stringify, never by concatenation.
//
// Audio: CAPTURE_HOOK_SCRIPT wraps RTCPeerConnection before the bot asks to
// join, so every remote audio track Meet receives afterwards is collected.
// Recording starts only when the harness calls start() (after the consent
// announcement is visible in the meeting chat). The tracks are mixed with
// Web Audio and cut into standalone audio/webm segments: the recorder is
// stopped and started again every segment, so each one carries its own
// header and can be transcribed alone. The harness drains the segments with
// another eval; nothing leaves the page over the network.

/** Segment length: long enough for a sentence, short for a live tail. */
export const MEETING_SEGMENT_MS = 30_000;
/** Segments kept in the page when nobody drains them (about 20 minutes). */
export const MEETING_PAGE_QUEUE = 40;

export const CAPTURE_HOOK_SCRIPT = `(() => {
  if (window.__sagaxMeet) return JSON.stringify({ installed: true, again: true });
  const Original = window.RTCPeerConnection;
  if (typeof Original !== "function") return JSON.stringify({ installed: false });
  const state = { tracks: new Map(), sources: new Set(), chunks: [], dropped: 0, recording: false, discard: false, ctx: null, dest: null, recorder: null, timer: null, errors: [], seq: 0, mime: "" };
  const note = (error) => { if (state.errors.length < 10) state.errors.push(String(error && error.message || error).slice(0, 200)); };
  const connect = (track) => {
    if (!state.recording || state.sources.has(track.id) || track.readyState === "ended") return;
    try {
      state.ctx.createMediaStreamSource(new MediaStream([track])).connect(state.dest);
      state.sources.add(track.id);
    } catch (error) { note(error); }
  };
  const attach = (track) => {
    if (!track || track.kind !== "audio" || state.tracks.has(track.id)) return;
    state.tracks.set(track.id, track);
    connect(track);
  };
  const scanElements = () => {
    for (const element of document.querySelectorAll("audio, video")) {
      const stream = element.srcObject;
      if (stream && typeof stream.getAudioTracks === "function") for (const track of stream.getAudioTracks()) attach(track);
    }
  };
  class SagaxPeerConnection extends Original {
    constructor(...args) {
      super(...args);
      this.addEventListener("track", (event) => attach(event.track));
    }
  }
  window.RTCPeerConnection = SagaxPeerConnection;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = SagaxPeerConnection;
  const keep = (blob, seq) => {
    if (!blob || !blob.size || state.discard) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (state.discard) return;
      const data = String(reader.result || "").split(",")[1] || "";
      if (!data) return;
      state.chunks.push({ seq, at: Date.now(), mime: state.mime || "audio/webm", data });
      while (state.chunks.length > ${MEETING_PAGE_QUEUE}) { state.chunks.shift(); state.dropped++; }
    };
    reader.readAsDataURL(blob);
  };
  const startRecorder = () => {
    const seq = ++state.seq;
    const parts = [];
    const options = { audioBitsPerSecond: 24000 };
    if (state.mime) options.mimeType = state.mime;
    const recorder = new MediaRecorder(state.dest.stream, options);
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) parts.push(event.data); };
    recorder.onstop = () => keep(new Blob(parts, { type: state.mime || "audio/webm" }), seq);
    recorder.onerror = (event) => note(event.error || "recorder error");
    recorder.start();
    state.recorder = recorder;
  };
  const rotate = () => {
    scanElements();
    const previous = state.recorder;
    if (!state.recording) return;
    startRecorder();
    if (previous && previous.state !== "inactive") previous.stop();
  };
  window.__sagaxMeet = {
    start(segmentMs) {
      if (state.recording) return true;
      const Context = window.AudioContext || window.webkitAudioContext;
      state.ctx = new Context();
      void state.ctx.resume().catch(note);
      state.dest = state.ctx.createMediaStreamDestination();
      state.mime = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      state.recording = true;
      scanElements();
      for (const track of state.tracks.values()) connect(track);
      startRecorder();
      state.timer = setInterval(rotate, Math.max(5000, Number(segmentMs) || 30000));
      return true;
    },
    stop(discard) {
      if (discard) { state.discard = true; state.chunks.length = 0; }
      if (!state.recording) return false;
      state.recording = false;
      clearInterval(state.timer);
      if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
      return true;
    },
    drain(max) {
      const chunks = state.chunks.splice(0, Math.max(1, Math.min(10, Number(max) || 4)));
      return { chunks, queued: state.chunks.length, dropped: state.dropped, tracks: state.tracks.size, context: state.ctx ? state.ctx.state : "none", recording: state.recording, errors: state.errors.splice(0) };
    },
  };
  return JSON.stringify({ installed: true });
})()`;

export const MEETING_START_SCRIPT = `JSON.stringify({ started: Boolean(window.__sagaxMeet && window.__sagaxMeet.start(${MEETING_SEGMENT_MS})) })`;
export const MEETING_STOP_SCRIPT = `JSON.stringify({ stopped: Boolean(window.__sagaxMeet && window.__sagaxMeet.stop()) })`;
/** A participant objected: stop now and drop every segment not yet
 * transcribed, including the one the recorder is still writing. */
export const MEETING_DISCARD_SCRIPT = `JSON.stringify({ discarded: Boolean(window.__sagaxMeet) && (window.__sagaxMeet.stop(true), true) })`;
export const MEETING_DRAIN_SCRIPT = `JSON.stringify(window.__sagaxMeet ? window.__sagaxMeet.drain(4) : { chunks: [], missing: true })`;

/** Pre-join screen: continue without devices, keep the microphone and the
 * camera off, type the guest name, and mark the join button for a real
 * (trusted) click by selector. */
export function prepareJoinScript(displayName: string): string {
  return `(() => {
  const name = ${JSON.stringify(displayName)};
  const label = (element) => [element.getAttribute("aria-label"), element.getAttribute("data-tooltip"), element.innerText].filter(Boolean).join(" ").trim();
  const buttons = () => Array.from(document.querySelectorAll("button, [role=button]"));
  for (const button of buttons()) {
    if (/continue without (microphone|mic|camera)|continuer sans (micro|caméra)/i.test(label(button))) button.click();
  }
  let muted = 0;
  for (const button of buttons()) {
    const text = label(button);
    if (/turn off (microphone|camera)|désactiver (le micro|la caméra)/i.test(text)) { button.click(); muted++; }
  }
  let nameFilled = false;
  const input = Array.from(document.querySelectorAll("input[type=text], input:not([type])"))
    .find((element) => /name|nom/i.test([element.getAttribute("aria-label"), element.getAttribute("placeholder"), element.getAttribute("autocomplete")].filter(Boolean).join(" ")));
  if (input) {
    if (input.value !== name) {
      input.focus();
      if (typeof input.select === "function") input.select();
      if (!document.execCommand("insertText", false, name)) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, name);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    nameFilled = input.value === name;
  }
  let joinReady = false;
  for (const button of buttons()) {
    button.removeAttribute("data-sagax-join");
    if (!joinReady && /^(ask to join|join now|join|demander à participer|participer|rejoindre)$/i.test(String(button.innerText || "").trim()) && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
      button.setAttribute("data-sagax-join", "1");
      joinReady = true;
    }
  }
  return JSON.stringify({ nameInput: Boolean(input), nameFilled, joinReady, muted });
})()`;
}

/** What the page shows now, for classifyMeetPage. */
export const MEETING_STATE_SCRIPT = `(() => {
  const label = (element) => [element.getAttribute("aria-label"), element.getAttribute("data-tooltip")].filter(Boolean).join(" ");
  const buttons = Array.from(document.querySelectorAll("button, [role=button]"));
  const leave = buttons.some((button) => /leave call|quitter l.appel/i.test(label(button)));
  const people = new Set(Array.from(document.querySelectorAll("[data-participant-id]")).map((element) => element.getAttribute("data-participant-id"))).size;
  return JSON.stringify({ url: location.href, text: (document.body ? document.body.innerText : "").slice(0, 6000), leave, people });
})()`;

/** Open the meeting chat and mark its text box and send button. */
export const MEETING_CHAT_OPEN_SCRIPT = `(() => {
  const label = (element) => [element.getAttribute("aria-label"), element.getAttribute("data-tooltip")].filter(Boolean).join(" ");
  const findBox = () => Array.from(document.querySelectorAll("textarea, [contenteditable=true]"))
    .find((element) => /send a message|envoyer un message|message/i.test([label(element), element.getAttribute("placeholder")].filter(Boolean).join(" ")));
  let box = findBox();
  let opened = false;
  if (!box) {
    const button = Array.from(document.querySelectorAll("button, [role=button]"))
      .find((element) => /chat with everyone|discuter avec tous|^chat$|messages in the call|messages de l.appel/i.test(label(element)));
    if (button) { button.click(); opened = true; }
    box = findBox();
  }
  if (box) box.setAttribute("data-sagax-chat", "1");
  return JSON.stringify({ opened, box: Boolean(box) });
})()`;

/** Type the announcement in the marked chat box and mark the send button. */
export function chatTypeScript(text: string): string {
  return `(() => {
  const text = ${JSON.stringify(text)};
  const box = document.querySelector("[data-sagax-chat]");
  if (!box) return JSON.stringify({ typed: false });
  box.focus();
  if (!document.execCommand("insertText", false, text)) {
    if ("value" in box) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(box, text);
    } else box.textContent = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const label = (element) => [element.getAttribute("aria-label"), element.getAttribute("data-tooltip")].filter(Boolean).join(" ");
  const send = Array.from(document.querySelectorAll("button, [role=button]"))
    .find((element) => /send a message|envoyer un message|^send$|^envoyer$/i.test(label(element)) && !element.disabled && element.getAttribute("aria-disabled") !== "true");
  if (send) send.setAttribute("data-sagax-send", "1");
  return JSON.stringify({ typed: true, send: Boolean(send) });
})()`;
}

/** How many times the text shows in the chat history, outside the box. */
export function chatPostedScript(text: string): string {
  return `(() => {
  const text = ${JSON.stringify(text)};
  const box = document.querySelector("[data-sagax-chat]");
  const pending = String((box ? ("value" in box ? box.value : box.textContent) : "") || "");
  const body = document.body ? document.body.innerText : "";
  const count = body.split(text).length - 1 - (pending.includes(text) ? 1 : 0);
  return JSON.stringify({ posted: count > 0, count });
})()`;
}

/** The meeting chat's lines as the page shows them, read from the panel
 * around the marked text box (opened again when it was closed). ok false:
 * the chat could not be read on this poll. */
export const MEETING_CHAT_READ_SCRIPT = `(() => {
  const label = (element) => [element.getAttribute("aria-label"), element.getAttribute("data-tooltip"), element.getAttribute("placeholder")].filter(Boolean).join(" ");
  const findBox = () => document.querySelector("[data-sagax-chat]") || Array.from(document.querySelectorAll("textarea, [contenteditable=true]"))
    .find((element) => /send a message|envoyer un message|message/i.test(label(element)));
  let box = findBox();
  if (!box) {
    const button = Array.from(document.querySelectorAll("button, [role=button]"))
      .find((element) => /chat with everyone|discuter avec tous|^chat$|messages in the call|messages de l.appel/i.test(label(element)));
    if (button) button.click();
    box = findBox();
  }
  if (!box) return JSON.stringify({ ok: false });
  box.setAttribute("data-sagax-chat", "1");
  let panel = box.closest("aside, [role=complementary], [role=dialog]");
  if (!panel) {
    panel = box;
    for (let depth = 0; depth < 6 && panel.parentElement && panel.parentElement !== document.body; depth++) panel = panel.parentElement;
  }
  const lines = String(panel.innerText || "").split("\\n").map((line) => line.trim()).filter(Boolean).slice(-400);
  return JSON.stringify({ ok: true, lines });
})()`;

/** Lines of `current` that `previous` did not have, counting repeats. */
export function newChatLines(previous: readonly string[], current: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const line of previous) left.set(line, (left.get(line) ?? 0) + 1);
  return current.filter((line) => {
    const count = left.get(line) ?? 0;
    if (count) left.set(line, count - 1);
    return !count;
  });
}

const OBJECTION = /\b(stop|stopp?e[rz]?|arr[eê]te[rz]?|quitte[rz]?|quit|leave|go away|get out|sors|sortez|kick|remove|retire[rz]?|enl[eè]ve[rz]?|record\w*|enregistr\w*|transcri\w*|bot|robot|consent\w*|privacy|confidentialit\w*|refus\w*|object\w*|opt.?out)\b|je refuse|pas d.enregistrement|no recording|don.t record|do not record|n.enregistre pas|pas de transcription|non merci|no thanks|pas de notes|don.t take notes|do not take notes|pas d.accord|not ok\b|not okay/i;

/** Labels Meet shows above the bot's own messages. */
const OWN_AUTHOR_LABELS = new Set(["you", "vous", "moi", "me"]);

/** Whether a new chat line objects to the notetaker. Deliberately broad:
 * when in doubt, the bot leaves. Only the bot's own lines are left out, by
 * exact match: a message it posted, or its own author label (its display
 * name, "You"). A participant's line that merely quotes part of the
 * announcement ("stop", "je quitte") still counts. */
export function chatObjects(line: string, botName: string, ownTexts: readonly string[], displayName = ""): boolean {
  const text = line.trim();
  if (!text) return false;
  if (ownTexts.some((own) => own.trim() === text)) return false;
  if (OWN_AUTHOR_LABELS.has(text.toLowerCase()) || (displayName && text === displayName.trim())) return false;
  const name = botName.trim().toLowerCase();
  if (name.length >= 2 && text.toLowerCase().includes(name)) return true;
  if (/^(no|non|nope|nan|niet)[.!]*$/i.test(text)) return true;
  return OBJECTION.test(text);
}

/** Posted in the meeting chat when the bot leaves at a participant's request. */
export const MEETING_LEAVING_TEXT = "Je quitte. / Leaving.";

/** Mark the leave button for a trusted click. */
export const MEETING_LEAVE_MARK_SCRIPT = `(() => {
  const button = Array.from(document.querySelectorAll("button, [role=button]"))
    .find((element) => /leave call|quitter l.appel/i.test([element.getAttribute("aria-label"), element.getAttribute("data-tooltip")].filter(Boolean).join(" ")));
  if (button) button.setAttribute("data-sagax-leave", "1");
  return JSON.stringify({ leave: Boolean(button) });
})()`;

export type MeetPageState = "lobby" | "waiting" | "in-meeting" | "refused" | "ended";

/** What a Meet page state script saw, read conservatively: a page that
 * says it refused or removed the bot wins over everything. */
export function classifyMeetPage(signals: { text?: unknown; leave?: unknown }): MeetPageState {
  const text = typeof signals.text === "string" ? signals.text : "";
  if (/you can.t join this (video )?call|vous ne pouvez pas (participer|rejoindre)|denied your request|a refusé votre demande|removed you from the (meeting|call)|vous a retiré/i.test(text)) return "refused";
  const leave = signals.leave === true;
  if (!leave && /you left the meeting|you.ve left the (meeting|call)|vous avez quitté|the call has ended|the meeting has ended|l.appel est terminé|la réunion est terminée|return to home screen|revenir à l.écran d.accueil/i.test(text)) return "ended";
  if (leave) return "in-meeting";
  if (/asking to be let in|please wait until a meeting host|someone will let you in|demande de participation|veuillez patienter|quelqu.un va vous laisser entrer/i.test(text)) return "waiting";
  return "lobby";
}

/** The JSON value an eval answered: agent-browser returns the script's
 * value as text, which is itself the JSON string the script built. */
export function parseEvalJson(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object" || (result as { isError?: unknown }).isError === true) return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const part = content.find((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string") as { text: string } | undefined;
  if (!part) return null;
  try {
    let value: unknown = JSON.parse(part.text);
    if (typeof value === "string") value = JSON.parse(value);
    // agent-browser may wrap the value: { data: { result } }.
    if (value && typeof value === "object" && !Array.isArray(value) && "data" in value && !("chunks" in value)) {
      const data = (value as { data?: unknown }).data;
      const inner = data && typeof data === "object" && "result" in data ? (data as { result?: unknown }).result : undefined;
      if (typeof inner === "string") value = JSON.parse(inner);
      else if (inner && typeof inner === "object") value = inner;
    }
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** The announcement posted in the meeting chat before any recording, and
 * again every 10 minutes or when someone joins. It names the bot and the
 * person, says the audio goes to an external provider outside Québec, how
 * long the text is kept, and how to make the bot leave. */
export function meetingAnnouncement(displayName: string, personName: string | undefined): string {
  const person = personName?.trim() ? personName.trim().slice(0, 60) : "";
  const fr = `${displayName} prend des notes pour ${person || "la personne qui l'a invité"}. L'audio est transcrit par un fournisseur externe (xAI), hors du Québec ; l'audio n'est pas gardé, le texte reste dans la conversation de ${person || "cette personne"} pour les notes. Écrivez « stop » ici et je quitte.`;
  const en = `${displayName} is taking notes for ${person || "the person who invited it"}. Audio is transcribed by an external provider (xAI), outside Québec; audio is not kept, the text stays in ${person ? `${person}'s` : "that person's"} conversation for the notes. Type "stop" here and I will leave.`;
  return `${fr} / ${en}`;
}

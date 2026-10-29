// Show a task in my Chrome, end to end, against a throwaway headless Chrome
// (temporary profile, --headless=new, its own loopback DevTools port) and a
// local site: never the person's Chrome or profile, never a window.
//
// The person's side is a direct connection to the test Chrome that clicks
// and types in the recorded tab with real (trusted) input events. The path
// that comes out is saved as a skill (shared/shown-path.ts), then a scripted
// bot follows its steps with the page tools: once through My Chrome (the
// gate, the approval cards of pilot.ts unchanged, the My Chrome banner up
// for the whole replay), once in a browser of its own in the background
// (nothing of the person's Chrome is used). The page's final state is
// checked both times.
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { planShownPath } from "../../../shared/shown-path.ts";
import { teachReplayPlan, type TeachStep } from "../../../shared/teach-recording.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { PILOT_BANNER_ID } from "./gate.ts";
import { runMyChromeTool } from "./pilot.ts";
import { RECORDER_BANNER_ID } from "./recorder.ts";
import { MyChromeService } from "./service.ts";
import { CdpClient, waitFor } from "./testing/cdp-client.ts";
import { FakeEngine } from "./testing/fake-engine.ts";
import { findTestChrome, launchTestChrome, type TestChrome } from "./testing/test-chrome.ts";

const CHROME = findTestChrome();
const PASSWORD = "hunter2-Correct!";

const PAGES: Record<string, string> = {
  "/start": `<!doctype html><title>Start</title><h1>Accueil</h1><a href="/form">Formulaire</a>`,
  "/form": `<!doctype html><title>Form</title><h1>Demande</h1>
<label for="name">Nom</label><input id="name" name="name">
<label for="pw">Mot de passe</label><input id="pw" type="password" name="password">
<label for="comment">Commentaire</label><input id="comment" name="comment">
<label><input id="terms" type="checkbox"> J'accepte les conditions</label>
<button type="button" id="send">Envoyer la demande</button>
<p id="result"></p>
<script>
document.getElementById("send").addEventListener("click", () => {
  const ok = document.getElementById("pw").value === ${JSON.stringify(PASSWORD)};
  document.getElementById("result").textContent = "Sent " + document.getElementById("name").value + " / " + (document.getElementById("terms").checked ? "accepted" : "not accepted") + " / " + (ok ? "pw ok" : "pw bad");
});
</script>`,
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}

/** The bot following a shown path's steps with the page tools: each element
 * found by its role and name in a fresh snapshot, never by position. A
 * secret step takes the value from the vault (here, the test's). */
async function replaySteps(steps: readonly TeachStep[], call: (params: unknown) => Promise<unknown>, vault: string): Promise<void> {
  const textOf = (result: unknown) => ((result as { content?: Array<{ text?: string }> }).content ?? []).map((part) => part.text ?? "").join("\n");
  const find = async (role: string, name: string): Promise<string> => {
    const snapshot = textOf(await call({ name: "agent_browser_snapshot", arguments: {} }));
    for (const line of snapshot.split("\n")) {
      const match = /^- (\w+) "((?:[^"\\]|\\.)*)" \[ref=(e\d+)\]/.exec(line);
      if (match && match[1] === role && match[2]!.replace(/\\"/g, "\"") === name) return `@${match[3]}`;
    }
    throw new Error(`no ${role} "${name}" on the page`);
  };
  for (const step of steps) {
    let result: unknown;
    if (step.kind === "open") result = await call({ name: "agent_browser_open", arguments: { url: step.url } });
    else if (step.kind === "click") result = await call({ name: "agent_browser_click", arguments: { selector: await find(step.target!.role, step.target!.name) } });
    else if (step.kind === "type") result = await call({ name: "agent_browser_fill", arguments: { selector: await find(step.target!.role, step.target!.name), text: step.secret ? vault : step.text } });
    else if (step.kind === "press") result = await call({ name: "agent_browser_press", arguments: { key: step.key } });
    else continue;
    if ((result as { isError?: boolean }).isError) throw new Error(`${step.kind} failed: ${textOf(result)}`);
  }
}

describe.skipIf(!CHROME)("Show a task in my Chrome, recorded and replayed (headless test Chrome)", () => {
  let chrome: TestChrome;
  let site: Server;
  let origin = "";
  let dataDir = "";
  let service: MyChromeService;
  let person: CdpClient;
  let recorded: TeachStep[] = [];
  let defaultReplay = "";
  let recordedTab = "";

  beforeAll(async () => {
    chrome = await launchTestChrome(CHROME!);
    site = createServer((req, res) => {
      const page = PAGES[new URL(req.url ?? "/", "http://x").pathname];
      res.statusCode = page ? 200 : 404;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(page ?? "not found");
    });
    origin = `http://localhost:${await listen(site)}`;
    dataDir = mkdtempSync(join(tmpdir(), "sagax-mychrome-recorder-"));
    service = new MyChromeService({ dataDir, organization: false, locate: async () => chrome.wsUrl });
    await service.setEnabled(true);
    service.allowSite(origin);
    person = await CdpClient.connect(chrome.wsUrl);
  }, 60_000);

  afterAll(async () => {
    person?.close();
    await service?.close();
    await new Promise<void>((resolve) => site ? site.close(() => resolve()) : resolve());
    await chrome?.close();
    if (dataDir) await removeTempDir(dataDir);
  }, 30_000);

  it("records the person's clicks and typing in a tab of their Chrome, never a secret, and gives an editable path", async () => {
    const started = await service.startRecording(`${origin}/start`);
    expect(started.recording).toBe(true);

    // The person's own connection finds the recorded tab and acts in it.
    let targetId = "";
    await waitFor(async () => {
      const { targetInfos } = await person.send("Target.getTargets") as { targetInfos: Array<{ targetId: string; url: string; type: string }> };
      targetId = targetInfos.find((info) => info.type === "page" && info.url === `${origin}/start`)?.targetId ?? "";
      return Boolean(targetId);
    }, 10_000, "the recorded tab");
    recordedTab = targetId;
    const { sessionId } = await person.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
    await person.send("Runtime.enable", {}, sessionId);
    const ready = (path: string) => waitFor(async () => (await person.evaluate<string>(sessionId, `location.pathname + "|" + document.readyState + "|" + Boolean(document.getElementById(${JSON.stringify(RECORDER_BANNER_ID)}))`)) === `${path}|complete|true`, 10_000, `${path} with the recording banner`);
    const center = async (selector: string) => person.evaluate<{ x: number; y: number }>(sessionId, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const click = async (selector: string) => {
      const { x, y } = await center(selector);
      await person.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
      await person.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
      await person.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
    };
    const type = (text: string) => person.send("Input.insertText", { text }, sessionId);

    await ready("/start");
    await click("a");
    await ready("/form");
    await click("#name");
    await type("Alice");
    await click("#pw");
    await type(PASSWORD);
    await click("#comment");
    // the same password pasted into an ordinary field: masked by its digest
    await type(PASSWORD);
    await click("#terms");
    await click("#send");
    await waitFor(async () => (await person.evaluate<string>(sessionId, "document.getElementById('result').textContent")).startsWith("Sent"), 5_000, "the page's result");
    await waitFor(() => (service.recordingStatus()?.steps ?? 0) >= 7, 5_000, "the recorded steps");
    expect(service.recordingNote("Check that the confirmation shows")?.steps).toBe(8);

    const result = await service.stopRecording();
    expect(result).not.toBeNull();
    recorded = result!.steps;
    defaultReplay = result!.replay;
    expect(recorded.map((step) => step.kind)).toEqual(["open", "click", "type", "type", "type", "click", "click", "note"]);
    expect(recorded[0]!.url).toBe(`${origin}/start`);
    expect(recorded[1]!.target).toMatchObject({ role: "link", name: "Formulaire" });
    expect(recorded[2]).toMatchObject({ kind: "type", text: "Alice", target: { role: "textbox", name: "Nom", selector: "#name" } });
    expect(recorded[3]).toMatchObject({ kind: "type", secret: true, target: { name: "Mot de passe" } });
    expect(recorded[4]).toMatchObject({ kind: "type", secret: true, target: { name: "Commentaire" } });
    expect(recorded[5]!.target).toMatchObject({ role: "checkbox", name: "J'accepte les conditions" });
    expect(recorded[6]!.target).toMatchObject({ role: "button", name: "Envoyer la demande", selector: "#send" });
    expect(recorded[7]).toMatchObject({ kind: "note", text: "Check that the confirmation shows" });
    // no step anywhere carries the password
    expect(JSON.stringify(recorded)).not.toContain(PASSWORD);
    // replayed out of sight unless the person picks their own Chrome
    expect(defaultReplay).toBe("background");
    // the tab is the person's again: no banner, no recorder
    await waitFor(async () => !(await person.evaluate<boolean>(sessionId, `Boolean(document.getElementById(${JSON.stringify(RECORDER_BANNER_ID)}))`)), 5_000, "the banner gone");
    expect(service.recordingStatus()).toBeNull();
    await person.send("Target.detachFromTarget", { sessionId });
  }, 60_000);

  it("saves it as a skill that says where it is replayed and asks the vault or the person for each secret", () => {
    const myChrome = planShownPath({ title: "Send the request", steps: recorded, replay: "my-chrome" }, "preview", new Set());
    expect(myChrome.action).toBe("preview");
    const markdown = (myChrome as { markdown: string }).markdown;
    expect(markdown).toContain("## Where to Replay");
    const announce = teachReplayPlan("my-chrome", recorded).announce!;
    expect(announce).toContain(origin);
    // said in the conversation before the first step
    expect(markdown.indexOf(announce)).toBeGreaterThan(0);
    expect(markdown.indexOf(announce)).toBeLessThan(markdown.indexOf("## Procedure"));
    expect(markdown).toContain("fill_credential");
    expect(markdown).toContain('the button "Envoyer la demande"');
    expect(markdown).not.toContain(PASSWORD);
    const background = (planShownPath({ title: "Send the request", steps: recorded, replay: "background" }, "preview", new Set()) as { markdown: string }).markdown;
    expect(background).toContain("in the background: nothing opens on the person's screen");
    expect(background).not.toContain("I am about to drive your Chrome");
    expect(teachReplayPlan("background", recorded)).toMatchObject({ where: "background", announce: null, indicator: false });
  });

  it("replays it in My Chrome with the usual approval cards and the banner with Stop up the whole time", async () => {
    const session = "mychrome-bot-replay";
    const engine = await FakeEngine.connect(await service.urlFor(session));
    const cards: string[] = [];
    const bannerSeen: boolean[] = [];
    const call = async (params: unknown) => {
      const result = await runMyChromeTool({
        session, params, memory: service.memory,
        run: (p) => engine.run(p),
        pageUrl: async () => ((await engine.run({ name: "agent_browser_get_url", arguments: {} })).content[0]?.text ?? ""),
        confirm: async (summary) => { cards.push(summary); return "allow"; },
        notes: () => service.takeNotes(session),
        stepsUnasked: false,
      });
      // Sagax's banner (MyChromeIndicator) reads this status: this bot drives a tab
      bannerSeen.push(service.status().gate.clients.some((client) => client.label === session && client.tabs.length > 0));
      return result;
    };
    try {
      await replaySteps(recorded, call, PASSWORD);
      const finalText = (await call({ name: "agent_browser_get_text", arguments: { selector: "#result" } }) as { content: Array<{ text: string }> }).content[0]!.text;
      expect(finalText).toBe("Sent Alice / accepted / pw ok");
      // the approval rules of My Chrome are unchanged: the send waited on its card
      expect(cards).toEqual([expect.stringContaining('button "Envoyer la demande" (a send or submit)')]);
      expect(bannerSeen.length).toBeGreaterThan(5);
      expect(bannerSeen.every(Boolean)).toBe(true);
      // and the tab itself carries the banner with Stop (the tab the person
      // recorded in stays theirs, with no banner)
      const { targetInfos } = await person.send("Target.getTargets") as { targetInfos: Array<{ targetId: string; url: string }> };
      const botTab = targetInfos.find((info) => info.url === `${origin}/form` && info.targetId !== recordedTab)!;
      const { sessionId } = await person.send("Target.attachToTarget", { targetId: botTab.targetId, flatten: true }) as { sessionId: string };
      expect(await person.evaluate<boolean>(sessionId, `Boolean(document.getElementById(${JSON.stringify(PILOT_BANNER_ID)}))`)).toBe(true);
      await person.send("Target.detachFromTarget", { sessionId });
    } finally {
      engine.close();
    }
  }, 60_000);

  it("replays it in the background in a browser of the bot's own, with nothing on the person's Chrome", async () => {
    await waitFor(() => service.status().gate.clients.length === 0, 5_000, "no bot on My Chrome");
    const engine = await FakeEngine.connect(chrome.wsUrl, { ownContext: true });
    const driving: number[] = [];
    try {
      await replaySteps(recorded, async (params) => {
        const result = await engine.run(params);
        driving.push(service.status().gate.clients.length);
        return result;
      }, PASSWORD);
      const finalText = (await engine.run({ name: "agent_browser_get_text", arguments: { selector: "#result" } })).content[0]!.text;
      expect(finalText).toBe("Sent Alice / accepted / pw ok");
      // no gate connection was opened for it: no My Chrome banner, no indicator
      expect(driving.length).toBeGreaterThan(5);
      expect(driving.every((count) => count === 0)).toBe(true);
    } finally {
      engine.close();
    }
  }, 60_000);
});

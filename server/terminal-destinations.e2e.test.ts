// The in-chat terminal end to end on the desktop app's own server (solo):
// a scripted bot lists its terminal destinations and offers one without
// naming it, the card proposes where the person may open a shell ("This
// computer" here), a pick the card never offered is refused, the allow opens
// a real login shell in a terminal, the widget's socket carries keystrokes
// and a resize, closing it ends the session, and every step is audited.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";

it.skipIf(process.platform === "win32")("offers, opens, drives and closes a terminal on this computer, audited", async () => {
  const owner = randomBytes(32).toString("base64url");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => realFetch(input, { ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": owner } });
  const session = await launchVerificationServer({ ...process.env, SAGAX_TEST_DESKTOP_OWNER_TOKEN: owner }, undefined, undefined, undefined, undefined, { scripted: true });
  const url = session.info.url;
  const cli = (...args: string[]) => runControlOmb(args, { env: { SAGAX_URL: url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") =>
    request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, url) as Promise<any>;
  const planPath = join(session.info.dataDir, "room-plan.json");
  const auditPath = join(session.info.dataDir, "terminal-sessions.jsonl");
  const audit = () => existsSync(auditPath) ? readFileSync(auditPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  try {
    const bot = (await cli("new-bot", "--name", "Ops")).bot;
    writeFileSync(planPath, JSON.stringify({ [bot.id]: {
      steps: [
        { tool: "list_terminal_resources", arguments: {} },
        { tool: "offer_shell_terminal", arguments: { reason: "Déboguer en direct" } },
      ],
      reply: "",
    } }));
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Ouvre-moi un terminal.");
    // The turn ends on the card: it waits for the person.
    expect((await cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("needs-user");

    const evidence = readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const steps = evidence.flatMap((turn: any) => turn.evidence).filter((entry: any) => entry.step);
    const listed = steps.find((entry: any) => entry.step.tool === "list_terminal_resources");
    expect(listed.response.result.isError).toBeFalsy();
    expect(listed.response.result.content[0].text).toContain("\"provider\": \"desktop\"");
    const offered = steps.find((entry: any) => entry.step.tool === "offer_shell_terminal");
    expect(offered.response.result.isError).toBeFalsy();

    const messages = (await api(`/api/threads/${bot.activeTaskId}/messages`, undefined, "GET")).messages;
    const card = messages.find((m: any) => m.card?.terminalRequest).card;
    expect(card.terminalRequest).toMatchObject({ provider: "desktop", resourceId: "mine", reason: "Déboguer en direct" });
    expect(card.terminalRequest.destinations.map((row: any) => row.provider)).toContain("desktop");

    // The card's answer, as the app sends it.
    const respond = async (body: Record<string, unknown>) => {
      const answer = await fetch(`${url}/api/threads/${bot.activeTaskId}/respond`, {
        method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ requestId: card.requestId, ...body }),
      });
      return { status: answer.status, body: await answer.json().catch(() => null) as Record<string, unknown> | null };
    };
    // A destination the card never offered: refused, the card stays open.
    const refused = await respond({ behavior: "allow", terminalDestination: { provider: "ssh", resourceId: "elsewhere" } });
    expect(refused.status).toBe(403);
    expect(String(refused.body?.error)).toMatch(/not allowed/);
    expect(audit().at(-1)).toMatchObject({ kind: "session.refused", resourceId: "ssh:elsewhere" });

    expect((await respond({ behavior: "allow", terminalDestination: { provider: "desktop", resourceId: "mine" }, terminalSize: { cols: 100, rows: 30 } })).status).toBe(200);
    const after = (await api(`/api/threads/${bot.activeTaskId}/messages`, undefined, "GET")).messages;
    const embed = after.find((m: any) => m.terminalEmbed)?.terminalEmbed;
    expect(embed).toMatchObject({ provider: "desktop", status: "live" });

    const ws = new WebSocket(`${url.replace(/^http/, "ws")}/api/terminal/sessions/${embed.sessionId}/ws`, {
      headers: { origin: url, "x-openmausbot-desktop-owner": owner },
    } as never);
    ws.binaryType = "arraybuffer";
    let output = "";
    ws.onmessage = (event) => { output += typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8"); };
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error("terminal socket refused")); });
    const type = (text: string) => ws.send(new TextEncoder().encode(text));
    // zsh greets a home without startup files with a setup menu; q leaves it.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (/new users/i.test(output)) type("q");
    await new Promise((resolve) => setTimeout(resolve, 500));
    type("echo sagax-$((40+2))\r");
    await expect.poll(() => output, { timeout: 10_000 }).toMatch(/sagax-42/);
    ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    type("stty size\r");
    await expect.poll(() => output, { timeout: 10_000 }).toMatch(/40 120/);
    ws.close();
    await expect.poll(() => audit().map((row: any) => row.kind), { timeout: 10_000 }).toContain("session.ended");
    expect(audit().map((row: any) => row.kind)).toEqual(["session.requested", "session.refused", "session.opened", "session.ended"]);
    expect(audit().find((row: any) => row.kind === "session.opened")).toMatchObject({ resourceId: "desktop:mine", botId: bot.id, threadId: bot.activeTaskId });
  } finally {
    globalThis.fetch = realFetch;
    await session.close();
  }
}, 120_000);

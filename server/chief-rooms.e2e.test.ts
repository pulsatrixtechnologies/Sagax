import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";
import { z } from "zod";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

type Bot = { id: string; threadId: string; name: string };
type Room = { id: string; name: string; memberIds: string[]; section?: string; bulletin: string; working?: boolean };
type RpcReply = { result: { isError?: boolean; content: Array<{ text: string }> } };
type Mounted = { command: string; args: string[]; env: Record<string, string> };

it("creates and manages an own-section room through the mounted Chief MCP proxy", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const proxies: ChildProcess[] = [];
  const control = async (args: string[]) => {
    const result = await runControlOmb([...args, "--url", fixture.info.url]);
    evidence.push({ command: args, result });
    return result;
  };
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${method} ${path}`).toBe(true);
    return await response.json() as T;
  };
  try {
    const bots: Bot[] = [];
    for (const name of ["Fixture Chief", "Fixture Peer", "Fixture Second", "Foreign Peer"]) {
      const { bot } = await control(["new-bot", "--name", name]) as { bot: Bot };
      bots.push(bot);
      await api("PATCH", `/api/bots/${bot.id}`, { section: name === "Foreign Peer" ? "Private" : "Room verification" });
    }
    const [chief, peer, second, foreign] = bots;
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
    // 2026-10-20 (#897): a Primary Bot covers every bot of its person whatever
    // the section, so a bot in another section is no longer foreign. What
    // stays out of reach is a bot the Chief's own peer list leaves out.
    await api("PATCH", `/api/bots/${chief.id}`, { peers: [peer.id, second.id] });
    // What one bot's turn mounts, then that agents proxy spawned the same way.
    const mount = async (bot: Bot, text: string): Promise<Mounted> => {
      rmSync(fixture.fixtureDumpPath, { force: true });
      await control(["send", "--bot", bot.id, "--text", text]);
      await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 15_000 }).toBe(true);
      const { mcpConfig } = z.object({ mcpConfig: z.object({ mcpServers: z.object({
        agents: z.object({ command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()) }),
      }) }) }).parse(JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")));
      const mounted = mcpConfig.mcpServers.agents;
      expect(mounted.env.SAGAX_BOT_ID).toBe(bot.id);
      expect(mounted.env.SAGAX_HARNESS_URL).toBe(fixture.info.url);
      return mounted;
    };
    const connect = (mounted: Mounted) => {
      const proxy = spawn(mounted.command, mounted.args, {
        cwd: process.cwd(),
        env: { ...mounted.env, HOME: fixture.info.dataDir, USERPROFILE: fixture.info.dataDir, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });
      proxies.push(proxy);
      const pending = new Map<number, (result: unknown) => void>();
      let nextId = 0;
      createInterface({ input: proxy.stdout! }).on("line", (line) => {
        const reply = JSON.parse(line) as { id: number; result: unknown };
        pending.get(reply.id)?.(reply.result);
      });
      return <T = RpcReply["result"]>(method: string, params: Record<string, unknown> = {}) => new Promise<T>((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} did not answer`)); }, 10_000);
        pending.set(id, (result) => { clearTimeout(timer); pending.delete(id); resolve(result as T); });
        proxy.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    };
    const toolNames = async (rpc: ReturnType<typeof connect>) =>
      (await rpc<{ tools: Array<{ name: string }> }>("tools/list")).tools.map((entry) => entry.name);

    // A turn is shown find_tool and use_tool. Chief-only tools stay out of
    // this bot's catalog, so use_tool cannot call them. create_bot is the
    // one any bot of the person may use (2026-10-17, server/bot-creation.ts).
    const peerMount = await mount(peer, "Say hello.");
    expect(peerMount.env.SAGAX_CHIEF_OF_STAFF).toBe("0");
    const peerRpc = connect(peerMount);
    const peerTools = (await peerRpc<{ tools: Array<{ name: string }> }>("tools/list")).tools.map((entry) => entry.name);
    expect(peerTools).toEqual(["find_tool", "use_tool"]);
    expect(peerMount.env.SAGAX_CREATE_BOTS).toBe("1");
    const peerUse = (name: string, args: Record<string, unknown> = {}) =>
      peerRpc<RpcReply["result"]>("tools/call", { name: "use_tool", arguments: { name, arguments: args } });
    expect(JSON.stringify(await peerUse("create_bot"))).not.toContain("Unknown tool");
    const refusedRoom = await peerUse("create_room");
    expect(refusedRoom.isError).toBe(true);
    expect(refusedRoom.content.map((item) => item.text).join("\n")).toContain("Unknown tool: create_room");
    expect((await peerUse("list_rooms")).isError).not.toBe(true);
    evidence.push({ peerTools });
    await control(["interrupt", "--bot", peer.id]);

    const mounted = await mount(chief, "Set up a small room for the team.");
    expect(mounted.env.SAGAX_CHIEF_OF_STAFF).toBe("1");
    const rpc = connect(mounted);
    expect(await toolNames(rpc)).toEqual(["find_tool", "use_tool"]);
    const tool = async (name: string, args: Record<string, unknown>, denied = false) => {
      const result = await rpc("tools/call", { name, arguments: args });
      evidence.push({ tool: name, args, result });
      expect(Boolean(result.isError), JSON.stringify(result)).toBe(denied);
      return result.content.map((item) => item.text).join("\n");
    };
    const rooms = async () => (await api<{ groups: Room[] }>("GET", "/api/bots?messages=0")).groups;
    await tool("create_room", { name: "Review room", member_bot_ids: [peer.id], bulletin: "Review only the assigned change." });
    const room = (await rooms()).find((candidate) => candidate.name === "Review room")!;
    expect(room).toMatchObject({ section: "Room verification", memberIds: [chief.id, peer.id], working: false });
    expect(await tool("list_rooms", {})).toContain(room.id);
    await tool("manage_room", { room_id: room.id, action: "rename", name: "Verified room" });
    await tool("manage_room", { room_id: room.id, action: "add_members", member_bot_ids: [second.id] });
    await tool("manage_room", { room_id: room.id, action: "remove_members", member_bot_ids: [peer.id] });
    await tool("manage_room", { room_id: room.id, action: "set_bulletin", bulletin: "Verified short brief ✓" });
    const saved = (await rooms()).find((candidate) => candidate.id === room.id);
    expect(saved).toMatchObject({ name: "Verified room", memberIds: [chief.id, second.id], bulletin: "Verified short brief ✓", section: "Room verification" });
    evidence.push({ saved });
    await tool("create_room", { name: "Forbidden room", member_bot_ids: [foreign.id] }, true);
    await tool("manage_room", { room_id: room.id, action: "add_members", member_bot_ids: [foreign.id] }, true);
    expect((await rooms()).find((candidate) => candidate.id === room.id)).toEqual(saved);
    expect((await rooms()).some((candidate) => candidate.name === "Forbidden room")).toBe(false);
    await control(["messages", "--channel", room.id, "--limit", "10"]);
    await control(["interrupt", "--bot", chief.id]);
    await tool("manage_room", { room_id: room.id, action: "rename", name: "Expired turn" }, true);
    expect((await rooms()).find((candidate) => candidate.id === room.id)?.name).toBe("Verified room");
  } finally {
    for (const proxy of proxies) await waitForExit(proxy, { signal: "SIGTERM" });
    await fixture.close();
    const evidencePath = `${fixture.info.logPath}.chief-rooms.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    expect(existsSync(fixture.info.dataDir)).toBe(false);
    console.info(JSON.stringify({ ...fixture.info, evidencePath, fixtureRemoved: true, exitCode: fixture.child.exitCode }));
  }
}, 60_000);

// A small stand-in for agent-browser in My Chrome tests: the page tools a bot
// replays a shown path with (open, snapshot, click, fill, press, get_text),
// spoken as raw DevTools to the gate (My Chrome) or straight to a test
// Chrome's own browser context (the bot's own browser, in the background).
// Elements are addressed by @eN refs from the last snapshot, like the engine.
import { CdpClient } from "./cdp-client.ts";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: true };

const ROLES = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "menuitem", "tab", "option", "switch", "heading"]);

export class FakeEngine {
  private readonly cdp: CdpClient;
  private readonly browserContextId: string | undefined;
  private sessionId = "";
  private refs = new Map<string, { role: string; name: string; backendNodeId: number }>();

  private constructor(cdp: CdpClient, browserContextId?: string) {
    this.cdp = cdp;
    this.browserContextId = browserContextId;
  }

  /** Through the gate (My Chrome), or, with ownContext, in a fresh context of
   * a test Chrome (the bot's own browser: nothing of the person's). */
  static async connect(url: string, options: { ownContext?: boolean } = {}): Promise<FakeEngine> {
    const cdp = await CdpClient.connect(url);
    let context: string | undefined;
    if (options.ownContext) context = String((await cdp.send("Target.createBrowserContext", {})).browserContextId);
    return new FakeEngine(cdp, context);
  }

  get events() { return this.cdp.events; }

  private async tab(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const { targetId } = await this.cdp.send("Target.createTarget", { url: "about:blank", ...(this.browserContextId ? { browserContextId: this.browserContextId } : {}) });
    const { sessionId } = await this.cdp.send("Target.attachToTarget", { targetId, flatten: true });
    this.sessionId = String(sessionId);
    await this.cdp.send("Page.enable", {}, this.sessionId);
    await this.cdp.send("Runtime.enable", {}, this.sessionId);
    return this.sessionId;
  }

  private async settle(): Promise<void> {
    const session = await this.tab();
    const end = Date.now() + 10_000;
    await new Promise((resolve) => setTimeout(resolve, 150));
    while (Date.now() < end) {
      const state = await this.cdp.evaluate<string>(session, "document.readyState").catch(() => "");
      if (state === "complete") return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private node(ref: unknown): number {
    const match = /^@?(e\d+)$/.exec(String(ref ?? "").trim());
    const info = match ? this.refs.get(match[1]!) : undefined;
    if (!info) throw new Error(`unknown ref ${String(ref)}`);
    return info.backendNodeId;
  }

  /** One tool call, as the bot's runtime would make it. */
  async run(params: unknown): Promise<ToolResult> {
    const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };
    const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }] });
    try {
      const session = await this.tab();
      switch (name) {
        case "agent_browser_open":
          await this.cdp.send("Page.navigate", { url: String(args.url) }, session);
          await this.settle();
          return text(`opened ${String(args.url)}`);
        case "agent_browser_snapshot": {
          const tree = await this.cdp.send("Accessibility.getFullAXTree", {}, session) as { nodes?: Array<{ ignored?: boolean; role?: { value?: string }; name?: { value?: string }; backendDOMNodeId?: number }> };
          this.refs = new Map();
          const lines: string[] = [];
          for (const node of tree.nodes ?? []) {
            const role = String(node.role?.value ?? "");
            if (node.ignored || !ROLES.has(role) || typeof node.backendDOMNodeId !== "number") continue;
            const ref = `e${this.refs.size + 1}`;
            const label = String(node.name?.value ?? "");
            this.refs.set(ref, { role, name: label, backendNodeId: node.backendDOMNodeId });
            lines.push(`- ${role} "${label.replace(/"/g, "\\\"")}" [ref=${ref}]`);
          }
          return text(lines.join("\n"));
        }
        case "agent_browser_click": {
          const backendNodeId = this.node(args.selector);
          await this.cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }, session).catch(() => undefined);
          const box = await this.cdp.send("DOM.getBoxModel", { backendNodeId }, session) as { model: { content: number[] } };
          const quad = box.model.content;
          const x = (quad[0]! + quad[4]!) / 2;
          const y = (quad[1]! + quad[5]!) / 2;
          await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, session);
          await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, session);
          await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, session);
          await this.settle();
          return text("clicked");
        }
        case "agent_browser_fill": {
          const backendNodeId = this.node(args.selector);
          await this.cdp.send("DOM.focus", { backendNodeId }, session);
          const { object } = await this.cdp.send("DOM.resolveNode", { backendNodeId }, session) as { object: { objectId: string } };
          await this.cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function () { this.value = ''; }" }, session);
          await this.cdp.send("Input.insertText", { text: String(args.text ?? "") }, session);
          return text("filled");
        }
        case "agent_browser_select": {
          const backendNodeId = this.node(args.selector);
          const { object } = await this.cdp.send("DOM.resolveNode", { backendNodeId }, session) as { object: { objectId: string } };
          await this.cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function (label) { const option = Array.from(this.options).find((o) => o.label === label || o.value === label); if (option) this.value = option.value; this.dispatchEvent(new Event('change', { bubbles: true })); }", arguments: [{ value: String(args.value ?? "") }] }, session);
          return text("selected");
        }
        case "agent_browser_press": {
          const key = String(args.key ?? "Enter");
          const code = key === "Escape" ? 27 : 13;
          await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, ...(key === "Enter" ? { text: "\r" } : {}) }, session);
          await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code }, session);
          await this.settle();
          return text("pressed");
        }
        case "agent_browser_get_url":
          return text(await this.cdp.evaluate<string>(session, "location.href"));
        case "agent_browser_get_text":
          return text(await this.cdp.evaluate<string>(session, `document.querySelector(${JSON.stringify(String(args.selector ?? "body"))})?.innerText ?? ""`));
        default:
          return { content: [{ type: "text", text: `fake engine: ${name} not supported` }], isError: true };
      }
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  }

  close(): void {
    this.cdp.close();
  }
}

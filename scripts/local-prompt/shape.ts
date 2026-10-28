// What one model request is made of (#1276): system prompt, tool definitions
// and messages, in characters and estimated tokens. The estimate is one token
// per 3.5 characters, close to what Qwen and Claude tokenizers give for this
// mix of English prose and JSON schemas; it is a budget, not a bill.

export const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

interface MessagesRequest {
  system?: string | Array<{ type?: string; text?: string }>;
  tools?: Array<{ name: string }>;
  messages?: unknown[];
}

export interface PromptShape {
  chars: { system: number; tools: number; messages: number };
  tokens: { system: number; tools: number; messages: number; total: number };
  toolCount: number;
  /** Tool definitions per MCP server (`builtin` for the engine's own). */
  toolsByServer: Record<string, { count: number; tokens: number }>;
}

export function systemText(request: MessagesRequest): string {
  if (typeof request.system === "string") return request.system;
  return (request.system ?? []).map((block) => block.text ?? "").join("\n");
}

export function promptShape(request: MessagesRequest): PromptShape {
  const system = systemText(request).length;
  const tools = JSON.stringify(request.tools ?? []).length;
  const messages = JSON.stringify(request.messages ?? []).length;
  const toolsByServer: PromptShape["toolsByServer"] = {};
  for (const tool of request.tools ?? []) {
    const server = tool.name.startsWith("mcp__") ? tool.name.split("__")[1]! : "builtin";
    const entry = toolsByServer[server] ??= { count: 0, tokens: 0 };
    entry.count += 1;
    entry.tokens += estimateTokens(JSON.stringify(tool).length);
  }
  const tokens = { system: estimateTokens(system), tools: estimateTokens(tools), messages: estimateTokens(messages) };
  return {
    chars: { system, tools, messages },
    tokens: { ...tokens, total: tokens.system + tokens.tools + tokens.messages },
    toolCount: request.tools?.length ?? 0,
    toolsByServer,
  };
}

function common(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

/** How many leading characters two requests share in their system prompt
 * and in their tool definitions: the part a prefix cache reuses when a new
 * conversation starts (a local model's template puts both before the first
 * message). */
export function sharedPrefix(a: MessagesRequest, b: MessagesRequest): { system: number; tools: number; identical: boolean; tokens: number } {
  const systemA = systemText(a), systemB = systemText(b);
  const toolsA = JSON.stringify(a.tools ?? []), toolsB = JSON.stringify(b.tools ?? []);
  const system = common(systemA, systemB);
  const identical = systemA === systemB && toolsA === toolsB;
  const tools = systemA === systemB ? common(toolsA, toolsB) : 0;
  return { system, tools, identical, tokens: estimateTokens(system + tools) };
}

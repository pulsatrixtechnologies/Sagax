// Azure AI Foundry and Azure OpenAI behind the OpenAI-compatible engine.
//
// An Azure resource is reached at https://<resource>.openai.azure.com,
// https://<resource>.services.ai.azure.com (Foundry) or
// https://<resource>.cognitiveservices.azure.com. Its OpenAI v1 API
// (/openai/v1: chat/completions, responses) takes the deployment name as
// `model`. Its /openai/v1/models lists the base models the region offers
// (hundreds of them, most not deployed), not what the resource can run: the
// resource's own list is its deployments, GET /openai/deployments with the
// 2022-12-01 api-version, each row the deployment name (`id`) and the model
// under it (`model`). The key goes in the `api-key` header, which every one
// of these routes takes.

/** The api-version whose data plane still lists a resource's deployments. */
export const AZURE_DEPLOYMENTS_API_VERSION = "2022-12-01";

const RESOURCE_HOST = /^[a-z0-9][a-z0-9-]{0,62}\.(?:openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/i;

export interface AzureOpenAIEndpoint {
  /** https://<resource>.<family>, no path. */
  origin: string;
  /** The OpenAI v1 base the chat engine calls. */
  v1: string;
  /** GET this with the `api-key` header for the resource's deployments. */
  deployments: string;
}

function parse(url: string | null | undefined): URL | null {
  const text = url?.trim();
  if (!text) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/** The Azure resource a URL points at, whatever was pasted: the resource
 * root, its /openai/v1 base, a Foundry project URL or a full deployment
 * route with ?api-version. Null for any other host. */
export function azureOpenAIEndpoint(url: string | null | undefined): AzureOpenAIEndpoint | null {
  const parsed = parse(url);
  if (!parsed || parsed.protocol !== "https:" || !RESOURCE_HOST.test(parsed.hostname)) return null;
  const origin = `https://${parsed.hostname.toLowerCase()}`;
  return {
    origin,
    v1: `${origin}/openai/v1`,
    deployments: `${origin}/openai/deployments?api-version=${AZURE_DEPLOYMENTS_API_VERSION}`,
  };
}

/** A Microsoft Azure address that is not a resource endpoint (the portal,
 * ai.azure.com, a typo in the family): the person meant Azure, the URL is
 * wrong. */
export function looksLikeAzureUrl(url: string | null | undefined): boolean {
  const parsed = parse(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return host === "azure.com" || host.endsWith(".azure.com") || host.endsWith(".azure.net");
}

/** Models a deployment can hold that are no conversation model: embeddings,
 * speech, transcription, images, video, moderation. Everything else is kept,
 * and so is a deployment whose model Azure does not name. */
export function isAzureNonChatModel(model: string): boolean {
  return /(embedding|whisper|tts|transcribe|dall-e|gpt-image|image|sora|realtime|audio|moderation|davinci|babbage|ada-\d|ada$)/i.test(model);
}

export interface AzureDeployment {
  /** The deployment name: what a request sends as `model`. */
  id: string;
  /** The model deployed under it, when Azure says. */
  model?: string;
}

/** The deployments a GET /openai/deployments body lists, ready to run:
 * succeeded (or no status), a conversation model or an unknown one. */
export function azureDeployments(body: unknown): AzureDeployment[] {
  const rows = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
    ? (body as { data: unknown[] }).data
    : [];
  const out: AzureDeployment[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { id, model, status } = row as { id?: unknown; model?: unknown; status?: unknown };
    if (typeof id !== "string" || !id.trim() || id.length > 200 || seen.has(id)) continue;
    if (typeof status === "string" && status && status !== "succeeded") continue;
    const underlying = typeof model === "string" && model.trim() ? model.trim() : undefined;
    if (underlying && isAzureNonChatModel(underlying)) continue;
    seen.add(id);
    out.push({ id, ...(underlying ? { model: underlying } : {}) });
  }
  return out;
}

/** The picker label of a deployment: its name, and the model under it when
 * the name does not already say it ("support-bot (gpt-4.1)"). */
export function azureDeploymentLabel(deployment: AzureDeployment): string {
  const { id, model } = deployment;
  if (!model || id.toLowerCase().includes(model.toLowerCase())) return id;
  return `${id} (${model})`;
}

/** Why an OpenAI-compatible endpoint lists no model, in a word the picker
 * turns into a sentence (model.listIssue.*). */
export type ModelListIssue =
  | "key-refused"
  | "bad-url"
  | "unreachable"
  | "azure-bad-url"
  | "azure-no-deployments";

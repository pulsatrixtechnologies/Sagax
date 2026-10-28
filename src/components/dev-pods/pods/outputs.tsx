// Outputs: the artifacts this conversation saved and the files the bot
// attached. An artifact opens on its own; a file shows the reply that
// carries it, where the gallery opens or saves it.
import { useEffect, useState } from "react";
import { AppWindow, FileOutput, FileText, Image as ImageIcon, Music } from "lucide-react";
import { t } from "@/lib/i18n";
import { openArtifact } from "@/lib/artifact-events";
import { fetchBotArtifacts } from "@/lib/artifacts";
import { registerDevPod, type DevPodContext, type DevPodData } from "../registry";
import { conversationOutputs, type DevOutput } from "../sources";

const KIND_ICON = { image: ImageIcon, file: FileText, audio: Music, artifact: AppWindow } as const;

/** The conversation's artifacts plus the files its replies carry. The files
 * show at once; the artifacts join them once the list loads, and stay out
 * when it fails (a failed list is not an empty one). */
function useOutputs(ctx: DevPodContext): DevPodData<DevOutput[]> {
  const [artifacts, setArtifacts] = useState<Awaited<ReturnType<typeof fetchBotArtifacts>> | null>(null);
  useEffect(() => {
    let live = true;
    fetchBotArtifacts(ctx.bot.id)
      .then((list) => { if (live) setArtifacts(list); })
      .catch(() => { if (live) setArtifacts([]); });
    return () => { live = false; };
  }, [ctx.bot.id, ctx.bot.threadId]);
  const outputs = conversationOutputs(artifacts ?? [], ctx.messages, ctx.bot.threadId);
  return outputs.length ? { status: "ready", data: outputs } : { status: "empty" };
}

function OutputsBody({ data, ctx }: { data: DevOutput[]; ctx: DevPodContext }) {
  const open = (output: DevOutput) => {
    if (output.artifactId) openArtifact({ botId: ctx.bot.id, artifactId: output.artifactId, title: output.name });
    else ctx.dispatch({ type: "focusMessage", threadId: ctx.bot.threadId, messageId: output.messageId });
  };
  return (
    <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
      {data.map((output) => {
        const Icon = KIND_ICON[output.kind];
        return (
          <li key={output.key} data-output={output.name} data-output-kind={output.kind}>
            <button
              type="button"
              onClick={() => open(output)}
              title={t("devPods.outputs.open", { name: output.name })}
              className="-mx-1 flex min-h-[28px] w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 text-left hover:bg-hover"
            >
              <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-secondary" />
              <span className="min-w-0 flex-1 truncate text-ink">{output.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

registerDevPod<DevOutput[]>({
  id: "outputs",
  order: 40,
  title: () => t("devPods.outputs.title"),
  icon: FileOutput,
  collapsible: true,
  useData: (ctx) => useOutputs(ctx),
  Body: OutputsBody,
});

// Outputs: the files the bot attached in this conversation. A click shows
// the reply that carries it, where the gallery opens or saves it.
import { useMemo } from "react";
import { FileOutput, FileText, Image as ImageIcon, Music } from "lucide-react";
import { t } from "@/lib/i18n";
import { registerDevPod, type DevPodContext } from "../registry";
import { devOutputs, type DevOutput } from "../sources";

const KIND_ICON = { image: ImageIcon, file: FileText, audio: Music } as const;

function OutputsBody({ data, ctx }: { data: DevOutput[]; ctx: DevPodContext }) {
  return (
    <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
      {data.map((output) => {
        const Icon = KIND_ICON[output.kind];
        return (
          <li key={output.key} data-output={output.name}>
            <button
              type="button"
              onClick={() => ctx.dispatch({ type: "focusMessage", threadId: ctx.bot.threadId, messageId: output.messageId })}
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
  useData: (ctx) => {
    const outputs = useMemo(() => devOutputs(ctx.messages), [ctx.messages]);
    return outputs.length ? { status: "ready", data: outputs } : { status: "empty" };
  },
  Body: OutputsBody,
});

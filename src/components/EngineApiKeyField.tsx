// A masked access key on a provider card. The server stores it and answers
// only whether one is saved. The value never goes into a data attribute,
// a log line, or local storage.
import { useEffect, useState } from "react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";

export function EngineApiKeyField({ instanceId }: { instanceId: string }) {
  const { refreshInstances } = useStore();
  const [value, setValue] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState<"load" | "save" | "clear" | null>("load");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api(`/api/instances/${encodeURIComponent(instanceId)}/api-key`, { signal: controller.signal })
      .then(({ configured: saved }: { configured: boolean }) => {
        if (controller.signal.aborted) return;
        setConfigured(Boolean(saved));
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : t("engineSetup.apiKey.saveFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy((current) => (current === "load" ? null : current));
      });
    return () => controller.abort();
  }, [instanceId]);

  const send = async (key: string) => {
    setBusy(key ? "save" : "clear");
    setError(null);
    setNotice(null);
    try {
      const { configured: saved }: { configured: boolean } = await api(
        `/api/instances/${encodeURIComponent(instanceId)}/api-key`,
        { method: "POST", body: JSON.stringify({ key }) },
      );
      setConfigured(Boolean(saved));
      setValue("");
      setNotice(t(saved ? "engineSetup.apiKey.saved" : "engineSetup.apiKey.cleared"));
      await refreshInstances().catch(() => {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("engineSetup.apiKey.saveFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 space-y-2" data-engine-api-key={instanceId}>
      <label className="block text-[12px] font-medium text-ink" htmlFor={`engine-key-${instanceId}`}>
        {t("engineSetup.apiKey.field")}
      </label>
      <input
        id={`engine-key-${instanceId}`}
        type="password"
        name="access-key"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("engineSetup.apiKey.placeholder")}
        className="w-full rounded-lg border border-hairline bg-inset px-3 py-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary focus-visible:ring-2 focus-visible:ring-accent"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || value.trim().length === 0}
          onClick={() => void send(value)}
          className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-50"
        >
          {busy === "save" ? t("engineSetup.apiKey.saving") : t("engineSetup.apiKey.save")}
        </button>
        {configured && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void send("")}
            className="rounded-lg bg-control px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50"
          >
            {busy === "clear" ? t("engineSetup.apiKey.saving") : t("engineSetup.apiKey.clear")}
          </button>
        )}
      </div>
      {notice && <p role="status" className="text-[12px] text-success">{notice}</p>}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

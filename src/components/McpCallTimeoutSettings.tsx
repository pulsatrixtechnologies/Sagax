import { useEffect, useRef, useState } from "react";

import {
  MAX_MCP_CALL_TIMEOUT_MINUTES,
  MIN_MCP_CALL_TIMEOUT_MINUTES,
  mcpCallTimeoutMinutes,
  parseMcpCallTimeoutMinutes,
} from "@/lib/mcp-call-timeout";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { DescribedRow, UnitField } from "./SettingsPrimitives";

export function McpCallTimeoutSettings() {
  const { state, dispatch } = useStore();
  const confirmedMinutes = mcpCallTimeoutMinutes(state.config);
  const [value, setValue] = useState(String(confirmedMinutes));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);

  useEffect(() => {
    if (!dirty) setValue(String(confirmedMinutes));
  }, [confirmedMinutes, dirty]);

  const save = async () => {
    if (!dirty || saveInFlight.current) return;
    const parsed = parseMcpCallTimeoutMinutes(value);
    if (!parsed.ok) {
      setError(t("settings.mcpCalls.range"));
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ mcp: { callTimeoutMinutes: parsed.minutes } }),
      });
      dispatch({ type: "configStatus", config });
      setValue(String(mcpCallTimeoutMinutes(config)));
      setDirty(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.mcpCalls.error"));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  // 0.5.6 (JC): one Grok-style row, label and a short grey line at the
  // left, the minutes at the right; the range shows only when refused.
  return (
    <div data-settings-card="organization.mcpCalls">
      <DescribedRow
        label={t("settings.mcpCalls.title")}
        rowId="organization.mcpCalls"
        description={error
          ? <span id="mcp-call-timeout-error" role="alert" className="text-danger">{error}</span>
          : t("settings.mcpCalls.subtitle")}
      >
        <UnitField
          id="mcp-call-timeout"
          value={value}
          unit={t("settings.mcpCalls.minutes")}
          label={t("settings.mcpCalls.title")}
          min={MIN_MCP_CALL_TIMEOUT_MINUTES}
          max={MAX_MCP_CALL_TIMEOUT_MINUTES}
          disabled={saving}
          invalid={Boolean(error)}
          describedBy={error ? "mcp-call-timeout-error" : undefined}
          onChange={(next) => {
            setValue(next);
            setDirty(true);
            setError("");
          }}
          onCommit={() => void save()}
        />
      </DescribedRow>
    </div>
  );
}

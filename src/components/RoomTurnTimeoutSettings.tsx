import { useEffect, useRef, useState } from "react";

import {
  MAX_ROOM_TURN_TIMEOUT_MINUTES,
  MIN_ROOM_TURN_TIMEOUT_MINUTES,
  parseRoomTurnTimeoutMinutes,
} from "@/lib/room-turn-timeout";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { DescribedRow, UnitField } from "./SettingsPrimitives";

export function RoomTurnTimeoutSettings() {
  const { state, dispatch } = useStore();
  const confirmedMinutes = state.config?.rooms.turnTimeoutMinutes ?? 5;
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
    const parsed = parseRoomTurnTimeoutMinutes(value);
    if (!parsed.ok) {
      // Both rejection branches mean the same thing — out of range — so the
      // sentence comes from the catalog. The parser stays pure and keeps its
      // own English copy for its unit test.
      setError(t("settings.roomTurns.range"));
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ rooms: { turnTimeoutMinutes: parsed.minutes } }),
      });
      dispatch({ type: "configStatus", config });
      setValue(String(config.rooms.turnTimeoutMinutes));
      setDirty(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.roomTurns.error"));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  // 0.5.6 (JC): one Grok-style row, label and a short grey line at the
  // left, the minutes at the right; the range shows only when refused.
  return (
    <div data-settings-card="organization.roomTurns">
      <DescribedRow
        label={t("settings.roomTurns.title")}
        rowId="organization.roomTurns"
        description={error
          ? <span id="room-turn-timeout-error" role="alert" className="text-danger">{error}</span>
          : t("settings.roomTurns.subtitle")}
      >
        <UnitField
          id="room-turn-timeout"
          value={value}
          unit={t("settings.roomTurns.minutes")}
          label={t("settings.roomTurns.title")}
          min={MIN_ROOM_TURN_TIMEOUT_MINUTES}
          max={MAX_ROOM_TURN_TIMEOUT_MINUTES}
          disabled={saving}
          invalid={Boolean(error)}
          describedBy={error ? "room-turn-timeout-error" : undefined}
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

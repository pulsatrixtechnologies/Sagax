// The gamertag line under the person's name in the sidebar footer: a trophy
// and their total points ("1 240", grouped the way their language writes
// numbers). Clicking it opens Settings > Achievements. Hidden when the
// person turned it off, and on a server without achievements.
import { useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { useAchievements } from "@/lib/achievements";
import { t } from "@/lib/i18n";
import { formatPoints } from "./AchievementsPage";
import "./achievements.css";

/** What the line says, or null when it should not show. */
export function gamertagText(input: { status: string; points?: number; showPoints?: boolean }): string | null {
  if (input.status !== "ready" || input.points === undefined || input.showPoints === false) return null;
  return formatPoints(input.points);
}

export function Gamertag({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const { status, snapshot } = useAchievements();
  const text = gamertagText({ status, points: snapshot?.points, showPoints: snapshot?.settings.showPoints });
  // the trophy pops when the total grows
  const last = useRef(snapshot?.points);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    const points = snapshot?.points;
    if (points !== undefined && last.current !== undefined && points > last.current) {
      setBump(true);
      const timer = setTimeout(() => setBump(false), 700);
      last.current = points;
      return () => clearTimeout(timer);
    }
    last.current = points;
  }, [snapshot?.points]);
  if (text === null || !snapshot) return null;
  const label = t("achievements.gamertag.label", { points: text, level: snapshot.level.level });
  return (
    <button
      type="button"
      className={`achievement-gamertag ${className ?? ""}`}
      data-gamertag=""
      data-bump={bump ? "" : undefined}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <Trophy size={11} strokeWidth={2.4} aria-hidden="true" />
      <span>{text}</span>
    </button>
  );
}

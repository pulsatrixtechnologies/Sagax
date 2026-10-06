// The points pill under the person's name in the sidebar: a trophy and their
// total ("1 240", grouped the way their language writes numbers). Clicking
// it opens their achievement card. Hidden when the person turned points off,
// and on a server without achievements.
import { useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { useAchievements } from "@/lib/achievements";
import { t } from "@/lib/i18n";
import { formatPoints } from "./AchievementsPage";
import "./achievements.css";

/** What the points pill says, or null when it should not show. */
export function gamertagText(input: { status: string; points?: number; showPoints?: boolean }): string | null {
  if (input.status !== "ready" || input.points === undefined || input.showPoints === false) return null;
  return formatPoints(input.points);
}

/** Trophy and the point total. The same pill on your row and a colleague's. */
export function PointsPill({ text, label, onOpen, className, bump = false, iconSize = 11, footer = false }: {
  text: string;
  label: string;
  onOpen: () => void;
  className?: string;
  bump?: boolean;
  iconSize?: number;
  /** Account footer: a step larger than a colleague's pill. */
  footer?: boolean;
}) {
  return (
    <button
      type="button"
      className={`achievement-gamertag shrink-0 ${className ?? ""}`}
      data-gamertag=""
      data-footer={footer ? "" : undefined}
      data-bump={bump ? "" : undefined}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <Trophy size={iconSize} strokeWidth={2.4} aria-hidden="true" />
      <span>{text}</span>
    </button>
  );
}

export function Gamertag({ onOpen, className, iconSize, footer = false }: { onOpen: () => void; className?: string; iconSize?: number; footer?: boolean }) {
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
  return <PointsPill text={text} label={label} onOpen={onOpen} className={className} bump={bump} iconSize={iconSize} footer={footer} />;
}

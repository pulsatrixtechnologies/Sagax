// The bot settings dialog's section rail — one entry per BotSettingsSection,
// in the fixed order the rail renders them. Search filters against label
// plus keywords, the same convention as the app SettingsModal's SECTIONS.
// "slack" is listed here but shown only when the server offers a link to the
// organisation's Admin (BotSettingsDialog filters it out otherwise), and
// "visibility" only to an admin in a browser (never in the desktop app), and
// "sharing" only on a server signed in with Perspicax, where it replaces
// "visibility"; "perspicax" (the MCP profiles the bot offers) only there too.
// Works on is not a row: it is the control at the top of the Computer tab.
import {
  BookOpen,
  Brain,
  CalendarClock,
  Coins,
  Cpu,
  Eye,
  History,
  LayoutDashboard,
  type LucideIcon,
  Mic,
  Network,
  Plug,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Slack } from "../brand-icons";

import type { BotSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";

/** `labelKey`, when present, is the translated label (read at render time);
 * `label` stays the English fallback and search text. */
export const BOT_SECTIONS: Array<{
  id: BotSettingsSection;
  label: string;
  labelKey?: LocaleKey;
  icon: LucideIcon;
  keywords: string[];
}> = [
  { id: "overview", label: "Overview", labelKey: "botSettings.nav.overview", icon: LayoutDashboard, keywords: ["summary", "status", "what it does", "won't", "prompt", "what the model sees"] },
  { id: "slack", label: "Slack", icon: Slack, keywords: ["slack", "slack app", "admin", "message", "direct messages", "mentions"] },
  { id: "soul", label: "Soul", labelKey: "botSettings.nav.soul", icon: Sparkles, keywords: ["standing instructions", "instructions", "persona", "rules", "soul.md"] },
  { id: "skills", label: "Skills", icon: BookOpen, keywords: ["skills", "learned", "procedures", "teach"] },
  { id: "memory", label: "Memory", labelKey: "botSettings.nav.memory", icon: Brain, keywords: ["memory", "notes", "remember", "topics"] },
  { id: "routines", label: "Routines", labelKey: "botSettings.nav.routines", icon: CalendarClock, keywords: ["schedule", "routines", "cron", "tasks"] },
  { id: "access", label: "Access", labelKey: "botSettings.nav.access", icon: Network, keywords: ["computer", "vm", "cloud", "vps", "folder", "workspace", "browser", "connected apps", "composio", "webhooks", "always allow", "grants", "tool selection", "tools", "mcp", "allow", "exclude"] },
  { id: "model", label: "Model", labelKey: "botSettings.nav.model", icon: Cpu, keywords: ["engine", "model", "provider", "cli", "effort"] },
  { id: "permissions", label: "Permissions", labelKey: "botSettings.nav.permissions", icon: ShieldCheck, keywords: ["auto mode", "approve", "auto approve", "review", "routine approvals", "peers", "contact", "coordination", "chief of staff", "section"] },
  { id: "voice", label: "Voice & alerts", labelKey: "botSettings.nav.voice", icon: Mic, keywords: ["voice", "alerts", "notifications", "speak"] },
  { id: "visibility", label: "Who can see it", labelKey: "botSettings.visibility.title", icon: Eye, keywords: ["visibility", "who can see", "private", "people", "admins", "members", "access", "hide"] },
  { id: "sharing", label: "Shared with", labelKey: "botSettings.sharing.title", icon: Users, keywords: ["share", "sharing", "people", "grant", "who can use", "members", "directory"] },
  { id: "perspicax", label: "Perspicax Profiles", labelKey: "botSettings.perspicax.title", icon: Plug, keywords: ["perspicax", "mcp", "profile", "profiles", "tools", "connectwise"] },
  { id: "history", label: "History", labelKey: "botSettings.nav.history", icon: History, keywords: ["history", "changes", "undo", "rollback", "log"] },
  { id: "usage", label: "Usage", labelKey: "botSettings.nav.usage", icon: Coins, keywords: ["tokens", "cost", "billing"] },
];

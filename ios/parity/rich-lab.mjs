// The rich content lab (PARITY_RICH=1 in fixture-server.mjs), for the WP14
// UI tests (ios/UITests/RichContentUITests.swift). Off by default: nothing
// of the reference dataset changes without it.
//
// Pass one creates a "Rich Lab" bot through the API. Between the passes its
// transcript is written straight into the store, like the reference
// transcripts: an ask, the shell steps of a run (two through the control
// CLI, so the run card shows), then one reply per rich block the desktop
// draws (code, table, CSV, charts, mermaid, email, callouts, spoilers,
// footnotes, pictures), and the turn's digest with the credentials an
// organization server would name.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const RICH_LAB = process.env.PARITY_RICH === "1";
export const RICH_LAB_BOT = "Rich Lab";

const lab = { bot: null };

export async function seedRichLabBot(base, api) {
  const { bot } = await api(base, "POST", "/api/bots", {
    name: RICH_LAB_BOT,
    title: "Laboratoire de contenu riche",
    modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
  });
  await api(base, "PATCH", `/api/bots/${bot.id}`, { color: "teal" });
  lab.bot = { id: bot.id, threadId: bot.threadId };
  return lab.bot;
}

const LONG_CODE = Array.from({ length: 36 }, (_unused, index) => `print("ligne ${index + 1}")`).join("\n");

const TABLE = [
  "| Poste | Montant | Note |",
  "| --- | --- | :-: |",
  ...["Loyer,1200,a", "Logiciels,340,b", "Matériel,2 450,c", "Formation,90,d", "Déplacements,610,e",
    "Repas,75,f", "Publicité,1 020,g", "Assurance,410,h", "Divers,15,i"].map((row) => {
    const [name, amount, note] = row.split(",");
    return `| ${name} | ${amount} | ${note} |`;
  }),
].join("\n");

const CSV = "région,ventes,coût\nNord,120,80\nSud,95,70\nEst,140,\"1,100\"";

const CHART = "type: bar\ntitle: Ventes par trimestre\ntrimestre,2025,2026\nT1,120,140\nT2,95,130\nT3,160,170\nT4,180,210";

const CHART_JSON = JSON.stringify({ type: "donut", title: "Répartition", labels: ["Courriel", "Téléphone", "Clavardage"], series: [{ name: "Billets", data: [42, 31, 27] }] });

const EMAIL = "To: Ana <ana@example.com>, bo@example.com\nCc: sam@example.com\nSubject: Renouvellement T3\n\nBonjour Ana,\n\n**Merci** pour l'appel.\n\n- Point un\n- Point deux";

const MERMAID = "graph TD\n  A[Demande] --> B{Approuvée?}\n  B -->|Oui| C[Déployer]\n  B -->|Non| D[Réviser]";

export function seedRichLabTranscript(dataDir, png) {
  if (!lab.bot) return;
  const attachments = join(dataDir, "attachments");
  mkdirSync(attachments, { recursive: true });
  const swatch = join(attachments, "rich-lab-swatch.png");
  writeFileSync(swatch, png(160, 120, [40, 140, 200]));

  const db = new DatabaseSync(join(dataDir, "messages.db"));
  const insert = db.prepare(
    "INSERT OR REPLACE INTO messages (thread_id, id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const leaf = db.prepare("INSERT OR REPLACE INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?)");
  db.prepare("DELETE FROM messages WHERE thread_id = ?").run(lab.bot.threadId);
  const now = Date.now();
  // an inline raster data: image (drawn by the fixture's own PNG writer)
  const DATA_PNG = `data:image/png;base64,${Buffer.from(png(24, 24, [220, 60, 60])).toString("base64")}`;
  // each reply is its own settled turn, so none folds into a "worked" row
  const turn = { turnTerminal: true, turnSucceeded: true };
  const records = [
    { id: "rich-ask", role: "user", kind: "text", text: "Prépare le rapport riche de remplacement." },
    { id: "rich-step-1", role: "bot", kind: "activity", text: "", tool: { name: "Bash", ok: true, summary: "pnpm control:omb doctor --url http://127.0.0.1:8799" } },
    { id: "rich-step-2", role: "bot", kind: "activity", text: "", tool: { name: "Bash", ok: true, summary: "git status" } },
    { id: "rich-step-3", role: "bot", kind: "activity", text: "", tool: { name: "Bash", ok: false, summary: "pnpm control:omb send --bot x --text y" } },
    { id: "rich-step-4", role: "bot", kind: "activity", text: "", tool: { name: "Bash", ok: true, summary: "git push origin main" } },
    { id: "rich-mermaid", role: "bot", kind: "text", text: `Le flux :\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\``, ...turn },
    { id: "rich-widget", role: "bot", kind: "text", text: "Un compteur :\n\n```widget\n<button id=b onclick=\"this.textContent='Cliqué'\">Compteur</button>\n```", ...turn },
    { id: "rich-code", role: "bot", kind: "text", text: `Le script :\n\n\`\`\`python\n${LONG_CODE}\n\`\`\``, ...turn },
    { id: "rich-table", role: "bot", kind: "text", text: `Le budget :\n\n${TABLE}`, ...turn },
    { id: "rich-csv", role: "bot", kind: "text", text: `Les ventes :\n\n\`\`\`csv\n${CSV}\n\`\`\``, ...turn },
    { id: "rich-chart", role: "bot", kind: "text", text: `Le graphique :\n\n\`\`\`chart\n${CHART}\n\`\`\`\n\n\`\`\`chart\n${CHART_JSON}\n\`\`\``, ...turn },
    { id: "rich-email", role: "bot", kind: "text", text: `Le brouillon :\n\n\`\`\`email\n${EMAIL}\n\`\`\``, ...turn },
    { id: "rich-images", role: "bot", kind: "text", text: `Les images :\n\n![Pastille](${DATA_PNG})\n\n![Logo distant](https://example.com/logo.png)\n\n![Échantillon](${swatch})`, ...turn },
    { id: "rich-extras", role: "bot", kind: "text", text: [
      "> [!WARNING] Attention requise",
      "> Le serveur redémarre ce soir.",
      "",
      "> [!TIP]",
      "> Gardez une copie.",
      "",
      "La réponse est ~~quarante-deux~~ et la source est citée[^src].",
      "",
      "[^src]: Guide de remplacement, page 12.",
    ].join("\n"), ...turn },
    { id: "rich-digest", role: "bot", kind: "digest", text: "[digest] · tools: shell ×4 (1 failed) · files: changed rapport.md",
      digest: { turnId: "rich-turn", botId: lab.bot.id, threadId: lab.bot.threadId, at: now, durationMs: 4000, tools: [{ name: "shell", count: 4, failed: 1 }],
        files: { changed: ["rapport.md"], added: [], deleted: [] }, memory: [], reply: "Le rapport est prêt.", hookCoverage: "full",
        access: { via: "org-key", payer: "organization" } } },
  ];
  let parent;
  records.forEach((fields, index) => {
    if (fields.turnTerminal) fields.turnId = `turn-${fields.id}`;
    const record = { at: now - (records.length - index) * 60_000, ...fields, ...(parent ? { parentId: parent } : {}) };
    insert.run(lab.bot.threadId, record.id, record.at, record.role, record.kind, record.text ?? "", JSON.stringify(record));
    parent = record.id;
  });
  leaf.run(lab.bot.threadId, parent);
  db.close();
}

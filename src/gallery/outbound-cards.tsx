/** Isolated gallery for headless screenshots of the phone call and purchase
 * cards (src/components/OutboundCard.tsx, parité R13). Not shipped in the app.
 * ?lang=<code>&skin=<id>&only=<call|purchase|conversation> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OutboundCard } from "../components/OutboundCard";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import type { OutboundCard as OutboundCardData } from "../../shared/wire";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const row = (n: number, outbound: OutboundCardData): Message => ({ id: `m${n}`, role: "bot", kind: "text", text: "", outbound } as unknown as Message);
const CARDS: Message[] = [
  row(1, { kind: "call", id: "call_0000000000000001", status: "pending", botName: "Rocket", destination: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous de mardi.", script: "Jean confirme le rendez-vous de mardi à 10 h. Merci de rappeler au besoin.", language: "fr", callback: "+1 438 555 0199" }),
  row(2, { kind: "call", id: "call_0000000000000002", status: "done", botName: "Rocket", destination: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous de mardi.", script: "Jean confirme le rendez-vous.", via: "Chef" }),
  row(3, { kind: "purchase", id: "pay_0000000000000003", status: "pending", botName: "Rocket", merchant: "Boutique Exemple", amount: "45.20", currency: "CAD", cardLabel: "visa •••• 4242", items: [{ name: "Câble USB-C", quantity: 2, price: "10.00" }, { name: "Chargeur 65 W", quantity: 1, price: "25.20" }] }),
  row(4, { kind: "purchase", id: "pay_0000000000000004", status: "done", botName: "Rocket", merchant: "Air Exemple", amount: "812.40", currency: "CAD", cardLabel: "visa •••• 4242", orderRef: "XK7Q2P", mismatchTotal: "830.10", declared: true, flights: [{ from: "YUL", to: "YVR", date: "2026-11-02", flight: "AC 301" }, { from: "YVR", to: "YUL", date: "2026-11-09", flight: "AC 308" }] }),
];

// Conversation calls (place_phone_call mode conversation): the approval, the
// call under way, and its results (completed with the transcript open,
// voicemail, no answer).
const conversation = {
  kind: "call" as const, botName: "Rocket", destination: "+1 514 555 0142", mode: "conversation" as const, language: "fr" as const, maxMinutes: 5,
  objective: "Prendre rendez-vous pour l'entretien de la thermopompe la semaine prochaine, idéalement en matinée.",
  script: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex.",
};
const CONVERSATION: { message: Message; transcriptOpen?: boolean }[] = [
  { message: row(11, { ...conversation, id: "call_0000000000000011", status: "pending", instructions: "Rester bref et poli. Proposer mardi ou mercredi entre 8 h et 11 h. Ne donner aucune information de paiement.", voicemail: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex au sujet de l'entretien de la thermopompe. Alex vous rappellera." }) },
  { message: row(12, { ...conversation, id: "call_0000000000000012", status: "done", via: "Chef" }) },
  { message: row(13, { ...conversation, id: "call_0000000000000013", status: "done", result: {
    outcome: "completed", endedBy: "goal", durationSec: 247, endedAt: 1798000000000,
    points: ["Rendez-vous fixé mardi 4 novembre à 9 h.", "Le technicien prévoit environ une heure sur place.", "Le prix de l'entretien annuel est de 149 $ avant taxes."],
    commitments: ["Laisser l'accès au sous-sol libre le matin du rendez-vous.", "La compagnie envoie une confirmation par texto lundi."],
    transcript: [
      { speaker: "bot", text: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex. J'aimerais prendre rendez-vous pour l'entretien d'une thermopompe." },
      { speaker: "callee", text: "Oui, bonjour. J'ai de la place mardi à 9 h, est-ce que ça irait?" },
      { speaker: "bot", text: "Mardi à 9 h, c'est parfait. Combien de temps faut-il prévoir?" },
      { speaker: "callee", text: "Environ une heure. C'est 149 $ avant taxes, et on envoie une confirmation par texto lundi." },
      { speaker: "bot", text: "Merci beaucoup, bonne journée!" },
    ],
  } }), transcriptOpen: true },
  { message: row(14, { ...conversation, id: "call_0000000000000014", status: "done", result: {
    outcome: "voicemail", durationSec: 21, endedAt: 1798000000000, points: ["Message laissé dans la boîte vocale de la compagnie."], commitments: [], transcriptExpired: true,
  } }) },
  { message: row(15, { ...conversation, id: "call_0000000000000015", status: "done", result: {
    outcome: "no-answer", durationSec: 0, endedAt: 1798000000000, points: [], commitments: [],
  } }) },
  { message: row(16, { ...conversation, id: "call_0000000000000016", status: "done", result: {
    outcome: "completed", endedBy: "stop-request", doNotCallAgain: true, durationSec: 34, endedAt: 1798000000000,
    points: ["L'interlocuteur ne souhaite pas recevoir d'appels d'un assistant IA."], commitments: [],
    transcript: [{ speaker: "bot", text: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex." }, { speaker: "callee", text: "Non merci, ne rappelez plus." }],
  } }) },
];

const only = params.get("only");
const shown = [
  ...(only === "conversation" ? [] : CARDS.filter((message) => !only || message.outbound?.kind === only).map((message) => ({ message, transcriptOpen: false }))),
  ...(only && only !== "conversation" ? [] : CONVERSATION),
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="min-h-screen bg-canvas p-6 text-ink" data-gallery-panel>
      {shown.map(({ message, transcriptOpen }) => <OutboundCard key={message.id} message={message} transcriptOpen={transcriptOpen} />)}
    </main>
  </StrictMode>,
);

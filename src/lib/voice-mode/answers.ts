// Spoken answers to a permission card, shared by every call on this page
// (voice mode, the take-turns call, a room). The card is spoken as a
// question with its two options ("Allow once, or deny?") and the answer must
// pick one of them: anything else, a hedge or a sentence that merely
// contains "sure" included, is asked again, never read as consent. The
// rules live in shared/call-consent.ts (`voice` mode); the iPhone mirrors
// them in CallAnswers (ios/Sources/CompanionCore/VoiceCall/VoiceModeSettings.swift).
import { spokenConsent } from "../../../shared/call-consent";

/** "allow" (Allow once), "deny", or null: ask the options again. */
export function spokenDecision(said: string): "allow" | "deny" | null {
  return spokenConsent(said, "voice");
}

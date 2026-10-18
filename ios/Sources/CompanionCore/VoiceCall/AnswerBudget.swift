// How much of an answer a call says aloud. A port of the desktop's
// `src/lib/voice-mode/answer-budget.ts`.
//
// The bot is told the voice output contract (server/voice-call-prompt.ts:
// the verdict first, one to four short spoken sentences, at most one
// question). This is the deterministic cap: at most four sentences are said
// (a line break after words ends one too), and a question ends what is
// said, so the person answers it. The words after the cut stay in the
// chat; after the sentence cap the call says the rest is written there.
// The cut keeps a prefix of the text so far that only grows, so a sentence
// stream fed with it never starts over.
import Foundation

public enum SpokenAnswerCut: Equatable, Sendable {
    /// the sentence cap: the call says the rest is in the chat
    case length
    /// the first question ends it: the person answers
    case question
}

extension SpokenText {
    /// The most sentences a call says of one answer.
    public static let spokenSentencesMax = 4

    /// The part of an answer a call says aloud, and why it stops early
    /// (nil: said whole).
    public static func spokenAnswer(_ text: String, max: Int = spokenSentencesMax) -> (text: String, cut: SpokenAnswerCut?) {
        let spoken = Array(spokenPart(text))
        var count = 0
        var from = 0
        var i = 0
        func hasLetter(_ slice: ArraySlice<Character>) -> Bool { slice.contains { $0.isLetter } }
        while i < spoken.count {
            let ch = spoken[i]
            var marks = ""
            var end = i
            if ch == "\n" {
                end = i + 1
            } else if ".!?…".contains(ch) {
                var j = i
                while j < spoken.count, ".!?…".contains(spoken[j]) { marks.append(spoken[j]); j += 1 }
                while j < spoken.count, "\"'»)]".contains(spoken[j]) { j += 1 }
                // a boundary only before a space or the end
                if j < spoken.count && !spoken[j].isWhitespace { i = j; continue }
                end = j
                if marks == "." && SentenceStream.isAbbreviationDot(spoken, dot: i) { i = j; continue }
            } else {
                i += 1
                continue
            }
            let start = i
            i = end
            // a sentence needs words: a lone "1." or an empty line is not one
            if !hasLetter(spoken[from..<start]) { from = end; continue }
            from = end
            count += 1
            let question = marks.contains("?")
            if !question && count < max { continue }
            var keep = end
            while keep < spoken.count, spoken[keep].isWhitespace { keep += 1 }
            let rest = String(spoken[end...])
            let cut: SpokenAnswerCut? = speakableSentence(rest).isEmpty ? nil : (question ? .question : .length)
            return (String(spoken[..<keep]), cut)
        }
        return (String(spoken), nil)
    }
}

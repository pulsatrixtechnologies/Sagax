// Identifiers and file paths are never read aloud on a call. A port of the
// desktop's `shared/spoken-identifiers.ts` (same rules, same tests in
// VoiceCallTests): UUIDs, hashes, JWTs and opaque tokens, "#1234" numbers
// and "id: 42" labels go; an absolute or home path keeps its last name.
// Amounts, dates, times, phone numbers and words are untouched, and nothing
// is said in place of what was removed.
import Foundation

public enum SpokenIdentifiers {
    private static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private static let jwt = regex(#"\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}"#)
    private static let uuid = regex(#"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"#, [.caseInsensitive])
    // linear: no nested quantifier; hashLike filters the matches
    private static let hex = regex(#"\b[0-9a-f]{8,128}\b"#, [.caseInsensitive])
    private static let tokenCandidate = regex(#"(?<![A-Za-z0-9_/.-])[A-Za-z0-9][A-Za-z0-9_-]{9,}(?![A-Za-z0-9_-])"#)
    private static let hashNumber = regex(#"(^|[^\w&])#[0-9]{3,}\b"#)
    private static let labelledId = regex(#"\b(?:id|uuid|guid)\b\s*[:=#]?\s*(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+"#, [.caseInsensitive])
    private static let unixPath = regex(#"(^|[\s("'«])~?(?:/[\w.@+-]+){2,}/?"#)
    private static let windowsPath = regex(#"(^|[\s("'«])[A-Za-z]:\\(?:[\w .@+-]+\\)*([\w.@+-]+)"#)
    private static let emptyBrackets = regex(#"[(\[]\s*(?:[:#=,;-]\s*)*[)\]]"#)
    private static let spaces = regex(#"[ \t]{2,}"#)
    private static let spaceBeforeMark = regex(#"[ \t]+([.,!?;:)\]])"#)
    private static let spaceAfterOpen = regex(#"([(\[])[ \t]+"#)

    private static func replace(_ regex: NSRegularExpression, in text: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }

    /// Each match replaced by `transform(match, groups)`, last match first.
    private static func replace(_ regex: NSRegularExpression, in text: String, transform: (String, [String]) -> String) -> String {
        var result = text
        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        for match in matches.reversed() {
            guard let whole = Range(match.range, in: text) else { continue }
            var groups: [String] = []
            for index in 1..<max(1, match.numberOfRanges) {
                let range = match.range(at: index)
                groups.append(range.location == NSNotFound ? "" : (Range(range, in: text).map { String(text[$0]) } ?? ""))
            }
            guard let target = Range(match.range, in: result) else { continue }
            result.replaceSubrange(target, with: transform(String(text[whole]), groups))
        }
        return result
    }

    private static func opaque(_ token: String) -> Bool {
        let segments = token.split(whereSeparator: { $0 == "_" || $0 == "-" }).map(String.init)
        func hasDigit(_ s: String) -> Bool { s.contains(where: \.isNumber) }
        func hasLetter(_ s: String) -> Bool { s.contains(where: { $0.isASCII && $0.isLetter }) }
        if segments.contains(where: { $0.count >= 10 && hasDigit($0) && hasLetter($0) }) { return true }
        return segments.count > 1
            && segments.contains(where: { $0.count >= 6 && $0.allSatisfy(\.isNumber) })
            && segments.contains(where: hasLetter)
    }

    private static func hashLike(_ run: String) -> Bool {
        run.filter { "abcdefABCDEF".contains($0) }.count >= 2 && run.filter(\.isNumber).count >= 2
    }

    private static func lastName(_ path: String) -> String {
        path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
    }

    /// The text with identifiers removed and paths cut to their last name.
    public static func strip(_ input: String) -> String {
        if input.isEmpty { return input }
        var text = input
        text = replace(jwt, in: text, with: " ")
        // a label first, so "id: <uuid>" goes whole
        text = replace(labelledId, in: text, with: " ")
        text = replace(uuid, in: text, with: " ")
        text = replace(windowsPath, in: text) { _, groups in groups[0] + groups[1] }
        text = replace(unixPath, in: text) { whole, groups in
            let lead = groups[0]
            return lead + lastName(String(whole.dropFirst(lead.count)))
        }
        text = replace(tokenCandidate, in: text) { token, _ in opaque(token) ? " " : token }
        text = replace(hex, in: text) { run, _ in hashLike(run) ? " " : run }
        text = replace(hashNumber, in: text, with: "$1 ")
        text = replace(emptyBrackets, in: text, with: " ")
        text = replace(spaces, in: text, with: " ")
        text = replace(spaceBeforeMark, in: text, with: "$1")
        text = replace(spaceAfterOpen, in: text, with: "$1")
        return text
    }
}

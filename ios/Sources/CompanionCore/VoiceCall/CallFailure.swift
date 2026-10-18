// What a call says when the bot's turn fails. A port of the desktop's
// `src/lib/voice-mode/failure.ts`.
//
// A failed turn is an activity row named "error: <cause>" (or an "access"
// row on an organization server). The call never reads the cause: it sorts
// it into a kind with one sentence in the call's language. It waits
// `graceMs` with the bot idle after it first saw the row (the harness
// retries a call turn once after 2.5 s); a retry that answers says nothing,
// a retry that fails too is said once. Once per person's words, then
// silence. Nothing while the bot works or speaks, or a card waits.
import Foundation

public enum CallFailureKind: String, Equatable, Sendable, CaseIterable {
    case busy, limit, quota, signIn, connection, generic
}

public struct CallFailure: Sendable {
    public static let graceMs: Double = 6_000

    private static func matches(_ pattern: String, _ text: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Narrow on purpose, the same list as the desktop's failure.ts.
    private static let kinds: [(String, CallFailureKind)] = [
        (#"usage limit|(?<!rate )limit reached|limit will reset|rate limit window"#, .limit),
        (#"insufficient.?quota|\bquota\b|credit balance|out of (tokens|credits)|\bbilling\b|payment required|\b402\b"#, .quota),
        (#"\b429\b|rate.?limit|too many requests|overloaded|\b529\b|\b503\b|\bat capacity\b|over capacity|service unavailable"#, .busy),
        (#"\b40[13]\b|unauthori[sz]ed|forbidden|\bsign(ed)?[ -]?in\b|\blog(ged)?[ -]?in\b|/login|authenticat|api key|invalid.{0,20}\bkey\b|(token|session|credential|key|oauth)\S*\s+(has\s+)?expired"#, .signIn),
        (#"failed to fetch|network|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|connection (reset|refused|closed|lost|error)|timed? ?out|ETIMEDOUT|\b(HTTP|status)\s*5\d\d\b|\b50[0234]\b(?!\s*(tokens|items|ms|bytes|lines|rows))|bad gateway|internal server error"#, .connection),
    ]

    /// A client abort, the whole message (shared/client-cancel.ts): a stop, no failure.
    private static let cancellations = [
        #"^context\s+canceled\.?$"#,
        #"^(context\s+canceled)?\s*the\s+request\s+was\s+cancell?ed\s+by\s+the\s+client\.?$"#,
        #"^((the|this)\s+)?operation\s+was\s+aborted\.?$"#,
        #"^(the\s+)?request\s+was\s+aborted\.?$"#,
        #"^the\s+user\s+aborted\s+a\s+request\.?$"#,
    ]

    public static func kind(cause: String, setup: Bool = false) -> CallFailureKind {
        if setup { return .signIn }
        return kinds.first { matches($0.0, cause) }?.1 ?? .generic
    }

    /// The kind of a row that says the turn failed; nil for any other row.
    public static func rowKind(_ row: Message) -> CallFailureKind? {
        guard row.role == .bot else { return nil }
        if row.kind == .access { return .generic }
        // a stopped turn ("stopped: ...") never starts with "error:"
        guard ErrorRowRules.isError(row) else { return nil }
        let cause = ErrorRowRules.text(row)
        let body = cause.replacingOccurrences(of: #"^provider returned a( streaming)? completion error:\s*"#, with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cancellations.contains(where: { matches($0, body) }) { return nil }
        return kind(cause: cause, setup: row.tool?.setup == true)
    }

    private var seen: [String: Double] = [:]
    private var settled: Set<String>
    private var saidFor: Set<String> = []

    public init(existing: [Message] = []) {
        settled = Set(existing.map(\.id))
    }

    /// The kind to say now, or nil. Ask on every tick.
    public mutating func next(now: Double, messages: [Message], botBusy: Bool, botSpeaking: Bool, awaitingAnswer: Bool) -> CallFailureKind? {
        guard let lastUser = messages.lastIndex(where: { $0.role == .user && $0.kind == .text && $0.parallelTask == nil && $0.peerAsk == nil }) else { return nil }
        let words = messages[lastUser].id
        let after = messages[(lastUser + 1)...].filter { $0.parallelTask == nil }
        let failed = after.filter { !settled.contains($0.id) && Self.rowKind($0) != nil }
        guard let newest = failed.last else { return nil }
        for row in failed where seen[row.id] == nil { seen[row.id] = now }
        // an answer came after all (the retry worked)
        if after.contains(where: { $0.role == .bot && $0.kind == .text && !($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            for row in failed { settled.insert(row.id) }
            return nil
        }
        let open = after.contains { $0.card?.requestId != nil && $0.card?.answered == nil && $0.card?.dismissed != true }
        if botBusy || botSpeaking || awaitingAnswer || open { return nil }
        if saidFor.contains(words) {
            for row in failed { settled.insert(row.id) }
            return nil
        }
        guard now - (seen[newest.id] ?? now) >= Self.graceMs else { return nil }
        for row in failed { settled.insert(row.id) }
        saidFor.insert(words)
        return Self.rowKind(newest)
    }
}

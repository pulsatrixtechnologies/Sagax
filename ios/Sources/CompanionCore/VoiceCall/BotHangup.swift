// When a live call should leave the ear after the server says it ended.
// The same rule as src/lib/voice-mode/call-end.ts: mute at once, let a
// goodbye that is already spoken finish, then hang up. A goodbye that
// never goes quiet still ends the call.

public enum BotHangupDecision: String, Equatable, Sendable {
    case wait
    case hangup
}

public enum BotHangup {
    /// Quiet, with no goodbye started yet: wait this long for it to be enqueued.
    public static let settleMs = 2_500.0
    /// A goodbye that never goes quiet still ends the call.
    public static let capMs = 20_000.0

    public static func decide(speaking: Bool, heardSpeech: Bool, elapsedMs: Double) -> BotHangupDecision {
        if elapsedMs >= capMs { return .hangup }
        if speaking { return .wait }
        if heardSpeech { return .hangup }
        if elapsedMs < settleMs { return .wait }
        return .hangup
    }
}

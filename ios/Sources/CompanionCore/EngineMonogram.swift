// Neutral badges for model providers and connected apps (App Store 5.2).
// The app never draws a third party's official mark: an engine or an app is
// shown as one or two letters on a soft tone of our own palette, and its
// name stays in text beside it. The tones are Sagax's, never a brand colour.
import Foundation

/// The letters and the tone of one provider's badge.
public struct EngineMonogram: Equatable, Sendable {
    /// One or two letters, the first uppercase ("Cl", "Gk", "OR").
    public let letters: String
    /// An index into the app's badge tones (`EngineMonogram.toneCount`).
    public let tone: Int

    public static let toneCount = 6

    public init(letters: String, tone: Int) {
        self.letters = letters
        self.tone = ((tone % Self.toneCount) + Self.toneCount) % Self.toneCount
    }

    /// A known provider by the instance's icon preset (`icon.preset`), then
    /// by its driver kind; nil for one the table does not know.
    public init?(driverKind: String, preset: String?) {
        if let preset, let known = Self.presets[preset] {
            self = known
            return
        }
        guard let known = Self.drivers[driverKind] else { return nil }
        self = known
    }

    /// Any other name: the initials of its first two words ("Open Code" ->
    /// "OC"), else its first two letters ("linear" -> "Li"), with a tone that
    /// stays the same for the same name. Nil when the name has no letter.
    public init?(name: String) {
        guard let letters = Self.initials(name) else { return nil }
        let seed = name.lowercased().unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
        self.init(letters: letters, tone: seed)
    }

    /// "Open Code" -> "OC", "linear" -> "Li", "my-server" -> "MS", "" -> nil.
    public static func initials(_ name: String) -> String? {
        let words = name
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .filter { $0.first?.isLetter == true }
        guard let first = words.first else { return nil }
        if words.count >= 2, let second = words[1].first {
            return (String(first.prefix(1)) + String(second)).uppercased()
        }
        let two = Array(first.prefix(2))
        return String(two.prefix(1)).uppercased() + String(two.dropFirst()).lowercased()
    }

    private static let claude = EngineMonogram(letters: "Cl", tone: 0)
    private static let codex = EngineMonogram(letters: "Cx", tone: 1)
    private static let grok = EngineMonogram(letters: "Gk", tone: 2)
    private static let cursor = EngineMonogram(letters: "Cu", tone: 3)
    private static let pi = EngineMonogram(letters: "Pi", tone: 4)
    private static let qwen = EngineMonogram(letters: "Qw", tone: 5)
    private static let kimi = EngineMonogram(letters: "Ki", tone: 1)
    private static let opencode = EngineMonogram(letters: "OC", tone: 2)
    private static let mistral = EngineMonogram(letters: "Mi", tone: 0)
    private static let openrouter = EngineMonogram(letters: "OR", tone: 3)

    private static let presets: [String: EngineMonogram] = [
        "openai": codex, "anthropic": claude, "xai": grok, "qwen": qwen,
        "moonshot": kimi, "mistral": mistral, "openrouter": openrouter,
    ]

    private static let drivers: [String: EngineMonogram] = [
        "claudeAgent": claude, "codex": codex, "grok": grok, "grokAgent": grok,
        "cursorAgent": cursor, "piAgent": pi, "qwenAgent": qwen, "kimiAgent": kimi,
        "opencodeGo": opencode, "mistral": mistral,
    ]
}

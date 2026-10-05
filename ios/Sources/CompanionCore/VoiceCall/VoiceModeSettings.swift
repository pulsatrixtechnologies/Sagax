// Voice mode's settings, the same values as the desktop (shared/voice-mode.ts
// and src/lib/voice-mode/call-settings.ts): the voice that reads a bot's
// answers, its speed and the language the person speaks (kept under the
// desktop's own key, `omb.voiceMode.v1`, so an organization server's synced
// preferences carry the same choice between the phone and the computer),
// and how this phone takes part in a call (hands-free or push to talk, call
// sounds), which stays on this device like the desktop's `omb.voiceCall.v1`.
import Foundation

public struct VoiceModeLanguage: Hashable, Sendable {
    public let code: String
    public let label: String
}

public struct VoiceModeSettings: Codable, Equatable, Sendable {
    /// An xAI voice id; "" is Not set (xAI's default voice).
    public var voice: String
    public var speed: Double
    public var language: String

    public init(voice: String = "", speed: Double = 1, language: String = "auto") {
        self.voice = voice
        self.speed = speed
        self.language = language
    }

    public static let storageKey = "omb.voiceMode.v1"
    public static let `default` = VoiceModeSettings()
    public static let speeds: [Double] = [0.75, 1, 1.25, 1.5]
    public static let minSpeed = 0.7
    public static let maxSpeed = 1.5

    /// The languages the panel offers, in the desktop's order.
    public static let languages: [VoiceModeLanguage] = [
        ("auto", "Auto-detect"), ("en", "English"), ("ar-EG", "Arabic (Egypt)"), ("ar-SA", "Arabic (Saudi Arabia)"),
        ("ar-AE", "Arabic (UAE)"), ("bn", "Bengali"), ("ca", "Catalan"), ("zh", "Chinese (Simplified)"), ("cs", "Czech"),
        ("da", "Danish"), ("nl", "Dutch"), ("fil", "Filipino"), ("fi", "Finnish"), ("fr", "French"), ("de", "German"),
        ("hi", "Hindi"), ("id", "Indonesian"), ("it", "Italian"), ("ja", "Japanese"), ("ko", "Korean"), ("ms", "Malay"),
        ("fa", "Persian"), ("pl", "Polish"), ("pt-BR", "Portuguese (Brazil)"), ("pt-PT", "Portuguese (Portugal)"),
        ("ro", "Romanian"), ("ru", "Russian"), ("es-MX", "Spanish (Mexico)"), ("es-ES", "Spanish (Spain)"),
        ("sv", "Swedish"), ("th", "Thai"), ("tr", "Turkish"), ("vi", "Vietnamese"),
    ].map { VoiceModeLanguage(code: $0.0, label: $0.1) }

    public static func isLanguage(_ code: String) -> Bool { languages.contains { $0.code == code } }

    private static let voiceId = try! NSRegularExpression(pattern: "^[\\w.-]{1,64}$")

    public static func isVoiceId(_ value: String) -> Bool {
        voiceId.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    /// Keep what is valid, default the rest. Never throws.
    public static func clean(_ json: Any?) -> VoiceModeSettings {
        let record = json as? [String: Any] ?? [:]
        var out = VoiceModeSettings.default
        if let voice = record["voice"] as? String, voice.isEmpty || isVoiceId(voice) { out.voice = voice }
        if let speed = (record["speed"] as? NSNumber)?.doubleValue, speed.isFinite, speed >= minSpeed, speed <= maxSpeed { out.speed = speed }
        if let language = record["language"] as? String, isLanguage(language) { out.language = language }
        return out
    }

    public static func decode(_ raw: String?) -> VoiceModeSettings {
        guard let raw, let data = raw.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) else {
            return .default
        }
        return clean(json)
    }

    public var encoded: String {
        let body: [String: Any] = ["voice": voice, "speed": speed, "language": language]
        let data = (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// "1x", "1.25x"
    public static func speedLabel(_ speed: Double) -> String {
        let rounded = (speed * 100).rounded() / 100
        let text = rounded == rounded.rounded() ? String(Int(rounded)) : String(rounded)
        return "\(text)x"
    }

    public static func languageLabel(_ code: String) -> String {
        languages.first { $0.code == code }?.label ?? code
    }

    /// The locale the phone's recognizer should listen in: the picked
    /// language, or (auto) the person's own language.
    public func recognitionLocales(preferred: [Locale] = Dictation.localeCandidates()) -> [Locale] {
        guard language != "auto" else { return preferred }
        var out = [Locale(identifier: language)]
        // "fr" alone: prefer the person's own region of it (fr-CA over fr-FR)
        if !language.contains("-") {
            out.insert(contentsOf: preferred.filter { $0.identifier.lowercased().hasPrefix(language.lowercased()) }, at: 0)
        }
        return out
    }
}

/// How this phone takes part in a call (the desktop's CallSettings).
public struct CallSettings: Codable, Equatable, Sendable {
    public enum Input: String, Codable, Sendable { case auto, push }
    /// "auto": hands-free with barge-in; "push": hold the button to talk
    public var input: Input
    /// subtle tones for connect, interrupt, hold and end
    public var earcons: Bool
    /// how long a pause ends a turn (short, normal, patient)
    public var pause: CallPause

    public init(input: Input = .auto, earcons: Bool = true, pause: CallPause = .normal) {
        self.input = input
        self.earcons = earcons
        self.pause = pause
    }

    public static let storageKey = "omb.voiceCall.v1"
    public static let `default` = CallSettings()

    public static func decode(_ raw: String?) -> CallSettings {
        guard let raw, let data = raw.data(using: .utf8),
              let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .default }
        return CallSettings(
            input: (record["input"] as? String) == "push" ? .push : .auto,
            earcons: record["earcons"] as? Bool ?? true,
            pause: (record["pause"] as? String).flatMap(CallPause.init(rawValue:)) ?? .normal
        )
    }

    public var encoded: String {
        let data = (try? JSONSerialization.data(withJSONObject: ["input": input.rawValue, "earcons": earcons, "pause": pause.rawValue] as [String: Any], options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

/// The call's running time, as a phone shows it: m:ss, then h:mm:ss.
public func formatCallTime(_ seconds: TimeInterval) -> String {
    let total = max(0, Int(seconds.rounded(.down)))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let secs = String(format: "%02d", total % 60)
    return hours > 0 ? "\(hours):\(String(format: "%02d", minutes)):\(secs)" : "\(minutes):\(secs)"
}

/// Spoken answers to a permission card, shared by every call. Anything else
/// is read as a reply to the bot, not as consent: an approval must never be
/// granted by a sentence that merely contained the word "sure".
public enum CallAnswers {
    private static let yes = try! NSRegularExpression(
        pattern: "^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|allow|approve|approved|fine|please do|oui|ouais|d'accord|vas-y|allez-y|j'approuve)\\b",
        options: [.caseInsensitive]
    )
    private static let no = try! NSRegularExpression(
        pattern: "^(no|nope|don'?t|do not|stop|deny|denied|cancel|never|skip it|non|refuse|annule|jamais)\\b",
        options: [.caseInsensitive]
    )

    public static func isYes(_ said: String) -> Bool { matches(yes, said) }
    public static func isNo(_ said: String) -> Bool { matches(no, said) }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)) != nil
    }
}

/// A room's spoken turn in its existing mention syntax (the desktop's
/// `routeSpokenGroupMessage`, src/lib/group-call.ts): recognition returns
/// "Atlas, ..." rather than "@Atlas ...".
public struct SpokenGroupMessage: Equatable, Sendable {
    public var text: String
    public var addressed: Bool
}

public enum GroupCallRouting {
    public static func route(_ text: String, memberNames: [String]) -> SpokenGroupMessage {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return SpokenGroupMessage(text: "", addressed: false) }
        if test("(?:^|\\s)@everyone\\b", trimmed) { return SpokenGroupMessage(text: trimmed, addressed: true) }
        let mentioned = memberNames.contains { name in
            test("(?:^|\\s)@" + NSRegularExpression.escapedPattern(for: name) + "(?=\\s|[,.!?:;]|$)", trimmed)
        }
        if mentioned { return SpokenGroupMessage(text: trimmed, addressed: true) }
        if let rest = capture("^(?:hey\\s+)?(?:everyone|everybody|all)(?:[\\s,:-]+(.*))?$", trimmed) {
            return SpokenGroupMessage(text: rest.isEmpty ? "@everyone" : "@everyone \(rest)", addressed: true)
        }
        for name in memberNames.sorted(by: { $0.count > $1.count }) {
            let pattern = "^(?:hey\\s+)?" + NSRegularExpression.escapedPattern(for: name) + "(?:[\\s,:-]+(.*))?$"
            guard let rest = capture(pattern, trimmed) else { continue }
            return SpokenGroupMessage(text: rest.isEmpty ? "@\(name)" : "@\(name) \(rest)", addressed: true)
        }
        return SpokenGroupMessage(text: trimmed, addressed: false)
    }

    private static func test(_ pattern: String, _ text: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return false }
        return regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// The trailing group (trimmed, "" when absent), or nil when no match.
    private static func capture(_ pattern: String, _ text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        let group = match.range(at: 1)
        guard group.location != NSNotFound, let range = Range(group, in: text) else { return "" }
        return text[range].trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

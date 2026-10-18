// Report a bot's reply (App Store guideline 1.2, generated content): the
// message menu's Report opens a sheet that writes an email to Pulsatrix.
// The email carries the message id and only what the person chose: a
// reason, their own note, and the reply's words if they tick the box.
// Nothing is sent by the app itself; the person sends the email (or pastes
// the copied report) from their own mail app.
import Foundation

public enum MessageReport {
    /// Where reports go.
    public static let address = "hello@pulsatrix.ca"

    public enum Reason: String, CaseIterable, Identifiable, Sendable {
        case harmful, offensive, sexual, misleading, privacy, other
        public var id: String { rawValue }
    }

    /// A bot's reply can be reported; your own lines and a person's in a
    /// room cannot. `isBot` says whether a room sender is one of the bots.
    public static func canReport(_ message: Message, isBot: (String) -> Bool) -> Bool {
        guard message.role == .bot, message.kind == .text else { return false }
        guard let from = message.from else { return true }
        return isBot(from.botId)
    }

    public struct Draft: Equatable, Sendable {
        public var messageId: String
        public var reason: Reason
        /// The reason's words in the app's language (the email is read by
        /// a person, and the reason key follows it).
        public var reasonLabel: String
        public var note: String
        /// The reply's words, only when the person chose to include them.
        public var includedText: String?
        /// "Sagax iOS 0.5.19 (48)".
        public var app: String
        public var demo: Bool

        public init(messageId: String, reason: Reason, reasonLabel: String, note: String, includedText: String?, app: String, demo: Bool) {
            self.messageId = messageId
            self.reason = reason
            self.reasonLabel = reasonLabel
            self.note = note
            self.includedText = includedText
            self.app = app
            self.demo = demo
        }

        public var subject: String { "Sagax: AI reply report (\(reason.rawValue))" }

        public var body: String {
            var lines = [
                "Reason: \(reasonLabel) [\(reason.rawValue)]",
                "Message id: \(messageId)",
                "App: \(app)\(demo ? " (demo)" : "")",
            ]
            let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedNote.isEmpty { lines += ["", "Note:", trimmedNote] }
            if let includedText, !includedText.isEmpty {
                lines += ["", "Reply:", String(includedText.prefix(maxIncludedCharacters))]
            }
            return lines.joined(separator: "\n")
        }

        /// The whole report as plain text, for the clipboard when no mail
        /// app is set up.
        public var plainText: String { "To: \(MessageReport.address)\nSubject: \(subject)\n\n\(body)" }

        /// A `mailto:` link to Pulsatrix with the subject and body filled.
        public var mailURL: URL? {
            var components = URLComponents()
            components.scheme = "mailto"
            components.path = MessageReport.address
            components.queryItems = [
                URLQueryItem(name: "subject", value: subject),
                URLQueryItem(name: "body", value: body),
            ]
            // `+` stays literal in a query item; mail apps read it as a plus
            components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
            return components.url
        }
    }

    /// A long reply is cut so the link stays within what mail apps accept.
    public static let maxIncludedCharacters = 1_500
}

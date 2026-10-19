import Foundation

/// JC 2026-10-19: "N'affiche JAMAIS des GUID, on ne comprend rien." Text on
/// screen shows a name, never a UUID/GUID or another opaque id; the id may go
/// in a Copy action for support. Same rules as the desktop's
/// shared/human-id.ts.
enum HumanID {
    private static let opaque = try! NSRegularExpression(
        pattern: "^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{20,}|[a-z]{1,12}[-_](?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[0-9a-z]{20,}))$",
        options: [.caseInsensitive]
    )

    /// Whether `value` is an id a person cannot read.
    static func isOpaque(_ value: String) -> Bool {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return opaque.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// The first readable candidate (a name, a login), else `fallback`.
    static func readable(_ candidates: String?..., or fallback: String) -> String {
        for candidate in candidates {
            let text = candidate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !text.isEmpty && !isOpaque(text) { return text }
        }
        return fallback
    }
}

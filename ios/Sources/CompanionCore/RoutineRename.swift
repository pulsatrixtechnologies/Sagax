import Foundation

/// A routine renamed in place (2026-10-29, as the desktop's row menu and
/// title): the name trimmed, an empty one refused.
public enum RoutineName {
    public static let max = 120

    /// The name to save, or nil when nothing is left once trimmed.
    public static func clean(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}

import Foundation

/// Claude Code's dynamic workflow (`--effort ultracode`), stored on the wire
/// like any other effort; non-Claude engines map it at turn time on the server.
public enum UltracodeEffort {
    public static let id = "ultracode"

    public static func isUltracode(_ effort: String?) -> Bool {
        effort == id
    }

    /// Picker rows: native levels plus Ultracode when the engine supports effort.
    public static func pickerLevels(_ native: [String]) -> [String] {
        var seen = Set<String>()
        let levels = native.filter { !$0.isEmpty && seen.insert($0).inserted && $0 != id }
        guard !levels.isEmpty else { return [] }
        return levels + [id]
    }

    public static func accepts(effort: String?, in levels: [String]) -> Bool {
        guard let effort else { return true }
        if isUltracode(effort) {
            return !pickerLevels(levels).isEmpty
        }
        return levels.contains(effort)
    }

    public static func label(_ effort: String) -> String {
        if isUltracode(effort) {
            return String(localized: "Ultracode", comment: "Claude ultracode effort product name")
        }
        if effort.lowercased() == "xhigh" { return "X-High" }
        return effort.capitalized
    }
}

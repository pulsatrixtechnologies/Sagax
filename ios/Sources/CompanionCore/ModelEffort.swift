import Foundation

/// `shared/model-capabilities.ts`: the reasoning levels one model takes
/// (2026-10-13). The server copies each engine's per-model list onto the
/// catalog row (`effortLevels`, `defaultEffort`); an empty list means the
/// model has no effort control, a missing one leaves the engine's levels.
public enum ModelEffort {
    /// Native levels for this model, in the engine's order, never Ultracode.
    public static func nativeLevels(_ option: ModelOption?, engine: [String]) -> [String] {
        let levels = engine.filter { !UltracodeEffort.isUltracode($0) }
        guard let own = option?.effortLevels else { return levels }
        return levels.filter { own.contains($0) }
    }

    /// The picker's levels for this model: native, then Ultracode; empty
    /// when the model takes none.
    public static func pickerLevels(_ option: ModelOption?, engine: [String]) -> [String] {
        UltracodeEffort.pickerLevels(nativeLevels(option, engine: engine))
    }

    /// What runs when no level is sent, when the engine says.
    public static func defaultLevel(_ option: ModelOption?, engine: [String]) -> String? {
        guard let level = option?.defaultEffort, nativeLevels(option, engine: engine).contains(level) else { return nil }
        return level
    }

    /// The level kept on this model: the same when it takes it, else none.
    public static func forModel(_ effort: String?, option: ModelOption?, engine: [String]) -> String? {
        guard let effort, !effort.isEmpty else { return nil }
        let native = nativeLevels(option, engine: engine)
        if UltracodeEffort.isUltracode(effort) { return native.isEmpty ? nil : effort }
        return native.contains(effort) ? effort : nil
    }
}

// "Browse Bots" beside the Connect apps search (the desktop's
// ConnectAppsView `onBrowseBots`, PluginsPanel.tsx `push({ page: "bots" })`):
// it opens Browse Bots, the catalogue with the templates folded in, the
// same view as the sidebar's Browse Bots. No button when the pairing has
// no catalogue (the desktop hides it on a remote client).
import Foundation

public enum BotTemplatesDestination: String, Sendable, Equatable {
    case templates
}

public enum BotTemplatesEntry {
    public static func destination(gate: SurfaceGate) -> BotTemplatesDestination? {
        gate.allows(.browseBots) ? .templates : nil
    }
}

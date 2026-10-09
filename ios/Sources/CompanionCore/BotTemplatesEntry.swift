// "Bot templates" beside the Connect apps search (the desktop's
// ConnectAppsView `onBotTemplates`, PluginsPanel.tsx `openBotTemplates`):
// Connect apps closes, then the Templates library opens when Settings >
// Experimental has it on (and this pairing may browse it), else the new
// bot sheet, where a bot starts from a ready-made option or from scratch.
// No button when the pairing can do neither.
import Foundation

public enum BotTemplatesDestination: String, Sendable, Equatable {
    case templates
    case newBot = "new-bot"
}

public enum BotTemplatesEntry {
    public static func destination(gate: SurfaceGate, features: ServerFeatures?) -> BotTemplatesDestination? {
        if features?.templates == true, gate.allows(.browseBots) { return .templates }
        if gate.allows(.createBot) { return .newBot }
        return nil
    }
}

import AudioToolbox
import UIKit

// MARK: - Sound Effects
public enum SoundEffects {
    public static func playSent() {
        AudioServicesPlaySystemSound(1004)
    }
}

// MARK: - Haptic Feedback
public enum Haptics {
    /// Settings > App > Haptics (`PrefKey.haptics`), on unless turned off.
    /// The key string is repeated here because this file is also linked
    /// where `PrefKey` is not.
    public static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: "companion.prefs.haptics") as? Bool ?? true
    }

    public static func selection() {
        guard isEnabled else { return }
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
    }

    public static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        guard isEnabled else { return }
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred()
    }

    public static func notification(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        guard isEnabled else { return }
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(type)
    }

    public static func success() {
        notification(.success)
    }
}

// MARK: - Platform Bridge
public enum PlatformBridge {
    public static func copyToPasteboard(_ text: String) {
        UIPasteboard.general.string = text
        Haptics.selection()
    }
}

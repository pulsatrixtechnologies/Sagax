// Confidential threads ("Fil confidentiel"), the phone's half of
// server/confidential-threads.ts: a thread its owner marked confidential
// is never remembered, exported or shared beyond them. The flag is
// permanent; only deleting the thread ends it, so no surface offers a way
// back. Everything a view needs to decide is here, so it is tested without
// a simulator.
import Foundation

/// The classification banner of a confidential thread: a solid band at the
/// top of the conversation and another above the composer. It is a fact
/// about the thread, not a notice, so it has no close control.
public enum ConfidentialBanner {
    /// The band's height, reserved whenever the thread is confidential so
    /// the transcript never jumps when it appears.
    public static let height: Double = 28
    /// Never dismissible: there is no state that hides it.
    public static let isDismissible = false
    /// The SF Symbol drawn before the label.
    public static let symbol = "lock.fill"

    /// Shown exactly when the thread open is confidential.
    public static func shows(for task: BotTask?) -> Bool {
        task?.isConfidential == true
    }

    /// Shown exactly when the bot's selected thread is confidential. Rooms
    /// never are.
    public static func shows(for chat: Chat) -> Bool {
        guard case let .bot(bot) = chat else { return false }
        return shows(for: bot.tasks?.first { $0.threadId == bot.threadId })
    }

    /// Localization keys (Localizable.xcstrings).
    public static let labelKey = "CONFIDENTIEL"
    public static let accessibilityKey = "Fil confidentiel : ce fil n'est ni mémorisé, ni exporté, ni partagé"
}

/// The New thread choices for a bot: an ordinary thread and a confidential
/// one. Where the organization makes new threads confidential by default,
/// the ordinary choice says so explicitly (`confidential: false`), else it
/// sends nothing and the server's default applies.
public struct NewThreadChoice: Equatable, Sendable {
    public var confidential: Bool?

    public static func ordinary(orgDefaultConfidential: Bool) -> NewThreadChoice {
        NewThreadChoice(confidential: orgDefaultConfidential ? false : nil)
    }

    public static let confidentialThread = NewThreadChoice(confidential: true)
}

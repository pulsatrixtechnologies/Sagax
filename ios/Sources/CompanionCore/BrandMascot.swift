// Which mascot stands for the app on this phone.
//
// Not connected (welcome, choosing a way in): the default Sagax owl. Once
// connected, the person's Primary Bot (`chiefOfStaff`) in its own character,
// colour and skin, live from the fleet; until the fleet arrives (an offline
// launch) the last look seen for that connection. No Primary Bot: the owl.
// The app icon never changes.
import Foundation

public enum BrandMascot: Equatable, Sendable {
    case sagaxOwl
    case primary(Bot)

    /// The Primary Bot of a fleet: the visible bot marked Chief of Staff.
    public static func primaryBot(in bots: [Bot]) -> Bot? {
        bots.first { $0.chiefOfStaff == true && $0.hidden != true }
    }

    /// - Parameters:
    ///   - connected: a computer, an organization or the demo is open.
    ///   - bots: the live fleet (empty until it has loaded).
    ///   - cached: the last Primary Bot look saved for this connection.
    public static func resolve(connected: Bool, bots: [Bot], cached: Bot?) -> BrandMascot {
        guard connected else { return .sagaxOwl }
        if let primary = primaryBot(in: bots) { return .primary(primary.brandLook) }
        if bots.isEmpty, let cached { return .primary(cached.brandLook) }
        return .sagaxOwl
    }
}

extension Bot {
    /// Only what drawing the mascot needs: no transcript, no threads. This
    /// is what the offline cache keeps, and what makes two looks compare
    /// equal when only the conversation moved.
    public var brandLook: Bot {
        var look = self
        look.messages = nil
        look.tasks = nil
        look.projects = nil
        look.activeLeafId = nil
        look.hasMore = nil
        look.unread = false
        look.busy = nil
        look.activity = nil
        look.waitingOnTeammate = nil
        look.instructionsLead = nil
        return look
    }
}

// The Team map's state (matrix TM1, TM2; TeamMapPage.tsx): the handoffs
// snapshot, asked every three seconds while the page is on screen, the
// person's own order of each team's bots, and the move to another team
// behind its confirmation. On an organization server the order is the
// person's record on the server (`sagax.teamCanvasBotOrder.v1`, the key
// TeamCanvas.tsx keeps it under there), so it is the same on every device;
// on a personal computer it stays on this phone per workspace, as the
// desktop keeps it in its browser. The first time the server holds none,
// this phone's own order is offered.
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class TeamMapModel: ObservableObject {
    @Published private(set) var snapshot = TeamMapSnapshot.empty
    @Published private(set) var orders: [String: [String]] = [:]
    /// A failed move (`error`) or a failed refresh (`refreshError`).
    @Published var error: String?
    @Published var refreshError: String?
    /// The move waiting for "Move bot".
    @Published var pendingMove: PendingMove?
    @Published private(set) var moving: String?
    /// What the last arrange or move did, for VoiceOver.
    @Published private(set) var announcement = "" {
        didSet { if !announcement.isEmpty { UIAccessibility.post(notification: .announcement, argument: announcement) } }
    }

    struct PendingMove: Identifiable {
        let bot: Bot
        let destination: String
        var id: String { "\(bot.id)>\(destination)" }
        var destinationName: String { destination.isEmpty ? String(localized: "Unassigned") : destination }
    }

    private var workspace: String?
    /// The pairing bound last, for saving the order to the person's record.
    private weak var session: Session?
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The saved order for this pairing's workspace.
    func bind(_ session: Session) {
        guard let connection = session.connection else { return }
        self.session = session
        let key = connection.serverEnvironmentId ?? connection.id
        if key != workspace {
            workspace = key
            orders = TeamMap.parseOrders(defaults.string(forKey: TeamMap.ordersKey(workspace: key)))
        }
        // the person's own order on an organization server; this phone's
        // order is offered once while the server holds none
        let prefs = SidebarPrefsModel.shared
        if let synced = prefs.teamBotOrders {
            if prefs.prefs.values[SidebarPrefKey.teamBotOrder] == nil, !orders.isEmpty {
                prefs.setTeamBotOrders(session, orders)
            } else if synced != orders {
                orders = synced
            }
        }
    }

    func refresh(_ session: Session) async {
        guard let client = session.settingsClient else { return }
        do {
            snapshot = try await client.teamMap()
            refreshError = nil
        } catch is CancellationError {
        } catch {
            refreshError = error.localizedDescription
        }
    }

    /// Every three seconds while the view lives (its `.task`).
    func poll(_ session: Session) async {
        bind(session)
        while !Task.isCancelled {
            bind(session)
            await refresh(session)
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
    }

    // MARK: Arranging inside a team (TM2)

    func lane(_ bots: [Bot], in section: TeamMapSection) -> [Bot] {
        TeamMap.ordered(bots, order: orders[section.key] ?? [])
    }

    func canArrange(_ bot: Bot, by delta: Int, in sections: [TeamMapSection]) -> Bool {
        TeamMap.arrange(bot, by: delta, in: sections, orders: orders) != nil
    }

    func arrange(_ bot: Bot, by delta: Int, in sections: [TeamMapSection]) {
        guard let next = TeamMap.arrange(bot, by: delta, in: sections, orders: orders) else { return }
        let key = TeamMap.teamKey(of: bot)
        orders[key] = next
        if SidebarPrefsModel.shared.teamBotOrders != nil, let session {
            SidebarPrefsModel.shared.setTeamBotOrders(session, orders)
        } else if let workspace {
            defaults.set(TeamMap.encodeOrders(orders), forKey: TeamMap.ordersKey(workspace: workspace))
        }
        let team = key.isEmpty ? String(localized: "Unassigned") : key
        announcement = String(localized: "\(bot.name) arranged in \(team). Team membership is unchanged.")
        Haptics.selection()
    }

    // MARK: Moving to another team (admin)

    func requestMove(_ bot: Bot, to destination: String) {
        pendingMove = PendingMove(bot: bot, destination: destination)
    }

    func confirmMove(_ session: Session) {
        guard let move = pendingMove else { return }
        pendingMove = nil
        moving = move.bot.id
        error = nil
        Task {
            defer { moving = nil }
            if await session.assignSection(name: move.destination, botIds: [move.bot.id]) != nil {
                await session.refresh()
                let team = move.destination.isEmpty ? String(localized: "Unassigned") : move.destination
                announcement = String(localized: "Moved \(move.bot.name) to \(team).")
            } else {
                error = session.actionError
                session.actionError = nil
            }
        }
    }

    func cancelMove() {
        pendingMove = nil
        announcement = String(localized: "Move cancelled. Team membership is unchanged.")
    }
}

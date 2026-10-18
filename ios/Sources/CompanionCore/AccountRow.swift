// The account row of the desktop sidebar (SidebarProfileMenu.tsx, #194,
// #215; matrix DC14, DC15). The phone has no account row: its account
// menu's Automations entry carries the routines count (no badge on the
// photo since 2026-10-18) and its header line shows the person's title and
// points.
//
// - The routines count: the viewer's active routines (`activeRoutineCount`,
//   src/lib/active-routines.ts). `routineAttention` (a failed run nobody has
//   seen) is still computed for the desktop's rule but not drawn.
// - Title and points: the viewer's own only, each while its switch is on
//   ("Show my title", "Show my points"). Other people's rows never show them.
import Foundation

public enum AccountRow {
    /// `isActiveRoutine`: switched on, not paused by the server, and with a
    /// next run.
    public static func isActive(_ routine: Routine) -> Bool {
        routine.enabled && routine.suspended == nil && routine.nextRunAt != nil
    }

    /// `activeRoutineCount`: only routines of bots the viewer owns count.
    public static func activeRoutines(_ routines: [Routine], bots: [Bot], viewerId: String) -> Int {
        let own = Set(bots.filter { PrimaryBotRules.viewerOwns($0, viewerId: viewerId) }.map(\.id))
        return routines.filter { own.contains($0.botId) && isActive($0) }.count
    }

    /// The badge's dot: a failed or missed run nobody has looked at.
    public static func routineAttention(_ runs: [RoutineRun]) -> Bool {
        runs.contains(where: \.isUnseenProblem)
    }

    /// The title under the person's name, while "Show my title" is on.
    public static func title(_ snapshot: AchievementSnapshot?) -> AchievementText? {
        guard let snapshot, snapshot.settings.showTitle, let id = snapshot.settings.title else { return nil }
        for reward in AchievementDefinition.catalog.flatMap(\.rewards) {
            if case let .title(rewardId, name) = reward, rewardId == id { return name }
        }
        return nil
    }

    /// The points, while "Show my points" is on.
    public static func points(_ snapshot: AchievementSnapshot?) -> Int? {
        guard let snapshot, snapshot.settings.showPoints else { return nil }
        return snapshot.points
    }
}

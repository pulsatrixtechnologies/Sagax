// The state behind the bot panel's Activity card (matrix row BP10), as the
// desktop's `bot-settings/ActivitySection.tsx` keeps it: the list from
// GET /api/bots/:id/activity (50 entries), refetched when the bot's threads
// change and polled every 4 s while work runs (30 s otherwise), the live
// tracker that lets a finished job linger 5 s before it leaves, and Stop.
// Layout-agnostic: the phone's Info card and a future iPad panel both read it.
import CompanionCore
import SwiftUI

@MainActor
final class BotActivityModel: ObservableObject {
    @Published private(set) var list: BotActivityList?
    @Published private(set) var failed = false
    @Published private(set) var stopping: Set<String> = []
    @Published private(set) var now = Date()

    let botId: String
    private var tracker = BotActivityLiveTracker()
    private var request = 0
    private var client: CompanionClient?
    private var poller: Task<Void, Never>?

    init(botId: String) {
        self.botId = botId
    }

    var active: Bool { list?.all.contains { $0.status.isActive } ?? false }

    /// Details > Coding: running coding jobs and those just finished.
    var coding: [BotActivityItem]? {
        list.map { BotActivityRules.codingLive($0.items, visible: { [tracker, now] in tracker.visible($0, at: now) }) }
    }

    /// Details > Activity: everything else and the sub-agents.
    var other: [BotActivityItem]? {
        list.map { BotActivityRules.activityLive($0.items, subagents: $0.subagents, visible: { [tracker, now] in tracker.visible($0, at: now) }) }
    }

    func fading(_ item: BotActivityItem) -> Bool { tracker.fading(item, at: now) }

    /// Start (or restart) loading and polling with this client.
    func start(client: CompanionClient?) {
        self.client = client
        poller?.cancel()
        poller = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                guard let self else { return }
                let wait = self.active ? BotActivityRules.pollActive : BotActivityRules.pollIdle
                // tick the elapsed times every second while something runs
                var waited: TimeInterval = 0
                while waited < wait, !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    waited += 1
                    if self.active || self.tracker.nextChange(after: self.now) != nil { self.now = Date() }
                }
            }
        }
    }

    func stop() {
        poller?.cancel()
        poller = nil
    }

    func refresh() async {
        guard let client else { return }
        request += 1
        let id = request
        do {
            let next = try await client.botActivity(botId: botId)
            guard id == request else { return }
            now = Date()
            tracker.update(next.all, at: now)
            list = next
            failed = false
        } catch {
            if id == request { failed = true }
        }
    }

    /// Stop a running entry. A card interrupts its thread (ActivitySection.tsx
    /// `stop`); the detail stops a parallel task on its own
    /// (ActivityDetailModal `stop`). The list refetches 1.5 s later.
    func stopItem(_ item: BotActivityItem, fromDetail: Bool = false, onError: @escaping (String) -> Void) {
        guard let threadId = item.threadId, let client else { return }
        stopping.insert(item.id)
        Task {
            do {
                if fromDetail, item.parallel == true {
                    try await client.stopParallelTask(botId: item.botId, threadId: threadId)
                } else {
                    try await client.interrupt(botId: item.botId, threadId: threadId)
                }
            } catch {
                onError(error.localizedDescription)
            }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            stopping.remove(item.id)
            await refresh()
        }
    }
}

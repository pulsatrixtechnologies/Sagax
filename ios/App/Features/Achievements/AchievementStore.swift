// The person's achievements on the paired computer or server (matrix ST9),
// as src/lib/achievements.ts keeps them for the desktop: the snapshot
// (GET /api/me/achievements), the events only the app sees (batched, POST
// /api/me/achievements/events), the settings (PUT .../settings, shown at
// once and reloaded on a refusal), and the unlock banners
// (src/lib/achievement-toasts.ts: each id once, eight waiting at most, one
// at a time, never while the person is typing, none with "Unlock banners"
// off).
//
// The desktop also hears unlocks on its event stream; the phone reloads the
// snapshot when it comes to the front and on each report instead, and
// banners the ids unlocked since it last looked.
import CompanionCore
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class AchievementStore: ObservableObject {
    static let shared = AchievementStore()

    enum Status: Equatable { case idle, loading, ready, unavailable }

    @Published private(set) var status: Status = .idle
    @Published private(set) var snapshot: AchievementSnapshot?
    /// The banner on screen, then the ones waiting.
    @Published private(set) var toast: AchievementToastItem?
    @Published private(set) var error: String?

    func clearError() { error = nil }

    private var client: CompanionClient?
    private var connectionID: String?
    private var pending: [AchievementEvent] = []
    private var flushTask: Task<Void, Never>?
    private var queue: [AchievementToastItem] = []
    private var shown: Set<String> = []
    private var toastTask: Task<Void, Never>?
    private var openedReported: Set<String> = []

    static let maxQueued = 8
    static let showSeconds: Double = 5.2
    static let typingQuietSeconds: Double = 1.8

    // MARK: Connection

    /// A new pairing starts over: nothing is known about this person yet.
    func attach(client: CompanionClient?, connectionID: String?) {
        guard connectionID != self.connectionID else {
            self.client = client
            return
        }
        self.client = client
        self.connectionID = connectionID
        snapshot = nil
        status = .idle
        pending = []
        queue = []
        toast = nil
    }

    /// The first read for a person, then `app.opened` once per launch
    /// (after a time zone sync), and `trombi.summoned` when the retro skin
    /// was unlocked before the character was.
    func appOpened() async {
        guard let connectionID, !openedReported.contains(connectionID) else {
            await reload()
            return
        }
        await reload()
        guard status == .ready, let snapshot else { return }
        openedReported.insert(connectionID)
        let offset = TimeZone.current.secondsFromGMT() / 60
        if snapshot.settings.tzOffset != offset {
            await update(AchievementSettingsPatch(tzOffset: offset))
        }
        var events = [AchievementEvent.appOpened]
        if ThemeStore.shared.retroUnlocked, !snapshot.rewards.contains("character:trombi") {
            events.append(.trombiSummoned)
        }
        await send(events)
    }

    // MARK: Reads

    func reload() async {
        guard let client else { return }
        if snapshot == nil { status = .loading }
        do {
            let next = try await client.achievements()
            absorb(next)
            status = .ready
        } catch let APIError.status(code, _) where code == 404 {
            status = .unavailable
        } catch {
            if snapshot == nil { status = .idle }
        }
    }

    /// A new snapshot: banners the ids unlocked since the last one (the
    /// first snapshot of a person only seeds what is already known).
    private func absorb(_ next: AchievementSnapshot) {
        let before = snapshot.map { Set($0.items.filter(\.unlocked).map(\.id)) }
        snapshot = next
        let unlocked = next.items.filter(\.unlocked)
        guard let before else {
            shown.formUnion(unlocked.map(\.id))
            return
        }
        let fresh = unlocked.filter { !before.contains($0.id) }.sorted { ($0.unlockedAt ?? 0) < ($1.unlockedAt ?? 0) }
        enqueue(fresh.compactMap { state in
            AchievementDefinition.lookup(state.id).map { AchievementUnlock(id: $0.id, points: $0.points, unlockedAt: state.unlockedAt) }
        })
    }

    // MARK: Events

    /// Batched like `reportAchievement`: at most 32 waiting, sent 400 ms after
    /// the last one. Nothing is reported where achievements are not kept.
    func report(_ event: AchievementEvent) {
        guard status != .unavailable, client != nil else { return }
        if pending.count < 32 { pending.append(event) }
        flushTask?.cancel()
        flushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled, let self else { return }
            let batch = self.pending
            self.pending = []
            await self.send(batch)
        }
    }

    private func send(_ events: [AchievementEvent]) async {
        guard let client, !events.isEmpty else { return }
        do {
            let result = try await client.reportAchievements(events)
            enqueue(result.unlocked)
            if let next = result.snapshot {
                // The unlocks above are already queued; mark them known.
                shown.formUnion(result.unlocked.map(\.id))
                let known = Set(next.items.filter(\.unlocked).map(\.id))
                shown.formUnion(known)
                snapshot = next
                status = .ready
            }
        } catch let APIError.status(code, _) where code == 404 {
            status = .unavailable
        } catch {
            // Best effort, as on the desktop.
        }
    }

    // MARK: Settings

    func update(_ patch: AchievementSettingsPatch) async {
        guard let client, var current = snapshot else { return }
        current.settings = patch.applied(to: current.settings)
        snapshot = current
        do {
            let saved = try await client.updateAchievementSettings(patch)
            if var latest = snapshot {
                latest.settings = saved
                snapshot = latest
            }
        } catch {
            self.error = error.localizedDescription
            await reload()
        }
    }

    // MARK: Banners

    private func enqueue(_ unlocks: [AchievementUnlock]) {
        let toastsOn = snapshot?.settings.toasts != false
        for unlock in unlocks where !shown.contains(unlock.id) {
            shown.insert(unlock.id)
            guard toastsOn, let definition = AchievementDefinition.lookup(unlock.id) else { continue }
            if queue.count < Self.maxQueued { queue.append(AchievementToastItem(definition: definition, points: unlock.points)) }
        }
        pump()
    }

    private func pump() {
        guard toast == nil, toastTask == nil, !queue.isEmpty else { return }
        toastTask = Task { [weak self] in
            guard let self else { return }
            // Wait while the person types (the desktop's 1.8 s of quiet).
            while Date().timeIntervalSince(AchievementTyping.lastKeystroke) < Self.typingQuietSeconds {
                try? await Task.sleep(nanoseconds: 400_000_000)
            }
            guard !self.queue.isEmpty else { self.toastTask = nil; return }
            let next = self.queue.removeFirst()
            self.notifyInBackground(next)
            withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { self.toast = next }
            if Haptics.isEnabled { Haptics.notification(.success) }
            try? await Task.sleep(nanoseconds: UInt64(Self.showSeconds * 1_000_000_000))
            self.dismissToast()
        }
    }

    func dismissToast() {
        toastTask?.cancel()
        toastTask = nil
        withAnimation(.easeIn(duration: 0.3)) { toast = nil }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 320_000_000)
            self?.pump()
        }
    }

    /// "System notification in the background": the app is not in front.
    private func notifyInBackground(_ item: AchievementToastItem) {
        guard snapshot?.settings.native == true, UIApplication.shared.applicationState != .active else { return }
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Achievement unlocked (+\(item.points))")
        content.body = [item.definition.name.resolved(AchievementLanguage.current), item.rewardLabel(AchievementLanguage.current)]
            .compactMap { $0 }.joined(separator: "\n")
        if NotificationSounds.isEnabled { content.sound = .default }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "sagax-achievement:\(item.definition.id)", content: content, trigger: nil))
    }
}

struct AchievementToastItem: Identifiable, Equatable {
    let definition: AchievementDefinition
    let points: Int
    var id: String { definition.id }

    func rewardLabel(_ language: String?) -> String? {
        definition.rewards.first.map { AchievementWording.rewardLabel($0, language: language) }
    }
}

/// When the person last typed in a field: banners wait for 1.8 s of quiet.
enum AchievementTyping {
    @MainActor static var lastKeystroke = Date.distantPast
}

/// The language the catalog's texts follow: the app's chosen one.
enum AchievementLanguage {
    static var current: String? {
        let stored = UserDefaults.standard.string(forKey: PrefKey.language) ?? AppLanguage.system.rawValue
        return (AppLanguage.resolved(stored).locale ?? Locale.current).language.languageCode?.identifier
    }
}

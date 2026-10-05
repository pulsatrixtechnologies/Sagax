// Settings > Achievements (matrix ST9), as the desktop's AchievementsPage.tsx:
// the points, level and its bar, unlocked count and streak, the Title
// picker, the recent unlocks, the category tabs with a Show filter, one card
// per achievement (secrets stay hidden until unlocked), and the four
// switches. Opening the page reports `achievements.viewed`.
//
// Layout-agnostic: the cards flow in as many columns as the width allows
// (one on a phone, two or more in an iPad's settings pane).
import CompanionCore
import SwiftUI

struct AchievementsPage: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.locale) private var locale
    @ObservedObject private var store = AchievementStore.shared
    @State private var category: AchievementCategory?
    @State private var filter: AchievementFilter = .all

    private var language: String? { AchievementLanguage.current ?? locale.language.languageCode?.identifier }

    var body: some View {
        SettingsPage(title: "Achievements") {
            switch store.status {
            case .unavailable:
                SettingsFooter(text: "This server does not keep achievements yet.")
                    .accessibilityIdentifier("achievements-unavailable")
            case .ready where store.snapshot != nil:
                if let snapshot = store.snapshot { content(snapshot) }
            default:
                HStack(spacing: 8) {
                    ProgressView().tint(Theme.textSecondary)
                    Text("Loading achievements").font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
                }
                .padding(.top, 30)
            }
        }
        .task {
            if store.snapshot == nil { await store.reload() }
            store.report(.viewed)
        }
        .alert("Achievements", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.clearError() } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: store.error ?? "")
        }
    }

    @ViewBuilder
    private func content(_ snapshot: AchievementSnapshot) -> some View {
        header(snapshot)
        if !snapshot.recent.isEmpty {
            SettingsSectionLabel(text: "Recent unlocks")
            recent(snapshot)
        }
        SettingsSectionLabel(text: "Categories")
        tabs
        cards(snapshot)
        SettingsSectionLabel(text: "Settings")
        switches(snapshot)
    }

    // MARK: Header

    private func header(_ snapshot: AchievementSnapshot) -> some View {
        let level = snapshot.level
        return SettingsCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Image(systemName: "trophy.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .background(AchievementWording.color(.legendary), in: Circle())
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Text(verbatim: snapshot.points.formatted())
                                .font(Theme.font(28, .bold))
                                .foregroundStyle(Theme.textPrimary)
                                .accessibilityIdentifier("achievements-points")
                            Text("points").font(Theme.Font.body).foregroundStyle(Theme.textSecondary)
                        }
                        Text("\(snapshot.unlockedCount) of \(snapshot.count) unlocked")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Spacer(minLength: 0)
                }
                HStack(spacing: 8) {
                    Text("Level \(level.level)")
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(Theme.textPrimary)
                    ProgressView(value: level.progress(points: snapshot.points))
                        .tint(AchievementWording.color(.legendary))
                        .accessibilityLabel(Text("Progress to the next level"))
                    Text("\(max(0, level.to - snapshot.points)) to the next level")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                if snapshot.streak > 0 {
                    Label {
                        Text("\(snapshot.streak)-day streak")
                    } icon: {
                        Image(systemName: "flame.fill").foregroundStyle(Color(hex: 0xF97316))
                    }
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.horizontal, SettingsMetrics.rowInset)
            .padding(.vertical, 14)
            let titles = snapshot.unlockedTitles
            if !titles.isEmpty {
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                HStack {
                    Text("Title").font(Theme.Font.rowTitle).foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Picker(selection: Binding(
                        get: { snapshot.settings.title ?? "" },
                        set: { id in Task { await store.update(id.isEmpty ? AchievementSettingsPatch(clearTitle: true) : AchievementSettingsPatch(title: id)) } }
                    )) {
                        Text("No title").tag("")
                        ForEach(titles, id: \.id) { title in Text(verbatim: title.name.resolved(language)).tag(title.id) }
                    } label: {
                        Text("Title")
                    }
                    .tint(Theme.textSecondary)
                    .accessibilityIdentifier("achievements-title")
                }
                .padding(.leading, SettingsMetrics.rowInset)
                .padding(.trailing, 8)
                .frame(minHeight: 44)
            }
        }
    }

    // MARK: Recent

    private func recent(_ snapshot: AchievementSnapshot) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(snapshot.recent.prefix(5), id: \.self) { id in
                    if let definition = AchievementDefinition.lookup(id) {
                        HStack(spacing: 6) {
                            Image(systemName: AchievementWording.symbol(definition.icon))
                                .foregroundStyle(AchievementWording.color(definition.rarity))
                            Text(verbatim: definition.name.resolved(language)).foregroundStyle(Theme.textPrimary)
                            Text(verbatim: "+\(definition.points)").foregroundStyle(Theme.textSecondary)
                        }
                        .font(Theme.Font.label)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Theme.card, in: Capsule())
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            .padding(.horizontal, SettingsMetrics.cardMargin)
        }
        .accessibilityIdentifier("achievements-recent")
    }

    // MARK: Tabs and cards

    private var tabs: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach([nil] + AchievementCategory.allCases.map(Optional.some), id: \.self) { item in
                        Button {
                            Haptics.selection()
                            category = item
                        } label: {
                            Text(AchievementWording.categoryLabel(item))
                                .font(Theme.Font.labelMedium)
                                .foregroundStyle(category == item ? Theme.primaryInk : Theme.textPrimary)
                                .padding(.horizontal, 11)
                                .padding(.vertical, 7)
                                .background(category == item ? Theme.primaryFill : Theme.card, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(category == item ? .isSelected : [])
                        .accessibilityIdentifier("achievements-tab.\(item?.rawValue ?? "all")")
                    }
                }
                .padding(.leading, SettingsMetrics.cardMargin)
            }
            Menu {
                Picker(selection: $filter) {
                    ForEach(AchievementFilter.allCases, id: \.self) { Text(AchievementWording.filterLabel($0)).tag($0) }
                } label: { Text("Show") }
            } label: {
                HStack(spacing: 3) {
                    Text(AchievementWording.filterLabel(filter))
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
                }
                .font(Theme.Font.labelMedium)
                .foregroundStyle(Theme.textSecondary)
            }
            .accessibilityLabel(Text("Show"))
            .accessibilityIdentifier("achievements-filter")
            .padding(.trailing, SettingsMetrics.cardMargin + 4)
        }
        .padding(.bottom, 10)
    }

    private func cards(_ snapshot: AchievementSnapshot) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 10)], spacing: 10) {
            ForEach(snapshot.cards(category: category, filter: filter)) { definition in
                AchievementCard(definition: definition, state: snapshot.state(definition.id), language: language)
            }
        }
        .padding(.horizontal, SettingsMetrics.cardMargin)
    }

    // MARK: Switches

    private func switches(_ snapshot: AchievementSnapshot) -> some View {
        let settings = snapshot.settings
        return SettingsCard {
            SettingsRow(title: "Show my points in the sidebar", subtitle: "The trophy line under your name.",
                        accessory: .toggle(binding(settings.showPoints) { AchievementSettingsPatch(showPoints: $0) }),
                        identifier: "achievements-show-points")
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Unlock banners", subtitle: "A short banner when you unlock something. Its sound follows Notification sounds.",
                        accessory: .toggle(binding(settings.toasts) { AchievementSettingsPatch(toasts: $0) }),
                        identifier: "achievements-toasts")
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "System notification in the background", subtitle: "When the app is not in front, your phone shows the unlock.",
                        accessory: .toggle(Binding(get: { settings.native }, set: { on in
                            Task {
                                // Turning it on asks for notifications first.
                                if on { _ = await NotificationCoordinator.shared.requestAuthorization() }
                                await store.update(AchievementSettingsPatch(native: on))
                            }
                        })),
                        identifier: "achievements-native")
            CardHairline(leadingInset: SettingsMetrics.rowInset)
            SettingsRow(title: "Show my points to colleagues", subtitle: "Off: only you see your achievements.",
                        accessory: .toggle(binding(settings.public) { AchievementSettingsPatch(public: $0) }),
                        identifier: "achievements-public")
        }
    }

    private func binding(_ value: Bool, _ patch: @escaping (Bool) -> AchievementSettingsPatch) -> Binding<Bool> {
        Binding(get: { value }, set: { on in Task { await store.update(patch(on)) } })
    }
}

/// One achievement: icon, name, description (or the secret's hint), points,
/// progress, rarity, how many people have it, and the first reward.
struct AchievementCard: View {
    @Environment(\.themePalette) var themePalette
    let definition: AchievementDefinition
    let state: AchievementItemState?
    let language: String?

    private var unlocked: Bool { state?.unlocked == true }
    private var secret: Bool { definition.hidden && !unlocked }

    var body: some View {
        let tint = AchievementWording.color(definition.rarity)
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: secret ? "lock.fill" : AchievementWording.symbol(definition.icon))
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(unlocked ? .white : Theme.textSecondary)
                .frame(width: 40, height: 40)
                .background(unlocked ? tint : Theme.inset, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(secret ? String(localized: "Secret achievement") : definition.name.resolved(language))
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(unlocked ? Theme.textPrimary : Theme.textSecondary)
                    Spacer(minLength: 4)
                    Text(verbatim: "\(definition.points)")
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(tint)
                }
                Text(secret ? (definition.hint?.resolved(language) ?? String(localized: "Keep exploring to find it.")) : definition.description.resolved(language))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let state, state.showsProgress {
                    HStack(spacing: 6) {
                        ProgressView(value: Double(state.current), total: Double(max(state.target, 1))).tint(tint)
                        Text(verbatim: "\(state.current)/\(state.target)")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                HStack(spacing: 6) {
                    Text(AchievementWording.rarityLabel(definition.rarity)).textCase(.uppercase).foregroundStyle(tint)
                    if let percent = state?.percent {
                        Text("\(percent)% of people")
                    }
                    if !secret, let reward = definition.rewards.first {
                        Text(verbatim: AchievementWording.rewardLabel(reward, language: language)).lineLimit(1)
                    }
                }
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
        .opacity(unlocked ? 1 : 0.85)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(unlocked ? .isSelected : [])
        .accessibilityIdentifier("achievement.\(definition.id)")
    }
}

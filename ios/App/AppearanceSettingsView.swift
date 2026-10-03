// Settings > Appearance: every skin, with a small live preview like the
// desktop's picker (name, tagline, a miniature drawn in the skin's own
// colours), how the skin is chosen (follow the phone with a light and a dark
// skin, one skin always, or the computer's own), and the font.
import SwiftUI
import CompanionCore

struct AppearanceSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var themes = ThemeStore.shared
    @AppStorage(RunCardPreference.key) private var showRunCard = true

    /// The skin in effect (a DEBUG launch override included).
    private var selection: ThemeSelection { themes.effective }
    private var client: CompanionClient? { session.settingsClient }

    var body: some View {
        SettingsPage(title: "Appearance") {
            SettingsCard {
                modeRow(.system, title: "Match the phone", subtitle: "A light skin and a dark skin, switching with the phone.")
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                modeRow(.fixed, title: "Always one skin", subtitle: "The same skin whatever the phone's appearance.")
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                modeRow(.computer, title: "Same as my computer", subtitle: "The skin and font chosen on the computer. A skin picked here is saved there too.")
            }

            switch selection.mode {
            case .system:
                SettingsSectionLabel(text: "Light")
                skinGrid(SkinID.visible(retroUnlocked: themes.retroUnlocked, active: selection.lightSkin).filter { !$0.isDark }, selected: selection.lightSkin, slot: "light")
                SettingsSectionLabel(text: "Dark")
                skinGrid(SkinID.visible(retroUnlocked: themes.retroUnlocked, active: selection.darkSkin).filter(\.isDark), selected: selection.darkSkin, slot: "dark")
            case .fixed:
                SettingsSectionLabel(text: "Skin")
                skinGrid(SkinID.visible(retroUnlocked: themes.retroUnlocked, active: selection.fixedSkin), selected: selection.fixedSkin, slot: "fixed")
            case .computer:
                if let error = themes.computerError {
                    SettingsFooter(text: LocalizedStringKey(error))
                }
                SettingsSectionLabel(text: "Computer's skin")
                skinGrid(
                    SkinID.visible(retroUnlocked: themes.retroUnlocked, active: selection.computerSkin).filter { !$0.phoneOnly },
                    selected: selection.computerSkin ?? .pulsatrix,
                    slot: "computer"
                )
            }

            SettingsSectionLabel(text: "Font")
            SettingsCard {
                fontRow(.skin, title: "Skin default")
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                fontRow(.system, title: "System")
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                fontRow(.serif, title: "Serif")
            }
            SettingsFooter(text: "Black is the phone's own look. The other skins are the computer's, with the same colours.")

            // the thread switch and what is hidden from the home (WP6)
            SidebarAppearanceSettings()

            // the run card above the composer (ST4, SettingsModal RunCardRow)
            SettingsSectionLabel(text: "Chat")
            SettingsCard {
                SettingsRow(
                    title: "This run",
                    subtitle: "Show a list of the shell commands a bot ran for your current request. Turn it off to hide the card and its shortcut for saving the run as a skill.",
                    accessory: .toggle($showRunCard),
                    identifier: "settings.runCard"
                )
            }
        }
        .task(id: selection.mode) {
            if selection.mode == .computer { await themes.refreshFromComputer(client: client) }
        }
    }

    private func modeRow(_ mode: ThemeMode, title: LocalizedStringKey, subtitle: String) -> some View {
        SettingsRow(
            title: title,
            subtitle: subtitle,
            accessory: selection.mode == mode ? .check : .none,
            identifier: "theme.mode.\(mode.rawValue)"
        ) {
            themes.update { $0.mode = mode }
        }
    }

    private func fontRow(_ font: SkinFontChoice, title: LocalizedStringKey) -> some View {
        let current = selection.mode == .computer ? (selection.computerFont ?? .skin) : selection.font
        let selected = current == font || (font == .system && (current == .inter || current == .poppins))
        return SettingsRow(title: title, accessory: selected ? .check : .none, identifier: "theme.font.\(font.rawValue)") {
            themes.chooseFont(font, client: client)
        }
    }

    /// Two previews a row. Not lazy: thirteen cards at most, and every one
    /// exists for VoiceOver and the UI tests as soon as the page does.
    private func skinGrid(_ skins: [SkinID], selected: SkinID, slot: String) -> some View {
        let rows = stride(from: 0, to: skins.count, by: 2).map { Array(skins[$0..<min($0 + 2, skins.count)]) }
        return VStack(spacing: 10) {
            ForEach(rows, id: \.first) { row in
                HStack(alignment: .top, spacing: 10) {
                    ForEach(row) { skin in
                        SkinPreviewCard(skin: skin, selected: skin == selected, identifier: "skin.\(slot).\(skin.rawValue)") {
                            if slot == "computer" {
                                themes.choose(skin, client: client)
                            } else if slot == "fixed" {
                                themes.update { $0.fixedSkin = skin }
                            } else {
                                themes.update { skin.isDark ? ($0.darkSkin = skin) : ($0.lightSkin = skin) }
                            }
                        }
                    }
                    if row.count == 1 { Color.clear.frame(maxWidth: .infinity) }
                }
            }
        }
        .padding(.horizontal, 23.17)
    }
}

/// One skin in the picker: a miniature in its own colours (a header bar, an
/// assistant and a user bubble, an accent button), then its name and tagline.
/// It draws from the skin's palette, never the active one, like the desktop's
/// live `[data-skin]` miniatures.
struct SkinPreviewCard: View {
    @Environment(\.themePalette) var themePalette
    let skin: SkinID
    let selected: Bool
    var identifier: String?
    let action: () -> Void

    var body: some View {
        let p = skin.palette
        Button {
            Haptics.selection()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                miniature(p)
                    .frame(height: 74)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Metric.cardRadius == 0 ? 0 : 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Metric.cardRadius == 0 ? 0 : 10, style: .continuous)
                            .strokeBorder(selected ? Theme.accent : Theme.hairline, lineWidth: selected ? 2 : 1)
                    )
                HStack(spacing: 4) {
                    Text(verbatim: skin.name)
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if selected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.accentText)
                    }
                }
                .padding(.top, 8)
                Text(LocalizedStringKey(skin.tagline))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: skin.name))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(identifier ?? "skin.\(skin.rawValue)")
    }

    private func miniature(_ p: SkinPalette) -> some View {
        ZStack(alignment: .topLeading) {
            (p.bevelled ? p.desktop : p.bg).color
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 4) {
                    Circle().fill(p.glassFill.color).frame(width: 10, height: 10)
                    Capsule().fill(p.textSecondary.color.opacity(0.6)).frame(width: 30, height: 4)
                    Spacer()
                    Circle().fill(p.accent.color).frame(width: 10, height: 10)
                }
                RoundedRectangle(cornerRadius: p.bevelled ? 0 : 6, style: .continuous)
                    .fill(p.bubbleAssistant.color)
                    .frame(width: 70, height: 16)
                    .overlay(alignment: .leading) {
                        Capsule().fill(p.bubbleAssistantText.color).frame(width: 46, height: 3).padding(.leading, 6)
                    }
                HStack {
                    Spacer()
                    RoundedRectangle(cornerRadius: p.bevelled ? 0 : 6, style: .continuous)
                        .fill(p.bubbleUser.color)
                        .frame(width: 52, height: 16)
                        .overlay(alignment: .leading) {
                            Capsule().fill(p.bubbleUserText.color).frame(width: 32, height: 3).padding(.leading, 6)
                        }
                }
            }
            .padding(8)
        }
    }
}

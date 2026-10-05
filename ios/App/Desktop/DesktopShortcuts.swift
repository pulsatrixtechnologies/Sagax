// iPad I-sync: the keyboard shortcuts sheet as the desktop's modal
// (`KeyboardShortcutsModal.tsx`): a 500 pt box, radius 16, `bg-panel`, over
// a 60 % scrim; the header (the accent keyboard tile, "Keyboard Shortcuts"
// 16 semibold, "Quick commands and navigation" 12), the search field, the
// groups (11 pt uppercase headings, rows 13 pt with key caps 11.5 mono
// semibold in `bg-control`), and the foot (the hint and Done).
//
// It lists what the iPad answers (DesktopKeyCommands, the composer's
// Return, ⌘F, Escape, the app menu's ⌘,): the desktop's Live call and
// group-instruction keys have no iPad counterpart and are left out.
import SwiftUI
import CompanionCore

struct DesktopShortcut: Identifiable {
    let id: String
    let description: String
    let keys: [String]
}

struct DesktopShortcutGroup: Identifiable {
    let category: String
    let items: [DesktopShortcut]
    var id: String { category }

    static var all: [DesktopShortcutGroup] {
        [
            DesktopShortcutGroup(category: AppStrings.localized("Navigation"), items: [
                DesktopShortcut(id: "palette", description: AppStrings.localized("Open command palette (switcher & transcript search)"), keys: ["⌘", "K"]),
                DesktopShortcut(id: "new", description: AppStrings.localized("Search or create a bot"), keys: ["⌘", "N"]),
                DesktopShortcut(id: "jump", description: AppStrings.localized("Jump to bot 1–9 in the roster"), keys: ["⌘", "1–9"]),
                DesktopShortcut(id: "step", description: AppStrings.localized("Switch to previous / next bot"), keys: ["⌘", "⇧", "[ / ]"]),
                DesktopShortcut(id: "find", description: AppStrings.localized("Find in conversation"), keys: ["⌘", "F"]),
            ]),
            DesktopShortcutGroup(category: AppStrings.localized("Chat & Composer"), items: [
                DesktopShortcut(id: "send", description: AppStrings.localized("Send message"), keys: ["Return"]),
                DesktopShortcut(id: "newline", description: AppStrings.localized("Insert new line without sending"), keys: ["⇧", "Return"]),
                DesktopShortcut(id: "close", description: AppStrings.localized("Close active drawer, modal, or find bar"), keys: ["Esc"]),
                DesktopShortcut(id: "sheet", description: AppStrings.localized("Show keyboard shortcuts cheat sheet"), keys: ["⌘", "/"]),
            ]),
            DesktopShortcutGroup(category: AppStrings.localized("Workspace"), items: [
                DesktopShortcut(id: "sidebar", description: AppStrings.localized("Collapse or expand the sidebar"), keys: ["⌘", "\\"]),
                DesktopShortcut(id: "settings", description: AppStrings.localized("Settings"), keys: ["⌘", ","]),
            ]),
        ]
    }

    /// `filterShortcutGroups`: the rows whose description or keys contain the query.
    static func filtered(_ query: String) -> [DesktopShortcutGroup] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return all }
        return all.compactMap { group in
            let items = group.items.filter { item in
                item.description.lowercased().contains(q) || item.keys.joined(separator: " ").lowercased().contains(q)
                    || group.category.lowercased().contains(q)
            }
            return items.isEmpty ? nil : DesktopShortcutGroup(category: group.category, items: items)
        }
    }
}

struct DesktopShortcutsModal: View {
    @Environment(\.desktopTheme) private var theme
    let close: () -> Void
    @State private var query = ""
    @FocusState private var searching: Bool

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.6)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                AnyView(box)
                    .frame(width: min(500, geometry.size.width - 32))
                    .frame(maxHeight: geometry.size.height * 0.85)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: close))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-shortcuts")
    }

    private var box: some View {
        VStack(spacing: 0) {
            AnyView(header)
            AnyView(search)
            ScrollView {
                AnyView(list)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
            }
            AnyView(foot)
        }
        .background(theme.panel)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 25, y: 12)
    }

    private var header: some View {
        HStack(spacing: 10) {
            DesktopIconView(icon: .keyboard, size: 18)
                .foregroundStyle(theme.accentText)
                .frame(width: 32, height: 32)
                .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                Text("Keyboard Shortcuts").font(theme.font(16, .semibold)).foregroundStyle(theme.ink).frame(height: 24)
                Text("Quick commands and navigation").font(theme.font(12)).foregroundStyle(theme.inkSecondary).frame(height: 18)
            }
            Spacer(minLength: 0)
            Button(action: close) {
                DesktopSettingsIconView(icon: .x, size: 18)
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
            .accessibilityLabel(Text("Close keyboard shortcuts"))
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
    }

    private var search: some View {
        HStack(spacing: 8) {
            DesktopSettingsIconView(icon: .search, size: 14)
                .foregroundStyle(theme.inkSecondary)
            TextField("", text: $query, prompt: Text("Search shortcuts…").foregroundColor(theme.inkSecondary))
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .tint(theme.focus)
                .focused($searching)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel(Text("Search shortcuts"))
        }
        .padding(.horizontal, 12)
        .frame(height: 33.5)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(searching ? theme.focus : theme.hairline.opacity(0.4), lineWidth: 1))
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1) }
    }

    @ViewBuilder
    private var list: some View {
        let groups = DesktopShortcutGroup.filtered(query)
        if groups.isEmpty {
            Text("No shortcuts found for “\(query)”")
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
        } else {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: group.category.uppercased())
                            .font(theme.font(11, .semibold))
                            .tracking(0.55)
                            .foregroundStyle(theme.inkTertiary)
                        VStack(spacing: 0) {
                            ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                                if index > 0 { Rectangle().fill(theme.hairline.opacity(0.2)).frame(height: 1) }
                                AnyView(row(item))
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(theme.card.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.3), lineWidth: 1))
                    }
                }
            }
        }
    }

    private func row(_ item: DesktopShortcut) -> some View {
        HStack(spacing: 16) {
            Text(verbatim: item.description)
                .font(theme.font(13))
                .foregroundStyle(theme.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 4) {
                ForEach(Array(item.keys.enumerated()), id: \.offset) { _, key in
                    Text(verbatim: key)
                        .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 22, minHeight: 23)
                        .background(theme.control, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
                }
            }
            .fixedSize()
        }
        .padding(.vertical, 6)
        .frame(minHeight: 36)
        .accessibilityElement(children: .combine)
    }

    private var foot: some View {
        HStack {
            Text("Press ⌘ / to open")
                .font(theme.font(11.5))
                .foregroundStyle(theme.inkSecondary)
            Spacer(minLength: 0)
            Button(action: close) {
                Text("Done")
                    .font(theme.font(11.5, .medium))
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 12)
                    .frame(height: 25)
                    .background(theme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(theme.card.opacity(0.3))
        .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
    }
}

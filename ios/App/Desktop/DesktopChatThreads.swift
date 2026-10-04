// iPad I3b: the chat header's thread picker (TaskPicker.tsx), shown while
// Appearance > Show threads is on: a 36 pt round button (lucide
// messages-square) between Export and the panel toggle, opening a 300 pt
// card under it: a search, the bot's threads (the current one checked,
// "just now" under each title, pin / rename / delete on hover; the same
// actions on a long press), then New thread.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopThreadPickerButton: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    @Binding var open: Bool

    static let messagesSquare = [
        "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z",
    ]

    var body: some View {
        Button { open.toggle() } label: {
            DesktopLucideGlyph(paths: Self.messagesSquare, size: 18, strokeWidth: 1.75)
                .foregroundStyle(theme.ink)
                .frame(width: 36, height: 36)
                .background(open ? theme.elevatedHover : theme.elevated, in: Circle())
                .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(Text("All threads"))
        .accessibilityIdentifier("desktop-thread-picker")
        .overlay(alignment: .topTrailing) {
            if open {
                DesktopThreadPickerCard(bot: bot, close: { open = false })
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: 300)
                    .alignmentGuide(.top) { d in d[.top] - 40 }
                    .transition(.opacity)
            }
        }
        .zIndex(1)
    }
}

struct DesktopThreadPickerCard: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let close: () -> Void
    @State private var query = ""
    @FocusState private var searching: Bool

    var body: some View {
        let live = session.state.bot(bot.id) ?? bot
        let tasks = live.threadGroups(matching: query, queuedThreadIds: session.state.queuedThreadIds).flatMap(\.tasks)
        VStack(alignment: .leading, spacing: 0) {
            search.padding(.horizontal, 8).padding(.top, 6).padding(.bottom, 4)
            ScrollView {
                VStack(spacing: 0) {
                    if tasks.isEmpty {
                        Text("No thread matches “\(query)”")
                            .font(theme.font(13))
                            .foregroundStyle(theme.inkSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    }
                    ForEach(tasks, id: \.threadId) { task in
                        DesktopThreadPickerRow(task: task, bot: live, close: close)
                    }
                }
            }
            .frame(maxHeight: 320)
            .fixedSize(horizontal: false, vertical: tasks.count < 6)
            Button {
                close()
                Task {
                    if let created = await session.createRosterThread(for: live) { model.open(.bot(created)) }
                }
            } label: {
                HStack(spacing: 8) {
                    DesktopLucideGlyph(paths: ["M5 12h14", "M12 5v14"], size: 12)
                    Text("New thread").lineLimit(1)
                }
                .font(theme.font(12))
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 35, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
            .padding(.top, 4)
            .accessibilityIdentifier("desktop-thread-picker-new")
        }
        .padding(.vertical, 4)
        .padding(1)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 25, y: 25)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-thread-picker-card")
    }

    private var search: some View {
        HStack(spacing: 8) {
            DesktopIconView(icon: .search, size: 13)
                .foregroundStyle(theme.inkSecondary)
            TextField("", text: $query, prompt: Text("Search threads").foregroundColor(theme.inkSecondary))
                .font(theme.font(12.5))
                .foregroundStyle(theme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($searching)
                .onSubmit {
                    let live = session.state.bot(bot.id) ?? bot
                    if let first = live.threadGroups(matching: query, queuedThreadIds: session.state.queuedThreadIds).flatMap(\.tasks).first,
                       let projected = live.projected(forThread: first.threadId) {
                        model.open(.bot(projected))
                    }
                    close()
                }
        }
        .padding(.horizontal, 10)
        .frame(height: 32.8)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(searching || Self.parityFocused ? theme.focus : theme.hairline.opacity(0.4), lineWidth: 1)
        )
    }

    #if DEBUG
    /// The reference opens with the search focused (autoFocus).
    static var parityFocused: Bool { ParityLaunch.current?.iPadScreen == .chatThreads }
    #else
    static let parityFocused = false
    #endif
}

private struct DesktopThreadPickerRow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let task: BotTask
    let bot: Bot
    let close: () -> Void
    @State private var hovering = false

    var body: some View {
        let active = (model.selected?.threadId ?? bot.threadId) == task.threadId
        let actions = model.threadActions
        let target = { ThreadTarget(task: task, owner: actions.liveOwner(.bot(bot), in: session)) }
        HStack(spacing: 8) {
            DesktopLucideGlyph(paths: ["M20 6 9 17l-5-5"], size: 13)
                .foregroundStyle(theme.accent)
                .opacity(active ? 1 : 0)
            Button {
                if !active, let projected = bot.projected(forThread: task.threadId) { model.open(.bot(projected)) }
                close()
            } label: {
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: task.displayTitle)
                        .font(theme.font(13))
                        .foregroundStyle(theme.ink)
                        .lineLimit(1)
                        .frame(height: 19.5)
                    Text(verbatim: status)
                        .font(theme.font(11))
                        .foregroundStyle(theme.inkSecondary)
                        .lineLimit(1)
                        .frame(height: 16.5)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Group {
                rowTool(task.pinned == true ? .pinOff : .pin, label: task.pinned == true ? "Unpin" : "Pin") {
                    actions.perform(.pin(task.pinned != true), on: target(), session: session)
                }
                rowTool(.pencil, label: "Rename thread") {
                    close()
                    actions.perform(.rename, on: target(), session: session)
                }
                rowTool(.trash, label: "Delete thread") {
                    close()
                    actions.perform(.delete, on: target(), session: session)
                }
                .disabled(task.busy == true)
            }
            .opacity(hovering ? 1 : 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(minHeight: 52)
        .background(active ? theme.raised.opacity(0.6) : (hovering ? theme.raised.opacity(0.4) : .clear))
        .onHover { hovering = $0 }
        .threadMenu(task, owner: .bot(bot), actions: actions, session: session)
        .accessibilityIdentifier("desktop-thread-picker.\(task.threadId)")
    }

    /// "Working · just now", "Unread · 5 min ago", or the time alone.
    private var status: String {
        let ago = BotAdvancedWording.ago(task.listStamp)
        let state: String? = if task.activity == "waiting-on-you" {
            String(localized: "Waiting")
        } else if task.waitingOnTeammate == true {
            String(localized: "Waiting on a teammate")
        } else if task.busy == true {
            String(localized: "Working")
        } else if task.unread == true {
            String(localized: "Unread")
        } else {
            nil
        }
        return state.map { "\($0) · \(ago)" } ?? ago
    }

    private func rowTool(_ icon: DesktopIcon, label: LocalizedStringKey, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: 13)
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 21, height: 21)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }
}

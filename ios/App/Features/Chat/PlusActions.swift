// The composer's "+" sheet and its action list: the one registry new chat
// actions are added to, drawn exactly as before the split. WP3 adds Paste,
// the real "/" menu, Compact and a room's Interrupt.
import SwiftUI
import CompanionCore
import UIKit

extension ChatView {
    // MARK: - The + sheet

    /// What the composer's + opens: a glass sheet of the things you can do
    /// here, each with a line saying what it does. Rises above the composer;
    /// tapping anywhere else, or the × the + became, puts it away.
    @ViewBuilder
    var plusSheet: some View {
        if showingPlus {
            ZStack(alignment: .bottom) {
                Color.black.opacity(Theme.palette.isDark ? 0.35 : 0.2)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.snappy(duration: 0.28)) { showingPlus = false } }

                // Every action fits on a tall phone; on a shorter one (or with
                // larger text) the list scrolls instead of leaving the screen.
                ViewThatFits(in: .vertical) {
                    plusActionList
                    ScrollView(showsIndicators: false) { plusActionList }
                }
                .padding(.vertical, 10)
                .frame(maxWidth: CompanionLayout.chatWidth, alignment: .leading)
                .glassSheet(cornerRadius: 30)
                .padding(.horizontal, 12)
                // above the composer row (30 pt bottom inset, 44 pt tall)
                .padding(.bottom, Theme.Chat.composerBottom + Theme.Metric.glassLarge + 12)
                .frame(maxWidth: .infinity)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            .transition(.opacity)
        }
    }

    var plusActionList: some View {
        VStack(spacing: 0) {
            ForEach(plusActions) { action in
                Button {
                    withAnimation(.snappy(duration: 0.28)) { showingPlus = false }
                    action.run()
                } label: {
                    HStack(spacing: 16) {
                        Image(systemName: action.systemImage)
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(action.destructive ? Theme.destructiveMenu : Theme.textPrimary)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(Theme.textPrimary.opacity(0.10)))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(action.title)
                                .font(.system(size: 19, weight: .medium))
                                .foregroundStyle(action.destructive ? Theme.destructiveMenu : Theme.textPrimary)
                            Text(action.subtitle)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 18)
                    .frame(height: 64)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(action.disabled)
                .opacity(action.disabled ? 0.45 : 1)
                .accessibilityIdentifier("plus-\(action.id)")
            }
        }
    }

    struct PlusAction: Identifiable {
        let id: String
        let systemImage: String
        let title: LocalizedStringKey
        let subtitle: LocalizedStringKey
        var destructive = false
        var disabled = false
        let run: () -> Void
    }

    var plusActions: [PlusAction] {
        let canAddAttachment = attachments.count < AttachmentPolicy.maximumItems
            && !preparingAttachments && !sendingMessage
        var out: [PlusAction] = [
            PlusAction(
                id: "photos", systemImage: "photo.on.rectangle", title: "Photo Library",
                subtitle: "Add a photo to this message", disabled: !canAddAttachment
            ) { showingPhotoPicker = true },
            PlusAction(
                id: "files", systemImage: "paperclip", title: "Choose File",
                subtitle: "Add a document from Files", disabled: !canAddAttachment
            ) { showingFileImporter = true },
        ]
        if session.surfaceGate.allows(.pasteAttachment), UIPasteboard.general.hasImages || UIPasteboard.general.hasStrings {
            out.append(PlusAction(
                id: "paste", systemImage: "doc.on.clipboard", title: "Paste",
                subtitle: "Add the copied image or text", disabled: !canAddAttachment
            ) { pasteFromClipboard() })
        }
        out.append(PlusAction(
            id: "commands", systemImage: "command",
            title: LocalizedStringKey(String(localized: "Slash commands")),
            subtitle: LocalizedStringKey(String(localized: "Engine commands, /learn, /setup and more")),
            disabled: preparingAttachments || sendingMessage
        ) {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) { openCommandMenu() }
        })
        if session.surfaceGate.allows(.findInConversation) {
            out.append(PlusAction(
                id: "find", systemImage: "magnifyingglass",
                title: LocalizedStringKey(String(localized: "Find in conversation")),
                subtitle: LocalizedStringKey(String(localized: "Search this thread's messages"))
            ) { openFind() })
        }
        if case let .bot(bot) = current {
            out.append(PlusAction(
                id: "task", systemImage: "plus.square.on.square", title: "New thread",
                subtitle: "Start a fresh thread with \(bot.name)"
            ) { Task {
                if let created = await session.createTask(for: bot, title: nil) {
                    selectedThreadId = created.threadId
                }
            } })
            out.append(PlusAction(
                id: "tasks", systemImage: "square.stack", title: "Threads",
                subtitle: "Switch, rename or remove one"
            ) { showingTasks = true })
            out.append(PlusAction(
                id: "settings", systemImage: "gearshape", title: "Bot settings",
                subtitle: "Model, profile, voice and notifications"
            ) { openProfile() })
            if session.surfaceGate.allows(.compactConversation) {
                out.append(PlusAction(
                    id: "compact", systemImage: "rectangle.compress.vertical", title: "Compact conversation",
                    subtitle: "Summarize the context to free room", disabled: current.busy || hasPendingApproval
                ) { Task {
                    if await session.compact(bot: bot) { Haptics.impact(.light) }
                } })
            }
            out.append(PlusAction(
                id: "computer", systemImage: "display", title: "Watch computer",
                subtitle: "Live view of what \(bot.name) is doing"
            ) { showingComputer = true })
            out.append(PlusAction(
                id: "voice", systemImage: "waveform",
                title: LocalizedStringKey(String(localized: "Voice mode")),
                subtitle: LocalizedStringKey(String(localized: "Talk to \(bot.name) hands-free"))
            ) { startVoiceMode() })
        }
        if case let .room(room) = current, room.dm != true {
            out.append(PlusAction(
                id: "task", systemImage: "plus.square.on.square", title: "New thread",
                subtitle: "Start a fresh conversation in \(room.name)",
                disabled: current.busy || hasPendingApproval
            ) { Task { await session.createTask(for: room, title: nil) } })
            out.append(PlusAction(
                id: "tasks", systemImage: "square.stack", title: "Threads",
                subtitle: "Switch, rename or remove one"
            ) { showingTasks = true })
            // WP11 (RM11): the desktop's Goal chip. A typed "/goal …" sends
            // as a bounded team goal; tapping again takes it back out.
            out.append(PlusAction(
                id: "goal", systemImage: "target",
                title: LocalizedStringKey(String(localized: "Goal")),
                subtitle: LocalizedStringKey(String(localized: "Finish together: the team keeps working until the goal is complete"))
            ) { toggleRoomGoal() })
            out.append(PlusAction(
                id: "room-info", systemImage: "info.circle",
                title: LocalizedStringKey(String(localized: "Group info")),
                subtitle: LocalizedStringKey(String(localized: "Members, instructions, memory"))
            ) { showingRoomInfo = true })
        }
        out.append(PlusAction(
            id: "share", systemImage: "doc.plaintext", title: "Share transcript",
            subtitle: "This thread as Markdown"
        ) {
            Task {
                if let url = await session.export(threadId: current.threadId, format: "markdown") {
                    shareFile = ShareFile(url: url)
                }
            }
        })
        out.append(PlusAction(
            id: "share-json", systemImage: "curlybraces", title: "Share as JSON",
            subtitle: "Structured transcript data"
        ) {
            Task {
                if let url = await session.export(threadId: current.threadId, format: "json") {
                    shareFile = ShareFile(url: url)
                }
            }
        })
        if current.busy, case let .bot(bot) = current {
            out.append(PlusAction(
                id: "stop", systemImage: "stop.fill", title: "Interrupt",
                subtitle: "Stop the current turn", destructive: true
            ) { Task { await session.interrupt(bot: bot) } })
        }
        if current.busy, case let .room(room) = current, session.surfaceGate.allows(.roomInterrupt) {
            let thread = threadId
            out.append(PlusAction(
                id: "stop", systemImage: "stop.fill", title: "Interrupt",
                subtitle: "Stop the current turn", destructive: true
            ) { Task { await session.interrupt(room: room, threadId: thread) } })
        }
        return out
    }
}

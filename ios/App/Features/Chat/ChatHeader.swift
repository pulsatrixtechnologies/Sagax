// The chat's top bar (reference 02): back, the name capsule and its menu,
// and the computer button. Split out of ChatView.swift so the iPhone and the
// iPad desktop layout share it.
import SwiftUI
import CompanionCore

extension ChatView {
    var mascotState: MausState { MausState.forChat(current, in: session.state) }

    var headerBar: some View {
        ZStack {
            HStack(spacing: 0) {
                // chevron ink 8.7 x 15.3 pt, optically centred at x 39.7
                GlassCircleButton(
                    systemImage: "chevron.left", accessibilityLabel: "Back",
                    glyphSize: 18, glyphOffset: CGSize(width: 0.85, height: -0.25)
                ) { dismiss() }
                    .chatGlassRim(Circle())
                    .overlay(alignment: .topTrailing) {
                        if unreadElsewhere > 0 {
                            Text(verbatim: "\(unreadElsewhere)")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Theme.accentInk)
                                .padding(.horizontal, 5)
                                .frame(minWidth: 18, minHeight: 18)
                                .background(Theme.unreadDot, in: Capsule())
                                .offset(x: 4, y: -4)
                                .allowsHitTesting(false)
                                .accessibilityLabel(Text(String(localized: "\(unreadElsewhere) unread elsewhere")))
                        }
                    }
                Spacer(minLength: 8)
                // Settings > Experimental's development context pods, while
                // the conversation looks like development work
                if devPodsAvailable {
                    DevPodsHeaderButton(active: showingDevPods) { openDevPods() }
                        .padding(.trailing, 8)
                        .transition(.opacity)
                }
                if case .bot = current {
                    // outline monitor, ink 18 x 16.7 pt (drawn: the SF
                    // symbols fill the screen)
                    Button {
                        Haptics.selection()
                        openPanel(.computerButton)
                    } label: {
                        ComputerGlyph()
                            .fill(Theme.textPrimary)
                            .frame(width: ComputerGlyph.size.width, height: ComputerGlyph.size.height)
                            .offset(y: 0.1)
                            .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .themeGlass(Circle())
                    .chatGlassRim(Circle())
                    .accessibilityLabel("Watch \(current.name)'s computer")
                    .accessibilityIdentifier("header-computer")
                } else {
                    Color.clear.frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                }
            }
            ChatNameCapsule(chat: current, state: mascotState) { openProfile() }
                // narrower beside the dev pods button, so the two never meet
                .frame(maxWidth: devPodsAvailable ? 170 : 230)
                .contextMenu { nameCapsuleMenu }
                .accessibilityLabel(Text(PeopleDirectory.shared.name(current, session: session)))
                // The thread is no longer drawn in the header; VoiceOver
                // (and the UI tests) still hear which one is open.
                .accessibilityValue(Text(current.supportsTasks ? current.threadTitle : current.subtitle))
                .accessibilityHint(Text(current.isBot
                    ? String(localized: "Opens the profile. Touch and hold for threads.")
                    : String(localized: "Opens the conversation options.")))
                .accessibilityIdentifier("chat-name")
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 6)
        .frame(maxWidth: CompanionLayout.headerWidth)
        .frame(maxWidth: .infinity)
    }

    /// Touch and hold the name: threads and the profile.
    @ViewBuilder
    var nameCapsuleMenu: some View {
        // A bot's threads live here while Threads location is the chat
        // header (#143, #210); in sidebar mode they are under its home row
        // and the header offers none. Rooms are unchanged.
        if current.supportsTasks, !current.isBot || SidebarPrefsModel.shared.threadsPlacement.inHeader {
            Button { showingTasks = true } label: {
                Label(String(localized: "Threads"), systemImage: "square.stack")
            }
            if case let .bot(bot) = current {
                Button {
                    Task {
                        if let created = await session.createTask(for: bot, title: nil) {
                            selectedThreadId = created.threadId
                        }
                    }
                } label: {
                    Label(String(localized: "New thread"), systemImage: "plus.square.on.square")
                }
            } else if case let .room(room) = current, room.peopleDm == true {
                // a person's conversation starts threads like a bot (#262)
                Button {
                    Task { _ = await session.createTask(for: room, title: nil) }
                } label: {
                    Label(String(localized: "New thread"), systemImage: "plus.square.on.square")
                }
            }
        }
        if case let .room(room) = current, room.peopleDm == true {
            // WP15 (RM21): a conversation with a person opens their sheet
            if let peer = PeopleDirectory.shared.peer(room, session: session) {
                Button { PeopleDirectory.shared.showPerson(peer.id) } label: {
                    Label(String(localized: "View profile"), systemImage: "person.crop.circle")
                }
            }
        } else if case let .room(room) = current, room.dm != true {
            Button { showingRoomInfo = true } label: {
                Label(String(localized: "Group info"), systemImage: "info.circle")
            }
        }
    }

    /// The name capsule opens the profile (rooms: their threads or the +
    /// sheet). `ChatProfileRoute` decides what the profile is and how it is
    /// presented.
    func openProfile() {
        // iPad desktop shell: the bot's profile is the docked panel.
        if let desktopChat, case .bot = current {
            desktopChat.showPanel(.details)
            return
        }
        guard case .bot = current else {
            // A conversation with a person opens their sheet (RM21), the
            // way the desktop's header name does.
            if case let .room(room) = current, room.peopleDm == true,
               let peer = PeopleDirectory.shared.peer(room, session: session) {
                PeopleDirectory.shared.showPerson(peer.id)
            // A team room opens its Room info (RM6); Threads is a row there.
            } else if case let .room(room) = current, room.dm != true {
                showingRoomInfo = true
            } else if current.supportsTasks {
                showingTasks = true
            } else {
                showingPlus = true
            }
            return
        }
        openPanel(.nameCapsule)
    }

    /// The bot panel on the door's tab: full screen on the phone, the docked
    /// panel in the iPad's desktop shell.
    func openPanel(_ door: BotPanelDoor) {
        guard case .bot = current else { return }
        if let desktopChat {
            desktopChat.showPanel(door.tab)
            return
        }
        panelTab = door.tab
        showingPanel = true
    }

    /// Voice mode: a live call with this bot or room (the desktop's call
    /// button in the composer). Pressed again on a call, it hangs up.
    func startVoiceMode() {
        dictation.stop()
        composerFocused = false
        let chat = current
        if call.isOnCall(chat) {
            call.end()
            return
        }
        Haptics.impact(.medium)
        Task { await call.start(chat, session: session) }
    }

    var callPillShown: Bool {
        call.isOnCall(current)
    }

    /// Who the bar calls: the bot, or the room with its members.
    private var callSubject: CallBarSubject {
        switch current {
        case let .bot(bot): .bot(bot)
        case let .room(room): .room(room, members: room.memberIds.compactMap { session.state.bot($0) })
        }
    }

    /// A call, with a bot or a room: the floating bar under the name, as on
    /// the desktop's bot call. It takes only its own row; the conversation
    /// stays on screen and its card (settings, transcript) lies over the thread.
    @ViewBuilder
    var callBar: some View {
        if callPillShown {
            CallBar(subject: callSubject, call: call, panel: $callPanel)
                .padding(.horizontal, CallBarMetrics.gutter)
                .padding(.top, Self.topBarHeight + (pinnedPreview == nil ? 0 : Self.pinnedBannerHeight) + CallBarMetrics.top)
                .frame(maxWidth: .infinity)
                .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
        }
    }

}

// The chat's top bar (reference 02): back, the name capsule and its menu,
// the computer button, and the island greeting. Split out of ChatView.swift
// unchanged so the iPhone and the future iPad desktop layout share it.
import SwiftUI
import CompanionCore
import UIKit

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
            ChatNameCapsule(chat: current, state: mascotState, mascotHidden: islandVisible) { openProfile() }
                .frame(maxWidth: 230)
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
        if current.supportsTasks {
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
        if case .bot = current { return call.isOnCall(current) }
        return false
    }

    /// Full-screen call. The chevron folds it; the conversation stays underneath.
    @ViewBuilder
    var callStage: some View {
        if case let .bot(bot) = current, call.isOnCall(current), !callCollapsed {
            CallPillView(bot: bot, call: call, onCollapse: { callCollapsed = true })
                .ignoresSafeArea()
        }
    }

    /// A short in-flow row. It does not cover the first message.
    @ViewBuilder
    var callCollapsedBar: some View {
        if callCollapsedBarShown, case let .bot(bot) = current {
            CallCollapsedBar(bot: bot, call: call, onExpand: { callCollapsed = false })
                .padding(.top, Self.topBarHeight + (pinnedPreview == nil ? 0 : Self.pinnedBannerHeight) + 4)
                .frame(maxWidth: .infinity)
        }
    }

    var callCollapsedBarShown: Bool {
        callCollapsed && callPillShown
    }

    @ViewBuilder
    var groupCall: some View {
        if case let .room(room) = current, call.isOnCall(current) {
            GroupCallOverlay(room: room, call: call)
                .transition(.opacity)
        }
    }

    /// The island greeting: the face grows in the island, then shrinks into
    /// the capsule's 24 pt mascot seat. One face in one layer, measured from
    /// the screen's top edge.
    var islandFace: some View {
        let topInset = IslandGeometry.topInset
        let islandSide: CGFloat = 220
        // centred in the part of the square the hardware island does not cover
        let islandFaceCentre = IslandGeometry.top + IslandGeometry.size.height + (islandSide - IslandGeometry.size.height) / 2
        let seatCentre = topInset + 6 + Theme.Metric.glassLarge / 2
        let seatSize = Theme.Chat.capsuleMascot
        let faceSize = seatSize + (132 - seatSize) * facePhase
        let faceCentre = seatCentre + (islandFaceCentre - seatCentre) * facePhase
        let seatOffsetX = Self.capsuleMascotOffset(name: current.name) * (1 - facePhase)
        let state = mascotState
        return ZStack(alignment: .top) {
            if islandVisible {
                IslandShell(expanded: islandExpanded, expandedSize: CGSize(width: islandSide, height: islandSide)) {
                    Color.clear
                }
                ChatAvatarView(chat: current, size: faceSize, state: state, animated: true, comets: islandExpanded)
                    .offset(x: seatOffsetX, y: faceCentre - faceSize / 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .ignoresSafeArea(edges: .top)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// The capsule mascot's centre relative to the screen's centre: the
    /// capsule is 12 + 24 + 10 + name + 14 wide and centred.
    static func capsuleMascotOffset(name: String) -> CGFloat {
        let nameWidth = ceil((name as NSString).size(withAttributes: [
            .font: UIFont.systemFont(ofSize: 14, weight: .medium),
        ]).width)
        let width = min(230, 12 + Theme.Chat.capsuleMascot + 10 + nameWidth + 14)
        return -width / 2 + 12 + Theme.Chat.capsuleMascot / 2
    }
}

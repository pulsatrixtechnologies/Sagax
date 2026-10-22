// Trailing swipe on a sidebar row reveals Pin / Unpin, like the reference design.
// The rows live in a ScrollView, so SwiftUI `.swipeActions` (List only) cannot
// apply; this offset + simultaneous drag is the same gesture on iPhone, iPad
// and the iOS app on Mac.
import CompanionCore
import SwiftUI

struct SidebarPinSwipe: ViewModifier {
    let pinned: Bool
    let pin: () -> Void
    @State private var offset: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .offset(x: offset)
            .background(alignment: .trailing) {
                if SidebarBotPinning.actionVisible(offset: Double(offset)) {
                Button {
                    pin()
                    withAnimation(.snappy(duration: 0.2)) { offset = 0 }
                } label: {
                    Label(
                        pinned ? String(localized: "Unpin") : String(localized: "Pin"),
                        systemImage: pinned ? "pin.slash" : "pin"
                    )
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.white)
                    .frame(width: CGFloat(SidebarBotPinning.revealDistance), height: 44)
                    .frame(maxHeight: .infinity)
                    .background(Color.accentColor)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(pinned ? "Unpin" : "Pin"))
                .accessibilityIdentifier(pinned ? "sidebar-swipe-unpin" : "sidebar-swipe-pin")
                .frame(width: CGFloat(SidebarBotPinning.actionWidth(offset: Double(offset))), alignment: .leading)
                .clipped()
                }
            }
            .clipped()
            .simultaneousGesture(
                DragGesture(minimumDistance: 24, coordinateSpace: .local)
                    .onChanged { value in
                        let dx = Double(value.translation.width)
                        let dy = Double(value.translation.height)
                        guard abs(dx) > abs(dy) else { return }
                        offset = CGFloat(SidebarBotPinning.clampedOffset(dx))
                    }
                    .onEnded { value in
                        let dx = Double(value.translation.width)
                        let dy = Double(value.translation.height)
                        withAnimation(.snappy(duration: 0.2)) {
                            offset = SidebarBotPinning.swipeRevealsAction(horizontal: dx, vertical: dy)
                                ? -CGFloat(SidebarBotPinning.revealDistance)
                                : 0
                        }
                    }
            )
    }
}

extension View {
    func sidebarPinSwipe(pinned: Bool, pin: @escaping () -> Void) -> some View {
        modifier(SidebarPinSwipe(pinned: pinned, pin: pin))
    }

    @ViewBuilder
    func sidebarBotPinSwipe(_ chat: Chat, session: Session) -> some View {
        if case let .bot(bot) = chat {
            sidebarBotPinSwipe(bot, session: session)
        } else {
            self
        }
    }

    func sidebarBotPinSwipe(_ bot: Bot, session: Session) -> some View {
        sidebarPinSwipe(pinned: bot.pinned == true) {
            Task { await session.setPinned(bot, pinned: bot.pinned != true) }
        }
    }
}

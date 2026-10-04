// iPad I4: the bot panel's Computer tab (`ComputerPanel` embedded, as the
// reference draws it): "Ara's screen" 13 secondary at y 313, the 16:10
// screen in a `bg-card` frame (radius 6) with the live picture or the power
// glyph and "This bot's computer is off", then the "Allow control of this
// computer" section (rounded-xl, hairline/40, shield glyph, chevron) that
// opens on Take control / Release and the full computer view. The picture
// and control are the phone's ComputerController (POST
// /api/bots/:id/computer/{screenshot,control}), the stream's frames first.
import SwiftUI
import UIKit
import CompanionCore

struct BotPanelComputer: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var controller: ComputerController
    @State private var controlOpen = false
    @State private var fullView = false

    init(bot: Bot) {
        self.bot = bot
        _controller = StateObject(wrappedValue: ComputerController(botId: bot.id, client: { nil }))
    }

    private var streamFrame: ScreenFrame? { session.state.screens[bot.id] }
    private var offline: Bool {
        if case .live = session.status { return false }
        return true
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(bot.name)'s screen")
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .frame(height: 19.5)
            AnyView(screen)
                .padding(.top, 6)
            AnyView(controlSection)
                .padding(.top, 16)
            if let notice = controller.notice {
                Text(verbatim: notice)
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 8)
            }
        }
        .padding(.top, 16)
        .padding(.leading, 16.5)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .onAppear {
            controller.attach { [weak session] in session?.computerClient }
            session.watchScreen(of: bot.id)
            controller.streamFrame(streamFrame?.data)
            controller.appear()
        }
        .onDisappear {
            controller.disappear()
            session.stopWatchingScreen(of: bot.id)
        }
        .onValueChange(of: streamFrame) { controller.streamFrame($0?.data) }
        .sheet(isPresented: $fullView) {
            NavigationStack { ComputerView(bot: bot) }
                .environmentObject(session)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-computer")
    }

    private var screen: some View {
        ZStack {
            theme.card
            if let image = controller.image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .accessibilityLabel(Text("\(bot.name)'s screen"))
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "power")
                        .font(.system(size: 19, weight: .regular))
                    Text(offline ? "This computer is offline" : "This bot's computer is off")
                        .font(theme.font(12))
                }
                .foregroundStyle(theme.inkSecondary)
            }
        }
        .aspectRatio(16 / 10, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { if controller.image != nil { fullView = true } }
    }

    private var controlSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { controlOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "shield")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 15)
                    Text("Allow control of this computer")
                        .font(theme.font(13, .medium))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.inkSecondary)
                        .rotationEffect(.degrees(controlOpen ? 180 : 0))
                }
                .padding(.horizontal, 16)
                .frame(height: 39.5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-computer-control")
            if controlOpen {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Take control to move the pointer and type on this computer from this iPad. The bot waits while you hold it.")
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.inkSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        if controller.isHeld {
                            PanelButton(title: "Release control", systemImage: "hand.raised.slash", prominent: true) {
                                Task { await controller.releaseControl() }
                            }
                        } else {
                            PanelButton(title: "Take control", systemImage: "cursorarrow.rays", prominent: true,
                                        disabled: controller.noComputer || offline || controller.phase == .taking) {
                                Task { await controller.takeControl() }
                            }
                        }
                        PanelButton(title: "Open full view", systemImage: "arrow.up.left.and.arrow.down.right") { fullView = true }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
    }
}

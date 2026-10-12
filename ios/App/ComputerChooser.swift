// The Computer tab's machine menu (`ScreenPicker` in ComputerMenu.tsx).
// The closed control and each option show the icon, the computer's full
// name (it wraps; it is never cut off) and its power (a dot and Éteint /
// Allumé, or the other states). "Works here" marks where the bot works.
// Picking one changes only what is shown, never the bot's Works on.
// Browser is the last choice where the server has the built-in browser.
// Shown only when there is more than one choice.
import SwiftUI
import CompanionCore

/// The person's desktops (`GET /api/me/desktop-bridge`), asked every 20
/// seconds while the Computer tab is on screen, and the power of each one
/// so the menu can name it. A server with no bridge (a solo server) answers
/// nothing and is not asked again.
@MainActor
final class ComputerChoicesModel: ObservableObject {
    @Published private(set) var bridge: PersonDesktopBridge?
    @Published private(set) var powers: [String: ComputerPower] = [:]

    private var provider: @MainActor () -> CompanionClient? = { nil }
    private var loop: Task<Void, Never>?
    private var stopped = false

    func start(_ provider: @escaping @MainActor () -> CompanionClient?) {
        self.provider = provider
        guard loop == nil, !stopped else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, await self.refresh() else { return }
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
    }

    /// False when this server has no bridge: stop asking.
    private func refresh() async -> Bool {
        guard let client = provider() else { return true }
        do {
            guard let next = try await client.personDesktopBridge() else {
                bridge = nil
                powers = [:]
                stopped = true
                return false
            }
            if next != bridge { bridge = next }
            await refreshPowers(client, choices: next.computerChoices())
        } catch {
            // Keep the last answer; the next poll asks again.
        }
        return true
    }

    /// One reading per listed computer. A miss keeps the previous word, and
    /// a computer that left the list drops out. Unknown stays unlabeled.
    private func refreshPowers(_ client: CompanionClient, choices: [ComputerChoice]) async {
        let listed = Set(choices.map(\.key))
        var next = powers.filter { listed.contains($0.key) }
        for choice in choices {
            do {
                switch choice {
                case .cloud:
                    next[choice.key] = ComputerPower.from(environment: try await client.serverEnvironment())
                case let .desktop(id, _, _):
                    let answer = try await client.localVm(action: .status, desktopId: id)
                    guard let status = answer.status else { continue }
                    next[choice.key] = ComputerPower.from(screen: LocalVmView.of(status: status, connected: true, pending: nil).state)
                }
            } catch {
                // Keep the last good reading for this computer.
            }
        }
        if next != powers { powers = next }
    }
}

/// The menu itself, in the colors of the screen it sits on.
struct ComputerChooser: View {
    struct Colors {
        var ink: Color
        var secondary: Color
        var card: Color
        var menu: Color
        var hairline: Color
        var field: Color
        var on: Color
        var off: Color
        var paused: Color
        var starting: Color
        var danger: Color
    }

    /// The key of browser mode's choice.
    static let browserKey = "browser"

    /// Cloud and each computer by its full name, or Screen, then Browser.
    static func rows(bridge: PersonDesktopBridge?, organization: Bool, worksOnLocal: Bool, browser: Bool, powers: [String: ComputerPower]) -> [ComputerMenuRow] {
        let choices = bridge?.computerChoices() ?? []
        return ComputerMenu.rows(
            organization: organization,
            choices: choices,
            worksOnKey: bridge?.worksOn(local: worksOnLocal)?.key,
            browser: browser,
            labels: ComputerMenuLabels(
                cloud: String(localized: "Cloud"),
                screen: String(localized: "Screen"),
                browser: String(localized: "Browser"),
                computer: String(localized: "Computer")
            ),
            powers: powers
        )
    }

    /// The choice the menu opens on: the browser, the computer on screen, or Screen.
    static func selectedKey(showsBrowser: Bool, chosen: ComputerChoice?) -> String {
        if showsBrowser { return browserKey }
        if let chosen { return chosen.key }
        return "screen"
    }

    let rows: [ComputerMenuRow]
    let chosen: String?
    let colors: Colors
    let pick: (String) -> Void

    @State private var open = false
    @State private var active = 0

    private var selectedIndex: Int {
        let index = rows.firstIndex { $0.key == chosen } ?? 0
        return rows.isEmpty ? 0 : index
    }

    private var selected: ComputerMenuRow? {
        rows.first { $0.key == chosen } ?? rows.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let selected {
                trigger(selected)
            }
            if open {
                menu
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("computer-picker")
    }

    private func trigger(_ row: ComputerMenuRow) -> some View {
        Button {
            Haptics.selection()
            if open { open = false } else { active = selectedIndex; open = true }
        } label: {
            HStack(spacing: 10) {
                rowBody(row, inMenu: false)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(colors.secondary)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(colors.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(colors.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(spoken(row))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("computer-choice.\(row.key)")
        .modifier(ComputerMenuKeys(open: $open, active: $active, rows: rows, selectedIndex: selectedIndex, pick: pick))
    }

    private var menu: some View {
        VStack(spacing: 2) {
            ForEach(Array(rows.enumerated()), id: \.element.key) { index, row in
                Button {
                    Haptics.selection()
                    open = false
                    pick(row.key)
                } label: {
                    HStack(spacing: 10) {
                        rowBody(row, inMenu: true)
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(colors.ink)
                            .opacity(row.key == chosen ? 1 : 0)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(index == active || row.key == chosen ? colors.field : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(spoken(row))
                .accessibilityAddTraits(row.key == chosen ? [.isButton, .isSelected] : .isButton)
                .accessibilityIdentifier("computer-choice.\(row.key)")
            }
        }
        .padding(4)
        .background(colors.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(colors.hairline, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Show the screen of"))
        .accessibilityIdentifier("computer-menu")
    }

    private func rowBody(_ row: ComputerMenuRow, inMenu: Bool) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: row.symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(inMenu ? colors.ink : colors.secondary)
                .frame(width: 28, height: 28)
                .background(inMenu ? colors.field : colors.field, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: row.name)
                    .font(.system(size: 13))
                    .foregroundStyle(colors.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                if row.here {
                    Text("Works here")
                        .font(.system(size: 11))
                        .foregroundStyle(colors.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let power = row.power {
                HStack(spacing: 6) {
                    Circle().fill(powerColor(power)).frame(width: 6, height: 6)
                    Text(powerWord(power))
                        .font(.system(size: 12))
                }
                .foregroundStyle(colors.secondary)
                .accessibilityHidden(true)
            }
        }
    }

    private func spoken(_ row: ComputerMenuRow) -> String {
        var parts = [row.name]
        if let power = row.power { parts.append(powerWord(power)) }
        if row.here { parts.append(String(localized: "Works here")) }
        return parts.joined(separator: ", ")
    }

    private func powerWord(_ power: ComputerPower) -> String {
        switch power {
        case .off: String(localized: "computer.power.off")
        case .on: String(localized: "computer.power.on")
        case .paused: String(localized: "computer.power.paused")
        case .starting: String(localized: "computer.power.starting")
        case .error: String(localized: "computer.power.error")
        case .unavailable: String(localized: "computer.power.unavailable")
        }
    }

    private func powerColor(_ power: ComputerPower) -> Color {
        switch power {
        case .on: colors.on
        case .off, .unavailable: colors.off
        case .paused: colors.paused
        case .starting: colors.starting
        case .error: colors.danger
        }
    }

}

/// Hardware-keyboard control of the machine menu. `onKeyPress` is iOS 17;
/// on 16 the menu stays a button and a list, which VoiceOver and the
/// pointer already use.
private struct ComputerMenuKeys: ViewModifier {
    @Binding var open: Bool
    @Binding var active: Int
    let rows: [ComputerMenuRow]
    let selectedIndex: Int
    let pick: (String) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content
                .onKeyPress(.downArrow) { move(1) }
                .onKeyPress(.upArrow) { move(-1) }
                .onKeyPress(.escape) { open = false; return .handled }
                .onKeyPress(.return) { confirm() }
                .onKeyPress(.space) { confirm() }
        } else {
            content
        }
    }

    @available(iOS 17.0, *)
    private func move(_ step: Int) -> KeyPress.Result {
        guard !rows.isEmpty else { return .ignored }
        if !open {
            active = selectedIndex
            open = true
            return .handled
        }
        active = (active + step + rows.count) % rows.count
        return .handled
    }

    @available(iOS 17.0, *)
    private func confirm() -> KeyPress.Result {
        guard !rows.isEmpty else { return .ignored }
        if !open {
            active = selectedIndex
            open = true
            return .handled
        }
        let index = min(max(active, 0), rows.count - 1)
        open = false
        pick(rows[index].key)
        return .handled
    }
}

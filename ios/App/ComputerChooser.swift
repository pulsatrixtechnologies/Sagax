// The Computer tab's screen picker on an organization server
// (`ComputerPicker` in OrgComputerTab.tsx). Electron names each host
// (truncated 132px). iPhone chips overflow, so iOS shows Cloud, Other VMs
// and Browser; the chosen host sits under the picker, with a menu when
// there is more than one (JC 2026-10-11). A dot marks the screen the bot
// works on. Picking one changes only what is shown, never the bot's Works
// on. Browser mode is the last chip where the server has the built-in
// browser. Shown only when there is more than one choice.
import SwiftUI
import CompanionCore

/// The person's desktops (`GET /api/me/desktop-bridge`), asked every 20
/// seconds while the Computer tab is on screen. A server with no bridge (a
/// solo server) answers nothing and is not asked again.
@MainActor
final class ComputerChoicesModel: ObservableObject {
    @Published private(set) var bridge: PersonDesktopBridge?

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
                stopped = true
                return false
            }
            if next != bridge { bridge = next }
        } catch {
            // Keep the last answer; the next poll asks again.
        }
        return true
    }
}

/// The segmented control itself, in the colors of the screen it sits on.
struct ComputerChooser: View {
    struct Colors {
        var ink: Color
        var secondary: Color
        var track: Color
        var selected: Color
        var dot: Color
    }

    struct Item: Identifiable {
        var id: String { key }
        let key: String
        let label: String
        let systemImage: String
        /// The bot works here: a dot, and VoiceOver says so.
        var here = false
    }

    /// The key of browser mode's chip.
    static let browserKey = "browser"
    /// Every Local VM shares this chip. Electron lists each host by name.
    static let vmsKey = "vms"

    /// The chips: on an organization server Cloud and Other VMs, else Screen
    /// alone; then Browser when the bot can show one.
    static func items(bridge: PersonDesktopBridge?, organization: Bool, worksOnLocal: Bool, browser: Bool) -> [Item] {
        var items: [Item]
        if organization, let bridge {
            let here = bridge.worksOn(local: worksOnLocal)
            items = [Item(key: ComputerChoice.cloud.key, label: String(localized: "Cloud"),
                          systemImage: "cloud", here: here == .cloud)]
            if bridge.iosChooserHasVMs() {
                items.append(Item(key: vmsKey, label: String(localized: "Other VMs"),
                                  systemImage: "laptopcomputer", here: here != nil && here != .cloud))
            }
        } else {
            items = [Item(key: "screen", label: String(localized: "Screen"), systemImage: "display")]
        }
        if browser { items.append(Item(key: browserKey, label: String(localized: "Browser"), systemImage: "globe")) }
        return items
    }

    static func selectedKey(showsBrowser: Bool, chosen: ComputerChoice?) -> String {
        if showsBrowser { return browserKey }
        if let chosen { return chosen == .cloud ? chosen.key : vmsKey }
        return "screen"
    }

    /// Other VMs stores a desktop key (`desktop:<id>`), never `vms`.
    static func resolvePick(_ key: String, bridge: PersonDesktopBridge?, current: ComputerChoice?) -> String {
        guard key == vmsKey else { return key }
        if let current, current != .cloud { return current.key }
        return bridge?.computerChoices().first { $0 != .cloud }?.key ?? key
    }

    /// The host name under Other VMs, and a menu when several desktops are online.
    @ViewBuilder
    static func provenance(bridge: PersonDesktopBridge?, chosen: ComputerChoice?, pick: @escaping (String) -> Void, secondary: Color) -> some View {
        let desktops = bridge?.computerChoices().filter { $0 != .cloud } ?? []
        if let chosen, chosen != .cloud, !desktops.isEmpty {
            if desktops.count > 1 {
                Menu {
                    ForEach(desktops, id: \.key) { desktop in
                        Button(desktop.name ?? String(localized: "Computer")) { pick(desktop.key) }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(verbatim: chosen.name ?? String(localized: "Computer"))
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(secondary)
                }
                .accessibilityIdentifier("computer-vm-menu")
            } else {
                Text(verbatim: chosen.name ?? String(localized: "Computer"))
                    .font(.system(size: 12))
                    .foregroundStyle(secondary)
                    .accessibilityIdentifier("computer-vm-name")
            }
        }
    }

    let items: [Item]
    let chosen: String?
    let colors: Colors
    let pick: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(items) { item in
                    chip(item)
                }
            }
            .padding(3)
            .background(colors.track, in: Capsule())
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Show the screen of"))
        .accessibilityIdentifier("computer-picker")
    }

    private func chip(_ item: Item) -> some View {
        let selected = item.key == chosen
        return Button {
            Haptics.selection()
            pick(item.key)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 12, weight: .medium))
                Text(verbatim: item.label)
                    .font(.system(size: 13, weight: selected ? .semibold : .regular))
                    .lineLimit(1)
                if item.here {
                    Circle().fill(colors.dot).frame(width: 6, height: 6)
                }
            }
            .foregroundStyle(selected ? colors.ink : colors.secondary)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(selected ? colors.selected : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.here ? Text("\(item.label): this bot works here") : Text(verbatim: item.label))
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
        .accessibilityIdentifier("computer-choice.\(item.key)")
    }
}

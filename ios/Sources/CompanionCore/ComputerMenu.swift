// The Computer tab's machine menu. One row per computer, by its full name,
// with the power the menu shows beside it. The view is ComputerChooser.
import Foundation

/// A machine's power, in the words the menu shows. "on" is Allumé / On.
public enum ComputerPower: String, Equatable, Sendable {
    case off, on, paused, starting, error, unavailable

    /// A running screen reads as on. The other screen states keep their names.
    public static func from(screen: LocalVmView.State) -> ComputerPower {
        switch screen {
        case .running: return .on
        case .off: return .off
        case .paused: return .paused
        case .starting: return .starting
        case .error: return .error
        }
    }

    /// The person's server environment, the same words the screen uses for it.
    public static func from(environment: ServerEnvironmentStatus) -> ComputerPower {
        if !environment.configured { return .off }
        switch environment.state {
        case "running": return .on
        case "paused": return .paused
        case "missing", "stopped": return .off
        default: return .unavailable
        }
    }
}

/// Names the view already translated. The menu does not look strings up.
public struct ComputerMenuLabels: Equatable, Sendable {
    public var cloud: String
    public var screen: String
    public var browser: String
    public var computer: String

    public init(cloud: String, screen: String, browser: String, computer: String) {
        self.cloud = cloud
        self.screen = screen
        self.browser = browser
        self.computer = computer
    }
}

/// One machine, or the browser, in the menu.
public struct ComputerMenuRow: Equatable, Sendable {
    public var key: String
    public var name: String
    public var symbol: String
    public var here: Bool
    /// Unknown until the computer has been asked: the row then has no power.
    public var power: ComputerPower?

    public init(key: String, name: String, symbol: String, here: Bool, power: ComputerPower? = nil) {
        self.key = key
        self.name = name
        self.symbol = symbol
        self.here = here
        self.power = power
    }
}

public enum ComputerMenu {
    /// On an organization server, Cloud and each computer by its full name.
    /// Elsewhere, Screen. Browser is last when the bot can show one.
    public static func rows(
        organization: Bool,
        choices: [ComputerChoice],
        worksOnKey: String?,
        browser: Bool,
        labels: ComputerMenuLabels,
        powers: [String: ComputerPower] = [:]
    ) -> [ComputerMenuRow] {
        var rows: [ComputerMenuRow] = []
        if organization, !choices.isEmpty {
            for choice in choices {
                switch choice {
                case .cloud:
                    rows.append(ComputerMenuRow(
                        key: choice.key, name: labels.cloud, symbol: "cloud",
                        here: choice.key == worksOnKey, power: powers[choice.key]
                    ))
                case let .desktop(_, name, _):
                    let shown = name.trimmingCharacters(in: .whitespacesAndNewlines)
                    rows.append(ComputerMenuRow(
                        key: choice.key, name: shown.isEmpty ? labels.computer : shown, symbol: "laptopcomputer",
                        here: choice.key == worksOnKey, power: powers[choice.key]
                    ))
                }
            }
        } else {
            rows.append(ComputerMenuRow(key: "screen", name: labels.screen, symbol: "display", here: false, power: nil))
        }
        if browser {
            rows.append(ComputerMenuRow(key: "browser", name: labels.browser, symbol: "globe", here: false, power: nil))
        }
        return rows
    }
}

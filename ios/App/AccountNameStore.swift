// The name the person gave each saved connection (Switch Account), kept on
// this phone only. Without one, a row shows what the server calls itself.
// An empty name clears it.
import Foundation

@MainActor
final class AccountNameStore: ObservableObject {
    static let shared = AccountNameStore()

    /// Bumped on every change so the rows that show a name redraw.
    @Published private(set) var revision = 0

    private let defaults: UserDefaults
    private let key = "account-custom-names"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The person's own name for this connection, when there is one.
    func name(for connectionID: String) -> String? {
        let value = (defaults.dictionary(forKey: key) as? [String: String])?[connectionID]
        return AccountNameStore.clean(value)
    }

    /// Keep this name; an empty one goes back to the server's own.
    func setName(_ name: String, for connectionID: String) {
        var names = (defaults.dictionary(forKey: key) as? [String: String]) ?? [:]
        if let clean = AccountNameStore.clean(name) {
            names[connectionID] = clean
        } else {
            names.removeValue(forKey: connectionID)
        }
        defaults.set(names, forKey: key)
        revision += 1
    }

    func forget(_ connectionID: String) {
        setName("", for: connectionID)
    }

    static func clean(_ value: String?) -> String? {
        guard let value else { return nil }
        let collapsed = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return collapsed.isEmpty ? nil : String(collapsed.prefix(80))
    }
}

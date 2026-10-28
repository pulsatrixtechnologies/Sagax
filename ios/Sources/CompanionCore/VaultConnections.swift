// Settings > Vault on the phone: 1Password on the paired computer, and the
// Shop Pay or Link choice from the one-time card contract. The phone never
// receives a card number or a 1Password secret.
import Foundation

public struct WalletLinkPublic: Decodable, Equatable, Sendable {
    public var chosen: Bool
    public var ready: Bool
    public var missing: String
}

public struct OnePasswordStatusPublic: Decodable, Equatable, Sendable {
    public var available: Bool
    public var via: String?
    public var reason: String?
}

public struct OnePasswordPickerItem: Decodable, Equatable, Sendable, Identifiable {
    public var id: String
    public var vaultId: String
    public var title: String
    public var vaultName: String
    public var domains: [String]
}

public enum VaultWallet {
    public static let ids = ["shop_pay", "link"]

    public static func label(_ id: String) -> String {
        id == "shop_pay" ? "Shop Pay" : "Link"
    }

    /// Shown only for the two wallets the contract names.
    public static func rows(_ wallets: [String: WalletLinkPublic]?) -> [(id: String, row: WalletLinkPublic)] {
        guard let wallets else { return [] }
        return ids.compactMap { id in wallets[id].map { (id, $0) } }
    }
}

public enum OnePasswordSettings {
    /// An organization server has no 1Password on the person's computer.
    public static func shown(_ status: OnePasswordStatusPublic?) -> Bool {
        guard let status else { return false }
        return status.reason != "organization"
    }

    public static func subtitle(_ status: OnePasswordStatusPublic) -> String {
        if status.available {
            return status.via == "connect"
                ? "Connected through 1Password Connect. Values are read from 1Password only when a bot fills them."
                : "Connected through the 1Password CLI. Values are read from 1Password only when a bot fills them."
        }
        if status.reason == "signed_out" {
            return "The 1Password CLI is installed but not signed in. Unlock 1Password and turn on its CLI integration."
        }
        return "Install the 1Password CLI (op) and turn on its desktop app integration to pick items from 1Password."
    }
}

private struct OnePasswordItemsBody: Decodable {
    var items: [OnePasswordPickerItem]
}

private struct WalletChoiceBody: Decodable {
    var wallets: [String: WalletLinkPublic]
}

public extension CompanionClient {
    /// Names and sites only. The value stays in 1Password.
    func onePasswordItems() async throws -> [OnePasswordPickerItem] {
        try await send(makeRequest("POST", "/api/me/credentials/onepassword/items", body: [:]), as: OnePasswordItemsBody.self).items
    }

    /// Saves a reference. Sagax does not copy the secret.
    func importOnePassword(vaultId: String, itemId: String) async throws {
        try await send(makeRequest("POST", "/api/me/credentials/onepassword/import", body: ["vaultId": vaultId, "itemId": itemId]))
    }

    /// Shop Pay or Link: the account the person already has. Nothing is charged.
    func chooseWallet(_ wallet: String, chosen: Bool) async throws -> [String: WalletLinkPublic] {
        guard VaultWallet.ids.contains(wallet) else { throw APIError.badURL }
        return try await send(
            makeRequest("POST", "/api/me/credentials/wallets", body: ["wallet": wallet, "chosen": chosen]),
            as: WalletChoiceBody.self
        ).wallets
    }
}

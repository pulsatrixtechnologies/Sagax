// The card of an outward action a bot asks for (message field `outbound`,
// shared/wire.ts `OutboundCard`): a phone call (server/outbound-calls.ts) or
// a purchase with a saved card (server/credential-vault.ts). Parité Grok Bot
// V4, 59, 83; the desktop's src/components/OutboundCard.tsx.
//
// One answer covers one action: Call or Don't call, Allow once or Decline.
// No Always allow. The card shows the full number to its own person, the
// exact words the call says, what the purchase buys; never a card number, a
// security code or an id.
import Foundation

public struct OutboundCardData: Codable, Hashable, Sendable {
    /// `unknown`: a kind from a newer server, drawn as the message's text.
    public enum Kind: String, Codable, Sendable { case call, purchase, unknown }

    public struct Line: Codable, Hashable, Sendable {
        public var name: String
        public var quantity: Int?
        /// "12.50", the line's own price when the page shows one.
        public var price: String?
        public init(name: String, quantity: Int? = nil, price: String? = nil) {
            self.name = name
            self.quantity = quantity
            self.price = price
        }
    }

    public struct Flight: Codable, Hashable, Sendable {
        public var from: String
        public var to: String
        /// YYYY-MM-DD
        public var date: String
        public var flight: String?
        public var passenger: String?
        public init(from: String, to: String, date: String, flight: String? = nil, passenger: String? = nil) {
            self.from = from
            self.to = to
            self.date = date
            self.flight = flight
            self.passenger = passenger
        }
    }

    public var kind: Kind
    /// The record the answer goes to: call_... or pay_... (never shown).
    public var id: String
    /// "pending", "approved", "denied", "done" or "failed".
    public var status: String
    public var botName: String
    public var destination: String?
    public var from: String?
    public var callback: String?
    public var purpose: String?
    public var script: String?
    public var language: String?
    public var merchant: String?
    public var amount: String?
    public var currency: String?
    public var cardLabel: String?
    public var items: [Line]?
    public var flights: [Flight]?
    public var orderRef: String?
    public var declared: Bool?
    public var mismatchTotal: String?
    public var via: String?
    public var error: String?

    /// A card this phone knows how to draw and answer.
    public var isDrawable: Bool { kind != .unknown && !id.isEmpty }

    public init(kind: Kind, id: String, status: String, botName: String) {
        self.kind = kind
        self.id = id
        self.status = status
        self.botName = botName
    }

    private enum CodingKeys: String, CodingKey {
        case kind, id, status, botName, destination, from, callback, purpose, script, language
        case merchant, amount, currency, cardLabel, items, flights, orderRef, declared, mismatchTotal, via, error
    }

    /// Lenient: a field this phone does not know the shape of is left out
    /// rather than failing the whole message it arrived on.
    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? row.decode(String.self, forKey: .kind)).flatMap(Kind.init(rawValue:)) ?? .unknown
        id = (try? row.decode(String.self, forKey: .id)) ?? ""
        status = (try? row.decode(String.self, forKey: .status)) ?? "pending"
        botName = (try? row.decode(String.self, forKey: .botName)) ?? ""
        destination = try? row.decodeIfPresent(String.self, forKey: .destination)
        from = try? row.decodeIfPresent(String.self, forKey: .from)
        callback = try? row.decodeIfPresent(String.self, forKey: .callback)
        purpose = try? row.decodeIfPresent(String.self, forKey: .purpose)
        script = try? row.decodeIfPresent(String.self, forKey: .script)
        language = try? row.decodeIfPresent(String.self, forKey: .language)
        merchant = try? row.decodeIfPresent(String.self, forKey: .merchant)
        amount = try? row.decodeIfPresent(String.self, forKey: .amount)
        currency = try? row.decodeIfPresent(String.self, forKey: .currency)
        cardLabel = try? row.decodeIfPresent(String.self, forKey: .cardLabel)
        items = try? row.decodeIfPresent([Line].self, forKey: .items)
        flights = try? row.decodeIfPresent([Flight].self, forKey: .flights)
        orderRef = try? row.decodeIfPresent(String.self, forKey: .orderRef)
        declared = try? row.decodeIfPresent(Bool.self, forKey: .declared)
        mismatchTotal = try? row.decodeIfPresent(String.self, forKey: .mismatchTotal)
        via = try? row.decodeIfPresent(String.self, forKey: .via)
        error = try? row.decodeIfPresent(String.self, forKey: .error)
    }
}

/// The card's wording rules, kept out of the view so they are testable.
public enum OutboundCardRules {
    /// `formatMoney`: "45,20 $" in the reader's locale, the amount as sent
    /// when it is not a number or has no currency.
    public static func money(_ amount: String?, currency: String?, locale: Locale = .current) -> String {
        guard let amount, !amount.isEmpty else { return "" }
        guard let value = Decimal(string: amount, locale: Locale(identifier: "en_US_POSIX")), let currency, !currency.isEmpty else { return amount }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = locale
        formatter.currencyCode = currency.uppercased()
        return formatter.string(from: value as NSDecimalNumber) ?? "\(amount) \(currency)"
    }

    /// What a finished purchase bought (`purchaseSummary`).
    public enum Bought: Hashable, Sendable {
        case flightOne, flights(Int), itemOne, items(Int), done
    }

    public static func bought(_ card: OutboundCardData) -> Bought {
        let flights = card.flights?.count ?? 0
        if flights > 0 { return flights == 1 ? .flightOne : .flights(flights) }
        let count = (card.items ?? []).reduce(0) { $0 + ($1.quantity ?? 1) }
        if count > 0 { return count == 1 ? .itemOne : .items(count) }
        return .done
    }

    /// The status line under a settled card (`statusLine`); nil while it
    /// waits, and for a purchase that is done (its title says so).
    public enum Status: Hashable, Sendable {
        case callApproved, callDone, callDenied, callFailed
        case purchaseApproved, purchaseDenied
    }

    public static func status(_ card: OutboundCardData, status: String? = nil) -> Status? {
        switch (card.kind, status ?? card.status) {
        case (.call, "approved"): .callApproved
        case (.call, "done"): .callDone
        case (.call, "denied"): .callDenied
        case (.call, "failed"): .callFailed
        case (.purchase, "approved"): .purchaseApproved
        case (.purchase, "denied"): .purchaseDenied
        default: nil
        }
    }

    /// The body of the answer (`POST /api/me/phone-calls/:id/answer` or
    /// `/api/me/credentials/purchases/:id/answer`). A call goes only once
    /// the person confirmed the number on the card.
    public static func answerPath(_ card: OutboundCardData) -> String {
        let id = card.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? card.id
        return card.kind == .call ? "/api/me/phone-calls/\(id)/answer" : "/api/me/credentials/purchases/\(id)/answer"
    }
}

extension CompanionClient {
    /// The person's answer on an outbound card: Call or Don't call (a call
    /// goes only with the number confirmed on the card), Allow once or
    /// Decline for a purchase.
    public func answerOutbound(_ card: OutboundCardData, yes: Bool, confirmed: Bool) async throws {
        let body: [String: Any]
        switch card.kind {
        case .call:
            body = yes
                ? ["decision": "call", "confirmed": confirmed, "confirmedTo": card.destination ?? ""]
                : ["decision": "deny"]
        case .purchase:
            body = ["decision": yes ? "once" : "deny"]
        case .unknown:
            throw APIError.badURL
        }
        try await send(try makeRequest("POST", OutboundCardRules.answerPath(card), body: body))
    }
}

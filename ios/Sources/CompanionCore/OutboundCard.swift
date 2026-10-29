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

    /// Where an ordered parcel is (shared/order-tracking.ts), as the bot
    /// declared it: ordered, shipped, in transit, out for delivery,
    /// delivered, or a problem.
    public struct Tracking: Codable, Hashable, Sendable {
        public var step: String
        public var carrier: String?
        public var number: String?
        public var url: String?
        /// YYYY-MM-DD
        public var eta: String?
        public var note: String?
        public init(step: String, carrier: String? = nil, number: String? = nil, url: String? = nil, eta: String? = nil, note: String? = nil) {
            self.step = step
            self.carrier = carrier
            self.number = number
            self.url = url
            self.eta = eta
            self.note = note
        }

        /// The four steps a card draws; in transit is still shipped.
        public static let stepper = ["ordered", "shipped", "out_for_delivery", "delivered"]

        /// Where the step sits on the bar; -1 for a problem or a step this phone does not know.
        public var stepIndex: Int {
            step == "in_transit" ? 1 : Self.stepper.firstIndex(of: step) ?? -1
        }

        public var isProblem: Bool { step == "exception" }
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
    /// "conversation" when the bot talks with the person it calls; nil for
    /// the one-way message (or a mode from a newer server, drawn as one).
    public var mode: String?
    /// A conversation call: what the bot must obtain or say, its guidance,
    /// the most it may last, and the short message it leaves on voicemail.
    public var objective: String?
    public var instructions: String?
    public var maxMinutes: Int?
    public var voicemail: String?
    /// A conversation call once it ended; placed without one: under way.
    public var result: OutboundCallResult?
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
    public var tracking: Tracking?
    public var error: String?

    /// A call the bot holds as a conversation (place_phone_call mode conversation).
    public var isConversation: Bool { kind == .call && mode == "conversation" }

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
        case mode, objective, instructions, maxMinutes, voicemail, result
        case merchant, amount, currency, cardLabel, items, flights, orderRef, declared, mismatchTotal, via, tracking, error
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
        mode = try? row.decodeIfPresent(String.self, forKey: .mode)
        objective = try? row.decodeIfPresent(String.self, forKey: .objective)
        instructions = try? row.decodeIfPresent(String.self, forKey: .instructions)
        maxMinutes = (try? row.decodeIfPresent(Int.self, forKey: .maxMinutes))
            ?? (try? row.decodeIfPresent(Double.self, forKey: .maxMinutes)).map { Int($0.rounded()) }
        voicemail = try? row.decodeIfPresent(String.self, forKey: .voicemail)
        result = try? row.decodeIfPresent(OutboundCallResult.self, forKey: .result)
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
        tracking = try? row.decodeIfPresent(Tracking.self, forKey: .tracking)
        error = try? row.decodeIfPresent(String.self, forKey: .error)
    }
}

/// How a conversation call ended (shared/wire.ts `OutboundCallResult`).
/// Lenient: an outcome or a reason this phone does not know decodes as
/// `.unknown` instead of losing the message it arrived on.
public struct OutboundCallResult: Codable, Hashable, Sendable {
    public enum Outcome: String, Codable, Sendable { case completed, voicemail, noAnswer = "no-answer", busy, failed, unknown }
    public enum EndedBy: String, Codable, Sendable { case goal, callee, stopRequest = "stop-request", timeLimit = "time-limit", hangUp = "hang-up", unknown }

    public struct Line: Codable, Hashable, Sendable {
        /// "bot" or "callee" (anything else is drawn as the other party).
        public var speaker: String
        public var text: String
        public var isBot: Bool { speaker == "bot" }
        public init(speaker: String, text: String) {
            self.speaker = speaker
            self.text = text
        }
    }

    public var outcome: Outcome
    public var endedBy: EndedBy?
    public var doNotCallAgain: Bool
    public var durationSec: Int
    public var points: [String]
    public var commitments: [String]
    public var transcript: [Line]
    public var truncated: Bool
    public var transcriptExpired: Bool
    /// epoch ms
    public var endedAt: Double?

    public init(outcome: Outcome, endedBy: EndedBy? = nil, doNotCallAgain: Bool = false, durationSec: Int = 0, points: [String] = [], commitments: [String] = [], transcript: [Line] = [], truncated: Bool = false, transcriptExpired: Bool = false, endedAt: Double? = nil) {
        self.outcome = outcome
        self.endedBy = endedBy
        self.doNotCallAgain = doNotCallAgain
        self.durationSec = durationSec
        self.points = points
        self.commitments = commitments
        self.transcript = transcript
        self.truncated = truncated
        self.transcriptExpired = transcriptExpired
        self.endedAt = endedAt
    }

    private enum CodingKeys: String, CodingKey {
        case outcome, endedBy, doNotCallAgain, durationSec, points, commitments, transcript, truncated, transcriptExpired, endedAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        outcome = (try? row.decode(String.self, forKey: .outcome)).flatMap(Outcome.init(rawValue:)) ?? .unknown
        endedBy = (try? row.decodeIfPresent(String.self, forKey: .endedBy)).flatMap { $0 }.map { EndedBy(rawValue: $0) ?? .unknown }
        doNotCallAgain = (try? row.decodeIfPresent(Bool.self, forKey: .doNotCallAgain)) ?? false
        let seconds = (try? row.decodeIfPresent(Double.self, forKey: .durationSec)).flatMap { $0 } ?? 0
        durationSec = seconds.isFinite && seconds > 0 ? Int(seconds.rounded()) : 0
        points = (try? row.decodeIfPresent([String].self, forKey: .points)).flatMap { $0 } ?? []
        commitments = (try? row.decodeIfPresent([String].self, forKey: .commitments)).flatMap { $0 } ?? []
        transcript = (try? row.decodeIfPresent([Line].self, forKey: .transcript)).flatMap { $0 } ?? []
        truncated = (try? row.decodeIfPresent(Bool.self, forKey: .truncated)) ?? false
        transcriptExpired = (try? row.decodeIfPresent(Bool.self, forKey: .transcriptExpired)) ?? false
        endedAt = (try? row.decodeIfPresent(Double.self, forKey: .endedAt)).flatMap { $0 }
    }

    /// "4:07": whole seconds as minutes and seconds.
    public static func duration(_ seconds: Int) -> String {
        let total = max(0, seconds)
        return "\(total / 60):" + String(format: "%02d", total % 60)
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
        /// A conversation call placed and not ended yet.
        case callInProgress
        case purchaseApproved, purchaseDenied
    }

    public static func status(_ card: OutboundCardData, status: String? = nil) -> Status? {
        let status = status ?? card.status
        if card.isConversation {
            switch status {
            case "approved": return .callApproved
            case "done": return card.result == nil ? .callInProgress : nil
            case "denied": return .callDenied
            case "failed": return card.result == nil ? .callFailed : nil
            default: return nil
            }
        }
        switch (card.kind, status) {
        case (.call, "approved"): return .callApproved
        case (.call, "done"): return .callDone
        case (.call, "denied"): return .callDenied
        case (.call, "failed"): return .callFailed
        case (.purchase, "approved"): return .purchaseApproved
        case (.purchase, "denied"): return .purchaseDenied
        default: return nil
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

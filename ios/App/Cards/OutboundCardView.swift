// The card of a phone call or a purchase a bot asks for (OutboundCard.tsx,
// parité Grok Bot V4, 59, 83): who it calls and from which line, why, the
// exact words, the callback number, the disclosure and "I confirm the
// number"; or what a purchase buys, from where, with which card. One answer
// covers one action: Call or Don't call, Allow once or Decline. No Always
// allow. Never a card number, a security code or an id.
import CompanionCore
import SwiftUI

struct OutboundCardView: View {
    @EnvironmentObject private var session: Session
    let card: OutboundCardData
    let accent: Color
    @Environment(\.desktopChatText) private var desktop
    @State private var busy: Bool?
    @State private var answered: String?
    @State private var error = ""
    /// Call only after the person confirms the number on the card.
    @State private var confirmed = false

    private var status: String { answered ?? card.status }
    private var pending: Bool { status == "pending" }

    var body: some View {
        let ink = ApprovalInk.of(desktop, accent: desktop?.accent ?? accent)
        VStack(alignment: .leading, spacing: 0) {
            header(ink)
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: title)
                    .font(ink.font(14, .semibold))
                    .foregroundStyle(ink.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("outbound-title")
                if card.kind == .call { callBody(ink) } else { purchaseBody(ink) }
                if let line = statusLine {
                    Text(verbatim: line)
                        .font(ink.font(12, .regular))
                        .foregroundStyle(ink.secondary)
                        .accessibilityIdentifier("outbound-status")
                }
                if let via = card.via, !via.isEmpty, !pending {
                    Text("Answered by \(via)")
                        .font(ink.font(12, .regular))
                        .foregroundStyle(ink.secondary)
                }
                if !error.isEmpty {
                    Text(verbatim: error)
                        .font(ink.font(12, .regular))
                        .foregroundStyle(ink.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if pending { buttons(ink) }
            }
            .padding(12)
        }
        .frame(maxWidth: 560, alignment: .leading)
        .background(desktop?.panel ?? Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(ink.hairline.opacity(0.4), lineWidth: 1))
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("outbound-card-\(card.kind.rawValue)")
    }

    // MARK: Parts

    private func header(_ ink: ApprovalInk) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .medium))
            Text(card.kind == .call ? "Phone call" : "Purchase").lineLimit(1)
            Spacer(minLength: 8)
            Text(verbatim: card.botName).lineLimit(1)
        }
        .font(ink.font(12, .regular))
        .foregroundStyle(ink.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ink.inset.opacity(0.6))
    }

    private var icon: String {
        switch card.kind {
        case .call: status == "denied" ? "phone.down" : "phone"
        case .purchase, .unknown: (card.flights?.isEmpty == false) ? "airplane" : "bag"
        }
    }

    private var money: String { OutboundCardRules.money(card.amount, currency: card.currency) }

    private var title: String {
        switch card.kind {
        case .call:
            return String(localized: "Call to \(card.destination ?? "")")
        case .purchase, .unknown:
            if status == "done" {
                switch OutboundCardRules.bought(card) {
                case .flightOne: return String(localized: "1 flight purchased · \(money)")
                case let .flights(count): return String(localized: "\(count) flights purchased · \(money)")
                case .itemOne: return String(localized: "1 item purchased · \(money)")
                case let .items(count): return String(localized: "\(count) items purchased · \(money)")
                case .done: return String(localized: "Purchased · \(money)")
                }
            }
            return String(localized: "Pay \(money) at \(card.merchant ?? "")")
        }
    }

    private var statusLine: String? {
        switch OutboundCardRules.status(card, status: status) {
        case .callApproved: String(localized: "Allowed. \(card.botName) is placing the call.")
        case .callDone: String(localized: "Call placed.")
        case .callDenied: String(localized: "Not called.")
        case .callFailed: String(localized: "The call failed.")
        case .purchaseApproved: String(localized: "Allowed. \(card.botName) can pay.")
        case .purchaseDenied: String(localized: "Declined.")
        case nil: nil
        }
    }

    @ViewBuilder
    private func callBody(_ ink: ApprovalInk) -> some View {
        if let from = card.from, !from.isEmpty {
            Text("From \(from)").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        }
        if let purpose = card.purpose, !purpose.isEmpty {
            (Text("Purpose:").foregroundColor(ink.secondary) + Text(verbatim: " \(purpose)").foregroundColor(ink.ink))
                .font(ink.font(13, .regular))
                .fixedSize(horizontal: false, vertical: true)
        }
        if let script = card.script, !script.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("What \(card.botName) will say").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                Text(verbatim: script)
                    .font(ink.font(12.5, .regular))
                    .foregroundStyle(ink.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 8)
                    .overlay(alignment: .leading) { Rectangle().fill(ink.hairline.opacity(0.6)).frame(width: 2) }
                    .accessibilityIdentifier("outbound-script")
            }
        }
        if let callback = card.callback, !callback.isEmpty {
            Text("Callback number said on the call: \(callback)").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        }
        if pending {
            Text("The call first says it is an AI assistant calling on your behalf, gives the callback number and how to stop the calls, says the message twice, then hangs up. Nothing is placed until you confirm the number and choose Call.")
                .font(ink.font(12, .regular))
                .foregroundStyle(ink.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Toggle(isOn: $confirmed) {
                Text("I confirm the number \(card.destination ?? "")")
                    .font(ink.font(12.5, .regular))
                    .foregroundStyle(ink.ink)
            }
            .toggleStyle(OutboundCheckboxStyle(tint: ink.accent))
            .accessibilityIdentifier("outbound-confirm")
        }
    }

    @ViewBuilder
    private func purchaseBody(_ ink: ApprovalInk) -> some View {
        let done = status == "done"
        if done, let merchant = card.merchant, !merchant.isEmpty {
            let order = card.orderRef.map { " · " + String(localized: "Order \($0)") } ?? ""
            Text(verbatim: merchant + order).font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        }
        if let items = card.items, !items.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 8) {
                        Text(verbatim: ((item.quantity ?? 1) > 1 ? "\(item.quantity ?? 1) × " : "") + item.name)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let price = item.price, !price.isEmpty {
                            Text(verbatim: OutboundCardRules.money(price, currency: card.currency)).foregroundStyle(ink.secondary)
                        }
                    }
                    .font(ink.font(12.5, .regular))
                    .foregroundStyle(ink.ink)
                }
            }
        }
        if let flights = card.flights, !flights.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(flights.enumerated()), id: \.offset) { _, leg in
                    let extra = [leg.flight, leg.passenger].compactMap { $0 }.filter { !$0.isEmpty }.map { " · " + $0 }.joined()
                    Text(verbatim: String(localized: "\(leg.from) to \(leg.to), \(leg.date)") + extra)
                        .font(ink.font(12.5, .regular))
                        .foregroundStyle(ink.ink)
                }
            }
        }
        if done, card.declared == true {
            Text("Receipt declared by the bot, not read by Sagax from the shop's page.")
                .font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        if done, let total = card.mismatchTotal, !total.isEmpty {
            Text("The shop confirmed \(OutboundCardRules.money(total, currency: card.currency)), not the \(money) you allowed. Check the order.")
                .font(ink.font(12, .regular)).foregroundStyle(Theme.warning)
                .fixedSize(horizontal: false, vertical: true)
        }
        if !done, let label = card.cardLabel, !label.isEmpty {
            Text("Pay with \(label)").font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
        }
        if pending {
            Text("The bot never sees the card number or the security code. Nothing is charged until you allow it.")
                .font(ink.font(12, .regular)).foregroundStyle(ink.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func buttons(_ ink: ApprovalInk) -> some View {
        HStack(spacing: 8) {
            Button { answer(true) } label: {
                HStack(spacing: 6) {
                    if busy == true { ProgressView().controlSize(.mini).tint(.white) }
                    Text(card.kind == .call ? "Call" : "Allow once")
                }
                .font(ink.font(13, .medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(ink.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .disabled(busy != nil || (card.kind == .call && !confirmed))
            .opacity(busy != nil || (card.kind == .call && !confirmed) ? 0.4 : 1)
            .accessibilityIdentifier("outbound-yes")
            Button { answer(false) } label: {
                HStack(spacing: 6) {
                    if busy == false { ProgressView().controlSize(.mini) }
                    Text(card.kind == .call ? "Don't call" : "Decline")
                }
                .font(ink.font(13, .regular))
                .foregroundStyle(ink.ink)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(ink.hairline.opacity(0.6), lineWidth: 1))
            }
            .disabled(busy != nil)
            .opacity(busy != nil ? 0.4 : 1)
            .accessibilityIdentifier("outbound-no")
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
    }

    private func answer(_ yes: Bool) {
        guard let client = session.settingsClient else { return }
        Haptics.selection()
        busy = yes
        error = ""
        Task {
            do {
                try await client.answerOutbound(card, yes: yes, confirmed: confirmed)
                answered = yes ? "approved" : "denied"
            } catch {
                self.error = error.localizedDescription
            }
            busy = nil
        }
    }
}

/// The desktop's checkbox: a square that fills with the accent.
private struct OutboundCheckboxStyle: ToggleStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16))
                    .foregroundStyle(configuration.isOn ? tint : Theme.textSecondary)
                configuration.label
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}

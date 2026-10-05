// The access card (feature parity CA11, AccessCard.tsx): a turn that could
// not run on an organization server for lack of engine access. It speaks to
// the person it is about ("you"), says what to do, and links to their keys
// in Perspicax. Signing in with a subscription and reconnecting routines
// happen on the computer, so the phone says so instead of drawing a button
// it cannot honour.
import SwiftUI
import CompanionCore

struct AccessCardView: View {
    @Environment(\.themePalette) var themePalette
    let access: AccessCard
    @EnvironmentObject private var session: Session

    private var lines: AccessCardLines {
        AccessCardLines.of(access, viewerPrincipalId: session.account?.principalId, admin: session.canAdminister)
    }

    var body: some View {
        let lines = lines
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "key.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.warning)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 5) {
                Text(Self.text(lines.text))
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if let hint = lines.hint {
                    Text(Self.text(hint))
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let keys = lines.keysUrl.flatMap(URL.init(string:)), keys.scheme == "https" {
                    Link(destination: keys) {
                        Label("Add my key in Perspicax", systemImage: "arrow.up.right")
                            .font(.system(size: 12.5, weight: .medium))
                    }
                    .accessibilityIdentifier("access-add-key")
                }
                if let detail = lines.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: 11.5, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                        .textSelection(.enabled)
                }
                if lines.signIn || lines.reconnect {
                    Label("Finish on your computer", systemImage: "desktopcomputer")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Theme.warning.opacity(0.3), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("access-card")
    }

    static func text(_ line: AccessLine) -> String {
        switch line {
        case let .engineMissing(engine):
            String(localized: "This bot uses \(engine), which is not installed on this server.")
        case .engineMissingOwner:
            String(localized: "Ask an admin.")
        case .keyRefused:
            String(localized: "The provider refused this bot's key.")
        case .keyRefusedAdmin:
            String(localized: "Check the key in Settings > Connections.")
        case let .noAccessOther(engine):
            String(localized: "No \(engine) access for this turn: the person who spoke needs their own subscription or key, or the organization's key.")
        case let .noAccessRoutine(engine):
            String(localized: "This routine can't run: it uses its owner's credentials, and there is no \(engine) subscription, key or organization key for it.")
        case .noAccessAdminOrgKey:
            String(localized: "A key in Settings > Connections serves as the organization's key.")
        case let .noAccessMine(engine):
            String(localized: "You don't have \(engine) access for this message: connect your \(engine) subscription or add your key in Perspicax.")
        case .noAccessMineAdmin:
            String(localized: "As an admin, you can also set the organization's key in Settings > Connections.")
        case let .noAccessRoutineMine(engine):
            String(localized: "Your routine can't run: you don't have \(engine) access. Connect your \(engine) subscription or add your key in Perspicax.")
        case .payerDisabledRoutineMine:
            String(localized: "Your account is disabled: your routines can't run.")
        case .payerDisabledSpeaker:
            String(localized: "Your account is disabled: this turn can't run.")
        case .payerDisabledOwner:
            String(localized: "This bot's owner is disabled: their routines can't run.")
        case let .routineDelegation(routine, person):
            String(localized: "The routine “\(routine)” is paused: it cannot act in \(person ?? String(localized: "its person"))'s name.")
        case let .routineDelegationReason(reason):
            switch reason {
            case "delegation_missing": String(localized: "Routines were never allowed to act in this person's name.")
            case "delegation_ended": String(localized: "The permission ended in Perspicax.")
            case "delegation_revoked": String(localized: "The permission was revoked.")
            case "person_out": String(localized: "Perspicax signed this person out.")
            case "no_right": String(localized: "This person can no longer run this bot's routines.")
            default: reason
            }
        }
    }
}

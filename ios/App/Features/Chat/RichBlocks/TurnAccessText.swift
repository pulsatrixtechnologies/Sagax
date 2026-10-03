// Which credentials paid for a turn on an organization server
// (`DigestChip.tsx` TurnAccessChip, `perspicax-org.ts` turnAccessLabel):
// "Paid with: Your subscription". Never a secret.
import Foundation
import CompanionCore

enum TurnAccessText {
    static func who(_ access: DigestAccess, viewer: String?) -> String {
        switch access.label(viewerPrincipalId: viewer) {
        case .yourSubscription: String(localized: "Your subscription")
        case .yourKey: String(localized: "Your key")
        case .speakerSubscription: String(localized: "The speaker's subscription")
        case .speakerKey: String(localized: "The speaker's key")
        case .ownerCredentials: String(localized: "Owner's credentials")
        case .orgKey: String(localized: "Organization's key")
        case .server: String(localized: "Server access")
        }
    }

    static func line(_ access: DigestAccess, viewer: String?) -> String {
        String(localized: "Paid with: \(who(access, viewer: viewer))")
    }
}

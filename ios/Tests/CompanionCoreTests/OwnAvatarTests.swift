// The person's own photo on an organization server (2026-10-16): who may
// change it (the session says the profile is Perspicax's), and the answer of
// PUT/DELETE /api/me/avatar.
import Foundation
import XCTest
@testable import CompanionCore

final class OwnAvatarTests: XCTestCase {
    private func session(_ json: String) throws -> AuthSession {
        try JSONDecoder().decode(AuthSession.self, from: Data(json.utf8))
    }

    func testOnlyAPersonOfAnOrganizationServerMayChangeTheirPhoto() throws {
        XCTAssertTrue(try session(#"{"kind":"session","principalId":"pr_ada","profileManagedBy":"perspicax"}"#).ownPhotoEditable)
        XCTAssertFalse(try session(#"{"kind":"session","principalId":"pr_ada"}"#).ownPhotoEditable)
        XCTAssertFalse(try session(#"{"kind":"session","profileManagedBy":"perspicax"}"#).ownPhotoEditable)
        XCTAssertFalse(try session(#"{"kind":"loopback","principalId":"pr_ada","profileManagedBy":"perspicax"}"#).ownPhotoEditable)
    }

    func testTheAnswerNamesTheNewVersionedPhotoOrNone() throws {
        let set = try JSONDecoder().decode(OwnAvatarAnswer.self, from: Data(#"{"ok":true,"avatarUrl":"/api/people/pr_ada/avatar?v=0123456789abcdef"}"#.utf8))
        XCTAssertEqual(set.avatar?.cacheKey, AccountAvatar("/api/people/pr_ada/avatar?v=0123456789abcdef")?.cacheKey)
        let removed = try JSONDecoder().decode(OwnAvatarAnswer.self, from: Data(#"{"ok":true,"avatarUrl":null}"#.utf8))
        XCTAssertNil(removed.avatar)
        // an address elsewhere is never a photo this phone reads
        let outside = try JSONDecoder().decode(OwnAvatarAnswer.self, from: Data(#"{"ok":true,"avatarUrl":"https://evil.example.test/x.png"}"#.utf8))
        XCTAssertNil(outside.avatar)
    }

    func testRefusalCodesAreKnown() {
        XCTAssertEqual(OwnAvatarRefusal(rawValue: "avatar_sign_in_again"), .signInAgain)
        XCTAssertEqual(OwnAvatarRefusal(rawValue: "avatar_perspicax_outdated"), .outdated)
        XCTAssertNil(OwnAvatarRefusal(rawValue: "something_else"))
    }
}

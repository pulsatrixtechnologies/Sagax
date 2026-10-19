import Foundation
import XCTest
@testable import CompanionCore

/// The desktop's cases (shared/fresh-topic.vectors.json), run here too.
final class FreshTopicTests: XCTestCase {
    private struct Vectors: Decodable {
        struct Case: Decodable {
            struct TopicJSON: Decodable {
                let createdAt: Double
                let updatedAt: Double?
                let busy: Bool?
                let activity: String?
                let unread: Bool?
                let waitingForTeammates: Bool?
            }
            let name: String
            let topic: TopicJSON?
            let now: Double
            let afterMs: Double
            let leftAt: Double?
            let queued: Bool?
            let fresh: Bool
            let reason: String
        }
        let cases: [Case]
    }

    func testSharedVectors() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("shared/fresh-topic.vectors.json")
        let vectors = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(vectors.cases.count, 10)
        for item in vectors.cases {
            let topic = item.topic.map {
                FreshTopic.Topic(createdAt: $0.createdAt, updatedAt: $0.updatedAt, busy: $0.busy ?? false, activity: $0.activity, unread: $0.unread ?? false, waitingForTeammates: $0.waitingForTeammates ?? false)
            }
            let decision = FreshTopic.onReturn(topic: topic, now: item.now, afterMs: item.afterMs, leftAt: item.leftAt, queued: item.queued ?? false)
            XCTAssertEqual(decision.fresh, item.fresh, item.name)
            XCTAssertEqual(decision.reason.rawValue, item.reason, item.name)
        }
    }

    func testThresholdSetting() {
        XCTAssertEqual(FreshTopic.parseAfter(nil), 4)
        XCTAssertEqual(FreshTopic.parseAfter("3"), 4)
        XCTAssertEqual(FreshTopic.parseAfter("8"), 8)
        XCTAssertEqual(FreshTopic.parseAfter("0"), 0)
        XCTAssertEqual(FreshTopic.afterMs(hours: 4), 14_400_000)
    }
}

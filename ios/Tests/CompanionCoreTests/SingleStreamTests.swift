import Foundation
import XCTest
@testable import CompanionCore

/// THE one-conversation rule, the desktop's and the server's cases
/// (shared/single-stream.vectors.json), run here too.
final class SingleStreamTests: XCTestCase {
    private struct Vectors {
        struct Case {
            let name: String
            /// The tasks as the wire tasks the app decodes: every field the
            /// rule reads, plus the title the model requires.
            let tasks: [BotTask]
            let segments: [String]
            let conversation: String?
            let earlier: [String]
            let beside: [String]
        }
        let cases: [Case]
    }

    private func vectors() throws -> Vectors {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("shared/single-stream.vectors.json")
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        return Vectors(cases: try cases.map { item in
            let tasks = try XCTUnwrap(item["tasks"] as? [[String: Any]]).map { fields -> BotTask in
                var fields = fields
                if fields["title"] == nil { fields["title"] = "" }
                return try JSONDecoder().decode(BotTask.self, from: JSONSerialization.data(withJSONObject: fields))
            }
            return Vectors.Case(
                name: try XCTUnwrap(item["name"] as? String), tasks: tasks,
                segments: try XCTUnwrap(item["segments"] as? [String]),
                conversation: item["conversation"] as? String,
                earlier: try XCTUnwrap(item["earlier"] as? [String]),
                beside: try XCTUnwrap(item["beside"] as? [String]))
        })
    }

    private func makeBot(threadId: String, tasks: [BotTask]) -> Bot {
        Bot(id: "b", threadId: threadId, name: "Scout", title: "Researcher",
            description: "", notifications: true, color: "green", unread: false,
            modelSelection: ModelSelection(instanceId: "engine", model: "default"), createdAt: 1,
            tasks: tasks)
    }

    func testSharedVectors() throws {
        let vectors = try vectors()
        XCTAssertGreaterThan(vectors.cases.count, 4)
        for item in vectors.cases {
            let tasks = item.tasks
            XCTAssertEqual(SingleStream.segments(tasks).map(\.threadId), item.segments, item.name)
            XCTAssertEqual(SingleStream.conversationThreadId(tasks), item.conversation, item.name)
            if let home = item.conversation {
                XCTAssertEqual(SingleStream.earlierSegments(tasks, before: home).map(\.threadId), item.earlier, item.name)
            }
            for candidate in tasks {
                XCTAssertEqual(SingleStream.opensBeside(tasks, candidate.threadId), item.beside.contains(candidate.threadId), "\(item.name): \(candidate.threadId) beside")
                XCTAssertEqual(SingleStream.isEarlierSegment(tasks, candidate.threadId), item.earlier.contains(candidate.threadId), "\(item.name): \(candidate.threadId) earlier")
            }
            XCTAssertFalse(SingleStream.opensBeside(tasks, "unknown"), item.name)
            // any order gives the same answer
            XCTAssertEqual(SingleStream.conversationThreadId(tasks.reversed()), item.conversation, item.name)
        }
    }

    func testHomeReadsTheServerFirstThenTheSameRule() throws {
        let vectors = try vectors()
        let tasks = vectors.cases[0].tasks
        var bot = makeBot(threadId: "a", tasks: tasks)
        // the server's answer, a segment of the stream: taken as it is
        bot.mainThreadId = "b"
        XCTAssertEqual(SingleStream.home(of: bot), "b")
        // a server answer that is no segment this phone knows: the rule
        bot.mainThreadId = "elsewhere"
        XCTAssertEqual(SingleStream.home(of: bot), "c")
        bot.mainThreadId = nil
        XCTAssertEqual(SingleStream.home(of: bot), "c")
        // no segment at all: nothing (the caller keeps its older rule)
        var alone = makeBot(threadId: "conf", tasks: vectors.cases[4].tasks)
        alone.mainThreadId = nil
        XCTAssertNil(SingleStream.home(of: alone))
    }

    func testLandingOfEveryWayIntoAThread() throws {
        let vectors = try vectors()
        var bot = makeBot(threadId: "chat", tasks: vectors.cases[1].tasks)
        bot.mainThreadId = nil
        XCTAssertEqual(SingleStream.landing(of: bot, threadId: "chat"), .conversation(thread: "chat"))
        for outside in ["run", "results", "hidden", "conf", "job", "par"] {
            XCTAssertEqual(SingleStream.landing(of: bot, threadId: outside), .beside(home: "chat"), outside)
        }
        XCTAssertEqual(SingleStream.landing(of: bot, threadId: "unknown"), .conversation(thread: "chat"))
        var stream = makeBot(threadId: "c", tasks: vectors.cases[0].tasks)
        stream.mainThreadId = nil
        XCTAssertEqual(SingleStream.landing(of: stream, threadId: "a"), .earlier(home: "c"))
        XCTAssertEqual(SingleStream.landing(of: stream, threadId: "c").shown, "c")
        // a bot with no conversation: the thread named is shown as it is
        var none = makeBot(threadId: "conf", tasks: vectors.cases[4].tasks)
        none.mainThreadId = nil
        XCTAssertEqual(SingleStream.landing(of: none, threadId: "conf"), .conversation(thread: "conf"))
    }
}

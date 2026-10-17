import XCTest
@testable import CompanionCore

/// Bug 2026-10-16 (iOS 0.5.9 to 0.5.11, "a thread cannot be opened"): a bot
/// chat closed itself on its first frame, with no request, when the bot's
/// selected thread was missing from its thread list. An organization
/// server sends such bots to a viewer (a narrowed stream frame, a hidden AI
/// client conversation they opened, no thread of theirs yet).
final class BotThreadAvailabilityTests: XCTestCase {
    private func bot() throws -> Bot {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "bots-paged", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "bots-paged", withExtension: "json")
        )
        var bot = try XCTUnwrap(try JSONDecoder().decode(Fleet.self, from: try Data(contentsOf: url)).bots.first)
        bot.threadId = "mine"
        bot.tasks = [task("mine"), task("other")]
        return bot
    }

    private func task(_ threadId: String) -> BotTask {
        BotTask(threadId: threadId, title: threadId, createdAt: 1)
    }

    private func state(with bots: [Bot]) -> CompanionState {
        var state = CompanionState()
        state.bots = bots
        return state
    }

    func testAListedThreadOpens() throws {
        let bot = try bot()
        let state = state(with: [bot])
        XCTAssertEqual(BotThreadAvailability.of(botId: bot.id, threadId: "mine", in: state), .open)
        XCTAssertEqual(BotThreadAvailability.of(botId: bot.id, threadId: "other", in: state), .open)
    }

    /// The case behind the bug: the bot's own selected thread, absent from
    /// its list, is the bot's to show (as `Bot.projected` already said).
    func testTheSelectedThreadOpensEvenWhenTheListLeavesItOut() throws {
        var bot = try bot()
        bot.tasks = [task("other")]
        let state = state(with: [bot])
        XCTAssertNotNil(bot.projected(forThread: "mine"))
        XCTAssertEqual(BotThreadAvailability.of(botId: bot.id, threadId: "mine", in: state), .open)
        XCTAssertEqual(BotThreadAvailability.step(for: .of(botId: bot.id, threadId: "mine", in: state), checked: false), .show)
    }

    /// A stream frame narrowed for the viewer: the fold keeps the bot and the
    /// chat that was tapped still opens.
    func testABotFrameWhoseListOmitsItsThreadStillOpens() throws {
        let bot = try bot()
        var state = state(with: [bot])
        var narrowed = bot
        narrowed.tasks = [task("other")]
        state.apply(.bot(narrowed))
        XCTAssertEqual(BotThreadAvailability.of(botId: bot.id, threadId: "mine", in: state), .open)
    }

    func testAThreadTheBotNoLongerHasLandsOnItsCurrentThread() throws {
        let bot = try bot()
        let state = state(with: [bot])
        let availability = BotThreadAvailability.of(botId: bot.id, threadId: "deleted", in: state)
        XCTAssertEqual(availability, .moved(current: "mine"))
        XCTAssertEqual(BotThreadAvailability.step(for: availability, checked: false), .select("mine"))
    }

    /// An organization viewer with no thread of their own yet: the bot list
    /// starts one, so the server is asked before anything is said.
    func testNoThreadOfYoursAsksTheServerBeforeExplaining() throws {
        var bot = try bot()
        bot.threadId = ""
        bot.tasks = []
        let state = state(with: [bot])
        let availability = BotThreadAvailability.of(botId: bot.id, threadId: "", in: state)
        XCTAssertEqual(availability, .noThread)
        XCTAssertEqual(BotThreadAvailability.step(for: availability, checked: false), .reload)
        XCTAssertEqual(BotThreadAvailability.step(for: availability, checked: true), .explain)
    }

    /// After the reload the person's thread exists: an empty target opens it.
    func testAnEmptyTargetLandsOnTheThreadTheReloadBrought() throws {
        let bot = try bot()
        let state = state(with: [bot])
        XCTAssertEqual(BotThreadAvailability.of(botId: bot.id, threadId: "", in: state), .moved(current: "mine"))
    }

    /// Never "no longer exists" from the phone's memory alone: a bot the
    /// state lacks (just created elsewhere, a missed frame) is asked for.
    func testAMissingBotAsksTheServerBeforeExplaining() throws {
        let bot = try bot()
        let availability = BotThreadAvailability.of(botId: bot.id, threadId: "mine", in: CompanionState())
        XCTAssertEqual(availability, .botMissing)
        XCTAssertEqual(BotThreadAvailability.step(for: availability, checked: false), .reload)
        XCTAssertEqual(BotThreadAvailability.step(for: availability, checked: true), .explain)
    }

    /// A bot deleted while its chat is open stops being available.
    func testABotDeletedWhileOpenIsMissing() throws {
        let bot = try bot()
        var state = state(with: [bot])
        state.apply(.botDeleted(botId: bot.id))
        XCTAssertEqual(BotThreadAvailability.of(botId: bot.id, threadId: "mine", in: state), .botMissing)
    }
}

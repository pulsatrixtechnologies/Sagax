// The working line's step on the phone (shared/working-step.ts): decoded
// from the row, named only while its call runs, and quiet time in minutes.
import XCTest
@testable import CompanionCore

final class WorkingStepTests: XCTestCase {
    private func row(_ tool: String, at: Double = 5_000, kind: String = "activity") throws -> Message {
        let json = #"{"id":"m1","role":"bot","kind":"\#(kind)","at":\#(at),"tool":\#(tool)}"#
        return try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testNamesTheRunningCallsStep() throws {
        let running = try row(#"{"name":"Bash","step":{"key":"run","detail":"scrape.py"}}"#)
        let current = WorkingStepLine.current([running])
        XCTAssertEqual(current?.step, WorkingStep(key: "run", detail: "scrape.py"))
        XCTAssertEqual(current?.since, 5_000)
        XCTAssertTrue(WorkingStepLine.readsDetail(current!.step))
    }

    func testNothingOnceTheCallEndsOrForAnOlderServer() throws {
        XCTAssertNil(WorkingStepLine.current([try row(#"{"name":"Bash","ok":true,"step":{"key":"run"}}"#)]))
        XCTAssertNil(WorkingStepLine.current([try row(#"{"name":"Bash"}"#)]))
        XCTAssertNil(WorkingStepLine.current([try row(#"{"name":"Bash","step":{"key":"fromTheFuture"}}"#)]))
        XCTAssertNil(WorkingStepLine.current([]))
    }

    func testABadStepNeverBreaksTheRow() throws {
        let message = try row(#"{"name":"Bash","step":{"detail":3}}"#)
        XCTAssertEqual(message.tool?.name, "Bash")
        XCTAssertNil(message.tool?.step)
    }

    func testDetailOnlyOnKeysThatReadWithIt() {
        XCTAssertFalse(WorkingStepLine.readsDetail(WorkingStep(key: "readMail", detail: "x")))
        XCTAssertFalse(WorkingStepLine.readsDetail(WorkingStep(key: "openApp")))
        XCTAssertTrue(WorkingStepLine.readsDetail(WorkingStep(key: "openApp", detail: "Chrome")))
    }

    func testQuietMinutes() {
        XCTAssertNil(WorkingStepLine.quietMinutes(since: 0, now: 59_000))
        XCTAssertEqual(WorkingStepLine.quietMinutes(since: 0, now: 125_000), 2)
    }
}

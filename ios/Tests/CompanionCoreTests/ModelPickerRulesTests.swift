// The model picker's one mode on iOS (#261): the pick keeps the effort on
// the same engine, Cloud and Local groups, allowed providers, and the
// threads on a model of their own.
import Foundation
import XCTest
@testable import CompanionCore

final class ModelPickerRulesTests: XCTestCase {
    private func instance(_ id: String, variants: Bool = false, options: String = "[]") throws -> Instance {
        let json = """
        {"instanceId":"\(id)","driverKind":"codex","snapshot":{"state":"available","authenticated":true},
         "models":{"default":"m1","options":\(options)},"capabilities":{"modelVariants":\(variants)}}
        """
        return try JSONDecoder().decode(Instance.self, from: Data(json.utf8))
    }

    func testThePickKeepsTheEffortOnTheSameEngineOnly() throws {
        let codex = try instance("codex")
        let current = ModelSelection(instanceId: "codex", model: "m1", effort: "high")
        XCTAssertEqual(ModelPickerRules.selectionForPick(current, instance: codex, model: "m2"), ModelSelection(instanceId: "codex", model: "m2", effort: "high"))
        let claude = try instance("claude")
        XCTAssertEqual(ModelPickerRules.selectionForPick(current, instance: claude, model: "opus"), ModelSelection(instanceId: "claude", model: "opus"))
        let grok = try instance("grok", variants: true)
        var withVariant = ModelSelection(instanceId: "grok", model: "g1")
        withVariant.variant = "fast"
        XCTAssertEqual(ModelPickerRules.selectionForPick(withVariant, instance: grok, model: "g1").variant, "fast")
        XCTAssertNil(ModelPickerRules.selectionForPick(withVariant, instance: grok, model: "g2").variant, "a variant never crosses models")
    }

    func testCloudAndLocalGroups() throws {
        let options = try JSONDecoder().decode([ModelOption].self, from: Data(#"""
        [{"id":"gpt-5","label":"GPT-5"},
         {"id":"llama","label":"Llama","local":true},
         {"id":"qwen","label":"Qwen","local":true,"loaded":true},
         {"id":"deskab12::mistral","label":"Mistral"},
         {"id":"lmstudio::phi","label":"Phi","custom":true},
         {"id":"server-own","label":"Own","custom":true}]
        """#.utf8))
        let solo = ModelPickerRules.groups(options, organization: false)
        XCTAssertEqual(solo.cloud.map(\.id), ["gpt-5", "server-own"])
        XCTAssertEqual(solo.local.map(\.id), ["qwen", "llama", "deskab12::mistral", "lmstudio::phi"], "loaded first")
        let org = ModelPickerRules.groups(options, organization: true)
        XCTAssertEqual(org.cloud.map(\.id), ["gpt-5", "llama", "qwen"], "the server's own machine is not the person's")
        XCTAssertEqual(org.local.map(\.id), ["deskab12::mistral"])
        XCTAssertTrue(ModelPickerRules.isDesktopModelId("deskab12::m"))
        XCTAssertFalse(ModelPickerRules.isDesktopModelId("desk::m"))
    }

    func testAllowedProviders() throws {
        let list = [try instance("codex"), try instance("claude"), try instance("grok")]
        XCTAssertTrue(ModelPickerRules.engineAllowed(nil, "x"))
        XCTAssertTrue(ModelPickerRules.engineAllowed([], "x"))
        XCTAssertFalse(ModelPickerRules.engineAllowed(["codex"], "x"))
        XCTAssertEqual(ModelPickerRules.listed(list, allowed: ["codex"], organization: true, selectedId: "grok").map(\.instanceId), ["codex", "grok"])
        XCTAssertEqual(ModelPickerRules.listed(list, allowed: ["codex"], organization: false, selectedId: "grok").count, 3)
        let config = try JSONDecoder().decode(ConfigStatus.self, from: Data(#"{"allowedEngines":["codex"]}"#.utf8))
        XCTAssertEqual(config.allowedEngines, ["codex"])
    }

    func testThreadsOnTheirOwnModel() throws {
        let tasks = try JSONDecoder().decode([BotTask].self, from: Data(#"""
        [{"threadId":"a","title":"A","createdAt":1,"followsBotModel":true},
         {"threadId":"b","title":"B","createdAt":1,"followsBotModel":false,"modelSelection":{"instanceId":"codex","model":"m2"}},
         {"threadId":"c","title":"C","createdAt":1,"followsBotModel":false,"modelSelection":{"instanceId":"codex","model":"m1"}},
         {"threadId":"d","title":"D","createdAt":1}]
        """#.utf8))
        XCTAssertEqual(tasks.map(\.followsBotModel), [true, false, false, nil])
        XCTAssertEqual(ModelPickerRules.threadsOnOwnModel(botModel: ModelSelection(instanceId: "codex", model: "m1"), tasks: tasks), 1)
    }
}

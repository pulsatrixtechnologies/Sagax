// The model menu's rules (src/lib/model-menu.test.ts, model-favorites.test.ts,
// model-health.test.ts): providers in submenus, favorites under Auto, only
// the models that run, and Simple's one "All models" row.
import XCTest
@testable import CompanionCore

final class ModelMenuTests: XCTestCase {
    private let labels = ModelMenuLabels(
        auto: "Auto", autoHint: "best model per task", useBotModel: { "Use \($0)'s model" },
        local: "Local", defaultTag: "Default", loadedTag: "Loaded"
    )

    private func instance(_ id: String, state: String = "available", authenticated: Bool? = true, models: [(String, String)], local: Bool = false) -> Instance {
        let options = models.map { ModelOption(id: $0.0, label: $0.1, custom: local ? true : nil, local: local ? true : nil) }
        return Instance(
            instanceId: id, driverKind: id, displayName: id.capitalized,
            snapshot: ProviderSnapshot(state: state, authenticated: authenticated),
            models: ModelCatalog(default: models.first?.0 ?? "", options: options)
        )
    }

    private var instances: [Instance] {
        [
            instance("claude", models: [("sonnet", "Sonnet"), ("opus", "Opus")]),
            instance("codex", authenticated: false, models: [("gpt", "GPT")]),
            instance("qwen", state: "missing", models: [("coder", "Coder")]),
            instance("pi", models: [("ds::llama", "DwarfStar: Llama")], local: true),
            instance("grok", models: [("ds::llama", "Grok: Llama")], local: true),
        ]
    }

    private func sections(selection: ModelSelection, follows: Bool? = nil) -> [ModelMenuSection] {
        ModelMenu.sections(
            instances: instances, selection: selection, botModel: ModelSelection(instanceId: "claude", model: "sonnet"),
            botName: "Ara", follows: follows, organization: false, allowedEngines: nil, labels: labels,
            engineLabel: { $0.displayName ?? $0.instanceId }
        )
    }

    func testOnlyTheModelsThatRunAreOffered() {
        let menu = sections(selection: ModelSelection(instanceId: "claude", model: "opus"))
        XCTAssertEqual(menu.map(\.key), ["top", "claude", ModelMenu.localSectionKey], "signed out and not installed providers go")
        XCTAssertEqual(menu[1].rows.map(\.modelId), ["sonnet", "opus"])
        XCTAssertEqual(menu[1].rows.first { $0.current }?.modelId, "opus")
        XCTAssertEqual(menu[2].rows.map(\.label), ["Llama"], "a local model once, its provider in the detail")
        XCTAssertEqual(menu[2].rows.first?.detail, "DwarfStar")
    }

    func testTheModelInUseStaysAndSaysItDoesNotRespond() {
        let menu = sections(selection: ModelSelection(instanceId: "codex", model: "gpt"))
        let codex = menu.first { $0.key == "codex" }
        XCTAssertEqual(codex?.rows.map(\.modelId), ["gpt"])
        XCTAssertEqual(codex?.rows.first?.notResponding, true)
        XCTAssertEqual(sections(selection: ModelSelection(instanceId: "qwen", model: "coder")).first { $0.key == "qwen" }?.rows.first?.current, true)
    }

    func testRootFavoritesAndCurrent() {
        let menu = sections(selection: ModelSelection(instanceId: "claude", model: "opus"), follows: false)
        let opus = ModelFavorites.key(instanceId: "claude", modelId: "opus")
        let sonnet = ModelFavorites.key(instanceId: "claude", modelId: "sonnet")
        var root = ModelMenu.root(menu, favorites: [sonnet, "gone\u{0}model"])
        XCTAssertEqual(root.top.map(\.key), ["auto", "follow"])
        XCTAssertEqual(root.current?.key, opus, "the current model shows when no top row is checked")
        XCTAssertEqual(root.favorites.map(\.key), [sonnet], "a favorite that is gone is not shown")
        XCTAssertEqual(root.providers.map(\.id), ["claude", ModelMenu.localSectionKey])
        XCTAssertEqual(root.providers.first?.current, true)
        root = ModelMenu.root(menu, favorites: [opus])
        XCTAssertNil(root.current, "a starred current model shows once, among the favorites")
        var autoSelection = ModelSelection(instanceId: "claude", model: "opus")
        autoSelection.auto = true
        let auto = ModelMenu.root(sections(selection: autoSelection), favorites: [])
        XCTAssertNil(auto.current)
        XCTAssertTrue(auto.top[0].current)
    }

    func testSearchListsMatchesFlat() {
        let menu = sections(selection: ModelSelection(instanceId: "claude", model: "opus"))
        XCTAssertEqual(ModelMenu.filter(menu, query: "OPUS").flatMap(\.rows).map(\.modelId), ["opus"])
        XCTAssertEqual(ModelMenu.filter(menu, query: "claude son").flatMap(\.rows).map(\.modelId), ["sonnet"])
        XCTAssertEqual(ModelMenu.fold("Élevé"), "eleve")
    }

    func testFavoritesRoundTripAndToggle() {
        let key = ModelFavorites.key(instanceId: "claude", modelId: "opus")
        XCTAssertEqual(ModelFavorites.serialize([key]), #"[["claude","opus"]]"#)
        XCTAssertEqual(ModelFavorites.parse(#"[["claude","opus"],["claude","opus"],["x"],5,["",""]]"#), [key])
        XCTAssertEqual(ModelFavorites.parse("not json"), [])
        XCTAssertEqual(ModelFavorites.toggled([], key), [key])
        XCTAssertEqual(ModelFavorites.toggled([key], key), [])
        XCTAssertEqual(ModelFavorites.toggled([], "no-separator"), [])
    }

    func testAdvancedIsTheDefaultForEveryone() {
        XCTAssertFalse(ModelMenu.isSimple(stored: nil))
        XCTAssertFalse(ModelMenu.isSimple(stored: "advanced"))
        XCTAssertFalse(ModelMenu.isSimple(stored: "1"))
        XCTAssertTrue(ModelMenu.isSimple(stored: "simple"))
    }
}

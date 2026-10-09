// The model picker's one mode (desktop #261, ModelPicker.tsx, 2026-10-09):
// a model chosen in a thread runs that thread and becomes the bot's model,
// in one request (PATCH /api/bots/:id/tasks/:t with updateBotDefault). Groups
// and new threads use the bot's model; threads that follow the bot move with
// it, a thread on its own model keeps it. "Only this thread" is gone; "Use
// <bot>'s model" puts a thread back on the bot's model. The list has two
// groups, Cloud and Local; the effort is kept on the same engine (a variant
// only on the same model); an organization lists only the providers its
// admin allows (`allowedEngines`).
import Foundation

public enum ModelPickerRules {
    /// `modelSelectionForPick`: switching models never carries an opaque
    /// variant from the previous model; the effort stays on the same engine.
    public static func selectionForPick(_ selection: ModelSelection, instance: Instance, model: String) -> ModelSelection {
        var next = ModelSelection(instanceId: instance.instanceId, model: model)
        if instance.instanceId == selection.instanceId {
            if instance.capabilities?.modelVariants == true {
                if model == selection.model, let variant = selection.variant { next.variant = variant }
            } else if let effort = selection.effort, !effort.isEmpty {
                next.effort = effort
            }
        }
        return next
    }

    /// A model on the person's own computer (`desk<id>::model`).
    public static func isDesktopModelId(_ id: String) -> Bool {
        guard let separator = id.range(of: "::"), separator.lowerBound > id.startIndex else { return false }
        return id[..<separator.lowerBound].range(of: #"^desk[a-z0-9]{3,24}$"#, options: .regularExpression) != nil
    }

    /// The dropdown's two groups. Local: models on this machine (solo) or
    /// on the person's own computer (organization), and a local server's
    /// (`server::model`), loaded ones first. Cloud: everything else. An
    /// organization server never lists its own custom models.
    public static func groups(_ options: [ModelOption], organization: Bool) -> (cloud: [ModelOption], local: [ModelOption]) {
        func isLocal(_ option: ModelOption) -> Bool {
            let localRow = organization ? isDesktopModelId(option.id) : (option.local == true || isDesktopModelId(option.id))
            return localRow || (option.custom == true && option.id.contains("::"))
        }
        let offered = organization ? options.filter { $0.custom != true || isDesktopModelId($0.id) } : options
        let local = offered.filter(isLocal)
        return (offered.filter { !isLocal($0) }, local.filter { $0.loaded == true } + local.filter { $0.loaded != true })
    }

    /// `engineAllowed`: nil or an empty list allows every engine.
    public static func engineAllowed(_ allowed: [String]?, _ instanceId: String) -> Bool {
        guard let allowed, !allowed.isEmpty else { return true }
        return allowed.contains(instanceId)
    }

    /// The providers listed: on an organization server the allowed ones,
    /// plus the bot's current one (shown, not selectable) so its state is
    /// explained.
    public static func listed(_ instances: [Instance], allowed: [String]?, organization: Bool, selectedId: String) -> [Instance] {
        guard organization else { return instances }
        return instances.filter { engineAllowed(allowed, $0.instanceId) || $0.instanceId == selectedId }
    }

    /// `threadsOnOwnModel`: threads that keep a model of their own.
    public static func threadsOnOwnModel(botModel: ModelSelection, tasks: [BotTask]) -> Int {
        tasks.filter { task in
            guard task.followsBotModel == false else { return false }
            let own = task.modelSelection ?? botModel
            return own.instanceId != botModel.instanceId || own.model != botModel.model
        }.count
    }
}

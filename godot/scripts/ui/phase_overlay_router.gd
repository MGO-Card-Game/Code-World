class_name PhaseOverlayRouter
extends PanelContainer

signal skip_requested
signal camp_shop_requested

const THEME_FACTORY = preload("res://scripts/ui/ui_theme.gd")
const Playback = preload("res://scripts/anim/playback_controller.gd")
const Visual = preload("res://scripts/anim/visual_state.gd")

const PHASE_GUIDANCE := {
	"awaitingRoll": "移动阶段 · 投掷移动骰",
	"turnComplete": "行动完成 · 结束当前回合",
	"encounterChoice": "旅者相遇 · 选择相遇对象",
	"scrollTargetChoice": "干扰卷轴 · 选择一名玩家",
	"scrollDiscardChoice": "缴械 · 目标需要弃置卷轴",
	"encounterDecision": "相遇抉择",
	"tradeOffer": "秘密报价",
	"tradeConfirmation": "交易确认",
	"bossGateChoice": "首领入口",
	"battle": "战斗阶段",
	"blessingChoice": "赐福抉择",
	"pvpPenalty": "相遇战代价",
	"equipmentChoice": "装备取舍",
	"pveReward": "战利品结算",
	"treasureReward": "宝箱收获",
	"blessingReward": "赐福获得",
	"mapEventNotice": "旅途见闻",
	"mapEventScrollChoice": "选择卷轴",
	"mapEventEquipmentChoice": "选择装备",
	"mapEventTravelChoice": "商会驿站",
	"mapEventHarmonyChoice": "调和属性",
	"statGrowthChoice": "永久成长",
	"shop": "沿途商栈",
	"casino": "赌场转盘",
	"gameOver": "登峰决胜",
}

const INTENTS := {"trade": "提出交易", "greet": "友好招呼", "battle": "发起战斗"}

@onready var message: Label = $Margin/Content/Message
@onready var choices: HBoxContainer = $Margin/Content/TargetChoices
@onready var guidance: Label = $Margin/Content/ActionRow/Guidance
@onready var primary_action: Button = $Margin/Content/ActionRow/PrimaryAction
@onready var boss_gate: Button = $Margin/Content/ActionRow/BossGate
@onready var camp_shop: Button = $Margin/Content/ActionRow/CampShop
@onready var skip_playback: Button = $Margin/Content/ActionRow/SkipPlayback
@onready var sigil: Label = $Margin/Content/ActionRow/ActionSigil

var dispatch_callable: Callable
var _playback: Playback
var _primary_type := ""
# A draft or minimized overlay belongs to this phase instance. Its controls
# can change independently when the viewer submits or gains a choice.
var _phase_key := ""
var _choice_actions: Array[Dictionary] = []


func _ready() -> void:
	if not dispatch_callable.is_valid():
		dispatch_callable = get_node("/root/GameClient").dispatch
	primary_action.pressed.connect(_on_primary_pressed)
	boss_gate.pressed.connect(func() -> void:
		if boss_gate.is_visible_in_tree():
			dispatch_action({"type": "openBossGate"}))
	camp_shop.pressed.connect(func() -> void:
		if camp_shop.is_visible_in_tree():
			camp_shop_requested.emit())
	skip_playback.pressed.connect(skip_requested.emit)
	var primary_normal: StyleBoxFlat = THEME_FACTORY.primary_button_style()
	var primary_hover: StyleBoxFlat = primary_normal.duplicate()
	primary_hover.bg_color = Color("a97a38")
	var primary_pressed: StyleBoxFlat = primary_normal.duplicate()
	primary_pressed.bg_color = Color("e1ae55")
	primary_action.add_theme_stylebox_override("normal", primary_normal)
	primary_action.add_theme_stylebox_override("hover", primary_hover)
	primary_action.add_theme_stylebox_override("pressed", primary_pressed)
	primary_action.add_theme_color_override("font_color", Color("fff0cb"))
	primary_action.add_theme_color_override("font_pressed_color", Color("17120b"))
	primary_action.add_theme_font_size_override("font_size", 16)


func reset_phase() -> void:
	_phase_key = ""
	_clear_choices()


func presentation_ready(reveal_after_event_id: Variant) -> bool:
	if _playback == null:
		return true
	return Visual.presentation_ready(_playback.queue.current_event(), _playback.queue.pending_events(), reveal_after_event_id)


func set_game_state(state: Dictionary, viewer: String, playback: Playback = null) -> void:
	_playback = playback
	var playing := playback != null and playback.is_playing()
	var phase: Dictionary = state.get("phase", {})
	var kind: String = phase.get("kind", "")
	var active: String = state.get("activePlayerId", "")
	var turn: int = state.get("turn", 0)
	var players: Dictionary = state.get("players", {})
	var choice: Dictionary = phase.get("choice", {})
	var key: Array = [kind]
	var actions: Array[Dictionary] = []
	var labels: Array[String] = []
	message.text = playback.dock_message(state) if playback != null else state.get("message", {}).get("text", "")
	skip_playback.visible = playing
	guidance.text = PHASE_GUIDANCE.get(kind, kind)
	sigil.text = _phase_sigil(kind)
	_primary_type = ""
	boss_gate.visible = kind == "awaitingRoll" and viewer == active and not playing and state.get("canOpenBossGate", false)
	camp_shop.visible = kind == "turnComplete" and viewer == active and not playing and state.get("canUseCampShop", false)

	match kind:
		"awaitingRoll", "turnComplete":
			key.append_array([turn, active])
			_primary_type = "rollMovement" if kind == "awaitingRoll" else "endTurn"
			if kind == "awaitingRoll":
				var dice: Dictionary = state.playerDerived[active]
				var count_text := "%d" % dice.movementDiceCount if dice.movementDiceCount > 1 else ""
				primary_action.text = "投掷 %sD%d" % [count_text, dice.movementSides]
			else:
				primary_action.text = "结束当前回合"
		"scrollTargetChoice":
			var ids: Array = choice.get("candidateIds", [])
			key.append_array([turn, choice.get("playerId"), choice.get("scrollKind"), choice.get("effectIndex"), choice.get("resume"), ids])
			if choice.get("playerId") == viewer:
				for id: String in ids:
					actions.append({"type": "chooseScrollTarget", "targetId": id})
					labels.append("选择 %s" % players.get(id, {}).get("name", id))
			else:
				guidance.text += " · 等待出牌者选择"
		"encounterChoice":
			var ids: Array = choice.get("opponentIds", [])
			key.append_array([turn, choice.get("tileIndex"), choice.get("challengerId"), ids])
			if choice.get("challengerId") == viewer:
				for id: String in ids:
					actions.append({"type": "chooseEncounterOpponent", "opponentId": id})
					labels.append("接近 %s" % players.get(id, {}).get("name", id))
			else:
				guidance.text += " · 等待行动者选择"
		"encounterDecision":
			var encounter: Dictionary = phase.get("encounter", {})
			key.append_array([turn, encounter.get("tileIndex"), encounter.get("aPlayerId"), encounter.get("bPlayerId")])
			var side := ""
			if encounter.get("aPlayerId") == viewer:
				side = "a"
			elif encounter.get("bPlayerId") == viewer:
				side = "b"
			var own_choice: Dictionary = encounter.get("choice" + side.to_upper(), {})
			if not side.is_empty() and own_choice.get("status") == "pending":
				for intent: String in INTENTS:
					actions.append({"type": "chooseEncounterIntent", "side": side, "intent": intent})
					labels.append(INTENTS[intent])
			else:
				guidance.text += " · 等待相遇双方决定"
		"battle", "pveReward", "equipmentChoice", "pvpPenalty", "tradeOffer", "tradeConfirmation", "scrollDiscardChoice", "statGrowthChoice", "gameOver", \
		"bossGateChoice", "blessingChoice", "blessingReward", "treasureReward", "shop", "casino":
			pass # The mounted modal owns these actions.
		_:
			guidance.text += " · 当前版本仅展示此阶段"

	primary_action.visible = not _primary_type.is_empty()
	primary_action.disabled = playing or _primary_type.is_empty() or viewer != active
	_sync_choices(JSON.stringify(key), actions, labels)
	choices.visible = not actions.is_empty() and not playing and (playback == null or playback.lingering_battle.is_empty())


func _sync_choices(key: String, actions: Array[Dictionary], labels: Array[String]) -> void:
	if key != _phase_key or actions != _choice_actions:
		_clear_choices()
		_phase_key = key
		_choice_actions = actions
		for action in actions:
			var button := Button.new()
			if action.type == "chooseEncounterIntent":
				button.custom_minimum_size = Vector2(126, 38)
				if action.intent == "battle":
					button.add_theme_color_override("font_color", Color("ffae9d"))
			button.pressed.connect(_on_choice_pressed.bind(action))
			choices.add_child(button)
	for index in labels.size():
		var button: Button = choices.get_child(index)
		button.text = labels[index]


func _clear_choices() -> void:
	for child in choices.get_children():
		choices.remove_child(child)
		child.queue_free()
	_choice_actions = []
	choices.hide()


func _on_choice_pressed(action: Dictionary) -> void:
	if choices.visible and action in _choice_actions:
		dispatch_action(action)


func _on_primary_pressed() -> void:
	if not primary_action.disabled:
		dispatch_action({"type": _primary_type})


func dispatch_action(action: Dictionary) -> void:
	dispatch_callable.call(action)


func _phase_sigil(phase_kind: String) -> String:
	match phase_kind:
		"awaitingRoll":
			return "骰"
		"turnComplete":
			return "✓"
		"battle":
			return "⚔"
		"encounterChoice", "encounterDecision":
			return "◇"
		"scrollTargetChoice", "scrollDiscardChoice":
			return "卷"
		"shop":
			return "商"
		"gameOver":
			return "冠"
		_:
			return "◆"

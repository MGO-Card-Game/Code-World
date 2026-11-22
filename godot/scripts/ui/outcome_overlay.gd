class_name OutcomeOverlay
extends "res://scripts/ui/phase_modal.gd"

const Playback = preload("res://scripts/anim/playback_controller.gd")
const Router = preload("res://scripts/ui/phase_overlay_router.gd")
const SOURCES := {"battle": "战斗奖励", "affix": "词条额外奖励", "elite": "精英额外奖励", "boss": "首领战利品", "blessing": "战争财阀"}
const RESOURCES := {"scroll": "卷轴", "equipment": "装备", "gold": "金币"}

var details := Label.new()
var waiting := Label.new()
var options := VBoxContainer.new()
var _phase_key: Array = []
var _buttons: Dictionary[String, Button] = {}


func _ready() -> void:
	details.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	details.add_theme_constant_override("line_spacing", 6)
	body.add_child(details)
	waiting.add_theme_color_override("font_color", Palette.MUTED)
	body.add_child(waiting)
	body.add_child(options)


func set_game_state(state: Dictionary, viewer: String, playback: Playback, router: Router) -> void:
	var kind: String = "" if state.is_empty() else state.phase.kind
	var decision: Dictionary
	var owner: String
	var key := []
	match kind:
		"pvpPenalty":
			decision = state.phase.penalty
			owner = decision.loserId
			if not decision.get("waived", false):
				key = [kind, state.turn, decision.winnerId, owner, viewer]
		"pveReward":
			decision = state.phase.notice
			owner = decision.playerId
			key = [kind, state.turn, owner, decision.enemyName, viewer]
		"equipmentChoice":
			decision = state.phase.choice
			owner = decision.playerId
			key = [kind, state.turn, owner, decision.offered.instanceId, viewer]
	_set_phase_key(key)
	visible = not key.is_empty() and playback.lingering_battle.is_empty() and router.presentation_ready(decision.get("revealAfterEventId"))
	if not visible:
		return
	var player: Dictionary = state.players[owner]
	var mine := owner == viewer
	options.visible = mine
	waiting.visible = not mine
	skip.visible = playback.is_playing()
	match kind:
		"pvpPenalty":
			_show_penalty(player, state.players[decision.winnerId].name, state.pvpPenaltyAmounts, mine)
		"pveReward":
			_show_reward(decision, player.name, mine)
		"equipmentChoice":
			_show_equipment(decision, player, player.name, mine)
	for button: Button in _buttons.values():
		button.disabled = playback.is_playing()


func _show_reward(notice: Dictionary, player_name: String, mine: bool) -> void:
	title.text = "%s击败了%s" % [player_name, notice.enemyName]
	kicker.text = "精英讨伐成功" if notice.get("elite", false) else "战斗胜利"
	var lines := PackedStringArray()
	for reward: Dictionary in notice.get("rewards", []):
		if reward.source == "boss":
			kicker.text = "阶段首领已倒下"
		lines.append("%s · %s · %s" % [SOURCES[reward.source], reward.name, RESOURCES[reward.resourceType]])
	details.text = "\n".join(lines)
	waiting.text = "等待%s确认奖励……" % player_name
	if mine:
		var label := "收下奖励并加点" if notice.get("statGrowth", false) else "收下奖励"
		_action_button("acknowledge", label, {"type": "acknowledgePveReward"})


func _show_equipment(choice: Dictionary, player: Dictionary, player_name: String, mine: bool) -> void:
	var info := Catalog.equipment_info(choice.offered.kind)
	kicker.text = "装备槽已满"
	title.text = "%s获得了%s" % [player_name, info.name]
	details.text = "%s · %s\n%s" % [info.rarity, info.categoryName, card_description(info)]
	waiting.text = "等待%s选择装备……" % player_name
	if not mine:
		return
	var keys := []
	for item: Dictionary in player.get("equipment", []):
		var owned := Catalog.equipment_info(item.kind)
		if owned.get("category") == info.category:
			var key := "replace-" + str(item.instanceId)
			keys.append(key)
			_action_button(key, "替换%s" % owned.name, {"type": "chooseEquipment", "replaceInstanceId": item.instanceId})
	keys.append("decline")
	_action_button("decline", "放弃新装备", {"type": "chooseEquipment"})
	_sync_option_order(keys)


func _show_penalty(loser: Dictionary, winner_name: String, amounts: Dictionary, mine: bool) -> void:
	kicker.text = "相遇战代价"
	title.text = "%s选择交付" % loser.name
	details.text = "胜者是%s。生命已经回溯，战斗中消耗的卷轴不会返还。" % winner_name
	waiting.text = "等待%s选择代价……" % loser.name
	if not mine:
		return
	var keys := []
	if amounts.gold > 0:
		keys.append("gold")
		_action_button("gold", "支付 20%% 金币 · %d 金币" % amounts.gold, {"type": "choosePvpPenalty", "choice": "gold"})
	for item: Dictionary in loser.scrolls:
		if not item.get("hidden", false):
			keys.append(item.instanceId)
			_action_button(item.instanceId, "交出卷轴 · %s" % Catalog.scroll_name(item.kind),
				{"type": "choosePvpPenalty", "choice": "resource", "resourceType": "scroll", "instanceId": item.instanceId})
	for item: Dictionary in loser.equipment:
		keys.append(item.instanceId)
		_action_button(item.instanceId, "交出装备 · %s" % Catalog.equipment_info(item.kind).name,
			{"type": "choosePvpPenalty", "choice": "resource", "resourceType": "equipment", "instanceId": item.instanceId})
	if amounts.hp > 0:
		keys.append("hp")
		_action_button("hp", "转移生命 · %d 点生命" % amounts.hp, {"type": "choosePvpPenalty", "choice": "hp"})
	_sync_option_order(keys)


func _sync_option_order(keys: Array) -> void:
	for key: String in _buttons.keys():
		if key not in keys:
			_remove_button(key)
	for index in keys.size():
		if _buttons[keys[index]].get_index() != index:
			options.move_child(_buttons[keys[index]], index)


func _set_phase_key(key: Array) -> void:
	if _phase_key == key:
		return
	for id: String in _buttons.keys():
		_remove_button(id)
	_phase_key = key
	body_scroll.scroll_vertical = 0


func _remove_button(key: String) -> void:
	var button := _buttons[key]
	options.remove_child(button)
	button.queue_free()
	_buttons.erase(key)


func _action_button(key: String, label: String, action: Dictionary) -> void:
	if not _buttons.has(key):
		var button := Button.new()
		button.pressed.connect(_submit.bind(button, action))
		options.add_child(button)
		_buttons[key] = button
	_buttons[key].text = label


func _submit(button: Button, action: Dictionary) -> void:
	if button.is_visible_in_tree() and not button.disabled:
		action_requested.emit(action)

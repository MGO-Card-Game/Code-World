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


func set_game_state(state: Dictionary, viewer: String, playback: Playback, router: Router, can_restart: bool = false) -> void:
	var kind: String = "" if state.is_empty() else state.phase.kind
	var decision: Dictionary
	var owner: String
	var key := []
	var playing := playback.is_playing()
	var ready_to_show := true
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
			ready_to_show = router.presentation_ready(decision.get("revealAfterEventId"))
		"equipmentChoice":
			decision = state.phase.choice
			owner = decision.playerId
			key = [kind, state.turn, owner, decision.offered.instanceId, viewer]
			ready_to_show = router.presentation_ready(decision.get("revealAfterEventId"))
		"scrollDiscardChoice":
			decision = state.phase.choice
			owner = decision.targetPlayerId
			key = [kind, state.turn, owner, viewer]
			ready_to_show = not playing
		"statGrowthChoice":
			decision = state.phase.choice
			owner = decision.playerId
			key = [kind, state.turn, owner, decision.stageId, viewer]
		"gameOver":
			owner = state.phase.winnerId
			key = [kind, state.turn, owner, viewer, can_restart]
	_set_phase_key(key)
	visible = not key.is_empty() and playback.lingering_battle.is_empty() and ready_to_show
	if not visible:
		return
	var player: Dictionary = state.players[owner]
	var mine := can_restart if kind == "gameOver" else owner == viewer
	options.visible = mine
	waiting.visible = not mine
	skip.visible = playing and kind != "gameOver" and (kind != "statGrowthChoice" or mine)
	match kind:
		"pvpPenalty":
			_show_penalty(player, state.players[decision.winnerId].name, state.pvpPenaltyAmounts, mine)
		"pveReward":
			_show_reward(decision, player.name, mine)
		"equipmentChoice":
			_show_equipment(decision, player, player.name, mine)
		"scrollDiscardChoice":
			_show_discard(decision, player, mine)
		"statGrowthChoice":
			_show_growth(decision, state.map.regions, player, mine)
		"gameOver":
			kicker.text = "登峰之冠"
			title.text = "%s获胜" % player.name
			details.text = "巨龙已经倒下，山巅见证了新的冠军。"
			waiting.text = "等待房主重新开局……"
			if can_restart:
				_action_button("restart", "再来一局", {"type": "restart"})
	for button: Button in _buttons.values():
		button.disabled = playing and kind != "gameOver"


func _show_discard(choice: Dictionary, target: Dictionary, mine: bool) -> void:
	kicker.text = choice.scrollName
	title.text = "%s选择要弃掉的卷轴" % target.name
	details.text = "被缴械的玩家自行决定损失哪一张暗牌。"
	waiting.text = "等待%s选择弃牌……" % target.name
	if not mine:
		return
	var keys := []
	for scroll: Dictionary in target.scrolls:
		if not scroll.get("hidden", false) and scroll.instanceId in choice.candidateIds:
			var info := Catalog.scroll_info(scroll.kind)
			keys.append(scroll.instanceId)
			_action_button(scroll.instanceId, "弃掉%s\n%s" % [info.name, card_description(info)],
				{"type": "chooseScrollDiscard", "instanceId": scroll.instanceId})
	_sync_option_order(keys)


func _show_growth(choice: Dictionary, regions: Array, player: Dictionary, mine: bool) -> void:
	for region: Dictionary in regions:
		if region.id == choice.stageId:
			kicker.text = "%s·登顶之证" % region.name
			break
	title.text = "%s的永久成长" % player.name
	details.text = "击败阶段首领的奖赏，一局只有两次，选定后不可更改。"
	waiting.text = "等待%s分配成长……" % player.name
	if not mine:
		return
	var labels := {
		"attack": "攻击 +1\n永久提高攻击，每一次出手都更疼。\n当前基础 %d" % player.baseAttack,
		"defense": "防御 +1\n永久提高防御，挨打时少扣一点。\n当前基础 %d" % player.baseDefense,
		"maxHp": "生命上限 +5\n永久提高生命上限，并立即补上这 5 点。\n当前 %d/%d" % [player.hp, player.maxHp],
	}
	for option: String in labels:
		_action_button(option, labels[option], {"type": "chooseStatGrowth", "option": option})


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
		button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		button.pressed.connect(_submit.bind(button, action))
		options.add_child(button)
		_buttons[key] = button
	_buttons[key].text = label


func _submit(button: Button, action: Dictionary) -> void:
	if button.is_visible_in_tree() and not button.disabled:
		action_requested.emit(action)

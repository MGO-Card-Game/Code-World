class_name OutcomeOverlay
extends "res://scripts/ui/phase_modal.gd"

const Playback = preload("res://scripts/anim/playback_controller.gd")
const Router = preload("res://scripts/ui/phase_overlay_router.gd")
const SOURCES := {"battle": "战斗奖励", "affix": "词条额外奖励", "elite": "精英额外奖励", "boss": "首领战利品", "blessing": "战争财阀"}
const RESOURCES := {"scroll": "卷轴", "equipment": "装备", "gold": "金币"}
const TREASURE_SOURCES := {"treasure": "宝箱收获", "blessing": "宝物猎人"}

var details := Label.new()
var waiting := Label.new()
var options := ActionList.new()


func _ready() -> void:
	details.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	details.add_theme_constant_override("line_spacing", 6)
	body.add_child(details)
	waiting.add_theme_color_override("font_color", Palette.MUTED)
	body.add_child(waiting)
	body.add_child(options)
	options.chosen.connect(action_requested.emit)


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
			key = [kind, state.turn, owner, decision.enemyName, decision.get("revealAfterEventId"), viewer]
			ready_to_show = router.presentation_ready(decision.get("revealAfterEventId"))
		"equipmentChoice":
			decision = state.phase.choice
			owner = decision.playerId
			key = [kind, state.turn, owner, decision.offered.instanceId, viewer]
			ready_to_show = router.presentation_ready(decision.get("revealAfterEventId"))
		"bossGateChoice":
			decision = state.phase.choice
			owner = decision.playerId
			key = [kind, state.turn, owner, decision.stageId, viewer]
			ready_to_show = not playing
		"blessingChoice":
			decision = state.phase.choice
			owner = decision.winnerId
			key = [kind, state.turn, owner, decision.offered.instanceId, viewer]
		"blessingReward", "treasureReward":
			decision = state.phase.notice
			owner = decision.playerId
			key = [kind, state.turn, owner, viewer, decision.blessing.instanceId if kind == "blessingReward" else decision.tileLabel, decision.get("revealAfterEventId")]
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
	options.locked = playing and kind != "gameOver"
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
		"bossGateChoice":
			_show_gate(decision, state, player, mine)
		"blessingChoice":
			_show_blessing_choice(decision, state, player, mine)
		"blessingReward":
			var blessing := Catalog.blessing_info(decision.blessing.kind)
			kicker.text = "获得赐福"
			title.text = "%s在%s获得了%s" % [player.name, decision.tileLabel, blessing.name]
			details.text = blessing.description
			waiting.text = "等待%s确认新赐福……" % player.name
			if mine:
				options.set_action("acknowledge", "确认赐福", {"type": "acknowledgeBlessingReward"})
		"treasureReward":
			_show_treasure(decision, player.name, mine)
		"statGrowthChoice":
			_show_growth(decision, state.map.regions, player, mine)
		"gameOver":
			kicker.text = "登峰之冠"
			title.text = "%s获胜" % player.name
			details.text = "巨龙已经倒下，山巅见证了新的冠军。"
			waiting.text = "等待房主重新开局……"
			if can_restart:
				options.set_action("restart", "再来一局", {"type": "restart"})


func _show_gate(choice: Dictionary, state: Dictionary, player: Dictionary, mine: bool) -> void:
	var progress: Dictionary = player.stageProgress[choice.stageId]
	var purchased: bool = progress.bossKeyPurchased
	var boss := Catalog.enemy_name(choice.bossEnemyId)
	var lines := PackedStringArray(["已购钥匙" if purchased else "尚未购买钥匙"])
	for region: Dictionary in state.map.regions:
		if region.id == choice.stageId:
			kicker.text = "%s · 守关挑战" % region.name
			for req: Dictionary in region.requirements:
				lines.append("%s · %d/%d" % [req.label, mini(progress[req.type], req.target), req.target])
			break
	title.text = "%s正在门后等待" % boss
	details.text = "\n".join(lines)
	waiting.text = "等待%s处理首领入口……" % player.name
	if not mine:
		return
	if purchased:
		options.set_action("challenge", "挑战%s" % boss, {"type": "chooseBossChallenge", "challenge": true})
	else:
		var price: int = state.bossGateKeyPrice
		var label := "金币不足 · 需要 %d" % price if player.gold < price else "购买钥匙 · %d 金币" % price
		options.set_action("buy", label, {"type": "buyBossKey"}, player.gold < price)
	options.set_action("decline", "暂不进入" if purchased else "暂不购买", {"type": "chooseBossChallenge", "challenge": false})
	options.keep_order(["challenge" if purchased else "buy", "decline"])


func _show_blessing_choice(choice: Dictionary, state: Dictionary, winner: Dictionary, mine: bool) -> void:
	kicker.text = "赐福抉择"
	if choice.source == "pvp":
		title.text = "%s夺得了%s的赐福" % [winner.name, state.players[choice.loserId].name]
	else:
		title.text = "%s在%s发现新的赐福" % [winner.name, choice.tileLabel]
	waiting.text = "等待%s选择赐福……" % winner.name
	var lines := PackedStringArray(["当前赐福槽位 %d/%d" % [winner.blessings.size(), state.playerDerived[choice.winnerId].blessingCapacity]])
	var keys := ["decline"]
	if mine:
		options.set_action("decline", "放弃新赐福", {"type": "chooseBlessing", "replace": false})
	for current: Dictionary in winner.blessings:
		var info := Catalog.blessing_info(current.kind)
		lines.append("已有赐福 · %s\n%s" % [info.name, info.description])
		if mine:
			keys.append(current.instanceId)
			options.set_action(current.instanceId, "替换%s" % info.name,
				{"type": "chooseBlessing", "replace": true, "replaceInstanceId": current.instanceId})
	var offered := Catalog.blessing_info(choice.offered.kind)
	lines.append("新赐福 · %s\n%s" % [offered.name, offered.description])
	details.text = "\n".join(lines)
	if mine:
		options.keep_order(keys)


func _show_treasure(notice: Dictionary, player_name: String, mine: bool) -> void:
	kicker.text = "空宝箱" if notice.empty else "宝箱已开启"
	title.text = "%s打开了%s" % [player_name, notice.tileLabel]
	var lines := PackedStringArray()
	for reward: Dictionary in notice.rewards:
		lines.append("%s · %s · %s" % [TREASURE_SOURCES[reward.source], reward.name, RESOURCES[reward.resourceType]])
	details.text = "箱子里空空如也。" if notice.empty else "\n".join(lines)
	waiting.text = "等待%s确认开箱结果……" % player_name
	if mine:
		options.set_action("acknowledge", "收下奖励", {"type": "acknowledgeTreasureReward"})


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
			options.set_action(scroll.instanceId, "弃掉%s\n%s" % [info.name, card_description(info)],
				{"type": "chooseScrollDiscard", "instanceId": scroll.instanceId})
	options.keep_order(keys)


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
		options.set_action(option, labels[option], {"type": "chooseStatGrowth", "option": option})


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
		options.set_action("acknowledge", label, {"type": "acknowledgePveReward"})


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
			options.set_action(key, "替换%s" % owned.name, {"type": "chooseEquipment", "replaceInstanceId": item.instanceId})
	keys.append("decline")
	options.set_action("decline", "放弃新装备", {"type": "chooseEquipment"})
	options.keep_order(keys)


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
		options.set_action("gold", "支付 20%% 金币 · %d 金币" % amounts.gold, {"type": "choosePvpPenalty", "choice": "gold"})
	for item: Dictionary in loser.scrolls:
		if not item.get("hidden", false):
			keys.append(item.instanceId)
			options.set_action(item.instanceId, "交出卷轴 · %s" % Catalog.scroll_name(item.kind),
				{"type": "choosePvpPenalty", "choice": "resource", "resourceType": "scroll", "instanceId": item.instanceId})
	for item: Dictionary in loser.equipment:
		keys.append(item.instanceId)
		options.set_action(item.instanceId, "交出装备 · %s" % Catalog.equipment_info(item.kind).name,
			{"type": "choosePvpPenalty", "choice": "resource", "resourceType": "equipment", "instanceId": item.instanceId})
	if amounts.hp > 0:
		keys.append("hp")
		options.set_action("hp", "转移生命 · %d 点生命" % amounts.hp, {"type": "choosePvpPenalty", "choice": "hp"})
	options.keep_order(keys)


func _set_phase_key(key: Array) -> void:
	if phase_key != key:
		options.keep_order([])
		phase_key = key
		body_scroll.scroll_vertical = 0

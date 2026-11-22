extends RefCounted

const Battle = preload("res://scripts/ui/battle_panel.gd")
const Outcome = preload("res://scripts/ui/outcome_overlay.gd")

var _check: Callable
var main: Node
var panel: Battle
var outcome: Outcome
var room: Dictionary
var state: Dictionary
var actions: Array[Dictionary] = []


func _init(check: Callable, scene: Node, fixture: Dictionary) -> void:
	_check = check
	main = scene
	panel = main.battle_panel
	outcome = main.outcome_overlay
	state = fixture
	room = {"code": "TEST3", "status": "playing", "seat": "player1", "state": state}


func run() -> void:
	main.router.dispatch_callable = _capture
	state.players.player3 = {"id": "player3", "name": "白云", "scrolls": []}
	state.turnOrder.append("player3")
	_broadcast()
	_check.call(not main.overlay_host.is_visible_in_tree(), "idle overlay leaves the board accessible")
	_test_hand()
	_test_visuals()
	_test_ending(false)
	_test_ending(true)
	_test_restart()
	await _test_pointer_input()


func _capture(action: Dictionary) -> void:
	actions.append(action)


func _press(button: Button, expected: Dictionary) -> void:
	_check.call(button.is_visible_in_tree() and not button.disabled, "available action %s" % expected)
	actions.clear()
	button.pressed.emit()
	_check.call(actions == [expected], "single exact action %s" % expected)


func _broadcast() -> void:
	# Match the fresh objects and JSON numbers delivered by a real roomState.
	main.get_node("/root/GameClient").room_changed.emit(JSON.parse_string(JSON.stringify(room)))


func _step() -> void:
	main._process(main.playback.queue.remaining_ms() / 1000.0)


func _battle() -> Dictionary:
	return {
		"kind": "pve", "aPlayerId": "player1", "enemyId": "uncannyFlesh",
		"attacker": "a", "round": 1, "hpA": 16, "hpB": 5, "initiativeA": 6, "initiativeB": 3,
		"choiceA": {"status": "pending"}, "choiceB": {"status": "declined"},
		"log": ["遭遇诡异肉块", "青岚取得先攻"],
	}


func _test_hand() -> void:
	var battle := _battle()
	state.phase = {"kind": "battle", "battle": battle}
	state.players.player1.scrolls = [
		{"kind": "might", "instanceId": "blade"}, {"kind": "battlefieldMedicine", "instanceId": "med"},
		{"kind": "decapitationOrder", "instanceId": "elite"}, {"kind": "guard", "instanceId": "shield"},
		{"instanceId": "back", "hidden": true},
	]
	state.viewerPlayableScrollIds = {"beforeAttackRoll": ["blade", "med", "back", "absent"], "beforeDefenseRoll": ["med", "shield"]}
	state.lastEvents = [{"id": 1, "type": "battleStarted"}]
	_broadcast()
	var panel_id := panel.get_instance_id()
	_check.call(panel.is_visible_in_tree() and not outcome.visible and panel.skip.visible, "battle owns overlay and skip")
	_check.call(panel.side_b.health.text.contains("5 / 100"), "catalog fallback for legacy monster maximum")
	_check.call(panel.hand.get_child_count() == 2, "intersect authority with visible hand, excluding elite-only scroll")
	var blade: Button = panel.hand.get_child(0)
	var med: Button = panel.hand.get_child(1)
	_check.call(blade.text.contains("力量卷轴 · N · 攻") and blade.text.contains("本次攻击 +3") and med.text.contains("疗"), "scroll name, rarity, sigil and effect")
	_check.call(panel.prompt.text.contains("对方已提交") and panel.confirm.disabled and blade.disabled, "enemy submitted, inputs locked during opening")
	panel.skip.pressed.emit()
	_press(panel.confirm, {"type": "submitScrollChoice", "side": "a", "instanceIds": []})
	med.pressed.emit()
	blade.pressed.emit()
	_check.call(panel.confirm.text == "打出并确认 · 2", "multiselect count")
	_broadcast()
	_check.call(panel.hand.get_child(0) == blade and panel.hand.get_child(1) == med and med.button_pressed and blade.button_pressed, "rebroadcast preserves button identities and draft")
	state.lastEvents = [{"id": 2, "type": "narration", "text": "战斗中"}]
	_broadcast()
	actions.clear()
	panel.confirm.pressed.emit()
	_check.call(actions.is_empty() and panel.confirm.disabled, "locked confirmation cannot dispatch")
	_step()
	_press(panel.confirm, {"type": "submitScrollChoice", "side": "a", "instanceIds": ["med", "blade"]})
	med.pressed.emit()
	_check.call(not med.button_pressed and panel.confirm.text == "打出并确认 · 1", "second click deselects")
	med.pressed.emit()
	state.viewerPlayableScrollIds.beforeAttackRoll = ["med"]
	_broadcast()
	_check.call(panel.hand.get_child_count() == 1 and panel.hand.get_child(0) == med, "withdraw only ineligible card")
	_press(panel.confirm, {"type": "submitScrollChoice", "side": "a", "instanceIds": ["med"]})

	battle.round = 2
	battle.attacker = "b"
	_broadcast()
	_check.call(panel.hand.get_child_count() == 2 and not med.button_pressed and panel.confirm.text == "直接投骰", "defense timing and round change reset draft")
	med.pressed.emit()
	state.lastEvents = [{"id": 3, "type": "battleStarted"}]
	_broadcast()
	_check.call(panel.confirm.text == "直接投骰" and not med.button_pressed, "distinct battle with identical participants and round resets draft")
	panel.skip.pressed.emit()
	battle.attacker = "a"
	state.players.player1.equipment = [{"kind": "warcasterPauldron", "instanceId": "armor"}]
	state.viewerPlayableScrollIds = {"beforeAttackRoll": []}
	_broadcast()
	_check.call(panel.hand.get_child_count() == 0 and panel.confirm.text == "直接投骰", "blocked attack timing permits empty submission only")
	state.viewerPlayableScrollIds = {}
	_broadcast()
	_check.call(panel.hand.get_child_count() == 0, "present contract with missing timing fails closed")
	state.erase("viewerPlayableScrollIds")
	state.players.player1.equipment = []
	_broadcast()
	_check.call(panel.hand.get_child_count() == 3 and panel.hand.get_child(2).text.contains("【精英与首领限定】"), "legacy timing fallback reads localized keywords")

	battle.kind = "pvp"
	battle.erase("enemyId")
	battle.bPlayerId = "player2"
	battle.choiceB = {"status": "pending"}
	state.viewerPlayableScrollIds = {"beforeAttackRoll": ["med"], "beforeDefenseRoll": []}
	_broadcast()
	panel.hand.get_child(0).pressed.emit()
	battle.choiceA = {"status": "chosen", "instanceIds": ["med"]}
	_broadcast()
	_check.call(panel.prompt.text == "等待白石决定是否使用卷轴……" and not panel.confirm.visible and panel.hand.get_child_count() == 0, "choice handoff removes own hand and submit")
	battle.choiceA = {"status": "pending"}
	_broadcast()
	_check.call(panel.confirm.text == "直接投骰" and not panel.hand.get_child(0).button_pressed, "same-round handoff clears previous draft")
	room.seat = "player3"
	state.erase("viewerPlayableScrollIds")
	_broadcast()
	_check.call(panel.kicker.text == "旅者相遇战" and panel.prompt.text == "等待青岚决定是否使用卷轴……", "spectator waits for named participant")
	_check.call(panel.hand.get_child_count() == 0 and not panel.confirm.is_visible_in_tree(), "spectator has no cards or submit even with legacy fixture")
	_check.call(panel.get_instance_id() == panel_id, "one mounted panel through choices, events and battles")
	room.seat = "player1"


func _test_visuals() -> void:
	var battle := _battle()
	battle.merge({"round": 2, "attacker": "b", "enemyAffix": "venomous", "nextPlayerAttackPenalty": 2, "enemyAttacksPerformed": 2}, true)
	state.phase = {"kind": "battle", "battle": battle}
	state.battleEnemy = {"name": "淬毒的诡异肉块", "maxHp": 102, "attack": 3, "defense": 4}
	state.lastEvents = [
		{"id": 10, "type": "battleStarted"},
		{"id": 11, "type": "attackRolled", "side": "b", "sides": 8, "dice": [7], "total": 10},
		{"id": 12, "type": "attackRolled", "side": "a", "sides": 20, "dice": [17, 2], "total": 22},
		{"id": 13, "type": "defenseRolled", "side": "b", "sides": 6, "dice": [3], "total": 7},
		{"id": 14, "type": "battleHealed", "targetSide": "a", "amount": 2, "hpBefore": 14, "hpAfter": 16},
		{"id": 15, "type": "battleDamage", "targetSide": "b", "amount": 4, "hpBefore": 9, "hpAfter": 5},
		{"id": 16, "type": "battleRoundAdvanced", "fromRound": 1, "fromAttacker": "a"},
	]
	_broadcast()
	_check.call(panel.kicker.text == "山路遭遇" and panel.title.text == "青岚 VS 淬毒的诡异肉块", "authoritative encounter title")
	_check.call(panel.side_a.heading.text == "青岚 · 攻击方" and panel.side_b.heading.text.ends_with("防守方"), "roles held before handover")
	_check.call(panel.initiative.text.contains("先攻 6 : 3") and panel.initiative.text.contains("第 1 轮") and not panel.confirm.visible, "initiative and held round preclude future decisions")
	_check.call(panel.side_a.bar.value == 14 and panel.side_b.bar.value == 9 and panel.side_b.bar.max_value == 102, "pending HP on both sides, affixed maximum")
	_check.call(panel.side_a.status.text == "霜冻侵蚀 · 下一次攻击 -2" and panel.side_b.status.text.contains("崩解倒计时 2 / 3 次攻击"), "frost and flesh countdown")
	_check.call(panel.side_b.status.text.contains("R · 怪物词条 · 淬毒的") and panel.side_b.status.text.contains("【无视防御】") and panel.side_b.status.text.contains("额外造成 1 点伤害"), "affix rarity, name, keyword, description")
	_check.call(panel.log_text.text == "遭遇诡异肉块\n青岚取得先攻" and panel.log_text.get_parent() is ScrollContainer, "scrollable multiline battle log")
	_step()
	_check.call(panel.side_a.roll.text.ends_with("合计 —") and panel.side_b.roll.text.ends_with("合计 —"), "side mismatch never assigns opponent's roll")
	_step()
	_check.call(panel.side_a.roll.text == "攻击 · D20   17 + 2   合计 22" and panel.side_b.roll.text.ends_with("合计 —"), "attack faces precede defense")
	_step()
	_check.call(panel.side_b.roll.text == "防御 · D6   3   合计 7", "defense displayed on defender")
	_step()
	_check.call(panel.side_a.change.text == "+2" and panel.side_a.bar.value == 16 and not panel.side_b.change.visible, "healing highlights target")
	_step()
	_check.call(panel.side_b.change.text == "-4" and panel.side_b.bar.value == 5 and not panel.side_a.change.visible, "damage highlights target")
	_step()
	_check.call(panel.initiative.text.contains("第 2 轮") and panel.side_b.heading.text.ends_with("攻击方") and panel.side_a.roll.text.ends_with("合计 —"), "round advance swaps roles and clears dice")
	_check.call(panel.confirm.visible and panel.confirm.disabled, "decision visible but locked until presentation finishes")
	_step()
	_check.call(not panel.confirm.disabled and not panel.skip.visible, "input restored after natural completion")


func _test_ending(equipment_first: bool) -> void:
	var battle := _battle()
	battle.enemyAffix = "vigorous"
	state.phase = {"kind": "battle", "battle": battle}
	state.battleEnemy = {"name": "生命旺盛的诡异肉块", "maxHp": 107, "attack": 3, "defense": 4}
	state.lastEvents = [{"id": 20, "type": "battleStarted"}]
	_broadcast()
	panel.skip.pressed.emit()
	var old_panel_id := panel.get_instance_id()
	var notice := {"playerId": "player1", "enemyName": "生命旺盛的诡异肉块", "elite": true,
		"revealAfterEventId": 24, "rewards": [
			{"source": "affix", "name": "力量卷轴", "publicName": "一张卷轴", "resourceType": "scroll"},
			{"source": "battle", "name": "12 金币", "publicName": "12 金币", "resourceType": "gold"},
		]}
	if equipment_first:
		state.players.player1.equipment = [
			{"instanceId": "old", "kind": "borderLeather"}, {"instanceId": "sword", "kind": "blackIronGreatsword"},
		]
		state.phase = {"kind": "equipmentChoice", "choice": {
			"playerId": "player1", "offered": {"instanceId": "new", "kind": "bloodthirstyBattleplate"},
			"source": "reward", "revealAfterEventId": 21, "resume": {"kind": "showPveReward", "notice": notice},
		}}
	else:
		state.phase = {"kind": "pveReward", "notice": notice}
	state.erase("battleEnemy")
	state.erase("viewerPlayableScrollIds")
	state.lastEvents = [
		{"id": 21, "type": "attackRolled", "side": "a", "sides": 20, "dice": [19], "total": 23},
		{"id": 22, "type": "battleDamage", "targetSide": "b", "amount": 5, "hpBefore": 5, "hpAfter": 0},
		{"id": 23, "type": "battleEnded"},
		{"id": 24, "type": "scrollGranted", "playerId": "player1", "instanceId": "prize"},
		{"id": 25, "type": "narration", "text": "领取奖励"},
	]
	_broadcast()
	_check.call(panel.is_visible_in_tree() and panel.get_instance_id() == old_panel_id and not outcome.visible, "end broadcast keeps existing battle in front")
	_check.call(not panel.prompt.visible and not panel.confirm.visible and not panel.hand.visible, "no input during killing blow")
	_check.call(panel.side_b.health.text.contains("5 / 107") and panel.title.text.contains("生命旺盛的诡异肉块"), "terminal broadcast retains authoritative enemy")
	state.lastEvents = []
	_broadcast()
	_step()
	_check.call(panel.side_b.health.text.contains("0 / 107") and panel.side_b.change.text == "-5" and panel.side_a.roll.text.contains("D20   19   合计 23"), "lethal HP, damage and dice survive later empty broadcast")
	_step()
	_check.call(main.playback.queue.current_event().type == "battleEnded" and panel.visible and not outcome.visible, "battleEnded still owns overlay even with earlier reveal boundary")
	if equipment_first:
		panel.skip.pressed.emit()
		_check.call(not panel.visible and outcome.is_visible_in_tree() and not outcome.skip.visible, "in-battle skip opens equipment exit")
		_test_equipment_options()
		notice.statGrowth = true
		notice.rewards.append({"source": "boss", "name": "铁匠围裙", "publicName": "铁匠围裙", "resourceType": "equipment"})
		state.phase = {"kind": "pveReward", "notice": notice}
		state.lastEvents = []
		_broadcast()
		_check.call(outcome.kicker.text == "阶段首领已倒下" and outcome.options.get_child(0).text == "收下奖励并加点", "equipment resumes boss reward with growth")
	else:
		_step()
		_check.call(not panel.visible and not outcome.visible and not main.overlay_host.visible and main.router.skip_playback.is_visible_in_tree(), "reward boundary still playing after battle exits")
		_step()
		_check.call(outcome.is_visible_in_tree() and outcome.skip.visible and outcome.options.get_child(0).disabled, "later narration runs inside revealed reward")
		outcome.skip.pressed.emit()
		_check.call(outcome.kicker.text == "精英讨伐成功" and outcome.options.get_child(0).text == "收下奖励", "elite reward and ordinary acknowledgement")
	_check.call(main.playback.lingering_battle_enemy.is_empty(), "enemy memory released with battle")
	_check.call(outcome.title.text == "青岚击败了生命旺盛的诡异肉块" and outcome.details.text.contains("词条额外奖励 · 力量卷轴 · 卷轴") and outcome.details.text.contains("战斗奖励 · 12 金币 · 金币"), "localized owner reward details")
	var ack: Button = outcome.options.get_child(0)
	_broadcast()
	_check.call(outcome.options.get_child(0) == ack, "ack button survives repeat roomState")
	_press(ack, {"type": "acknowledgePveReward"})
	room.seat = "player3"
	notice.rewards[0].name = notice.rewards[0].publicName
	_broadcast()
	_check.call(outcome.waiting.is_visible_in_tree() and outcome.waiting.text == "等待青岚确认奖励……" and outcome.options.get_child_count() == 0, "spectator reward is read-only")
	_check.call(outcome.details.text.contains("一张卷轴") and not outcome.details.text.contains("力量卷轴"), "render server-redacted spectator reward")
	room.seat = "player1"
	state.lastEvents = []
	if notice.get("statGrowth", false):
		state.phase = {"kind": "statGrowthChoice", "choice": {"playerId": "player1", "stageId": "foothill"}}
		_broadcast()
		_check.call(not main.overlay_host.visible and main.router.guidance.text.contains("永久成长"), "boss acknowledgement yields to stat growth phase")
	else:
		state.phase = {"kind": "turnComplete"}
		_broadcast()
		_check.call(not main.overlay_host.visible and main.router.primary_action.is_visible_in_tree() and not main.router.primary_action.disabled, "acknowledged ordinary reward returns to board actions")


func _test_equipment_options() -> void:
	_check.call(outcome.title.text == "青岚获得了嗜血战甲" and outcome.details.text.contains("SR · 防具") and outcome.details.text.contains("【无视防御】") and outcome.details.text.contains("防御骰上限 +1"), "new item details from catalog")
	_check.call(outcome.options.get_child_count() == 2, "only same-category equipment plus decline")
	var replace: Button = outcome.options.get_child(0)
	var decline: Button = outcome.options.get_child(1)
	_check.call(replace.text == "替换边境皮甲" and decline.text == "放弃新装备", "equipment option labels")
	state.lastEvents = [{"id": 26, "type": "narration", "text": "获得装备"}]
	_broadcast()
	_broadcast()
	_check.call(outcome.options.get_child(0) == replace and outcome.options.get_child(1) == decline and replace.disabled and decline.disabled, "equipment buttons reused and playback-locked")
	actions.clear()
	replace.pressed.emit()
	decline.pressed.emit()
	_check.call(actions.is_empty(), "locked equipment actions cannot dispatch")
	outcome.skip.pressed.emit()
	_press(replace, {"type": "chooseEquipment", "replaceInstanceId": "old"})
	_press(decline, {"type": "chooseEquipment"})
	state.phase.choice.offered.instanceId = "another"
	_broadcast()
	_check.call(outcome.options.get_child(0) != replace, "distinct offered item starts new choice instance")
	room.seat = "player2"
	_broadcast()
	_check.call(outcome.waiting.text == "等待青岚选择装备……" and outcome.waiting.is_visible_in_tree() and outcome.options.get_child_count() == 0, "other seat sees equipment decision read-only")
	room.seat = "player1"


func _test_restart() -> void:
	state.phase = {"kind": "battle", "battle": _battle()}
	state.battleEnemy = {"name": "旧敌人", "maxHp": 25}
	state.lastEvents = [{"id": 99, "type": "narration", "text": "旧局旁白"}]
	_broadcast()
	_check.call(main.router.message.text == "旧局旁白", "old caption exists before restart")
	state.phase = {"kind": "awaitingRoll"}
	state.erase("battleEnemy")
	state.lastEvents = [{"id": 1, "type": "turnStarted"}]
	_broadcast()
	_check.call(main.playback.is_playing() and main.router.message.text == state.message.text, "ID rollback clears stale caption before new presentation")
	_check.call(main.playback.lingering_battle_enemy.is_empty() and not main.overlay_host.visible, "restart clears old combat presentation")
	state.phase = {"kind": "battle", "battle": _battle()}
	state.battleEnemy = {"name": "重开后的敌人", "maxHp": 100}
	_broadcast()
	_check.call(not main.playback.lingering_battle_enemy.is_empty(), "next game has its own enemy")
	main.get_node("/root/GameClient").room_closed.emit("关闭")
	_check.call(main.playback.lingering_battle_enemy.is_empty() and not panel.visible and not main.overlay_host.visible, "leaving the room resets enemy and overlay")


func _test_pointer_input() -> void:
	state.phase = {"kind": "battle", "battle": _battle()}
	state.viewerPlayableScrollIds = {"beforeAttackRoll": ["blade"]}
	state.lastEvents = []
	_broadcast()
	await main.get_tree().process_frame
	await main.get_tree().process_frame
	var leave: Button = main.router.get_node("Margin/Content/ActionRow/Leave")
	_click(leave)
	_check.call(panel.is_visible_in_tree(), "backdrop intercepts clicks on underlying leave button")
	var blade: Button = panel.hand.get_child(0)
	_click(blade)
	_check.call(blade.button_pressed and panel.confirm.text == "打出并确认 · 1", "pointer click selects the laid-out card")
	actions.clear()
	_click(panel.confirm)
	_check.call(actions == [{"type": "submitScrollChoice", "side": "a", "instanceIds": ["blade"]}], "pointer click submits through overlay")
	state.phase = {"kind": "turnComplete"}
	_broadcast()
	await main.get_tree().process_frame
	actions.clear()
	_click(main.router.primary_action)
	_check.call(actions == [{"type": "endTurn"}], "dismissed overlay releases pointer input to dock")


func _click(button: Button) -> void:
	var viewport := button.get_viewport()
	var point := button.get_global_rect().get_center()
	var hover := InputEventMouseMotion.new()
	hover.position = point
	viewport.push_input(hover, true)
	for down in [true, false]:
		var event := InputEventMouseButton.new()
		event.position = point
		event.button_index = MOUSE_BUTTON_LEFT
		event.pressed = down
		viewport.push_input(event, true)

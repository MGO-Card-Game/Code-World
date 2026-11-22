extends RefCounted

const Battle = preload("res://scripts/ui/battle_panel.gd")
const Outcome = preload("res://scripts/ui/outcome_overlay.gd")
const A := "player1"
const B := "player2"
const C := "player3"

var check: Callable
var main: Node
var panel: Battle
var outcome: Outcome
var room: Dictionary
var state: Dictionary
var actions: Array[Dictionary] = []
var candidates := {
	A: {"beforeAttackRoll": ["scroll-1"], "beforeDefenseRoll": []},
	B: {"beforeAttackRoll": ["scroll-5"], "beforeDefenseRoll": ["scroll-3", "scroll-4"]},
}
var battle := {
	"kind": "pvp", "aPlayerId": A, "bPlayerId": B, "round": 1, "attacker": "a",
	"initiativeA": 5, "initiativeB": 2, "hpA": 16, "hpB": 15,
	"scrollsUsedA": 0, "scrollsUsedB": 0, "enemyAttacksPerformed": 0, "nextPlayerAttackPenalty": 0,
	"log": ["青岚取得先攻"], "choiceA": {"status": "pending"}, "choiceB": {"status": "pending"},
	"tileIndex": 1, "pvpResume": "turnComplete",
}


func _init(check_fn: Callable, scene: Node, fixture: Dictionary) -> void:
	check = check_fn
	main = scene
	panel = main.battle_panel
	outcome = main.outcome_overlay
	state = fixture
	state.players[A].scrolls = [{"kind": "might", "instanceId": "scroll-1"}, {"kind": "plunder", "instanceId": "scroll-2"}]
	state.players[A].equipment = [{"kind": "sword", "instanceId": "equipment-1"}]
	state.playerDerived[A].attack = 5
	state.players[B].scrolls = [
		{"kind": "guard", "instanceId": "scroll-3"}, {"kind": "guard", "instanceId": "scroll-4"},
		{"kind": "heavyStrike", "instanceId": "scroll-5"},
	]
	state.players[C] = state.players[B].merged({"id": C, "name": "白云", "scrolls": [], "position": 0}, true)
	state.turnOrder.append(C)
	state.playerDerived[C] = state.playerDerived[B].duplicate()
	state.phase = {"kind": "battle", "battle": battle}
	state.erase("viewerPlayableScrollIds")
	var members := []
	for id: String in state.turnOrder:
		members.append({"seat": id, "name": state.players[id].name, "connected": true})
	room = {"code": "PVPTA", "status": "playing", "hostSeat": A, "capacity": 3, "members": members}


func _broadcast(viewer: String) -> void:
	# Supply a fresh wire view even when only the receiving seat changes.
	var view: Dictionary = state.duplicate(true)
	for id: String in view.turnOrder:
		if id != viewer:
			view.players[id].scrolls = view.players[id].scrolls.map(func(card: Dictionary) -> Dictionary:
				return {"instanceId": card.instanceId, "hidden": true})
	if view.phase.kind == "battle":
		if viewer in candidates:
			view.viewerPlayableScrollIds = candidates[viewer]
		for side: String in ["a", "b"]:
			var choice := "choice" + side.to_upper()
			if viewer != battle[side + "PlayerId"] and battle[choice].status != "pending":
				view.phase.battle[choice] = {"status": "submitted"}
	room.seat = viewer
	room.state = view
	main.get_node("/root/GameClient").room_changed.emit(JSON.parse_string(JSON.stringify(room)))


func run() -> void:
	main.router.dispatch_callable = func(action: Dictionary) -> void: actions.append(action)
	_test_choices()
	_test_handover()
	var before_last_hit := state.duplicate(true)
	_test_ending(false)
	# Replay the final broadcast in a fresh room and skip battleEnded.
	room.code = "PVPTB"
	state = before_last_hit
	_broadcast(A)
	_test_ending(true)
	state.phase = {"kind": "turnComplete"}
	state.players[A].gold = 56
	state.players[B].gold = 64
	state.viewerPlayableScrollIds = {"map": ["scroll-2"]}
	state.erase("pvpPenaltyAmounts")
	state.lastEvents = []
	_broadcast(A)
	check.call(not main.overlay_host.visible and main.router.primary_action.is_visible_in_tree(), "penalty exit restores board")


func _press(button: Button, expected: Dictionary) -> void:
	actions.clear()
	check.call(button.is_visible_in_tree() and not button.disabled, "enabled PvP action %s" % expected)
	button.pressed.emit()
	check.call(actions == [expected], "exact PvP action %s" % expected)


func _check_private_text() -> void:
	var visible_text := PackedStringArray()
	for control in main.find_children("*", "Control", true, false):
		if control.is_visible_in_tree():
			visible_text.append(control.tooltip_text)
			if control is Label or control is Button:
				visible_text.append(control.text)
	var shown := "\n".join(visible_text)
	for secret: String in ["力量卷轴", "搜刮", "scroll-1", "scroll-2"]:
		check.call(not shown.contains(secret), "%s cannot see A's private card %s" % [room.seat, secret])


func _check_waiting_for(player_name: String) -> void:
	check.call(panel.prompt.is_visible_in_tree() and panel.prompt.text == "等待%s决定是否使用卷轴……" % player_name, "waiting for " + player_name)
	check.call(panel.hand.get_child_count() == 0 and not panel.confirm.is_visible_in_tree(), "waiting seat has no hand or submit")


func _test_choices() -> void:
	_broadcast(A)
	check.call(panel.hand.get_child_count() == 1 and panel.hand.get_child(0).text.begins_with("力量卷轴"), "A sees only attack candidate")
	for viewer: String in [B, C]:
		_broadcast(viewer)
		_check_waiting_for("青岚")
		_check_private_text()
	_broadcast(A)
	panel.hand.get_child(0).pressed.emit()
	_press(panel.confirm, {"type": "submitScrollChoice", "side": "a", "instanceIds": ["scroll-1"]})
	battle.choiceA = {"status": "chosen", "instanceIds": ["scroll-1"]}
	_broadcast(A)
	_check_waiting_for("白石")
	_broadcast(C)
	_check_waiting_for("白石")
	_check_private_text()
	_broadcast(B)
	check.call(room.state.phase.battle.choiceA == {"status": "submitted"} and panel.prompt.text.contains("对方已提交"), "B sees only A's submission status")
	check.call(panel.hand.get_child_count() == 2, "B sees only two defense candidates")
	for card: Button in panel.hand.get_children():
		check.call(card.text.begins_with("护盾卷轴"), "defense choice belongs to B")
	_check_private_text()
	panel.hand.get_child(1).pressed.emit()
	panel.hand.get_child(0).pressed.emit()
	_broadcast(B)
	check.call(panel.confirm.text == "打出并确认 · 2" and panel.hand.get_child(0).button_pressed and panel.hand.get_child(1).button_pressed, "B keeps multi-select draft on rebroadcast")
	_press(panel.confirm, {"type": "submitScrollChoice", "side": "b", "instanceIds": ["scroll-4", "scroll-3"]})


func _test_handover() -> void:
	battle.merge({"round": 2, "attacker": "b", "hpB": 13, "choiceA": {"status": "pending"},
		"scrollsUsedA": 1, "scrollsUsedB": 2}, true)
	state.players[A].scrolls.pop_front()
	state.players[B].scrolls = [state.players[B].scrolls.back()]
	candidates[A].beforeAttackRoll = []
	candidates[B].beforeDefenseRoll = []
	state.lastEvents = [
		{"id": 1, "type": "attackRolled", "side": "a", "die": 4, "dice": [4], "sides": 6, "base": 4, "flatBonus": 3, "total": 11},
		{"id": 2, "type": "defenseRolled", "side": "b", "die": 1, "dice": [1], "sides": 6, "base": 2, "flatBonus": 6, "total": 9},
		{"id": 3, "type": "battleDamage", "targetSide": "b", "amount": 2, "hpBefore": 15, "hpAfter": 13, "hpMax": 18},
		{"id": 4, "type": "battleRoundAdvanced", "fromRound": 1, "fromAttacker": "a", "round": 2, "attacker": "b"},
	]
	_broadcast(B)
	for event: Dictionary in state.lastEvents:
		check.call(main.playback.queue.current_event().type == event.type, "playing " + event.type)
		check.call(panel.initiative.text.contains("第 1 轮") and panel.side_a.heading.text.ends_with("攻击方") and not panel.confirm.visible, "round one held throughout " + event.type)
		main._process(main.playback.queue.remaining_ms() / 1000.0)
	check.call(panel.initiative.text.contains("第 2 轮") and panel.side_b.heading.text.ends_with("攻击方"), "round two begins with B attacking")
	check.call(panel.hand.get_child_count() == 1 and panel.hand.get_child(0).text.begins_with("痛击") and panel.confirm.text == "直接投骰", "B starts round two with clean attack draft")
	panel.hand.get_child(0).pressed.emit()
	_press(panel.confirm, {"type": "submitScrollChoice", "side": "b", "instanceIds": ["scroll-5"]})
	battle.choiceB = {"status": "chosen", "instanceIds": ["scroll-5"]}
	state.lastEvents = []
	_broadcast(A)
	_press(panel.confirm, {"type": "submitScrollChoice", "side": "a", "instanceIds": []})


func _test_ending(skip: bool) -> void:
	state.phase = {"kind": "pvpPenalty", "penalty": {"winnerId": B, "loserId": A, "tileIndex": 1, "resume": "turnComplete"}}
	state.pvpPenaltyAmounts = {"gold": 14, "hp": 3}
	state.players[B].scrolls = []
	state.lastEvents = [
		{"id": 5, "type": "battleDamage", "targetSide": "a", "hpBefore": 16, "hpAfter": 0, "amount": 16, "hpMax": 18},
		{"id": 6, "type": "battleEnded", "battleKind": "pvp", "winnerSide": "b", "outcome": "pvpDecided"},
		{"id": 7, "type": "narration", "text": "青岚需要选择代价。"},
	]
	_broadcast(A)
	check.call(panel.is_visible_in_tree() and not outcome.visible, "killing blow holds battle over penalty")
	main._process(main.playback.queue.remaining_ms() / 1000.0)
	check.call(main.playback.queue.current_event().type == "battleEnded" and panel.visible and not outcome.visible, "battleEnded owns full slot")
	if skip:
		panel.skip.pressed.emit()
	else:
		main._process(main.playback.queue.remaining_ms() / 1000.0)
	check.call(not panel.visible and outcome.is_visible_in_tree(), "penalty revealed after battleEnded")
	check.call(outcome.kicker.text == "相遇战代价" and outcome.title.text == "青岚选择交付" and outcome.details.text == "胜者是白石。生命已经回溯，战斗中消耗的卷轴不会返还。", "penalty copy matches PenaltyPanel")
	if skip:
		check.call(not outcome.options.get_child(0).disabled, "skip immediately unlocks penalty")
		_press(outcome.options.get_child(0), {"type": "choosePvpPenalty", "choice": "gold"})
		return
	actions.clear()
	for button: Button in outcome.options.get_children():
		check.call(button.disabled, "penalty option locked during narration")
		button.pressed.emit()
	check.call(actions.is_empty(), "locked penalty cannot dispatch")
	main._process(main.playback.queue.remaining_ms() / 1000.0)
	_test_penalty_options()


func _test_penalty_options() -> void:
	var labels := ["支付 20% 金币 · 14 金币", "交出卷轴 · 搜刮", "交出装备 · 铁剑", "转移生命 · 3 点生命"]
	var choices := [{"choice": "gold"}, {"choice": "resource", "resourceType": "scroll", "instanceId": "scroll-2"},
		{"choice": "resource", "resourceType": "equipment", "instanceId": "equipment-1"}, {"choice": "hp"}]
	var buttons := outcome.options.get_children()
	_broadcast(A)
	check.call(buttons.size() == labels.size(), "four payable options")
	for i in labels.size():
		var button: Button = outcome.options.get_child(i)
		check.call(button.text == labels[i] and button.get_instance_id() == buttons[i].get_instance_id(), "stable ordered button " + labels[i])
		_press(button, choices[i].merged({"type": "choosePvpPenalty"}))
	state.players[A].gold = 0
	state.pvpPenaltyAmounts.gold = 0
	_broadcast(A)
	check.call(outcome.options.get_children() == buttons.slice(1), "gold alone removed at zero")
	state.players[A].gold = 70
	state.pvpPenaltyAmounts = {"gold": 14, "hp": 0}
	state.players[B].hp = state.players[B].maxHp
	_broadcast(A)
	check.call(outcome.options.get_child_count() == 3 and outcome.options.get_child(0).text == labels[0] and outcome.options.get_child(2) == buttons[2], "zero HP removes only life transfer")
	for viewer: String in [B, C]:
		_broadcast(viewer)
		check.call(outcome.waiting.is_visible_in_tree() and outcome.waiting.text == "等待青岚选择代价……" and outcome.options.get_child_count() == 0, "winner and spectator see waiting only")
		_check_private_text()
	state.players[A].gold = 0
	state.players[A].scrolls = []
	state.players[A].equipment = []
	state.playerDerived[A].attack = 4
	state.phase.penalty.merge({"waived": true, "waiveReason": "noPayable"})
	state.erase("pvpPenaltyAmounts")
	_broadcast(A)
	check.call(not outcome.visible and outcome.options.get_child_count() == 0, "waived penalty has no payable modal")

extends RefCounted

const Trade = preload("res://scripts/ui/trade_overlay.gd")
const Outcome = preload("res://scripts/ui/outcome_overlay.gd")
const A := "player1"
const B := "player2"
const C := "player3"
const OFFER_A := {"gold": 9, "scrolls": [{"instanceId": "s-1", "kind": "plunder"}],
	"equipment": [{"instanceId": "e-1", "kind": "sword"}]}
const OFFER_B := {"gold": 12, "scrolls": [{"instanceId": "s-3", "kind": "guard"}],
	"equipment": [{"instanceId": "e-3", "kind": "coldIronSpear"}]}

var check: Callable
var main: Node
var trade: Trade
var outcome: Outcome
var state: Dictionary
var room: Dictionary
var actions: Array[Dictionary] = []


func _init(check_fn: Callable, scene: Node, fixture: Dictionary) -> void:
	check = check_fn
	main = scene
	trade = main.trade_overlay
	outcome = main.outcome_overlay
	state = fixture
	state.erase("viewerPlayableScrollIds")
	state.players[C] = state.players[B].merged({"id": C, "name": "白云"}, true)
	state.turnOrder.append(C)
	state.players[A].position = 1
	state.players[A].equipment = [OFFER_A.equipment[0], {"instanceId": "e-2", "kind": "shield"}]
	state.players[B].scrolls = OFFER_B.scrolls.duplicate(true)
	state.players[B].equipment = OFFER_B.equipment.duplicate(true)
	var members := []
	for id: String in state.turnOrder:
		members.append({"seat": id, "name": state.players[id].name, "connected": true})
	room = {"code": "MTHRA", "capacity": 3, "status": "playing", "members": members, "hostSeat": B}


func run() -> void:
	main.router.dispatch_callable = func(action: Dictionary) -> void: actions.append(action)
	_test_offer()
	_test_offer_retry()
	_test_confirmation()
	_test_discard()
	_test_growth()
	_test_game_over()


func _broadcast(viewer: String) -> void:
	var view := state.duplicate(true)
	for id: String in state.turnOrder:
		if id != viewer:
			view.players[id].scrolls = state.players[id].scrolls.map(func(item: Dictionary) -> Dictionary:
				return {"instanceId": item.instanceId, "hidden": true})
	if view.phase.kind == "tradeOffer":
		var offer: Dictionary = view.phase.trade
		for side: String in ["a", "b"]:
			var key := "offer" + side.to_upper()
			if viewer != offer[side + "PlayerId"] and offer[key].status == "offered":
				offer[key] = {"status": "submitted"}
	room.seat = viewer
	room.state = view
	main.get_node("/root/GameClient").room_changed.emit(JSON.parse_string(JSON.stringify(room)))


func _press(button: Button, expected: Dictionary) -> void:
	check.call(button.is_visible_in_tree() and not button.disabled, "available M3a action %s" % expected)
	actions.clear()
	button.pressed.emit()
	check.call(actions == [expected], "exact M3a action %s, received %s" % [expected, actions])


func _step() -> void:
	main._process(main.playback.queue.remaining_ms() / 1000.0)


func _narration() -> void:
	var id: int = state.nextEventId
	state.lastEvents = [{"id": id, "type": "narration", "text": "旅者行动中"}]
	state.nextEventId = id + 1


func _buttons(parent: Node) -> Array:
	return parent.find_children("*", "Button", true, false).filter(func(b: Button) -> bool: return b.is_visible_in_tree())


func _visible_text(parent: Node) -> String:
	var lines := PackedStringArray()
	for control: Control in parent.find_children("*", "Control", true, false):
		if control.is_visible_in_tree():
			lines.append(control.tooltip_text)
			if control is Button or control is Label:
				lines.append(control.text)
	return "\n".join(lines)


func _pending_trade() -> Dictionary:
	return {"aPlayerId": A, "bPlayerId": B, "tileIndex": 1, "offerA": {"status": "pending"}, "offerB": {"status": "pending"}}


func _test_offer() -> void:
	var offer := _pending_trade()
	state.phase = {"kind": "tradeOffer", "trade": offer}
	_narration()
	_broadcast(A)
	check.call(not trade.visible and not main.overlay_host.visible, "offer waits for playback")
	_step()
	check.call(trade.is_visible_in_tree() and trade.kicker.text == "秘密报价" and trade.title.text == "准备你的交易报价", "secret offer opens")
	check.call(trade.primary.text == "提交报价" and trade.primary.disabled, "empty offer disabled")
	actions.clear()
	trade.primary.pressed.emit()
	check.call(actions.is_empty(), "empty offer cannot dispatch")
	check.call(trade.gold_label.text == "金币（持有 70）" and trade.gold.min_value == 0 and trade.gold.max_value == 70 and trade.gold.step == 1 and trade.gold.rounded, "gold uses authoritative integer bounds")
	trade.gold.value = 90
	check.call(trade.gold.value == 70 and not trade.primary.disabled, "gold capped at balance")
	trade.gold.value = -2
	check.call(trade.gold.value == 0 and trade.primary.disabled, "gold floored at zero")
	var cards := _buttons(trade.scrolls)
	var gear := _buttons(trade.equipment)
	check.call(cards.size() == 2 and gear.size() == 2, "only owned cards and equipment listed")
	check.call(cards[0].text.contains("搜刮") and cards[0].text.contains("【") and cards[0].text.contains("随机抽走"), "scroll includes catalog keywords and description")
	check.call(gear[0].text.contains("铁剑") and gear[0].text.contains("攻击永久 +1"), "equipment includes catalog description")
	for list: Array in [cards, gear]:
		list[0].pressed.emit()
		check.call(not trade.primary.disabled, "one resource enables submission")
		list[0].pressed.emit()
		check.call(trade.primary.disabled and not list[0].button_pressed, "deselecting last resource disables submission")
	trade.gold.value = 9
	for button: Button in [cards[1], cards[0], gear[1], gear[0]]:
		button.pressed.emit()
	cards[0].grab_focus()
	offer.offerB = {"status": "offered", "offer": OFFER_B}
	_broadcast(A)
	check.call(room.state.phase.trade.offerB == {"status": "submitted"}, "opponent broadcast carries only submission status")
	check.call(_buttons(trade.scrolls) == cards and _buttons(trade.equipment) == gear and cards[0].has_focus(), "opponent submission preserves every button and keyboard focus")
	check.call(trade.gold.value == 9 and (cards + gear).all(func(b: Button) -> bool: return b.button_pressed), "opponent submission preserves complete draft")
	_press(trade.cancel, {"type": "cancelTrade", "side": "a"})
	var expected := {"type": "submitTradeOffer", "side": "a", "gold": 9, "scrollInstanceIds": ["s-2", "s-1"], "equipmentInstanceIds": ["e-2", "e-1"]}
	_press(trade.primary, expected)
	check.call(typeof(actions[0].gold) == TYPE_INT, "submit gold is an integer")
	cards[1].pressed.emit()
	gear[1].pressed.emit()
	check.call(actions == [expected], "dispatched lists are independent of later edits")
	_narration()
	_broadcast(A)
	check.call(not trade.visible, "playing broadcast temporarily hides draft")
	_step()
	check.call(_buttons(trade.scrolls) == cards and trade.gold.value == 9 and cards[0].button_pressed, "same trade survives temporary playback gate")
	check.call(not _visible_text(trade).contains("护盾卷轴"), "opponent's submitted card remains private")
	# Reordering a hand with two copies of one kind must keep the original copy selected.
	var hand: Array = state.players[A].scrolls
	state.players[A].scrolls = [{"instanceId": "s-5", "kind": "plunder"}, hand[0]]
	state.players[A].gold = 5
	_broadcast(A)
	var copies := _buttons(trade.scrolls)
	check.call(copies.size() == 2 and copies[1] == cards[0] and copies[1].button_pressed and not copies[0].button_pressed, "selection and button follow instance ID across reordering")
	check.call(trade.gold.value == 5, "a reduced balance clamps the existing draft")
	_press(trade.primary, {"type": "submitTradeOffer", "side": "a", "gold": 5, "scrollInstanceIds": ["s-1"], "equipmentInstanceIds": ["e-1"]})
	state.players[A].scrolls = hand
	state.players[A].gold = 70
	_broadcast(C)
	check.call(_buttons(trade).is_empty() and not trade.gold.is_visible_in_tree() and trade.waiting.text == "等待交易双方提交报价……", "spectator has only the offer waiting notice")
	var shown := _visible_text(main)
	for secret: String in ["搜刮", "灵活行动", "护盾卷轴"]:
		check.call(not shown.contains(secret), "spectator cannot see private card " + secret)
	_broadcast(A)
	check.call(trade.gold.value == 0 and trade.primary.disabled, "viewer change clears previous draft")


func _test_offer_retry() -> void:
	var offer := _pending_trade()
	state.turn += 1
	state.phase.trade = offer
	_broadcast(B)
	trade.gold.value = 12
	_buttons(trade.scrolls)[0].pressed.emit()
	_buttons(trade.equipment)[0].pressed.emit()
	_press(trade.primary, {"type": "submitTradeOffer", "side": "b", "gold": 12, "scrollInstanceIds": ["s-3"], "equipmentInstanceIds": ["e-3"]})
	offer.offerB = {"status": "offered", "offer": OFFER_B}
	_broadcast(B)
	check.call(trade.waiting.is_visible_in_tree() and trade.waiting.text == "报价已提交，等待对方……" and _buttons(trade) == [trade.cancel], "submitted participant can still cancel")
	_press(trade.cancel, {"type": "cancelTrade", "side": "b"})
	offer.offerB = {"status": "pending"}
	offer.error = "装备槽位不兼容，请双方调整装备报价。"
	_broadcast(B)
	check.call(trade.error_label.is_visible_in_tree() and trade.error_label.text == offer.error, "incompatible equipment reason displayed")
	check.call(trade.gold.value == 0 and trade.primary.disabled and not _buttons(trade.scrolls)[0].button_pressed and not _buttons(trade.equipment)[0].button_pressed, "offered to pending clears all three draft fields")
	_buttons(trade.scrolls)[0].pressed.emit()
	_broadcast(B)
	check.call(_buttons(trade.scrolls)[0].button_pressed and not trade.primary.disabled, "repeated retry reason preserves new draft")
	state.players[B].scrolls = []
	_buttons(trade.equipment)[0].pressed.emit()
	state.players[B].equipment = []
	_broadcast(B)
	var shown := _visible_text(trade)
	check.call(trade.primary.disabled and shown.contains("没有可报价的卷轴") and shown.contains("没有可报价的装备"), "lost IDs removed and both empty notices shown")
	state.players[B].scrolls = OFFER_B.scrolls.duplicate(true)
	state.players[B].equipment = OFFER_B.equipment.duplicate(true)
	trade.gold.value = 8
	offer.tileIndex = 0
	_broadcast(B)
	check.call(trade.gold.value == 0 and trade.primary.disabled, "new tile starts a fresh trade")
	trade.gold.value = 6
	state.phase = {"kind": "turnComplete"}
	_broadcast(B)
	check.call(not trade.visible and not main.overlay_host.visible, "leaving trade restores board")
	state.phase = {"kind": "tradeOffer", "trade": offer}
	_broadcast(B)
	check.call(trade.gold.value == 0 and trade.primary.disabled, "re-entering identical trade starts empty")


func _test_confirmation() -> void:
	var confirmation := {"aPlayerId": A, "bPlayerId": B, "tileIndex": 1,
		"offerA": OFFER_A.duplicate(true), "offerB": OFFER_B.duplicate(true), "confirmationA": "pending", "confirmationB": "pending"}
	state.phase = {"kind": "tradeConfirmation", "trade": confirmation}
	_narration()
	_broadcast(A)
	check.call(not trade.visible, "public confirmation waits for playback")
	_step()
	check.call(trade.kicker.text == "最终确认" and trade.title.text == "核对双方报价" and not trade.editor.visible, "confirmation replaces editor")
	for viewer: String in [A, B, C]:
		_broadcast(viewer)
		var shown := _visible_text(trade)
		check.call(shown.contains("青岚交出\n金币 · 9\n卷轴 · 搜刮\n装备 · 铁剑\n青岚：待确认"), "public offer A visible to " + viewer)
		check.call(shown.contains("白石交出\n金币 · 12\n卷轴 · 护盾卷轴\n装备 · 寒铁长枪\n白石：待确认"), "public offer B visible to " + viewer)
	check.call(_buttons(trade).is_empty() and trade.waiting.text == "等待尚未确认的一方……", "confirmation spectator waits")
	_broadcast(B)
	_press(trade.primary, {"type": "confirmTrade", "side": "b", "accept": true})
	_broadcast(A)
	var buttons := _buttons(trade)
	confirmation.confirmationB = "accepted"
	_broadcast(A)
	check.call(_buttons(trade) == buttons and buttons.size() == 2 and trade.summary.text.contains("白石：已确认"), "peer confirmation updates status in place")
	_press(trade.primary, {"type": "confirmTrade", "side": "a", "accept": true})
	_press(trade.cancel, {"type": "confirmTrade", "side": "a", "accept": false})
	_broadcast(B)
	check.call(_buttons(trade).is_empty() and trade.waiting.is_visible_in_tree() and trade.waiting.text == "等待尚未确认的一方……", "accepted participant waits")
	confirmation.offerA.gold = 0
	_broadcast(C)
	check.call(not trade.summary.text.contains("金币 · 0") and trade.summary.text.contains("金币 · 12"), "zero gold omitted per offer")


func _test_discard() -> void:
	state.activePlayerId = B
	state.players[A].scrolls.append({"instanceId": "s-4", "kind": "might"})
	state.phase = {"kind": "scrollDiscardChoice", "choice": {"sourcePlayerId": B, "targetPlayerId": A,
		"candidateIds": ["s-1", "s-4"], "scrollName": "缴械", "resume": "awaitingRoll"}}
	_narration()
	_broadcast(A)
	check.call(not outcome.visible and not main.overlay_host.visible, "discard hidden during playback")
	_step()
	check.call(outcome.is_visible_in_tree() and outcome.kicker.text == "缴械" and outcome.title.text == "青岚选择要弃掉的卷轴", "discard revealed at playback end")
	var cards := _buttons(outcome)
	check.call(cards.size() == 2 and cards[0].text.contains("搜刮") and cards[1].text.contains("本次攻击 +3") and not _visible_text(outcome).contains("灵活行动"), "discard shows only candidate cards with descriptions")
	_broadcast(A)
	check.call(_buttons(outcome) == cards, "discard buttons survive identical roomState")
	_press(cards[0], {"type": "chooseScrollDiscard", "instanceId": "s-1"})
	_press(cards[1], {"type": "chooseScrollDiscard", "instanceId": "s-4"})
	for viewer: String in [B, C]:
		_broadcast(viewer)
		var shown := _visible_text(main)
		check.call(_buttons(outcome).is_empty() and outcome.waiting.text == "等待青岚选择弃牌……", "discard waits for target on " + viewer)
		check.call(not shown.contains("力量卷轴") and not shown.contains("搜刮"), "target's card names stay private on " + viewer)


func _test_growth() -> void:
	state.activePlayerId = A
	state.phase = {"kind": "statGrowthChoice", "choice": {"playerId": A, "stageId": "mountainside"}}
	_narration()
	_broadcast(B)
	check.call(outcome.is_visible_in_tree() and _buttons(outcome).is_empty() and outcome.waiting.text == "等待青岚分配成长……", "non-owner waits throughout growth narration")
	_broadcast(A)
	var buttons := outcome.options.get_children()
	check.call(outcome.is_visible_in_tree() and outcome.kicker.text == "山腰·登顶之证" and outcome.title.text == "青岚的永久成长", "growth uses region name while narration plays")
	actions.clear()
	for button: Button in buttons:
		check.call(button.disabled, "growth locked during narration")
		button.pressed.emit()
	check.call(actions.is_empty(), "disabled growth actions cannot dispatch")
	_step()
	_broadcast(A)
	check.call(buttons.size() == 3 and outcome.options.get_children() == buttons, "growth options survive playback and broadcast")
	var labels := ["攻击 +1", "防御 +1", "生命上限 +5"]
	var values := ["当前基础 4", "当前基础 2", "当前 16/18"]
	var options := ["attack", "defense", "maxHp"]
	for i in options.size():
		check.call(buttons[i].text.begins_with(labels[i]) and buttons[i].text.ends_with(values[i]), "growth shows base value for " + options[i])
		_press(buttons[i], {"type": "chooseStatGrowth", "option": options[i]})
	_broadcast(B)
	check.call(_buttons(outcome).is_empty() and outcome.waiting.text == "等待青岚分配成长……", "host cannot allocate another player's growth")


func _test_game_over() -> void:
	state.phase = {"kind": "battle", "battle": {"kind": "boss", "stageId": "summit", "enemyId": "dragon", "aPlayerId": A,
		"hpA": 16, "hpB": 1, "attacker": "a", "round": 3, "initiativeA": 5, "initiativeB": 1, "log": [],
		"scrollsUsedA": 0, "scrollsUsedB": 0, "enemyAttacksPerformed": 2, "nextPlayerAttackPenalty": 0,
		"choiceA": {"status": "pending"}, "choiceB": {"status": "declined"}}}
	state.battleEnemy = {"name": "峰顶巨龙", "attack": 8, "defense": 6, "maxHp": 75}
	state.lastEvents = []
	_broadcast(B)
	var id: int = state.nextEventId
	state.lastEvents = [
		{"id": id, "type": "battleDamage", "targetSide": "b", "amount": 1, "hpBefore": 1, "hpAfter": 0, "hpMax": 75},
		{"id": id + 1, "type": "battleEnded", "battleKind": "boss", "winnerSide": "a", "outcome": "playerWon"},
		{"id": id + 2, "type": "gameOver", "winnerId": A},
	]
	state.nextEventId += 3
	state.phase = {"kind": "gameOver", "winnerId": A}
	state.erase("battleEnemy")
	_broadcast(B)
	for event: String in ["battleDamage", "battleEnded"]:
		check.call(main.playback.queue.current_event().type == event and main.battle_panel.is_visible_in_tree() and not outcome.visible, "victory waits throughout " + event)
		_step()
	check.call(main.playback.is_playing() and outcome.is_visible_in_tree() and not main.battle_panel.visible, "victory opens immediately after battleEnded")
	check.call(outcome.kicker.text == "登峰之冠" and outcome.title.text == "青岚获胜" and outcome.details.text == "巨龙已经倒下，山巅见证了新的冠军。", "victory copy names winner")
	var restart: Button = outcome.options.get_child(0)
	_broadcast(B)
	check.call(outcome.options.get_child(0) == restart and restart.text == "再来一局", "host restart button reused")
	_press(restart, {"type": "restart"})
	for viewer: String in [A, C]:
		_broadcast(viewer)
		check.call(_buttons(outcome).is_empty() and outcome.waiting.is_visible_in_tree() and outcome.waiting.text == "等待房主重新开局……", "non-host waits even when winner")
	room.hostSeat = C
	_broadcast(C)
	_press(outcome.options.get_child(0), {"type": "restart"})
	main.get_node("/root/GameClient").room_closed.emit("房间已关闭")
	check.call(not main.overlay_host.visible and not trade.visible and not outcome.visible, "room reset closes both modals")

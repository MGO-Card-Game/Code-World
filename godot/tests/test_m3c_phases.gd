extends RefCounted

const Catalog = preload("res://scripts/data/content_catalog.gd")
const EventOverlay = preload("res://scripts/ui/map_event_overlay.gd")
const Inspect = preload("res://scripts/ui/inspect_overlay.gd")
const Pointer = preload("res://tests/test_battle_pve.gd")
const A := "player1"
const B := "player2"
const EVENT_CHOICES := {
	"mapEventScrollChoice": {"eventKind": "twinSlayer", "candidateIds": ["s-2"]},
	"mapEventEquipmentChoice": {"eventKind": "weaponCollector", "candidateIds": ["armor"]},
	"mapEventTravelChoice": {"eventKind": "commerceOutpost", "targetTileIndex": 3, "price": 30},
	"mapEventHarmonyChoice": {"eventKind": "harmony", "amount": 1},
}

var check: Callable
var main: Node
var state: Dictionary
var hero: Dictionary
var event: EventOverlay
var inspect_ui: Inspect
var actions: Array[Dictionary] = []
var code := "MTHRC"


func _init(check_fn: Callable, scene: Node, fixture: Dictionary) -> void:
	check = check_fn
	main = scene
	state = fixture
	event = main.map_event_overlay
	inspect_ui = main.inspect_overlay
	hero = state.players[A]
	state.map.regions.append({"id": "summit", "name": "山巅", "startIndex": 64, "endIndex": 95,
		"entryIndex": 65, "gateIndex": 64, "bossEnemyId": "dragon", "requirements": []})
	state.map.tiles = []
	for index in 96:
		state.map.tiles.append({"id": index, "region": state.map.regions[floori(index / 32.0)].id,
			"type": "shop" if index == 3 else "event", "label": "商栈" if index == 3 else "山道%d" % index})
	hero.equipment = [{"instanceId": "armor", "kind": "bloodthirstyBattleplate"}]
	hero.blessings = [{"instanceId": "buff", "kind": "giantStrength"}]
	state.playerDerived[A].blessingCapacity = 2
	for kind: String in ["shortRangeTeleportCharm", "anywhereDoor", "gameMeat", "might", "retrace", "battlefieldMedicine"]:
		hero.scrolls.append({"instanceId": kind, "kind": kind})
		if "map" in Catalog.scroll_info(kind).timings:
			state.viewerPlayableScrollIds.map.append(kind)
	state.players[B].scrolls = [{"instanceId": "theirs", "kind": "guard"}]


func run() -> void:
	var capture := func(action: Dictionary) -> void: actions.append(action)
	main.router.dispatch_callable = capture
	main.roster.dispatch_callable = capture
	_test_events()
	await _test_resources()
	_test_phases()
	await _test_restore_input()
	main.get_node("/root/GameClient").room_closed.emit("已关闭")


func _broadcast(viewer := A) -> void:
	var view := state.duplicate(true)
	for id: String in view.turnOrder:
		if id != viewer:
			view.players[id].scrolls = view.players[id].scrolls.map(func(card: Dictionary) -> Dictionary:
				return {"instanceId": card.instanceId, "hidden": true})
	if viewer != view.activePlayerId or view.phase.kind not in ["awaitingRoll", "turnComplete"]:
		view.erase("viewerPlayableScrollIds")
	match view.phase.kind:
		"bossGateChoice": view.bossGateKeyPrice = 100
		"casino": view.casinoSpinPrice = 100
		"pvpPenalty": view.pvpPenaltyAmounts = {"hp": 2, "gold": 14}
	if view.phase.kind == "battle":
		view.viewerPlayableScrollIds = {"beforeAttackRoll": [], "beforeDefenseRoll": []}
	if view.phase.kind == "mapEventNotice" and viewer != view.phase.notice.playerId:
		for line: Dictionary in view.phase.notice.lines:
			if line.has("secret"):
				line.text = line.secret.publicText
				line.erase("secret")
	main.get_node("/root/GameClient").room_changed.emit(JSON.parse_string(JSON.stringify({
		"code": code, "status": "playing", "seat": viewer, "hostSeat": A, "capacity": 2, "state": view,
		"members": [{"seat": A, "name": hero.name, "connected": true}, {"seat": B, "name": state.players[B].name, "connected": true}],
	})))


func _press(button: Button, expected: Dictionary) -> void:
	check.call(button.is_visible_in_tree() and not button.disabled, "enabled: " + button.text)
	actions.clear()
	button.pressed.emit()
	check.call(actions == [expected], "single exact action %s, got %s" % [expected, actions])


func _locked(button: Button) -> void:
	actions.clear()
	check.call(button.is_visible_in_tree() and button.disabled, "disabled: " + button.text)
	button.pressed.emit()
	check.call(actions.is_empty(), "disabled action ignored")


func _event_choice(kind: String) -> Dictionary:
	return {"kind": kind, "choice": EVENT_CHOICES[kind].merged({"playerId": A, "effectIndex": 0})}


func _notice() -> Dictionary:
	return {"kind": "mapEventNotice", "notice": {"playerId": A, "kind": "hotSpring",
		"lines": [{"text": "第一条"}, {"text": "秘密牌名", "secret": {"owner": A, "publicText": "获得了卷轴"}}]}}


func _test_events() -> void:
	state.phase = _notice()
	state.phase.notice.revealAfterEventId = 1
	state.lastEvents = [{"id": 1, "type": "narration", "text": "前置"}, {"id": 2, "type": "narration", "text": "结果"}]
	_broadcast()
	check.call(not event.visible, "notice waits for its boundary")
	main._process(0.420)
	check.call(event.is_visible_in_tree() and event.kicker.text == "休整" and event.title.text == "山涧温泉", "notice opens during result playback")
	check.call(event.details.text.contains("恢复") and event.details.text.ends_with("第一条\n秘密牌名"), "catalog and ordered private narration")
	_locked(event.options.buttons.ack)
	check.call(event.options.buttons.ack.text == "事件结算中……", "notice labels playing state")
	event.skip.pressed.emit()
	state.lastEvents = []
	var ack: Button = event.options.buttons.ack
	var resumes := _phase_fixtures()
	resumes.resolveTile = {"kind": "resolveTile", "tileIndex": 1, "checkEncounter": true}
	var labels := {"casino": "走进赌场", "equipmentChoice": "处理装备", "mapEventScrollChoice": "选择卷轴",
		"mapEventEquipmentChoice": "决定是否交易", "mapEventTravelChoice": "决定是否启程",
		"mapEventHarmonyChoice": "选择调和方向", "resolveTile": "追踪精英"}
	check.call(ack.text == "继续前行", "default continuation")
	for kind: String in labels:
		state.phase.notice.resume = resumes[kind]
		_broadcast()
		check.call(event.options.buttons.ack == ack and ack.text == labels[kind], "same button, continuation " + kind)
	_press(ack, {"type": "acknowledgeMapEvent"})
	_broadcast(B)
	check.call(event.waiting.text == "等待青岚确认……" and event.options.buttons.is_empty()
		and event.details.text.ends_with("获得了卷轴") and not event.details.text.contains("秘密牌名"), "redacted event notice")

	for kind: String in EVENT_CHOICES:
		state.phase = _event_choice(kind)
		var id: int = main.playback.queue.watermark() + 1
		state.lastEvents = [{"id": id, "type": "narration", "text": "演出中"}]
		_broadcast()
		check.call(not event.visible, "choice waits for playback: " + kind)
		main._skip_playback()
		state.lastEvents = []
		check.call(event.is_visible_in_tree() and event.minimize.visible, "active event choice: " + kind)
		var nodes := event.options.get_children()
		_broadcast()
		check.call(event.options.get_children() == nodes, "event buttons reused: " + kind)
		match kind:
			"mapEventScrollChoice":
				check.call(nodes.size() == 1 and nodes[0].text.contains("灵活行动"), "only eligible scroll")
				_press(nodes[0], {"type": "chooseMapEventScroll", "instanceId": "s-2"})
			"mapEventEquipmentChoice":
				_press(nodes[0], {"type": "chooseMapEventEquipment", "instanceId": "armor"})
				_press(nodes[1], {"type": "chooseMapEventEquipment"})
			"mapEventTravelChoice":
				check.call(nodes[0].text == "支付 30 金币 · 前往商栈", "travel target and price")
				_press(nodes[0], {"type": "chooseMapEventTravel", "accept": true})
				_press(nodes[1], {"type": "chooseMapEventTravel", "accept": false})
				hero.gold = 29
				_broadcast()
				_locked(nodes[0])
				hero.gold = 70
			"mapEventHarmonyChoice":
				for i in 3:
					_press(nodes[i], {"type": "chooseMapEventHarmony", "option": ["attackToDefense", "defenseToAttack", "decline"][i]})
				hero.baseAttack = 0
				hero.baseDefense = 0
				_broadcast()
				_locked(nodes[0])
				_locked(nodes[1])
				hero.baseAttack = 4
				hero.baseDefense = 2
		_broadcast(B)
		check.call(event.waiting.is_visible_in_tree() and event.waiting.text.contains(hero.name)
			and event.options.buttons.is_empty(), "other seat only waits: " + kind)


func _open_hand(id: String) -> void:
	actions.clear()
	var button: Button = main.roster._buttons[id]
	check.call(button.is_visible_in_tree() and not button.disabled, "hand entry available: " + id)
	button.pressed.emit()
	check.call(inspect_ui.is_visible_in_tree() and actions.is_empty(), "inspect without dispatch: " + id)


func _test_resources() -> void:
	state.phase = {"kind": "awaitingRoll"}
	hero.position = 62
	state.playerDerived[A].movementSides = 9
	_broadcast()
	for entry: Array in [["s-2", 1, 9, 5, 35], ["shortRangeTeleportCharm", 1, 3, 3, 33], ["anywhereDoor", 32, 63, 44, 44]]:
		var id: String = entry[0]
		_open_hand(id)
		check.call(inspect_ui.parameter.min_value == entry[1] and inspect_ui.parameter.max_value == entry[2], "authoritative bounds: " + id)
		inspect_ui.parameter.value = entry[3]
		_broadcast()
		check.call(inspect_ui.parameter.value == entry[3] and inspect_ui.preview.text.ends_with("山道%d" % entry[4]), "parameter persists and wraps inside region")
		if id == "anywhereDoor":
			var input := inspect_ui.parameter.get_line_edit()
			await main.get_tree().process_frame
			input.grab_focus()
			input.edit()
			await main.get_tree().process_frame
			input.select_all()
			for digit: String in ["4", "5"]:
				var key := InputEventKey.new()
				key.pressed = true
				key.keycode = digit.unicode_at(0) as Key
				key.unicode = digit.unicode_at(0)
				input.get_viewport().push_input(key, true)
				key.pressed = false
				input.get_viewport().push_input(key, true)
			await main.get_tree().process_frame
			check.call(inspect_ui.preview.text.ends_with("山道45"), "typed target after editing: text=%s focus=%s value=%s preview=%s" % [input.text, input.has_focus(), inspect_ui.parameter.value, inspect_ui.preview.text])
			_broadcast()
			check.call(input.has_focus() and int(inspect_ui.parameter.value) == 45, "broadcast preserves edited target and focus")
		var expected := {"type": "useMapScroll", "instanceId": id}
		if id == "anywhereDoor":
			expected.targetPosition = 45
			inspect_ui.body_scroll.ensure_control_visible(inspect_ui.use_card)
			actions.clear()
			await _click(inspect_ui.use_card)
			check.call(actions == [expected], "pointer confirmation sends typed absolute target")
		else:
			expected.distance = entry[3]
			_press(inspect_ui.use_card, expected)
		check.call(not main.overlay_host.visible, "confirm closes configuration")
	_press(main.roster._buttons.gameMeat, {"type": "useMapScroll", "instanceId": "gameMeat"})
	main.roster._cards[A].pressed.emit()
	check.call(inspect_ui.blessings.text.contains("1/2") and inspect_ui.blessings.text.contains(Catalog.blessing_info("giantStrength").description), "blessing slots and description")
	inspect_ui.scrolls.buttons.gameMeat.pressed.emit()
	_press(inspect_ui.use_card, {"type": "useMapScroll", "instanceId": "gameMeat"})
	inspect_ui.equipment.buttons.armor.pressed.emit()
	var rule: String = Catalog.keyword_info("ignoreDefense").rule
	check.call(inspect_ui.kicker.text == "防具 · SR" and inspect_ui.details.text.contains(rule), "equipment rarity, category and full keyword rule")
	inspect_ui.back.pressed.emit()
	check.call(inspect_ui.title.text == hero.name and inspect_ui.scrolls.is_visible_in_tree(), "return to player's resources")
	inspect_ui.close_button.pressed.emit()
	main.roster._cards[B].pressed.emit()
	check.call(inspect_ui.scroll_heading.text.contains("1 张暗牌") and inspect_ui.scrolls.buttons.is_empty()
		and not inspect_ui.use_card.visible, "opponent hand is count-only")
	inspect_ui.close_button.pressed.emit()

	hero.hp = hero.maxHp
	_broadcast()
	_check_reason("gameMeat", "生命已满")
	_check_reason("might", "只能在战斗中使用")
	_check_reason("retrace", "还没有可折返的上一次停留位置")
	hero.previousStopPosition = hero.position
	_broadcast()
	_check_reason("retrace", "还没有可折返的上一次停留位置")
	hero.previousStopPosition = 50
	_broadcast()
	_press(main.roster._buttons.retrace, {"type": "useMapScroll", "instanceId": "retrace"})
	hero.hp -= 1
	state.phase = {"kind": "turnComplete"}
	_broadcast()
	_check_reason("s-2", "本回合已经移动")
	_check_reason("battlefieldMedicine", "不能再放弃移动")
	state.viewerPlayableScrollIds.map.erase("s-1")
	_broadcast()
	_check_reason("s-1", "当前无法使用")
	state.viewerPlayableScrollIds.map.append("s-1")
	state.activePlayerId = B
	_broadcast()
	_check_reason("s-1", "现在不是你的地图阶段")
	state.activePlayerId = A

	var id: int = main.playback.queue.watermark() + 1
	state.lastEvents = [{"id": id, "type": "narration", "text": "途中"},
		{"id": id + 1, "type": "scrollGranted", "instanceId": "s-1", "kind": "plunder", "playerId": A}]
	_broadcast()
	main.roster._cards[A].pressed.emit()
	check.call(not inspect_ui.scrolls.buttons.has("s-1"), "resource hand waits for reveal")
	inspect_ui.scrolls.buttons.gameMeat.pressed.emit()
	_locked(inspect_ui.use_card)
	main._skip_playback()
	check.call(inspect_ui.scrolls.buttons.has("s-1") and not inspect_ui.use_card.disabled, "open resource hand updates after playback")
	state.lastEvents = []
	state.phase = _phase_fixtures().scrollTargetChoice
	_broadcast()
	check.call(not inspect_ui.visible and main.router.choices.is_visible_in_tree(), "scroll target closes inspect and releases dock")
	main.roster._cards[A].pressed.emit()
	check.call(not inspect_ui.visible and main.roster._cards[A].disabled and main.roster._buttons["s-1"].disabled
		and main.board._boss_button.disabled, "target choice keeps picker accessible")


func _check_reason(id: String, reason: String) -> void:
	_open_hand(id)
	check.call(inspect_ui.details.text.contains(reason) and not inspect_ui.parameter.visible, "readable reason: " + reason)
	_locked(inspect_ui.use_card)
	inspect_ui.close_button.pressed.emit()


func _phase_fixtures() -> Dictionary:
	var offered := {"instanceId": "new-armor", "kind": "bloodthirstyBattleplate"}
	var blessing := {"instanceId": "new-blessing", "kind": "dragonScale"}
	var pair := {"tileIndex": 1, "aPlayerId": A, "bPlayerId": B}
	var pending := {"status": "pending"}
	var offer := {"gold": 2, "scrolls": [], "equipment": []}
	var phases := {
		"awaitingRoll": {}, "turnComplete": {},
		"encounterChoice": {"choice": {"challengerId": A, "opponentIds": [B], "tileIndex": 1}},
		"scrollTargetChoice": {"choice": {"playerId": A, "candidateIds": [B], "scrollKind": "plunder",
			"effectIndex": 0, "resume": "awaitingRoll"}},
		"scrollDiscardChoice": {"choice": {"sourcePlayerId": B, "targetPlayerId": A, "candidateIds": ["s-1"],
			"scrollName": "缴械", "resume": "awaitingRoll"}},
		"encounterDecision": {"encounter": pair.merged({"choiceA": pending, "choiceB": pending})},
		"tradeOffer": {"trade": pair.merged({"offerA": pending, "offerB": pending})},
		"tradeConfirmation": {"trade": pair.merged({"offerA": offer, "offerB": offer, "confirmationA": "pending", "confirmationB": "pending"})},
		"bossGateChoice": {"choice": {"playerId": A, "stageId": "foothill", "gateTileIndex": 0, "bossEnemyId": "banditChief", "source": "standing"}},
		"battle": {"battle": pair.merged({"kind": "pvp", "attacker": "a", "round": 1, "hpA": 16, "hpB": 15,
			"initiativeA": 6, "initiativeB": 3, "choiceA": pending, "choiceB": {"status": "submitted"},
			"scrollsUsedA": 0, "scrollsUsedB": 0, "log": []})},
		"blessingChoice": {"choice": {"source": "tile", "winnerId": A, "offered": blessing, "tileIndex": 1, "tileLabel": "祭坛"}},
		"pvpPenalty": {"penalty": {"winnerId": B, "loserId": A, "tileIndex": 1}},
		"equipmentChoice": {"choice": {"playerId": A, "offered": offered, "source": "reward", "resume": {"kind": "turnComplete"}}},
		"pveReward": {"notice": {"playerId": A, "enemyName": "山匪", "elite": false, "rewards": []}},
		"treasureReward": {"notice": {"playerId": A, "tileLabel": "宝箱", "empty": true, "rewards": []}},
		"blessingReward": {"notice": {"playerId": A, "tileLabel": "祭坛", "blessing": blessing}},
		"mapEventNotice": _notice(),
		"statGrowthChoice": {"choice": {"playerId": A, "stageId": "foothill"}},
		"shop": {"shop": {"playerId": A, "tileIndex": 3, "offers": []}},
		"casino": {"casino": {"playerId": A, "tileIndex": 4, "spins": 0}},
		"gameOver": {"winnerId": A},
	}
	for kind: String in EVENT_CHOICES:
		phases[kind] = _event_choice(kind)
	for kind: String in phases:
		phases[kind].kind = kind
	return phases


func _test_phases() -> void:
	var phases := _phase_fixtures()
	check.call(phases.size() == 25 and phases.size() == main.router.PHASE_GUIDANCE.size(), "all 25 distinct GamePhase fixtures")
	for kind: String in phases:
		state.phase = phases[kind]
		_broadcast()
		check.call(not main.router.guidance.text.contains("仅展示") and main.router.PHASE_GUIDANCE.has(kind), "explicit guidance: " + kind)
		if kind in ["awaitingRoll", "turnComplete", "encounterChoice", "encounterDecision", "scrollTargetChoice"]:
			var action_visible: bool = main.router.primary_action.is_visible_in_tree() or main.router.choices.is_visible_in_tree()
			check.call(action_visible and not main.overlay_host.visible and not main.router.restore.visible, "dock owns actions: " + kind)
			continue
		var modals: Array = main.overlay_host.get_children().filter(func(node: Control) -> bool: return node.is_visible_in_tree())
		check.call(modals.size() == 1, "one phase modal: " + kind)
		if modals.size() == 1:
			check.call(modals[0].minimize.visible == (kind not in ["tradeOffer", "battle", "gameOver"]), "minimize policy: " + kind)
	state.phase = phases.battle
	_broadcast()
	state.lastEvents = [{"id": main.playback.queue.watermark() + 1, "type": "battleEnded", "battleKind": "pvp", "winnerSide": "a", "outcome": "pvpDecided"}]
	state.phase = phases.mapEventNotice
	_broadcast()
	check.call(main.battle_panel.visible and not event.visible, "lingering battle keeps event hidden")
	main._skip_playback()
	check.call(event.is_visible_in_tree(), "event revealed after battle")
	state.lastEvents = []


func _click(button: Button) -> void:
	await main.get_tree().process_frame
	await main.get_tree().process_frame
	Pointer.click_button(button)


func _test_restore_input() -> void:
	state.phase = _notice()
	_broadcast()
	await _click(event.minimize)
	check.call(not main.overlay_host.visible and main.router.restore.is_visible_in_tree()
		and main.router.restore.text == "查看事件结果", "minimize releases board and shows restore")
	_broadcast()
	check.call(not event.visible, "unchanged broadcast preserves minimized decision")
	await _click(main.router.restore)
	check.call(event.is_visible_in_tree() and not main.router.restore.visible, "dock pointer restores decision")
	await _click(event.minimize)
	await _click(main.roster._cards[A])
	check.call(inspect_ui.is_visible_in_tree() and inspect_ui.restore.is_visible_in_tree() and not inspect_ui.minimize.visible, "released player card opens inspect")
	await _click(inspect_ui.restore)
	check.call(event.is_visible_in_tree() and not inspect_ui.visible and not main.router.restore.visible, "real click restores directly from detail")
	await _click(event.minimize)
	main.board.region_tabs.get_child(0).pressed.emit()
	await _click(main.board._boss_button)
	var rule: String = Catalog.keyword_info("ignoreDefense").rule
	check.call(inspect_ui.is_visible_in_tree() and inspect_ui.title.text == "山匪头目" and inspect_ui.kicker.text.contains("山脚"), "board boss opens displayed region")
	check.call(inspect_ui.details.text.contains("攻击骰 D6 · 防御骰 D6") and inspect_ui.details.text.contains("生命 28")
		and inspect_ui.details.text.contains("重斧") and inspect_ui.details.text.contains(rule)
		and inspect_ui.details.text.contains("山脚环数") and inspect_ui.details.text.contains("半血"), "boss stats, ability rules, requirements and defeat rules")
	await _click(inspect_ui.close_button)
	main.board.region_tabs.get_child(2).pressed.emit()
	await _click(main.board._boss_button)
	check.call(inspect_ui.title.text == "峰顶巨龙" and inspect_ui.details.text.contains("防御骰 D8")
		and inspect_ui.details.text.contains("胜利即赢得本局"), "selected summit tab uses its boss dice and victory condition")
	state.phase.notice.kind = "coinRain"
	_broadcast()
	check.call(event.is_visible_in_tree() and not inspect_ui.visible and not main.router.restore.visible, "new instance of same phase preempts inspection")
	event.minimize.pressed.emit()
	code = "MTHRD"
	_broadcast()
	check.call(event.visible and not main.router.restore.visible, "same decision in new room opens")
	event.minimize.pressed.emit()
	main._on_leave_room()
	_broadcast()
	check.call(event.visible and not main.router.restore.visible, "leave and rejoin clears minimized key")
	event.minimize.pressed.emit()
	main.get_node("/root/GameClient").room_closed.emit("已关闭")
	_broadcast()
	check.call(event.visible and not main.router.restore.visible, "closed room clears minimized key")

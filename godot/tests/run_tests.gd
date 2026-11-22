extends SceneTree

const Catalog = preload("res://scripts/data/content_catalog.gd")
const Client = preload("res://scripts/net/game_client.gd")
const Board = preload("res://scripts/ui/mountain_board.gd")
const Roster = preload("res://scripts/ui/roster_panel.gd")
const Router = preload("res://scripts/ui/phase_overlay_router.gd")
const AnimTests = preload("res://tests/test_anim_playback.gd")
const BattleTests = preload("res://tests/test_battle_pve.gd")
const PvpTests = preload("res://tests/test_battle_pvp.gd")
const M3aTests = preload("res://tests/test_m3a_phases.gd")
const M3bTests = preload("res://tests/test_m3b_phases.gd")
const M3cTests = preload("res://tests/test_m3c_phases.gd")
const EngineErrors = preload("res://tests/engine_errors.gd")

var _checks := 0
var _failures := 0
var _actions: Array[Dictionary] = []
var _errors := EngineErrors.new()


func _initialize() -> void:
	OS.add_logger(_errors)
	_run.call_deferred()


func _run() -> void:
	_test_catalog()
	_test_config()
	var initial_orphans := Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)
	var anim := AnimTests.new(_check)
	anim.test_queue()
	anim.test_visuals()
	anim.test_battle()
	anim.test_captions()
	var scene := load("res://scenes/main.tscn") as PackedScene
	_check(scene != null and scene.can_instantiate(), "main.tscn loads")
	if scene != null and scene.can_instantiate():
		var main := scene.instantiate()
		root.add_child(main)
		_test_scene(main)
		anim.test_scene(main, _game_state())
		await BattleTests.new(_check, main, _game_state()).run()
		PvpTests.new(_check, main, _game_state()).run()
		M3aTests.new(_check, main, _game_state()).run()
		M3bTests.new(_check, main, _game_state()).run()
		await M3cTests.new(_check, main, _game_state()).run()
		main.queue_free()
	await process_frame
	await process_frame
	_check(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT) == initial_orphans, "scene cleanup leaves no orphan nodes")
	var orphans := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	_check(orphans == 0, "absolute orphan node count after cleanup")
	OS.remove_logger(_errors)
	print("Godot M3c: %d checks, %d failed, %d runtime errors during tests, %d orphan nodes" % [_checks, _failures, _errors.count, orphans])
	quit(0 if _failures == 0 and _errors.count == 0 else 1)


func _check(ok: bool, description: String) -> void:
	_checks += 1
	if not ok:
		_failures += 1
		printerr("FAIL: ", description)


func _test_catalog() -> void:
	var data := Catalog.load_catalog(true)
	_check(data.get("schemaVersion") == 1, "catalog loads schema 1")
	var interference := 0
	for id in data.get("scrolls", {}):
		if Catalog.is_interference_scroll(id):
			interference += 1
	var bosses := 0
	for id in data.get("enemies", {}):
		if Catalog.enemy_info(id).get("tier") == "boss":
			bosses += 1
	_check(interference == 8 and bosses == 3, "8 interference scrolls and 3 bosses")
	_check(Catalog.keyword_info("ignoreDefense").get("label") == "无视防御", "public keyword")
	_check(Catalog.rule_term_info("maxHp").get("group") == "stat", "rule term")
	_check(Catalog.equipment_info("bloodthirstyBattleplate").get("category") == "armor", "equipment")
	_check(Catalog.blessing_info("giantStrength").get("enabled") == true, "blessing")
	_check(Catalog.map_event_info("hotSpring").get("category") == "recovery", "map event")
	_check(Catalog.affix_info("venomous").get("keywords") == ["ignoreDefense"], "elite affix")
	_check(Catalog.scroll_name("absent") == "absent" and Catalog.enemy_name("absent") == "absent", "unknown names")
	_check(Catalog.scroll_info("absent").is_empty() and not Catalog.is_interference_scroll("absent"), "unknown scroll")


func _test_config() -> void:
	var base := "user://dicebound_identity"
	_check(Client.resolve_identity_path([], "") == base + ".cfg", "default identity")
	_check(Client.resolve_identity_path([], "local") == base + "_local.cfg", "environment profile")
	_check(Client.resolve_identity_path(["--profile=p2"], "p1") == base + "_p2.cfg", "CLI profile precedence")
	_check(Client.resolve_identity_path(["--profile=../p:2*?"], "") == base + "_p2.cfg", "clean profile")
	_check(Client.resolve_identity_path([], "远征.二队") == base + "_远征.二队.cfg", "valid profile characters preserved")
	_check(Client.resolve_identity_path(["--profile=/..:"], "") == base + ".cfg", "empty sanitized profile")
	_check(Client.resolve_server_url("ws://local", [], "") == "ws://local", "default server")
	_check(Client.resolve_server_url("ws://local", [], " ws://env ") == "ws://env", "environment server")
	_check(Client.resolve_server_url("ws://local", ["--server=wss://cli"], "ws://env") == "wss://cli", "CLI server precedence")


func _game_state() -> Dictionary:
	var progress := {}
	for region: String in ["foothill", "mountainside", "summit"]:
		progress[region] = {"laps": 0, "eliteVictories": 0, "bossKeyPurchased": false,
			"openedTreasureTileIds": [], "bossDefeated": false}
	var hero_progress := progress.duplicate(true)
	hero_progress.foothill.laps = 1
	return {
		"players": {
			"player1": {"id": "player1", "name": "青岚", "hp": 16, "maxHp": 18, "gold": 70, "baseAttack": 4, "baseDefense": 2,
				"color": "#42cc88", "position": 0, "stageProgress": hero_progress, "statPurchases": 0,
				"equipment": [], "blessings": [],
				"scrolls": [{"instanceId": "s-1", "kind": "plunder"}, {"instanceId": "s-2", "kind": "remoteDice"}]},
			"player2": {"id": "player2", "name": "白石", "hp": 15, "maxHp": 18, "gold": 50, "baseAttack": 4, "baseDefense": 2,
				"color": "#cca144", "position": 1, "stageProgress": progress, "statPurchases": 0,
				"scrolls": [], "equipment": [], "blessings": []},
		},
		"activePlayerId": "player1", "turnOrder": ["player1", "player2"], "unavailablePlayerIds": [],
		"playerDerived": {
			"player1": {"attack": 4, "defense": 2, "blessingCapacity": 1, "movementSides": 6, "movementDiceCount": 1},
			"player2": {"attack": 4, "defense": 2, "blessingCapacity": 1, "movementSides": 6, "movementDiceCount": 1},
		},
		"turn": 3, "phase": {"kind": "awaitingRoll"}, "message": {"text": "准备登山"},
		"startingPlayerId": "player1", "rngSeed": 42, "nextInstanceId": 6, "nextEventId": 1, "history": [],
		"viewerPlayableScrollIds": {"map": ["s-1", "s-2"]}, "lastEvents": [],
		"map": {"seed": 42, "columns": 12, "regions": [
			{"id": "foothill", "name": "山脚", "startIndex": 0, "endIndex": 31, "entryIndex": 1, "gateIndex": 0,
				"bossEnemyId": "banditChief", "requirements": [{"type": "laps", "target": 2, "label": "山脚环数"}]},
			{"id": "mountainside", "name": "山腰", "startIndex": 32, "endIndex": 63, "entryIndex": 33, "gateIndex": 32,
				"bossEnemyId": "frostFang", "requirements": []},
		], "tiles": [
			{"id": 0, "region": "foothill", "type": "gate", "label": "关门"},
			{"id": 1, "region": "foothill", "type": "start", "label": "营地"},
			{"id": 32, "region": "mountainside", "type": "gate", "label": "山腰关门"},
		]},
	}


func _test_scene(main: Node) -> void:
	_check(main.lobby_panel.is_visible_in_tree(), "lobby initially visible")
	var client := root.get_node("GameClient")
	var room := {"code": "ABCDE", "status": "waiting", "seat": "player1", "hostSeat": "player1",
		"capacity": 2, "members": [{"seat": "player1", "name": "青岚", "connected": true},
		{"seat": "player2", "name": "白石", "connected": true}], "state": null}
	client.room_changed.emit(room)
	_check(main.room_panel.visible and not main.game_panel.visible and not main.lobby_panel.visible, "waiting view")
	_check(main.waiting_code.text == "ABCDE" and main.waiting_members.get_child_count() == 2, "waiting room members")
	_check(main.start_button.visible and not main.start_button.disabled, "host can start")
	room.status = "playing"
	room.state = _game_state()
	client.room_changed.emit(JSON.parse_string(JSON.stringify(room)))
	_check(main.game_panel.visible and not main.room_panel.visible and not main.lobby_panel.visible, "game view")
	_check(main.turn_label.text.contains("青岚") and main.router.message.text == "准备登山", "game header and message")
	_test_board(main.board, room.state.duplicate(true))
	_test_roster(main.roster, room.state.duplicate(true))
	_test_phases(main.router, room.state.duplicate(true))
	client.room_closed.emit("远征结束")
	_check(main.lobby_panel.visible and not main.game_panel.visible and main.notice.text == "远征结束", "return to lobby")


func _child_ids(parent: Node) -> Array[int]:
	var ids: Array[int] = []
	for node in parent.get_children():
		ids.append(node.get_instance_id())
	return ids


func _test_board(board: Board, state: Dictionary) -> void:
	board.set_game_state(state, "foothill")
	var ids := _child_ids(board)
	_check(ids.size() == 3, "two tiles and boss")
	var gate: Button = board.get_child(0)
	var camp: Button = board.get_child(1)
	var boss: Button = board.get_child(2)
	var original_badge := camp.get_node("player2").get_instance_id()
	_check(gate.has_node("player1") and gate.tooltip_text.contains("青岚"), "initial occupant")
	_check(boss.text.contains("山匪头目") and boss.text.contains("1/2"), "initial boss")
	state.players.player1.position = 1
	state.players.player1.stageProgress.foothill.bossDefeated = true
	state.playerDerived.player1.blessingCapacity = 2
	state.map.tiles[0].label = "空关门"
	state.map.tiles[0].type = "event"
	board.set_game_state(state.duplicate(true), "foothill")
	_check(ids == _child_ids(board), "all tile and boss IDs survive broadcast")
	_check(not gate.has_node("player1") and gate.tooltip_text == "0 · 空关门", "old tile loses badge and occupant tooltip")
	_check(camp.has_node("player1") and camp.tooltip_text.contains("青岚、白石"), "new tile gains badge and tooltip")
	_check(camp.get_node("player2").get_instance_id() == original_badge, "stationary badge reused")
	_check(gate.text.begins_with("闻") and gate.get_theme_stylebox("normal").border_width_left == 1, "tile style updates")
	_check(boss.text.contains("已击败"), "boss progress updates")
	state.map.tiles.reverse()
	board.set_game_state(state, "foothill")
	var reordered := _child_ids(board)
	_check(reordered.size() == 3 and reordered.all(func(id): return not ids.has(id)), "changed tile ID sequence rebuilds")
	board.region_tabs.get_child(1).pressed.emit()
	var next := _child_ids(board)
	_check(next.size() == 2 and next.all(func(id): return not reordered.has(id)), "region tab rebuilds board")
	_check(board.get_child(1).text.contains("霜牙巨兽"), "selected region boss")


func _capture(action: Dictionary) -> void:
	_actions.append(action)


func _press(button: Button, expected: Dictionary) -> void:
	_check(button.is_visible_in_tree() and not button.disabled, "button enabled for %s" % expected)
	_actions.clear()
	button.pressed.emit()
	_check(_actions == [expected], "exactly one dispatch %s, received %s" % [expected, _actions])


func _test_roster(roster: Roster, state: Dictionary) -> void:
	roster.dispatch_callable = _capture
	roster.set_game_state(state, "player1")
	var cards := _child_ids(roster.players_list)
	var hand := _child_ids(roster.hand_list)
	var card: Roster.PlayerCard = roster.players_list.get_child(0)
	var playable: Button = roster.hand_list.get_child(0)
	var movement: Button = roster.hand_list.get_child(1)
	_check(card.hp_bar.value == 16 and card.stats.text.contains("金币 70"), "initial HP and gold")
	_check(playable.text == Catalog.scroll_name("plunder") and movement.text == Catalog.scroll_name("remoteDice"), "catalog hand labels")
	_check(not movement.disabled and movement.tooltip_text == "选择使用参数", "movement card opens configuration")
	state.players.player1.hp = 7
	state.players.player1.gold = 31
	state.unavailablePlayerIds = ["player2"]
	roster.set_game_state(state.duplicate(true), "player1")
	_check(cards == _child_ids(roster.players_list) and hand == _child_ids(roster.hand_list), "card and hand IDs survive broadcast")
	_check(card.hp_bar.value == 7 and card.stats.text.contains("HP 7/18") and card.stats.text.contains("金币 31"), "HP and gold update")
	_check(roster.players_list.get_child(1).status_label.text == "掉线", "offline badge updates")
	_press(playable, {"type": "useMapScroll", "instanceId": "s-1"})
	state.phase = {"kind": "turnComplete"}
	roster.set_game_state(state, "player1")
	_press(playable, {"type": "useMapScroll", "instanceId": "s-1"})
	_check(not movement.disabled and movement.tooltip_text.contains("已经移动"), "spent movement card remains readable")
	state.activePlayerId = "player2"
	state.erase("viewerPlayableScrollIds")
	roster.set_game_state(state, "player1")
	_check(not playable.disabled and playable.tooltip_text == "现在不是你的地图阶段" and card.status_label.text == "待机", "inactive viewer may inspect")
	state.activePlayerId = "player1"
	state.phase = {"kind": "encounterChoice"}
	roster.set_game_state(state, "player1")
	_check(not playable.disabled and playable.tooltip_text == "现在不是你的地图阶段", "out-of-phase interference card is inspectable")
	state.players.player1.scrolls = [{"instanceId": "s-2", "hidden": true}, {"instanceId": "s-3", "kind": "plunder"}]
	state.turnOrder.reverse()
	roster.set_game_state(state, "player1")
	_check(_child_ids(roster.players_list) == [cards[1], cards[0]], "reordered players keep cards")
	var updated_hand := _child_ids(roster.hand_list)
	_check(updated_hand[0] == hand[1] and not hand.has(updated_hand[1]), "only changed scroll replaced")
	_check(movement.text == "未知卷轴" and movement.disabled, "hidden scroll redacted")


func _test_phases(router: Router, state: Dictionary) -> void:
	router.dispatch_callable = _capture
	router.set_game_state(state, "player1")
	_press(router.primary_action, {"type": "rollMovement"})
	state.phase = {"kind": "turnComplete"}
	router.set_game_state(state, "player1")
	_press(router.primary_action, {"type": "endTurn"})
	router.set_game_state(state, "player2")
	_check(router.primary_action.disabled, "only active seat can end turn")

	state.phase = {"kind": "encounterDecision", "encounter": {"aPlayerId": "player1", "bPlayerId": "player2",
		"tileIndex": 1, "choiceA": {"status": "pending"}, "choiceB": {"status": "pending"}}}
	router.set_game_state(state, "player1")
	var intents := _child_ids(router.choices)
	router.choices.get_child(0).grab_focus()
	state.phase.encounter.choiceB = {"status": "submitted"}
	router.set_game_state(state.duplicate(true), "player1")
	_check(intents.size() == 3 and _child_ids(router.choices) == intents, "encounter decision IDs survive opponent submission")
	_check(router.choices.get_child(0).has_focus(), "duplicate broadcast preserves choice focus")
	for index in 3:
		_press(router.choices.get_child(index), {"type": "chooseEncounterIntent", "side": "a", "intent": ["trade", "greet", "battle"][index]})
	state.phase.encounter.choiceA = {"status": "chosen", "intent": "greet"}
	router.set_game_state(state, "player1")
	_check(router.choices.get_child_count() == 0 and not router.choices.visible, "submitted viewer waits")
	state.phase.encounter.choiceB = {"status": "pending"}
	router.set_game_state(state, "player2")
	for index in 3:
		_press(router.choices.get_child(index), {"type": "chooseEncounterIntent", "side": "b", "intent": ["trade", "greet", "battle"][index]})
	intents = _child_ids(router.choices)

	state.phase = {"kind": "scrollTargetChoice", "choice": {"playerId": "player1", "candidateIds": ["player2"],
		"scrollKind": "plunder", "effectIndex": 0, "resume": "awaitingRoll"}}
	router.set_game_state(state, "player1")
	var targets := _child_ids(router.choices)
	_check(targets.size() == 1 and not intents.has(targets[0]), "target choice replaces encounter choices")
	state.players.player2.name = "新名字"
	router.set_game_state(state.duplicate(true), "player1")
	_check(_child_ids(router.choices) == targets and router.choices.get_child(0).text == "选择 新名字", "target IDs stable, label updated")
	_press(router.choices.get_child(0), {"type": "chooseScrollTarget", "targetId": "player2"})
	state.phase.choice.scrollKind = "disarm"
	router.set_game_state(state, "player1")
	_check(_child_ids(router.choices) != targets, "new scroll starts distinct target choice")
	router.set_game_state(state, "player2")
	_check(not router.choices.visible, "other seat cannot pick target")

	state.phase = {"kind": "encounterChoice", "choice": {"challengerId": "player1", "opponentIds": ["player2"], "tileIndex": 1}}
	router.set_game_state(state, "player1")
	_press(router.choices.get_child(0), {"type": "chooseEncounterOpponent", "opponentId": "player2"})
	state.phase = {"kind": "battle"}
	router.set_game_state(state, "player1")
	_check(router.guidance.text.contains("战斗") and not router.primary_action.visible and not router.choices.visible, "unsupported phase guidance")

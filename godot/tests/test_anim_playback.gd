extends RefCounted

const Queue = preload("res://scripts/anim/event_queue.gd")
const Visual = preload("res://scripts/anim/visual_state.gd")
const Playback = preload("res://scripts/anim/playback_controller.gd")

var _check: Callable


func _init(check: Callable) -> void:
	_check = check


func test_queue() -> void:
	var q := Queue.new()
	_check.call(not q.is_playing() and q.current_event().is_empty() and q.queue_length() == 0, "idle queue")
	_check.call(q.remaining_ms() == null and q.progress() == 1.0, "idle timing")
	_check.call(not q.enqueue([]) and not q.advance(200) and not q.drain(), "idle operations are no-ops")
	var first := {"id": 1, "type": "narration"}
	var second := {"id": 2, "type": "playerMoved"}
	var third := {"id": 3, "type": "movementRolled"}
	_check.call(q.enqueue([first, second]) and q.current_event() == first and q.is_playing(), "synchronous promotion")
	_check.call(q.pending_events() == [second] and q.queue_length() == 2, "pending excludes current")
	_check.call(not q.enqueue([first, second]) and not q.enqueue([]), "duplicate and empty broadcasts are no-ops")
	_check.call(not q.advance(-100) and q.progress() == 0.0, "negative delta clamps to zero")
	q.advance(105.5)
	_check.call(q.remaining_ms() == 314.5 and is_equal_approx(q.progress(), 105.5 / 420), "partial fractional progress")
	_check.call(q.enqueue([second, third]) and q.pending_events() == [second, third], "watermark accepts only fresh IDs")
	_check.call(q.remaining_ms() == 314.5 and q.watermark() == 3, "append preserves in-flight countdown")
	q.advance(q.remaining_ms())
	_check.call(q.current_event() == second and q.remaining_ms() == 520, "exact remaining after a partial frame promotes")
	q.advance(520 + 700 + 5000)
	_check.call(not q.is_playing() and q.seen_events() == [first, second, third], "long frame completes queue and retains seen")

	q.enqueue([first, second])
	q.enqueue([third])
	q.advance(420 + 520 + 0.5)
	_check.call(q.current_event() == third and q.remaining_ms() == 699.5, "carry fractional time over two events")
	_check.call(q.drain() and not q.drain() and q.queue_length() == 0, "skip discards current and pending")
	_check.call(q.seen_events() == [first, second, third] and q.watermark() == 3, "skip keeps history and watermark")
	_check.call(not q.enqueue([first, second, third]) and not q.is_playing(), "skipped events cannot replay")

	var durations := {
		420: ["narration"], 900: ["gameStarted"], 320: ["turnStarted"],
		700: ["movementRolled", "battleStarted", "battleEnded"], 520: ["playerMoved"],
		620: ["playerRetreated", "scrollTransferred", "equipmentGranted", "equipmentTransferred", "blessingGranted", "blessingTransferred"],
		480: ["playerHpChanged"], 380: ["maxHpChanged", "baseStatChanged", "goldChanged"],
		560: ["scrollGranted", "battleDamage", "battleHealed"], 440: ["scrollConsumed"], 760: ["initiativeRolled"],
		640: ["attackRolled", "defenseRolled"], 300: ["battleRoundAdvanced"], 600: ["gameOver"],
	}
	_check.call(Queue.DEFAULT_DURATIONS.size() == 26, "all 26 default durations")
	for duration: int in durations:
		for type: String in durations[duration]:
			q.enqueue([{"id": q.watermark() + 1, "type": type}])
			_check.call(q.remaining_ms() == duration, "duration of " + type)
			q.advance(duration)
	q.reset()
	q.enqueue([second], 2.0)
	_check.call(q.remaining_ms() == 260, "double speed halves duration")
	q.enqueue([third], 3.0)
	q.advance(260)
	_check.call(q.remaining_ms() == 233, "each batch keeps its rounded duration")
	for speed: float in [0.0, -2.0]:
		q.reset()
		q.enqueue([first, second], speed)
		_check.call(q.remaining_ms() == 0 and q.progress() == 1.0, "instant event for speed %s" % speed)
		_check.call(q.advance(0.0) and not q.is_playing(), "zero delta consumes all instant events")
	q.enqueue([{"id": 3, "type": "futureEvent"}, {"id": 4, "type": "narration"}])
	q.advance(0.0)
	_check.call(q.current_event().id == 4 and q.remaining_ms() == 420, "unknown type consumes no time")

	var many: Array[Dictionary] = []
	for id in range(10, 270):
		many.append({"id": id, "type": "narration"})
	q.enqueue(many)
	_check.call(q.seen_events().size() == 200 and q.seen_events()[0].id == 70 and q.seen_events()[-1].id == 269, "seen rolls across batches")
	q.advance(17)
	q.enqueue(many.slice(0, 250))
	_check.call(q.queue_length() == 250 and q.current_event().id == 10 and q.remaining_ms() == 420, "restart replaces in-flight queue")
	_check.call(q.seen_events() == many.slice(50, 250) and q.watermark() == 259, "restart caps new history independently")
	q.enqueue([first, second])
	_check.call(q.seen_events() == [first, second] and q.watermark() == 2, "small restart drops previous history")
	q.reset()
	_check.call(not q.is_playing() and q.pending_events().is_empty() and q.seen_events().is_empty() and q.watermark() == 0, "reset clears all playback state")
	_check.call(q.enqueue([first]) and q.current_event() == first, "reset permits old IDs again")


func test_visuals() -> void:
	var p := {"id": "p", "hp": 9, "maxHp": 22, "baseAttack": 5, "baseDefense": 4, "gold": 110, "position": 3}
	var hit := {"type": "playerHpChanged", "playerId": "p", "from": 18, "to": 13}
	var next_hit := hit.merged({"from": 13, "to": 9}, true)
	var other := hit.merged({"playerId": "q", "from": 99}, true)
	_check.call(Visual.visual_hp(p, [hit]) == 18 and Visual.visual_hp(p, [other]) == 9, "hold HP only for matching player")
	_check.call(Visual.visual_hp(p, [other, hit, next_hit]) == 18 and Visual.visual_hp(p, [next_hit]) == 13 and Visual.visual_hp(p, []) == 9, "chained hits release in order")
	_check.call(Visual.visual_max_hp(p, [{"type": "maxHpChanged", "playerId": "p", "from": 18}]) == 18 and Visual.visual_max_hp(p, []) == 22, "maximum HP")
	var attack := {"type": "baseStatChanged", "playerId": "p", "stat": "attack", "from": 4}
	var defense := attack.merged({"stat": "defense", "from": 2}, true)
	_check.call(Visual.visual_base_stat(p, "attack", [defense, attack]) == 4 and Visual.visual_base_stat(p, "defense", [attack, defense]) == 2, "attack and defense held separately")
	_check.call(Visual.visual_base_stat(p, "attack", [defense]) == 5 and Visual.visual_base_stat(p, "defense", [attack]) == 4, "independent stat release")
	_check.call(Visual.visual_gold(p, [{"type": "goldChanged", "playerId": "p", "from": 50}]) == 50 and Visual.visual_gold(p, []) == 110, "gold balance")
	var moved := {"type": "playerMoved", "playerId": "p", "from": 0, "to": 7}
	var retreat := {"type": "playerRetreated", "playerId": "p", "from": 7, "to": 3}
	_check.call(Visual.visual_position(p, [moved, retreat]) == 0 and Visual.visual_position(p, [retreat]) == 7 and Visual.visual_position(p, []) == 3, "advance then retreat")
	for type: String in ["scrollGranted", "equipmentGranted", "blessingGranted", "scrollTransferred", "equipmentTransferred", "blessingTransferred"]:
		var grant := {"type": type, "instanceId": "new"}
		_check.call(not Visual.is_revealed("new", [grant]) and Visual.is_revealed("other", [grant]), "reveal by instance for " + type)
	_check.call(Visual.is_revealed("new", []) and Visual.is_revealed("new", [{"type": "scrollConsumed", "instanceId": "new"}]), "only gains and transfers hold cards")

	var battle := {"hpA": 8, "hpB": 3}
	var hit_b := {"type": "battleDamage", "targetSide": "b", "hpBefore": 3, "hpAfter": 0}
	var heal_a := {"type": "battleHealed", "targetSide": "a", "hpBefore": 8, "hpAfter": 12}
	var hit_a := {"type": "battleDamage", "targetSide": "a", "hpBefore": 12, "hpAfter": 11}
	var patched := Visual.battle_with_damage(battle, [heal_a, hit_b, hit_a])
	_check.call(patched == {"hpA": 11, "hpB": 0} and battle == {"hpA": 8, "hpB": 3}, "latest HP per side patches only the snapshot copy")
	_check.call(is_same(battle, Visual.battle_with_damage(battle, [moved])), "irrelevant events preserve snapshot identity")
	_check.call(Visual.visual_battle_hp(patched, "a", [hit_b, heal_a, hit_a]) == 8 and Visual.visual_battle_hp(patched, "a", [hit_a]) == 12, "hold side A healing and damage")
	_check.call(Visual.visual_battle_hp(patched, "b", [heal_a, hit_b]) == 3 and Visual.visual_battle_hp(patched, "b", []) == 0, "side B killing blow")
	_check.call(Visual.active_damage(hit_b) == hit_b and Visual.active_damage(heal_a).is_empty() and Visual.active_damage({}).is_empty(), "active damage")
	_check.call(Visual.active_healing(heal_a) == heal_a and Visual.active_healing(hit_b).is_empty() and Visual.active_healing({}).is_empty(), "active healing")
	_check.call(Visual.presentation_ready({"id": 3}, [{"id": 4}], null), "legacy phases reveal immediately")
	_check.call(not Visual.presentation_ready({}, [{"id": 4}], 4), "pending boundary blocks")
	_check.call(not Visual.presentation_ready({"id": 3}, [], 4) and not Visual.presentation_ready({"id": 4}, [], 4), "current at or below boundary blocks")
	_check.call(Visual.presentation_ready({"id": 5}, [{"id": 6}], 4) and Visual.presentation_ready({}, [], 4), "later events and idle queue allow presentation")


func test_battle() -> void:
	var playback := Playback.new()
	var q := playback.queue
	var battle := {"round": 2, "attacker": "b", "hpA": 15, "hpB": 3}
	var start := {"id": 1, "type": "battleStarted"}
	var first := {"id": 2, "type": "attackRolled", "side": "a", "dice": [4], "total": 7}
	var second := first.merged({"id": 3, "dice": [6], "total": 9}, true)
	var defense := {"id": 4, "type": "defenseRolled", "side": "b", "dice": [1], "total": 3}
	var handover := {"id": 5, "type": "battleRoundAdvanced", "fromRound": 1, "fromAttacker": "a"}
	var state := {"phase": {"kind": "battle", "battle": battle}, "lastEvents": [start, first, second, defense, handover]}
	playback.sync_state(state)
	_check.call(playback.lingering_battle == battle, "live battle snapshot")
	var timeline := Visual.battle_timeline(q.seen_events())
	_check.call(Visual.visual_roll("attack", timeline, q.pending_events()).is_empty(), "both hits still pending")
	q.advance(q.remaining_ms())
	_check.call(Visual.visual_roll("attack", timeline, q.pending_events()) == first, "first hit shows during first roll")
	_check.call(Visual.visual_attacker(battle, q.pending_events()) == "a" and Visual.visual_battle_round(battle, q.pending_events()) == 1, "shown attacker and round hold during rolls")
	state.lastEvents = []
	playback.sync_state(state)
	_check.call(Visual.visual_roll("attack", Visual.battle_timeline(q.seen_events()), q.pending_events()) == first, "opponent's empty broadcast retains current roll")
	q.advance(q.remaining_ms())
	_check.call(Visual.visual_roll("attack", timeline, q.pending_events()) == second, "second hit replaces first")
	q.advance(q.remaining_ms())
	_check.call(Visual.visual_roll("defense", timeline, q.pending_events()) == defense, "defense displayed independently")
	q.advance(q.remaining_ms())
	_check.call(Visual.visual_attacker(battle, q.pending_events()) == "b" and Visual.visual_battle_round(battle, q.pending_events()) == 2, "handover releases both values as it starts")
	_check.call(Visual.visual_roll("attack", timeline, q.pending_events()).is_empty(), "played handover clears attack")
	playback.reset()
	state.lastEvents = [start, first, second, defense, handover]
	playback.sync_state(state)
	playback.drain()
	_check.call(Visual.visual_roll("attack", timeline, q.pending_events()).is_empty() and Visual.visual_roll("defense", timeline, q.pending_events()).is_empty(), "skipping a normal round clears both rolls")

	var final_roll := first.merged({"id": 6}, true)
	var final_defense := defense.merged({"id": 7}, true)
	var damage := {"id": 8, "type": "battleDamage", "targetSide": "b", "hpBefore": 3, "hpAfter": 0}
	var ended := {"id": 9, "type": "battleEnded"}
	var after := {"id": 10, "type": "scrollGranted"}
	state.phase = {"kind": "turnComplete"}
	state.lastEvents = [final_roll, final_defense, damage, ended, after]
	playback.sync_state(state)
	_check.call(Visual.is_battle_ending(q.current_event(), q.pending_events()) and playback.lingering_battle.hpB == 0, "pending ending retains patched battle")
	_check.call(Visual.visual_battle_hp(playback.lingering_battle, "b", q.pending_events()) == 3, "fatal damage held before playback")
	state.lastEvents = []
	playback.sync_state(state)
	q.advance(640 + 640)
	_check.call(Visual.visual_battle_hp(playback.lingering_battle, "b", q.pending_events()) == 0, "final HP survives empty broadcast")
	q.advance(q.remaining_ms())
	_check.call(q.current_event() == ended and Visual.is_battle_ending(ended, q.pending_events()) and not playback.lingering_battle.is_empty(), "battle lingers throughout battleEnded")
	q.advance(q.remaining_ms())
	_check.call(q.current_event() == after and not Visual.is_battle_ending(after, []) and playback.lingering_battle.is_empty(), "battle leaves before subsequent reward completes")

	playback.reset()
	q.enqueue([start, final_roll, final_defense, damage, ended])
	playback.drain()
	timeline = Visual.battle_timeline(q.seen_events())
	_check.call(Visual.visual_roll("attack", timeline, q.pending_events()) == final_roll and Visual.visual_roll("defense", timeline, q.pending_events()) == final_defense, "skipping a killing blow preserves both rolls")
	q.enqueue([{"id": 11, "type": "battleStarted"}])
	timeline = Visual.battle_timeline(q.seen_events())
	_check.call(timeline == [q.current_event()] and Visual.visual_roll("attack", timeline, []).is_empty(), "new battle cuts previous rolls from the timeline")
	_check.call(Visual.battle_timeline([final_roll, ended]) == [final_roll, ended], "retain entire window when start is outside seen")


func test_captions() -> void:
	var playback := Playback.new()
	var state := {"message": {"text": "final"}, "lastEvents": [
		{"id": 1, "type": "turnStarted"}, {"id": 2, "type": "narration", "text": "first"},
		{"id": 3, "type": "narration", "text": "second"}, {"id": 4, "type": "movementRolled"},
	]}
	playback.sync_state(state)
	_check.call(playback.dock_message(state) == "final", "message before first caption")
	_check.call(not playback.advance(20), "partial frame needs no render")
	_check.call(playback.advance(300) and playback.dock_message(state) == "first", "narration becomes caption at promotion")
	playback.advance(840)
	_check.call(playback.queue.current_event().id == 4 and playback.dock_message(state) == "second", "long frame retains last crossed narration")
	playback.advance(700)
	_check.call(not playback.is_playing() and playback.dock_message(state) == "final", "natural completion restores authoritative message")
	playback.reset()
	state.lastEvents = [{"id": 1, "type": "turnStarted"}]
	playback.sync_state(state)
	_check.call(playback.dock_message(state) == "final", "reset clears old caption")


func _broadcast(client: Node, room: Dictionary) -> void:
	# WebSocket JSON decodes numbers as floats and creates a new object for every broadcast.
	client.room_changed.emit(JSON.parse_string(JSON.stringify(room)))


func test_scene(main: Node, state: Dictionary) -> void:
	var client := main.get_node("/root/GameClient")
	var room := {"code": "ANIM1", "seat": "player1", "hostSeat": "player1", "status": "playing", "state": state}
	_broadcast(client, room)
	var gate: Button = main.board.get_child(0)
	var camp: Button = main.board.get_child(1)
	var boss_id: int = main.board.get_child(2).get_instance_id()
	var gate_id := gate.get_instance_id()
	var camp_id := camp.get_instance_id()
	var card = main.roster.players_list.get_child(0)
	var card_id: int = card.get_instance_id()
	var playable: Button = main.roster.hand_list.get_child(0)
	var primary: Button = main.router.primary_action
	var skip: Button = main.router.skip_playback
	var hero: Dictionary = state.players.player1
	hero.position = 1
	hero.hp = 9
	hero.gold = 110
	hero.scrolls.append({"kind": "plunder", "instanceId": "reward"})
	state.phase = {"kind": "turnComplete"}
	state.message.text = "行动完成"
	var events := [
		{"id": 1, "type": "narration", "text": "旅者出发"},
		{"id": 2, "type": "movementRolled", "playerId": "player1", "value": 1},
		{"id": 3, "type": "playerMoved", "playerId": "player1", "from": 0, "to": 1},
		{"id": 4, "type": "playerHpChanged", "playerId": "player1", "from": 16, "to": 9},
		{"id": 5, "type": "goldChanged", "playerId": "player1", "from": 70, "to": 110},
		{"id": 6, "type": "scrollGranted", "playerId": "player1", "instanceId": "reward", "kind": "plunder"},
	]
	state.lastEvents = events
	_broadcast(client, room)
	_check.call(gate.has_node("player1") and gate.tooltip_text.contains("青岚") and not camp.has_node("player1"), "broadcast holds badge and tooltip before first frame")
	_check.call(card.hp_bar.value == 16 and card.stats.text.contains("金币 70"), "broadcast holds both stats before first frame")
	_check.call(main.roster.hand_list.get_child_count() == 2 and playable.disabled, "granted card absent and old hand locked")
	_check.call(primary.disabled and skip.is_visible_in_tree() and skip.text == "跳过演出", "skip available while primary locked")
	_check.call(main.router.message.text == "旅者出发" and not main.router.presentation_ready(2), "first narration and phase gate sync immediately")
	main._process(0.100)
	_broadcast(client, room)
	_check.call(main.playback.queue.remaining_ms() == 320 and main.playback.queue.queue_length() == 6, "duplicate room broadcast preserves queue and elapsed time")
	state.lastEvents = []
	_broadcast(client, room)
	main._process(0.320)
	_check.call(main.playback.queue.current_event().type == "movementRolled" and gate.has_node("player1"), "rolling still holds starting tile")
	_check.call(not main.router.presentation_ready(2) and main.router.message.text == "旅者出发", "current boundary holds and caption persists")
	main._process(0.700)
	_check.call(not gate.has_node("player1") and not gate.tooltip_text.contains("青岚") and camp.has_node("player1") and camp.tooltip_text.contains("青岚"), "move releases badge and tooltip together")
	_check.call(main.router.presentation_ready(2) and card.hp_bar.value == 16, "later HP waits after movement gate opens")
	main._process(0.520)
	_check.call(card.hp_bar.value == 9 and card.stats.text.contains("金币 70"), "HP releases before gold")
	skip.pressed.emit()
	_check.call(card.stats.text.contains("金币 110") and main.roster.hand_list.get_child_count() == 3, "skip releases remaining balance and grant")
	_check.call(main.router.message.text == "行动完成" and not primary.disabled and not skip.visible and not playable.disabled, "skip restores final message and input synchronously")
	_check.call(not main.playback.is_playing() and main.playback.queue.watermark() == 6, "skip bypasses all remaining events")
	state.lastEvents = events
	_broadcast(client, room)
	_check.call(not skip.visible and not main.playback.is_playing(), "repeated skipped broadcast stays idle")
	_check.call(main.board.get_child(0).get_instance_id() == gate_id and main.board.get_child(1).get_instance_id() == camp_id and main.board.get_child(2).get_instance_id() == boss_id, "tile and boss IDs survive entire playback")
	_check.call(main.roster.players_list.get_child(0).get_instance_id() == card_id and main.roster.hand_list.get_child(0) == playable and main.router.primary_action == primary and main.router.skip_playback == skip, "roster, hand and dock controls stay mounted")

	state.phase = {"kind": "awaitingRoll"}
	hero.maxHp = 24
	hero.baseAttack = 7
	hero.baseDefense = 6
	hero.position = 0
	hero.scrolls = [{"kind": "plunder", "instanceId": "transferred"}]
	state.lastEvents = [
		{"id": 7, "type": "movementRolled"}, {"id": 8, "type": "playerRetreated", "playerId": "player1", "from": 1},
		{"id": 9, "type": "maxHpChanged", "playerId": "player1", "from": 18},
		{"id": 10, "type": "baseStatChanged", "playerId": "player1", "stat": "attack", "from": 4},
		{"id": 11, "type": "baseStatChanged", "playerId": "player1", "stat": "defense", "from": 2},
		{"id": 12, "type": "scrollTransferred", "instanceId": "transferred"},
	]
	_broadcast(client, room)
	_check.call(primary.disabled and camp.has_node("player1") and card.hp_bar.max_value == 18 and card.stats.text.contains("攻 4 · 防 2"), "roll action, retreat and permanent stats hold")
	_check.call(main.roster.hand_list.get_child(0) is Label, "only unrevealed transfer displays empty hand")
	main._process(2.460)
	_check.call(main.playback.queue.current_event().type == "scrollTransferred" and main.roster.hand_list.get_child(0) is Button and main.roster.hand_list.get_child(0).disabled, "card appears at transfer start but stays locked")
	main._process(0.620)
	_check.call(not skip.visible and not primary.disabled and not main.roster.hand_list.get_child(0).disabled, "natural completion enables map actions")
	_check.call(gate.has_node("player1") and card.hp_bar.max_value == 24 and card.stats.text.contains("攻 7 · 防 6"), "retreat and permanent stats reach final values")

	var held_card: Button = main.roster.hand_list.get_child(0)
	hero.position = 1
	hero.hp = 5
	hero.gold = 10
	state.lastEvents = [
		{"id": 13, "type": "narration", "text": "再次出发"},
		{"id": 14, "type": "playerMoved", "playerId": "player1", "from": 0},
		{"id": 15, "type": "playerHpChanged", "playerId": "player1", "from": 9},
		{"id": 16, "type": "goldChanged", "playerId": "player1", "from": 110},
		{"id": 17, "type": "scrollTransferred", "instanceId": "transferred"},
	]
	_broadcast(client, room)
	_check.call(not held_card.is_visible_in_tree() and gate.has_node("player1") and card.hp_bar.value == 9 and card.stats.text.contains("金币 110"), "all visuals held before immediate skip")
	skip.pressed.emit()
	_check.call(held_card.is_visible_in_tree() and not held_card.disabled and camp.has_node("player1") and card.hp_bar.value == 5 and card.stats.text.contains("金币 10"), "one click releases every visual and reuses existing hand button")

	_test_choice_gates(main, client, room)
	_test_room_resets(main, client, room)


func _test_choice_gates(main: Node, client: Node, room: Dictionary) -> void:
	var phases := [
		{"kind": "scrollTargetChoice", "choice": {"playerId": "player1", "candidateIds": ["player2"]}},
		{"kind": "encounterChoice", "choice": {"challengerId": "player1", "opponentIds": ["player2"]}},
		{"kind": "encounterDecision", "encounter": {"aPlayerId": "player1", "bPlayerId": "player2", "choiceA": {"status": "pending"}}},
	]
	for phase: Dictionary in phases:
		room.state.phase = phase
		room.state.lastEvents = []
		_broadcast(client, room)
		var choices: HBoxContainer = main.router.choices
		var id := choices.get_child(0).get_instance_id()
		room.state.lastEvents = [{"id": main.playback.queue.watermark() + 1, "type": "narration", "text": "等待"}]
		_broadcast(client, room)
		_check.call(not choices.is_visible_in_tree() and not choices.get_child(0).is_visible_in_tree(), "hide pending choices for " + phase.kind)
		_broadcast(client, room)
		main._process(0.420)
		_check.call(choices.is_visible_in_tree() and choices.get_child(0).get_instance_id() == id, "reuse choices after gate opens for " + phase.kind)


func _test_room_resets(main: Node, client: Node, room: Dictionary) -> void:
	var state: Dictionary = room.state
	var battle := {"kind": "battle", "battle": {"round": 1, "attacker": "a", "hpA": 7, "hpB": 1}}
	state.phase = battle
	state.lastEvents = [{"id": 50, "type": "narration", "text": "旧房间"}]
	_broadcast(client, room)
	room.code = "ANIM2"
	state.phase = {"kind": "awaitingRoll"}
	state.lastEvents = [{"id": 1, "type": "battleEnded"}]
	_broadcast(client, room)
	_check.call(main.playback.queue.seen_events().size() == 1 and main.playback.queue.watermark() == 1 and main.playback.queue.current_event().id == 1, "room switch starts a clean timeline")
	_check.call(main.playback.lingering_battle.is_empty() and main.router.message.text == state.message.text, "room switch drops old battle and caption")
	for destination: String in ["waiting", "closed", "leave"]:
		state.phase = battle
		state.lastEvents = [{"id": 2, "type": "narration", "text": "战斗中"}]
		room.state = state
		_broadcast(client, room)
		_check.call(main.playback.is_playing() and not main.playback.lingering_battle.is_empty(), "live battle before " + destination)
		match destination:
			"waiting":
				room.state = null
				_broadcast(client, room)
			"closed":
				client.room_closed.emit("关闭")
			"leave":
				main.get_node("Margin/Root/Screens/Game/ActionDock/Margin/Content/ActionRow/Leave").pressed.emit()
		var q: Queue = main.playback.queue
		_check.call(not q.is_playing() and q.seen_events().is_empty() and q.watermark() == 0 and main.playback.lingering_battle.is_empty(), "reset queue, history and battle on " + destination)
		_check.call(not main.game_panel.visible, "game view hidden on " + destination)

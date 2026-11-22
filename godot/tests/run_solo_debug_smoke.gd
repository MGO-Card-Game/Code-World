extends SceneTree

const Client = preload("res://scripts/net/game_client.gd")
const EngineErrors = preload("res://tests/engine_errors.gd")
const Pointer = preload("res://tests/test_battle_pve.gd")

var client: Client
var main: Node
var identities: DirAccess
var errors := EngineErrors.new()
var failure := ""


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	OS.add_logger(errors)
	identities = DirAccess.create_temp("dicebound_solo_")
	client = root.get_node("GameClient")
	client.identity_path = identities.get_current_dir().path_join("solo.cfg")
	client.error_received.connect(func(reason: String) -> void: failure = reason)
	main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await process_frame
	await process_frame
	await _play()
	main.free()
	client.leave_room()
	if FileAccess.file_exists(client.identity_path):
		DirAccess.remove_absolute(client.identity_path)
	identities = null
	await process_frame
	await process_frame
	var orphans := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	OS.remove_logger(errors)
	var passed := failure.is_empty() and errors.count == 0 and orphans == 0
	print("Solo debug smoke %s: %s, %d runtime errors, %d orphan nodes" % [
		"PASS" if passed else "FAIL", failure, errors.count, orphans])
	quit(0 if passed else 1)


func _play() -> void:
	if not await _update(Pointer.click_button.bind(main.solo_debug_button), "awaitingRoll"):
		return
	if not client.room.get("soloDebug", false) or not main.game_panel.is_visible_in_tree():
		failure = "lobby button did not open a solo game"
		return
	if not await _update(client.dispatch.bind({"type": "restart", "seed": 52}), "awaitingRoll"):
		return
	var first_seat: String = client.room.seat
	main._skip_playback()
	if not await _update(main.router.primary_action.pressed.emit, "treasureReward"):
		return
	main._skip_playback()
	if not main.debug_seat.is_visible_in_tree() or not main.outcome_overlay.options.visible:
		failure = "reward overlay does not identify the controlling seat or expose its action"
		return
	if not await _update(main.outcome_overlay.options.get_child(0).pressed.emit, "turnComplete"):
		return
	main._skip_playback()
	if not await _update(main.router.primary_action.pressed.emit, "awaitingRoll"):
		return
	if client.room.seat == first_seat or not main.game_room_code.text.contains(client.room.state.players[client.room.seat].name):
		failure = "end turn did not hand the window to the other seat"
		return
	var hand: Array = client.room.state.players[first_seat].scrolls
	if hand.is_empty() or not hand.all(func(card: Dictionary) -> bool: return card.get("hidden", false) and not card.has("kind")):
		failure = "previous seat's hand was not concealed"
		return
	main._skip_playback()
	await _update(main.router.primary_action.pressed.emit, "mapEventNotice")


func _update(send: Callable, expected_phase: String) -> bool:
	var before := client.room
	send.call()
	var deadline := Time.get_ticks_msec() + 4000
	while is_same(before, client.room) and failure.is_empty() and Time.get_ticks_msec() < deadline:
		await process_frame
	if failure.is_empty():
		if is_same(before, client.room):
			failure = "timed out waiting for " + expected_phase
		elif client.room.state.phase.kind != expected_phase:
			failure = "expected %s, received %s" % [expected_phase, client.room.state.phase.kind]
	return failure.is_empty()

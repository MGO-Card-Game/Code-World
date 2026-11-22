extends SceneTree

# godot --headless --path godot -s res://tests/run_ws_smoke.gd -- --server=ws://127.0.0.1:8787
const Client = preload("res://scripts/net/game_client.gd")
const EngineErrors = preload("res://tests/engine_errors.gd")
const TIMEOUT_SECONDS := 15.0

var a := Client.new()
var b := Client.new()
var identities: DirAccess
var errors := EngineErrors.new()
var stage := "initializing clients"
var finishing := false


func _initialize() -> void:
	OS.add_logger(errors)
	_run.call_deferred()


func _run() -> void:
	create_timer(TIMEOUT_SECONDS).timeout.connect(func() -> void: _finish("timeout after 15 seconds"))
	identities = DirAccess.create_temp("dicebound_ws_")
	if identities == null:
		_finish("cannot create temporary identity directory")
		return
	for client: Client in [a, b]:
		var label := "A" if client == a else "B"
		client.identity_path = identities.get_current_dir().path_join(label + ".cfg")
		root.add_child(client)
		client.error_received.connect(func(message: String) -> void: _finish(label + ": " + message))
		client.room_closed.connect(func(reason: String) -> void: _finish(label + ": " + reason))
		client.status_changed.connect(func(status: String) -> void:
			if status == "offline":
				_finish(label + " disconnected from " + client.server_url))

	print("WS smoke connecting to ", a.server_url)
	if not await _exchange("A creates room", a.create_room.bind("Smoke A", 2), false):
		return
	var code: String = a.room.code
	if code.length() != 5 or a.room.capacity != 2 or a.room.status != "waiting" or a.room.state != null or a.room.hostSeat != a.room.seat:
		_finish("expected a five-character code and a two-seat waiting room owned by A")
		return
	if not await _exchange("B joins " + code, b.join_room.bind(code, "Smoke B")):
		return
	for client: Client in [a, b]:
		var room := client.room
		if room.code != code or room.status != "waiting" or room.members.size() != 2 or not room.members.all(func(m: Dictionary) -> bool: return m.connected):
			_finish("both lobby views must contain two online members of room " + code)
			return

	if not await _exchange("A starts game", a.start_game):
		return
	if a.room.seat != "player1" or b.room.seat != "player2":
		_finish("expected player1 and player2, received %s and %s" % [a.room.seat, b.room.seat])
		return
	for client: Client in [a, b]:
		if client.room.status != "playing" or client.room.state.phase.kind != "awaitingRoll":
			_finish("expected awaitingRoll on " + client.room.seat)
			return
	if not _check_hands(false):
		return
	var actor := _active_client()
	if a.room.state.activePlayerId != b.room.state.activePlayerId:
		_finish("clients disagree on the active seat")
		return
	if not await _exchange("rollMovement by " + actor.room.seat, actor.dispatch.bind({"type": "rollMovement"})):
		return
	for client: Client in [a, b]:
		if not client.room.state.lastEvents.any(func(e: Dictionary) -> bool: return e.type == "movementRolled" and e.playerId == actor.room.seat):
			_finish("missing movementRolled in updated roomState for " + client.room.seat)
			return

	# New games start empty-handed. Seed 52 awards each seat a scroll on its
	# first move, so both redaction checks exercise real, nonempty hands.
	if not await _exchange("restart for card privacy", a.dispatch.bind({"type": "restart", "seed": 52})):
		return
	for action: String in ["rollMovement", "acknowledgeTreasureReward", "endTurn", "rollMovement"]:
		if not await _exchange("card privacy / " + action, _active_client().dispatch.bind({"type": action})):
			return
	if _check_hands(true):
		print("Room ", code, ": both seats received movementRolled and matching hidden opponent cards")
		_finish("")


func _active_client() -> Client:
	return a if a.room.seat == a.room.state.activePlayerId else b


func _exchange(description: String, send: Callable, both := true) -> bool:
	stage = description
	var previous_a := a.room
	var previous_b := b.room
	send.call()
	# GameClient replaces room on each received roomState. An ack cannot pass this barrier.
	while not finishing and (is_same(a.room, previous_a) or (both and is_same(b.room, previous_b))):
		await process_frame
	return not finishing


func _check_hands(require_cards: bool) -> bool:
	for owner: Client in [a, b]:
		var other := b if owner == a else a
		var seat: String = owner.room.seat
		var cards: Array = owner.room.state.players[seat].scrolls
		var backs: Array = other.room.state.players[seat].scrolls
		if backs.size() != cards.size() or (require_cards and cards.is_empty()):
			_finish("unexpected hand sizes for %s: %d cards / %d backs" % [seat, cards.size(), backs.size()])
			return false
		for i in cards.size():
			if not cards[i].has("kind") or backs[i] != {"instanceId": cards[i].instanceId, "hidden": true}:
				_finish("opponent view must contain only the matching hidden card for " + seat)
				return false
	return true


func _finish(reason: String) -> void:
	if finishing:
		return
	finishing = true
	if not reason.is_empty():
		printerr("WS smoke failed at ", stage, ": ", reason)
	_cleanup.call_deferred(reason.is_empty())


func _cleanup(success: bool) -> void:
	for client: Client in [a, b]:
		client.disconnect_from_server()
		if FileAccess.file_exists(client.identity_path):
			if DirAccess.remove_absolute(client.identity_path) != OK:
				printerr("Could not remove smoke identity: ", client.identity_path)
				success = false
		client.free()
	identities = null
	await process_frame
	await process_frame
	var orphans := int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))
	OS.remove_logger(errors)
	success = success and errors.count == 0 and orphans == 0
	print("WS smoke %s: %d runtime errors, %d orphan nodes" % ["PASS" if success else "FAIL", errors.count, orphans])
	quit(0 if success else 1)

extends Node

## Thin Godot client for the existing TypeScript WebSocket protocol.
##
## This node deliberately does not decide whether an action is legal. It sends
## GameAction-shaped dictionaries and renders the server's player-scoped view.

signal status_changed(status: String)
signal room_changed(room: Dictionary)
signal error_received(message: String)
signal room_closed(reason: String)

const IDENTITY_PATH := "user://dicebound_identity.cfg"
const ACTION_TIMEOUT_SECONDS := 5.0
const RECONNECT_DELAY_SECONDS := 2.0

var server_url: String = "ws://127.0.0.1:8787"
var status: String = "idle"
var room: Dictionary = {}

var _identity_path := IDENTITY_PATH
var _socket: WebSocketPeer
var _request_sequence := 0
var _pending_message: Dictionary = {}
var _last_join: Dictionary = {}
var _player_name := ""
var _manual_close := false
var _was_open := false
var _reconnect_remaining := -1.0
var _in_flight_request := ""
var _action_timeout_remaining := -1.0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	_identity_path = resolve_identity_path(args, OS.get_environment("DICEBOUND_PROFILE"))
	var default_url := str(ProjectSettings.get_setting("network/dicebound/server_url", server_url))
	server_url = resolve_server_url(default_url, args, OS.get_environment("DICEBOUND_SERVER_URL"))
	_player_name = load_player_name()
	set_process(true)


static func _option(args: PackedStringArray, prefix: String) -> String:
	for arg in args:
		if arg.begins_with(prefix):
			return arg.trim_prefix(prefix).strip_edges()
	return ""


static func resolve_identity_path(cmdline_args: PackedStringArray, env_profile: String) -> String:
	var invalid := RegEx.create_from_string(r'[\x00-\x1f<>:"/\\|?*]')
	for value in [_option(cmdline_args, "--profile="), env_profile]:
		var profile := invalid.sub(value, "", true).strip_edges().lstrip(". ").rstrip(". ")
		if not profile.is_empty():
			return "user://dicebound_identity_%s.cfg" % profile
	return IDENTITY_PATH


static func resolve_server_url(default_url: String, cmdline_args: PackedStringArray, env_url: String) -> String:
	var url := _option(cmdline_args, "--server=")
	if not url.is_empty():
		return url
	return default_url if env_url.strip_edges().is_empty() else env_url.strip_edges()


func _process(delta: float) -> void:
	if _action_timeout_remaining >= 0.0:
		_action_timeout_remaining -= delta
		if _action_timeout_remaining <= 0.0:
			_clear_in_flight()

	if _reconnect_remaining >= 0.0:
		_reconnect_remaining -= delta
		if _reconnect_remaining <= 0.0:
			_reconnect_remaining = -1.0
			_reconnect()

	if _socket == null:
		return

	_socket.poll()
	var ready_state := _socket.get_ready_state()
	if ready_state == WebSocketPeer.STATE_OPEN:
		if not _was_open:
			_was_open = true
			_set_status("online")
			_send_pending_message()
		_receive_packets()
	elif ready_state == WebSocketPeer.STATE_CLOSED:
		_handle_socket_closed()


func create_room(player_name: String, capacity: int) -> void:
	_player_name = _normalized_name(player_name)
	_save_identity(_player_name)
	_last_join.clear()
	_pending_message = {
		"type": "createRoom",
		"requestId": _next_request_id(),
		"playerName": _player_name,
		"playerToken": _load_or_create_token(),
		"capacity": clampi(capacity, 2, 4),
	}
	_connect_to_server()


func join_room(room_code: String, player_name: String) -> void:
	_player_name = _normalized_name(player_name)
	_save_identity(_player_name)
	var normalized_code := room_code.strip_edges().to_upper()
	_last_join = {"roomCode": normalized_code, "playerName": _player_name}
	_queue_join(normalized_code, _player_name)
	_connect_to_server()


func start_game() -> void:
	_send({"type": "startGame", "requestId": _next_request_id()})


func dispatch(action: Dictionary) -> void:
	if not _in_flight_request.is_empty():
		return
	var request_id := _next_request_id()
	if _send({"type": "action", "requestId": request_id, "action": action}):
		_in_flight_request = request_id
		_action_timeout_remaining = ACTION_TIMEOUT_SECONDS


func leave_room() -> void:
	_send({"type": "leaveRoom", "requestId": _next_request_id()})
	disconnect_from_server()


func disconnect_from_server() -> void:
	_manual_close = true
	_last_join.clear()
	_pending_message.clear()
	_reconnect_remaining = -1.0
	_clear_in_flight()
	room.clear()
	if _socket != null:
		_socket.close()
	_socket = null
	_was_open = false
	_set_status("idle")


func load_player_name() -> String:
	var config := ConfigFile.new()
	if config.load(_identity_path) != OK:
		return ""
	return str(config.get_value("identity", "player_name", ""))


func _connect_to_server() -> void:
	_manual_close = false
	_reconnect_remaining = -1.0
	if _socket != null and _socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_send_pending_message()
		return

	_socket = WebSocketPeer.new()
	_was_open = false
	_set_status("connecting")
	var error := _socket.connect_to_url(server_url)
	if error != OK:
		_socket = null
		_set_status("offline")
		error_received.emit("无法连接服务器：%s" % error_string(error))


func _queue_join(room_code: String, player_name: String) -> void:
	_pending_message = {
		"type": "joinRoom",
		"requestId": _next_request_id(),
		"roomCode": room_code,
		"playerName": player_name,
		"playerToken": _load_or_create_token(),
	}


func _reconnect() -> void:
	if _manual_close or _last_join.is_empty():
		return
	_queue_join(str(_last_join.get("roomCode", "")), str(_last_join.get("playerName", "")))
	_connect_to_server()


func _send_pending_message() -> void:
	if _pending_message.is_empty():
		return
	var message := _pending_message.duplicate(true)
	if _send(message):
		_pending_message.clear()


func _send(payload: Dictionary) -> bool:
	if _socket == null or _socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return false
	return _socket.send_text(JSON.stringify(payload)) == OK


func _receive_packets() -> void:
	while _socket != null and _socket.get_available_packet_count() > 0:
		var raw := _socket.get_packet().get_string_from_utf8()
		var parsed: Variant = JSON.parse_string(raw)
		if parsed is not Dictionary:
			continue
		_handle_message(parsed as Dictionary)


func _handle_message(message: Dictionary) -> void:
	match str(message.get("type", "")):
		"roomState":
			_clear_in_flight()
			var next_room: Variant = message.get("room", {})
			if next_room is not Dictionary:
				return
			room = (next_room as Dictionary).duplicate(true)
			_last_join = {
				"roomCode": str(room.get("code", "")),
				"playerName": _player_name,
			}
			room_changed.emit(room)
		"error":
			_clear_in_flight()
			error_received.emit(str(message.get("message", "服务器拒绝了请求")))
		"roomClosed":
			_clear_in_flight()
			_last_join.clear()
			room.clear()
			room_closed.emit(str(message.get("reason", "房间已关闭")))
		"ack":
			pass


func _handle_socket_closed() -> void:
	if _socket == null:
		return
	var close_reason := _socket.get_close_reason()
	_socket = null
	_was_open = false
	_clear_in_flight()
	_set_status("offline")
	if not _manual_close and not _last_join.is_empty():
		_reconnect_remaining = RECONNECT_DELAY_SECONDS
	elif not _manual_close and not close_reason.is_empty():
		error_received.emit("连接已关闭：%s" % close_reason)


func _next_request_id() -> String:
	_request_sequence += 1
	return "g%d" % _request_sequence


func _set_status(next_status: String) -> void:
	if status == next_status:
		return
	status = next_status
	status_changed.emit(status)


func _clear_in_flight() -> void:
	_in_flight_request = ""
	_action_timeout_remaining = -1.0


func _normalized_name(value: String) -> String:
	var normalized := value.strip_edges().substr(0, 16)
	return normalized if not normalized.is_empty() else "无名旅者"


func _save_identity(player_name: String) -> void:
	var config := ConfigFile.new()
	config.load(_identity_path)
	config.set_value("identity", "player_name", player_name)
	if str(config.get_value("identity", "player_token", "")).is_empty():
		config.set_value("identity", "player_token", _generate_token())
	config.save(_identity_path)


func _load_or_create_token() -> String:
	var config := ConfigFile.new()
	config.load(_identity_path)
	var token := str(config.get_value("identity", "player_token", ""))
	if not token.is_empty():
		return token
	token = _generate_token()
	config.set_value("identity", "player_token", token)
	config.set_value("identity", "player_name", _player_name)
	config.save(_identity_path)
	return token


func _generate_token() -> String:
	var bytes := Crypto.new().generate_random_bytes(16)
	var hex := ""
	for value in bytes:
		hex += "%02x" % value
	return "%s-%s-%s-%s-%s" % [
		hex.substr(0, 8),
		hex.substr(8, 4),
		hex.substr(12, 4),
		hex.substr(16, 4),
		hex.substr(20, 12),
	]

extends Control

## First Godot vertical slice. The server remains authoritative; this scene only
## renders RoomView/GameStateView and emits the existing JSON GameAction shapes.

const THEME_FACTORY = preload("res://scripts/ui/ui_theme.gd")

const STATUS_LABELS := {
	"idle": "未连接",
	"connecting": "连接中…",
	"online": "服务器在线",
	"offline": "连接已断开，正在等待重连",
}

const Board = preload("res://scripts/ui/mountain_board.gd")
const Roster = preload("res://scripts/ui/roster_panel.gd")
const Router = preload("res://scripts/ui/phase_overlay_router.gd")
const Playback = preload("res://scripts/anim/playback_controller.gd")

@onready var connection_status: Label = $Margin/Root/Topbar/ConnectionStatus
@onready var notice: Label = $Margin/Root/Notice
@onready var lobby_panel: PanelContainer = $Margin/Root/Screens/Lobby
@onready var room_panel: PanelContainer = $Margin/Root/Screens/Room
@onready var game_panel: VBoxContainer = $Margin/Root/Screens/Game

@onready var player_name: LineEdit = $Margin/Root/Screens/Lobby/Margin/Content/PlayerName
@onready var capacity: OptionButton = $Margin/Root/Screens/Lobby/Margin/Content/CapacityRow/Capacity
@onready var room_code_input: LineEdit = $Margin/Root/Screens/Lobby/Margin/Content/RoomCode
@onready var create_button: Button = $Margin/Root/Screens/Lobby/Margin/Content/CreateRoom
@onready var join_button: Button = $Margin/Root/Screens/Lobby/Margin/Content/JoinRoom

@onready var waiting_code: Label = $Margin/Root/Screens/Room/Margin/Content/Code
@onready var waiting_members: VBoxContainer = $Margin/Root/Screens/Room/Margin/Content/Members
@onready var start_button: Button = $Margin/Root/Screens/Room/Margin/Content/StartGame

@onready var turn_label: Label = $Margin/Root/Screens/Game/StatusBar/Margin/Content/Turn
@onready var game_room_code: Label = $Margin/Root/Screens/Game/StatusBar/Margin/Content/RoomCode
@onready var roster: Roster = $Margin/Root/Screens/Game/Body/RosterCard
@onready var board: Board = $Margin/Root/Screens/Game/Body/BoardCard/Margin/Content/Board
@onready var router: Router = $Margin/Root/Screens/Game/ActionDock

var _current_room: Dictionary = {}
var playback := Playback.new()


func _ready() -> void:
	theme = THEME_FACTORY.build()
	_apply_surface_styles()
	capacity.add_item("2 人", 2)
	capacity.add_item("3 人", 3)
	capacity.add_item("4 人", 4)
	capacity.select(2)
	player_name.text = GameClient.load_player_name()

	create_button.pressed.connect(_on_create_room)
	join_button.pressed.connect(_on_join_room)
	start_button.pressed.connect(GameClient.start_game)
	$Margin/Root/Screens/Room/Margin/Content/LeaveRoom.pressed.connect(_on_leave_room)
	$Margin/Root/Screens/Game/ActionDock/Margin/Content/ActionRow/Leave.pressed.connect(_on_leave_room)
	board.region_tabs = $Margin/Root/Screens/Game/Body/BoardCard/Margin/Content/RegionHeader/RegionTabs
	router.skip_requested.connect(_skip_playback)

	GameClient.status_changed.connect(_on_status_changed)
	GameClient.room_changed.connect(_on_room_changed)
	GameClient.error_received.connect(_show_notice)
	GameClient.room_closed.connect(_on_room_closed)
	_on_status_changed(GameClient.status)
	_show_lobby()


func _apply_surface_styles() -> void:
	$Margin/Root/Topbar/BrandMark.add_theme_stylebox_override(
		"panel",
		THEME_FACTORY.panel_style(Color("8f6b38"), true),
	)
	$Margin/Root/Screens/Game/StatusBar.add_theme_stylebox_override(
		"panel",
		THEME_FACTORY.panel_style(Color("4b5b70"), false),
	)
	$Margin/Root/Screens/Game/Body/RosterCard.add_theme_stylebox_override(
		"panel",
		THEME_FACTORY.panel_style(Color("47566b"), false),
	)
	$Margin/Root/Screens/Game/Body/BoardCard.add_theme_stylebox_override(
		"panel",
		THEME_FACTORY.panel_style(Color("79613c"), false),
	)
	$Margin/Root/Screens/Game/ActionDock.add_theme_stylebox_override(
		"panel",
		THEME_FACTORY.panel_style(Color("a4793e"), true),
	)


func _on_create_room() -> void:
	_clear_notice()
	var selected_capacity := capacity.get_item_id(capacity.selected)
	GameClient.create_room(player_name.text, selected_capacity)


func _on_join_room() -> void:
	_clear_notice()
	var code := room_code_input.text.strip_edges().to_upper()
	if code.length() != 5:
		_show_notice("请输入 5 位房间码")
		return
	GameClient.join_room(code, player_name.text)


func _on_leave_room() -> void:
	GameClient.leave_room()
	_current_room = {}
	_show_lobby()


func _on_status_changed(next_status: String) -> void:
	connection_status.text = str(STATUS_LABELS.get(next_status, next_status))
	create_button.disabled = next_status == "connecting"
	join_button.disabled = next_status == "connecting"


func _on_room_changed(next_room: Dictionary) -> void:
	_clear_notice()
	if next_room.get("code") != _current_room.get("code"):
		playback.reset()
		board.reset_selection()
		router.reset_phase()
	_current_room = next_room
	var state = next_room.get("state")
	if state is Dictionary:
		playback.sync_state(state)
		_show_game(state as Dictionary)
	else:
		_show_waiting_room()


func _on_room_closed(reason: String) -> void:
	_current_room = {}
	_show_lobby()
	_show_notice(reason)


func _show_lobby() -> void:
	playback.reset()
	lobby_panel.visible = true
	room_panel.visible = false
	game_panel.visible = false


func _show_waiting_room() -> void:
	playback.reset()
	lobby_panel.visible = false
	room_panel.visible = true
	game_panel.visible = false
	waiting_code.text = str(_current_room.get("code", "-----"))

	var members = _current_room.get("members", [])
	while waiting_members.get_child_count() > members.size():
		var last := waiting_members.get_child(-1)
		waiting_members.remove_child(last)
		last.queue_free()
	for index in members.size():
		var member: Dictionary = members[index]
		var row: Label
		if index == waiting_members.get_child_count():
			row = Label.new()
			row.add_theme_font_size_override("font_size", 18)
			waiting_members.add_child(row)
		else:
			row = waiting_members.get_child(index)
		var crown := "房主 · " if str(member.get("seat", "")) == str(_current_room.get("hostSeat", "")) else ""
		var connection := "在线" if bool(member.get("connected", false)) else "掉线"
		row.text = "%s%s  ·  %s" % [crown, str(member.get("name", "旅者")), connection]

	var viewer_is_host := str(_current_room.get("seat", "")) == str(_current_room.get("hostSeat", ""))
	var everyone_online := true
	for member in members:
		if member is Dictionary and not bool(member.get("connected", false)):
			everyone_online = false
	start_button.visible = viewer_is_host
	start_button.disabled = members.size() < 2 or not everyone_online


func _process(delta: float) -> void:
	if playback.is_playing() and playback.advance(delta * 1000.0):
		_show_game(_current_room.state)


func _skip_playback() -> void:
	if playback.drain():
		_show_game(_current_room.state)


func _show_game(state: Dictionary) -> void:
	lobby_panel.visible = false
	room_panel.visible = false
	game_panel.visible = true
	var players: Dictionary = state.get("players", {})
	var active_player_id := str(state.get("activePlayerId", ""))
	var active_player: Dictionary = players.get(active_player_id, {})
	turn_label.text = "行动 %d · %s的回合" % [int(state.get("turn", 0)), str(active_player.get("name", "旅者"))]
	game_room_code.text = "房间 %s" % str(_current_room.get("code", "-----"))

	var viewer: String = _current_room.get("seat", "")
	roster.set_game_state(state, viewer, playback)
	board.set_game_state(state, "", playback)
	router.set_game_state(state, viewer, playback)


func _show_notice(message: String) -> void:
	notice.text = message
	notice.visible = not message.is_empty()


func _clear_notice() -> void:
	notice.visible = false
	notice.text = ""

class_name RosterPanel
extends PanelContainer

const Catalog = preload("res://scripts/data/content_catalog.gd")
const Playback = preload("res://scripts/anim/playback_controller.gd")
const Visual = preload("res://scripts/anim/visual_state.gd")

@onready var players_list: VBoxContainer = $Margin/Content/Players
@onready var hand_list: VBoxContainer = $Margin/Content/HandScroll/Hand

var dispatch_callable: Callable
var _cards: Dictionary[String, PlayerCard] = {}
var _buttons: Dictionary[String, Button] = {}
var _empty_hand: Label


class PlayerCard extends PanelContainer:
	var avatar := Label.new()
	var name_label := Label.new()
	var status_label := Label.new()
	var hp_bar := ProgressBar.new()
	var stats := Label.new()
	var panel_style := StyleBoxFlat.new()
	var hp_fill := StyleBoxFlat.new()

	func _init() -> void:
		custom_minimum_size = Vector2(0, 68)
		panel_style.set_corner_radius_all(7)
		panel_style.border_width_left = 4
		panel_style.content_margin_left = 10
		panel_style.content_margin_right = 10
		panel_style.content_margin_top = 7
		panel_style.content_margin_bottom = 7
		add_theme_stylebox_override("panel", panel_style)
		var content := VBoxContainer.new()
		content.add_theme_constant_override("separation", 3)
		add_child(content)
		var header := HBoxContainer.new()
		header.add_theme_constant_override("separation", 7)
		content.add_child(header)
		avatar.custom_minimum_size = Vector2(25, 25)
		avatar.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		avatar.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		avatar.add_theme_font_size_override("font_size", 17)
		header.add_child(avatar)
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		name_label.add_theme_font_size_override("font_size", 14)
		header.add_child(name_label)
		status_label.add_theme_font_size_override("font_size", 11)
		header.add_child(status_label)
		hp_bar.custom_minimum_size = Vector2(0, 9)
		hp_bar.show_percentage = false
		hp_fill.set_corner_radius_all(4)
		hp_bar.add_theme_stylebox_override("fill", hp_fill)
		content.add_child(hp_bar)
		stats.add_theme_color_override("font_color", Color("8f9bad"))
		stats.add_theme_font_size_override("font_size", 11)
		content.add_child(stats)

	func update_player(player: Dictionary, id: String, viewer: String, active: bool, offline: bool, pending: Array) -> void:
		var color := Color.from_string(player.get("color", ""), Color("9aa7bd"))
		var player_name: String = player.get("name", id)
		panel_style.bg_color = Color("202b3b") if active else Color("151c27")
		panel_style.border_color = color
		avatar.text = player_name.left(1)
		avatar.add_theme_color_override("font_color", color)
		name_label.text = player_name + (" · 你" if id == viewer else "")
		name_label.add_theme_color_override("font_color", Color("f5f0e7") if active else Color("c9d1dc"))
		status_label.text = "掉线" if offline else ("行动中" if active else "待机")
		status_label.add_theme_color_override("font_color", Color("e9b95f") if active else Color("758296"))
		var hp := Visual.visual_hp(player, pending)
		var max_hp := Visual.visual_max_hp(player, pending)
		hp_bar.max_value = maxi(1, max_hp)
		hp_bar.value = hp
		hp_fill.bg_color = color.darkened(0.08)
		stats.text = "HP %d/%d   攻 %d · 防 %d   金币 %d" % [
			hp, max_hp, Visual.visual_base_stat(player, "attack", pending),
			Visual.visual_base_stat(player, "defense", pending), Visual.visual_gold(player, pending),
		]


func _ready() -> void:
	if not dispatch_callable.is_valid():
		dispatch_callable = get_node("/root/GameClient").dispatch


func set_game_state(state: Dictionary, viewer: String, playback: Playback = null) -> void:
	var pending: Array = playback.queue.pending_events() if playback != null else []
	var players: Dictionary = state.get("players", {})
	var order: Array = state.get("turnOrder", [])
	var active: String = state.get("activePlayerId", "")
	var unavailable: Array = state.get("unavailablePlayerIds", [])
	for id: String in _cards.keys():
		if not order.has(id):
			_retire(_cards[id])
			_cards.erase(id)
	for index in order.size():
		var id: String = order[index]
		if not _cards.has(id):
			_cards[id] = PlayerCard.new()
			players_list.add_child(_cards[id])
		var card := _cards[id]
		card.update_player(players.get(id, {}), id, viewer, id == active, id in unavailable, pending)
		if card.get_index() != index:
			players_list.move_child(card, index)

	var phase: Dictionary = state.get("phase", {})
	var can_play: bool = viewer == active and phase.get("kind") in ["awaitingRoll", "turnComplete"]
	_update_hand(players.get(viewer, {}).get("scrolls", []), can_play and (playback == null or not playback.is_playing()), pending)


func _update_hand(scrolls: Array, can_play: bool, pending: Array) -> void:
	var present := {}
	var visible_count := 0
	for scroll: Dictionary in scrolls:
		var id: String = scroll.instanceId
		present[id] = true
		if not Visual.is_revealed(id, pending):
			if _buttons.has(id):
				_buttons[id].hide()
				_buttons[id].disabled = true
			continue
		if not _buttons.has(id):
			var new_button := Button.new()
			new_button.pressed.connect(_play_scroll.bind(id))
			_buttons[id] = new_button
			hand_list.add_child(new_button)
		var button := _buttons[id]
		button.show()
		var kind: String = scroll.get("kind", "")
		var hidden: bool = scroll.get("hidden", false)
		button.text = "未知卷轴" if hidden else Catalog.scroll_name(kind)
		button.disabled = hidden or not can_play or not Catalog.is_interference_scroll(kind)
		if button.get_index() != visible_count:
			hand_list.move_child(button, visible_count)
		visible_count += 1
	for id: String in _buttons.keys():
		if not present.has(id):
			_retire(_buttons[id])
			_buttons.erase(id)

	if visible_count == 0 and _empty_hand == null:
		_empty_hand = Label.new()
		_empty_hand.text = "暂无卷轴"
		_empty_hand.modulate = Color("9aa7bd")
		hand_list.add_child(_empty_hand)
	elif visible_count > 0 and _empty_hand != null:
		_retire(_empty_hand)
		_empty_hand = null


func _play_scroll(id: String) -> void:
	if _buttons.has(id) and not _buttons[id].disabled:
		dispatch_callable.call({"type": "useMapScroll", "instanceId": id})


func _retire(node: Control) -> void:
	node.get_parent().remove_child(node)
	node.queue_free()

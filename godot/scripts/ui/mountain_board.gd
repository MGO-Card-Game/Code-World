class_name MountainBoard
extends Control

signal boss_inspected(region_id: String)

const TILE_SYMBOLS := {
	"start": "营",
	"battle": "战",
	"elite": "危",
	"treasure": "宝",
	"blessing": "福",
	"spring": "泉",
	"event": "闻",
	"shop": "商",
	"tunnel": "径",
	"gate": "门",
	"boss": "首",
}

const TILE_COLORS := {
	"start": Color("496078"),
	"battle": Color("824954"),
	"elite": Color("a54e59"),
	"treasure": Color("92703a"),
	"blessing": Color("745d9b"),
	"spring": Color("3e8290"),
	"event": Color("497564"),
	"shop": Color("8a7045"),
	"tunnel": Color("4c6075"),
	"gate": Color("9a693e"),
	"boss": Color("a83f46"),
}

const REGION_PALETTES := {
	"foothill": [Color("142720"), Color("203d32"), Color("557760")],
	"mountainside": [Color("182432"), Color("2a3b50"), Color("72839a")],
	"summit": [Color("222334"), Color("393c59"), Color("a3adc4")],
}

const Catalog = preload("res://scripts/data/content_catalog.gd")
const Playback = preload("res://scripts/anim/playback_controller.gd")
const Visual = preload("res://scripts/anim/visual_state.gd")

var region_tabs: HBoxContainer

var _state: Dictionary = {}
var _positions: Dictionary[String, int] = {}
var _region_id := ""
var _tile_ids: Array[int] = []
var _columns := 12
var _points: PackedVector2Array = PackedVector2Array()
var _tile_buttons: Array[Button] = []
var _boss_button: Button


func _ready() -> void:
	clip_contents = true
	resized.connect(_layout_board)
	mouse_filter = Control.MOUSE_FILTER_STOP


func reset_selection() -> void:
	_region_id = ""


func set_game_state(state: Dictionary, region_id: String = "", playback: Playback = null) -> void:
	_state = state
	var pending: Array = playback.queue.pending_events() if playback != null else []
	var players: Dictionary = state.get("players", {})
	_positions.clear()
	for id: String in state.get("turnOrder", []):
		_positions[id] = Visual.visual_position(players.get(id, {}), pending)
	_show_region(region_id)


func _show_region(region_id: String) -> void:
	var next_region := region_id
	if next_region.is_empty():
		next_region = _active_region_id() if _region_id.is_empty() else _region_id
	var game_map: Dictionary = _state.get("map", {})
	var tiles: Array[Dictionary] = []
	var ids: Array[int] = []
	for tile: Dictionary in game_map.get("tiles", []):
		if tile.get("region") == next_region:
			tiles.append(tile)
			ids.append(int(tile.id))

	var rebuild := next_region != _region_id or ids != _tile_ids or _boss_button == null
	var columns := maxi(3, int(game_map.get("columns", 12)))
	var layout_changed := rebuild or columns != _columns
	_region_id = next_region
	_columns = columns
	if rebuild:
		_tile_ids = ids
		_rebuild_nodes()

	var region := _selected_region()
	for index in tiles.size():
		_update_tile(_tile_buttons[index], tiles[index], region)
	_boss_button.disabled = _state.phase.kind == "scrollTargetChoice"
	_boss_button.visible = not region.is_empty()
	if _boss_button.visible:
		_boss_button.text = "♛  %s\n%s" % [Catalog.enemy_name(region.get("bossEnemyId", "")), _boss_status(region)]
	if region_tabs != null:
		_update_tabs(game_map.get("regions", []))
	if layout_changed:
		_points.clear()
		_layout_board()
		queue_redraw()


func _update_tabs(regions: Array) -> void:
	while region_tabs.get_child_count() > regions.size():
		_retire(region_tabs.get_child(-1))
	for index in regions.size():
		var region: Dictionary = regions[index]
		var button: Button
		if index == region_tabs.get_child_count():
			button = Button.new()
			button.toggle_mode = true
			button.custom_minimum_size = Vector2(104, 34)
			button.add_theme_font_size_override("font_size", 12)
			button.pressed.connect(_select_tab.bind(button))
			region_tabs.add_child(button)
		else:
			button = region_tabs.get_child(index)
		button.set_meta("region", region.id)
		button.text = region.get("name", region.id)
		button.set_pressed_no_signal(region.id == _region_id)


func _select_tab(button: Button) -> void:
	_show_region(button.get_meta("region"))


func _retire(node: Node) -> void:
	node.get_parent().remove_child(node)
	node.queue_free()


func _rebuild_nodes() -> void:
	for button in _tile_buttons:
		_retire(button)
	_tile_buttons.clear()
	if _boss_button != null:
		_retire(_boss_button)
	for id in _tile_ids:
		var button := _make_tile_button()
		_tile_buttons.append(button)
		add_child(button)
	_boss_button = _make_boss_button()
	add_child(_boss_button)


func _make_tile_button() -> Button:
	var button := Button.new()
	button.custom_minimum_size = Vector2(62, 62)
	button.size = button.custom_minimum_size
	button.pivot_offset = button.size * 0.5
	button.focus_mode = Control.FOCUS_NONE
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_size_override("font_size", 13)
	button.add_theme_color_override("font_color", Color("f5f0e7"))
	button.add_theme_color_override("font_hover_color", Color.WHITE)
	button.mouse_entered.connect(_animate_tile.bind(button, Vector2(1.09, 1.09)))
	button.mouse_exited.connect(_animate_tile.bind(button, Vector2.ONE))
	return button


func _update_tile(button: Button, tile: Dictionary, region: Dictionary) -> void:
	var tile_id := int(tile.id)
	var occupants := _update_occupants(button, tile_id)
	var tile_type: String = tile.get("type", "event")
	var local_index := tile_id - int(region.get("startIndex", tile_id))
	button.text = "%s\n%02d" % [TILE_SYMBOLS.get(tile_type, "·"), local_index]
	button.tooltip_text = "%d · %s" % [tile_id, tile.get("label", tile_type)]
	if not occupants.is_empty():
		button.tooltip_text += "\n驻留：%s" % "、".join(occupants)
	var occupied := not occupants.is_empty()
	var style_key := [tile_type, occupied]
	if button.get_meta("style_key", []) == style_key:
		return
	button.set_meta("style_key", style_key)
	var base: Color = TILE_COLORS.get(tile_type, Color("526174"))
	var special := tile_type in ["gate", "start"]
	button.add_theme_stylebox_override("normal", _tile_style(base, occupied, false, special))
	button.add_theme_stylebox_override("hover", _tile_style(base.lightened(0.12), true, true, special))
	button.add_theme_stylebox_override("pressed", _tile_style(base.lightened(0.18), true, true, special))


func _tile_style(color: Color, occupied: bool, hovered: bool, special: bool) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color.darkened(0.18) if not hovered else color
	style.border_color = Color("ffd47d") if occupied or special else color.lightened(0.25)
	style.set_border_width_all(3 if occupied or special else 1)
	style.set_corner_radius_all(31)
	style.shadow_color = Color(0, 0, 0, 0.5)
	style.shadow_size = 8 if hovered else 4
	style.shadow_offset = Vector2(0, 3)
	return style


func _make_boss_button() -> Button:
	var button := Button.new()
	button.custom_minimum_size = Vector2(220, 108)
	button.size = Vector2(220, 108)
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.tooltip_text = "查看首领情报"
	button.pressed.connect(func() -> void: boss_inspected.emit(_region_id))
	button.add_theme_font_size_override("font_size", 15)
	button.add_theme_color_override("font_color", Color("ffe1a0"))
	button.add_theme_color_override("font_hover_color", Color("fff2cf"))
	var normal := _boss_style(false)
	var hover := _boss_style(true)
	button.add_theme_stylebox_override("normal", normal)
	button.add_theme_stylebox_override("hover", hover)
	button.add_theme_stylebox_override("pressed", hover)
	button.mouse_entered.connect(_animate_tile.bind(button, Vector2(1.035, 1.035)))
	button.mouse_exited.connect(_animate_tile.bind(button, Vector2.ONE))
	return button


func _boss_style(hovered: bool) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color("3d2025") if not hovered else Color("572a30")
	style.border_color = Color("d1a254") if not hovered else Color("ffd47d")
	style.set_border_width_all(2)
	style.set_corner_radius_all(10)
	style.shadow_color = Color(0, 0, 0, 0.62)
	style.shadow_size = 12 if hovered else 8
	style.shadow_offset = Vector2(0, 5)
	return style


func _update_occupants(button: Button, tile_id: int) -> PackedStringArray:
	var names := PackedStringArray()
	var present := {}
	var players: Dictionary = _state.get("players", {})
	for id: String in _state.get("turnOrder", []):
		var player: Dictionary = players.get(id, {})
		if _positions[id] != tile_id:
			continue
		var badge := button.get_node_or_null(NodePath(id)) as PanelContainer
		if badge == null:
			badge = _make_badge()
			badge.name = id
			button.add_child(badge)
		present[id] = true
		badge.position = Vector2(40 - names.size() * 15, -7)
		var style: StyleBoxFlat = badge.get_theme_stylebox("panel")
		style.bg_color = Color.from_string(player.get("color", ""), Color("f0c56a"))
		var label: Label = badge.get_child(0)
		var player_name: String = player.get("name", id)
		label.text = player_name.left(1)
		names.append(player_name)
	for badge in button.get_children():
		if not present.has(String(badge.name)):
			_retire(badge)
	return names


func _make_badge() -> PanelContainer:
	var badge := PanelContainer.new()
	badge.size = Vector2(24, 24)
	badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var style := StyleBoxFlat.new()
	style.border_color = Color("fff3cc")
	style.set_border_width_all(1)
	style.set_corner_radius_all(12)
	badge.add_theme_stylebox_override("panel", style)
	var label := Label.new()
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_size_override("font_size", 11)
	label.add_theme_color_override("font_color", Color("0b0f17"))
	badge.add_child(label)
	return badge


func _layout_board() -> void:
	if _tile_buttons.is_empty() or size.x < 100.0 or size.y < 100.0:
		return
	_points.clear()
	var margin_x := 58.0
	var margin_y := 54.0
	var usable_width := maxf(100.0, size.x - margin_x * 2.0)
	var usable_height := maxf(100.0, size.y - margin_y * 2.0)
	var columns := _columns
	var rows := maxi(3, int((_tile_buttons.size() + 4 - columns * 2) / 2.0))
	var step_x := usable_width / float(columns - 1)
	var step_y := usable_height / float(rows - 1)

	for index in _tile_buttons.size():
		var grid_position := _ring_grid_position(index, columns, rows)
		var center := Vector2(
			margin_x + int(grid_position.x) * step_x,
			margin_y + int(grid_position.y) * step_y,
		)
		_points.append(center)
		var button := _tile_buttons[index]
		button.position = center - button.size * 0.5
	if _boss_button != null:
		_boss_button.position = size * 0.5 - _boss_button.size * 0.5
		_boss_button.pivot_offset = _boss_button.size * 0.5
	queue_redraw()


func _ring_grid_position(index: int, columns: int, rows: int) -> Vector2i:
	var right_start := columns
	var bottom_start := right_start + rows - 2
	var left_start := bottom_start + columns
	if index < right_start:
		return Vector2i(index, 0)
	if index < bottom_start:
		return Vector2i(columns - 1, index - right_start + 1)
	if index < left_start:
		return Vector2i(columns - 1 - (index - bottom_start), rows - 1)
	return Vector2i(0, rows - 2 - (index - left_start))


func _draw() -> void:
	_draw_atmosphere()
	if _points.size() < 2:
		return
	var closed_points := _points.duplicate()
	closed_points.append(_points[0])
	draw_polyline(closed_points, Color(0.03, 0.04, 0.06, 0.76), 13.0, true)
	draw_polyline(closed_points, Color(0.73, 0.61, 0.41, 0.68), 5.0, true)
	if _boss_button != null:
		var boss_center := _boss_button.position + _boss_button.size * 0.5
		draw_dashed_line(_points[0], boss_center, Color(0.83, 0.53, 0.35, 0.82), 4.0, 10.0, true)
	for point in _points:
		draw_circle(point, 7.0, Color("d9bd7d"))


func _draw_atmosphere() -> void:
	var palette: Array = REGION_PALETTES.get(_region_id, REGION_PALETTES["foothill"])
	draw_rect(Rect2(Vector2.ZERO, size), palette[0])
	var horizon := size.y * 0.52
	var back_mountains := PackedVector2Array([
		Vector2(0, size.y), Vector2(0, horizon + 45), Vector2(size.x * 0.18, horizon - 75),
		Vector2(size.x * 0.34, horizon + 20), Vector2(size.x * 0.52, horizon - 130),
		Vector2(size.x * 0.68, horizon + 10), Vector2(size.x * 0.84, horizon - 85),
		Vector2(size.x, horizon + 35), Vector2(size.x, size.y),
	])
	draw_colored_polygon(back_mountains, palette[1])
	var front_mountains := PackedVector2Array([
		Vector2(0, size.y), Vector2(0, size.y * 0.76), Vector2(size.x * 0.23, size.y * 0.57),
		Vector2(size.x * 0.43, size.y * 0.78), Vector2(size.x * 0.66, size.y * 0.5),
		Vector2(size.x * 0.82, size.y * 0.72), Vector2(size.x, size.y * 0.58),
		Vector2(size.x, size.y),
	])
	draw_colored_polygon(front_mountains, palette[2].darkened(0.38))
	for index in 8:
		var x := fmod(float(index * 193 + 71), maxf(size.x, 1.0))
		var y := fmod(float(index * 83 + 37), maxf(size.y * 0.46, 1.0))
		draw_circle(Vector2(x, y), 1.4, Color(1, 0.88, 0.62, 0.52))
	draw_rect(Rect2(0, size.y - 54, size.x, 54), Color(0.04, 0.055, 0.075, 0.55))


func _selected_region() -> Dictionary:
	var game_map: Dictionary = _state.get("map", {})
	for region_value in game_map.get("regions", []):
		if region_value is Dictionary and str(region_value.get("id", "")) == _region_id:
			return region_value
	return {}


func _active_region_id() -> String:
	var position := int(_positions.get(_state.get("activePlayerId", ""), -1))
	var game_map: Dictionary = _state.get("map", {})
	for tile in game_map.get("tiles", []):
		if tile is Dictionary and int(tile.get("id", -2)) == position:
			return str(tile.get("region", ""))
	return "foothill"


func _boss_status(region: Dictionary) -> String:
	var players: Dictionary = _state.get("players", {})
	var active_player: Dictionary = players.get(str(_state.get("activePlayerId", "")), {})
	var stage_progress: Dictionary = active_player.get("stageProgress", {})
	var progress: Dictionary = stage_progress.get(_region_id, {})
	if bool(progress.get("bossDefeated", false)):
		return "已击败 · 通往下一阶段"

	var requirement_labels: Array[String] = []
	var requirements_complete := true
	for requirement_value in region.get("requirements", []):
		if requirement_value is not Dictionary:
			continue
		var requirement: Dictionary = requirement_value
		var requirement_type := str(requirement.get("type", ""))
		var current := int(progress.get("laps", 0)) if requirement_type == "laps" else int(progress.get("eliteVictories", 0))
		var target := int(requirement.get("target", 0))
		requirements_complete = requirements_complete and current >= target
		var progress_name := "绕场进度" if requirement_type == "laps" else "精英胜场"
		requirement_labels.append("%s %d/%d" % [progress_name, current, target])

	if not requirements_complete:
		return " · ".join(PackedStringArray(requirement_labels))
	if bool(progress.get("bossKeyPurchased", false)):
		return "钥匙已备 · 可从守关门挑战"
	return "条件达成 · 在守关门购买钥匙"


func _animate_tile(button: Button, target_scale: Vector2) -> void:
	var tween := button.create_tween()
	tween.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(button, "scale", target_scale, 0.12)

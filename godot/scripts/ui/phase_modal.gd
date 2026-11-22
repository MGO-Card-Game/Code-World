extends PanelContainer

signal action_requested(action: Dictionary)
signal skip_requested

const Palette = preload("res://scripts/ui/ui_theme.gd")
const Catalog = preload("res://scripts/data/content_catalog.gd")

var kicker := Label.new()
var title := Label.new()
var skip := Button.new()
var body_scroll := ScrollContainer.new()
var body := VBoxContainer.new()


## A key identifies one action (including its arguments) across RoomView updates.
class ActionList extends VBoxContainer:
	signal chosen(action: Dictionary)
	var buttons: Dictionary[String, Button] = {}
	var locked := false

	func set_action(key: String, label: String, action: Dictionary, unavailable := false) -> void:
		if key not in buttons:
			var button := Button.new()
			button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			button.pressed.connect(_submit.bind(button, action))
			add_child(button)
			buttons[key] = button
		buttons[key].text = label
		buttons[key].disabled = locked or unavailable

	func keep_order(keys: Array) -> void:
		for key: String in buttons.keys():
			if key not in keys:
				var button := buttons[key]
				remove_child(button)
				button.queue_free()
				buttons.erase(key)
		for index in keys.size():
			var button := buttons[keys[index]]
			if button.get_index() != index:
				move_child(button, index)

	func _submit(button: Button, action: Dictionary) -> void:
		if button.is_visible_in_tree() and not button.disabled:
			chosen.emit(action)


func _init() -> void:
	var style := Palette.panel_style(Palette.BORDER_WARM)
	for edge in [SIDE_LEFT, SIDE_RIGHT, SIDE_TOP, SIDE_BOTTOM]:
		style.set_content_margin(edge, 20)
	add_theme_stylebox_override("panel", style)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 10)
	add_child(column)
	var header := HBoxContainer.new()
	column.add_child(header)
	kicker.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	kicker.add_theme_color_override("font_color", Palette.GOLD)
	header.add_child(kicker)
	skip.text = "跳过演出"
	skip.pressed.connect(skip_requested.emit)
	header.add_child(skip)
	title.add_theme_font_size_override("font_size", 24)
	title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	column.add_child(title)
	column.add_child(HSeparator.new())
	body_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(body_scroll)
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 10)
	body_scroll.add_child(body)


static func card_description(info: Dictionary) -> String:
	var tags := PackedStringArray()
	for keyword: String in info.get("keywords", []):
		tags.append("【%s】" % Catalog.keyword_info(keyword).get("label", keyword))
	tags.append(info.get("description", ""))
	return " ".join(tags)

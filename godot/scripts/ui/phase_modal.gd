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

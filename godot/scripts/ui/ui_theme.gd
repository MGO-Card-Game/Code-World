class_name DiceboundTheme
extends RefCounted

const INK := Color("0b0f17")
const PANEL := Color("151b26")
const PANEL_RAISED := Color("1c2432")
const BORDER := Color("374356")
const BORDER_WARM := Color("705a38")
const TEXT := Color("edf1f7")
const MUTED := Color("9aa7b9")
const GOLD := Color("e7b85d")
const GOLD_BRIGHT := Color("ffd98a")
const DANGER := Color("df806f")


static func build() -> Theme:
	var theme := Theme.new()
	theme.default_font_size = 15

	theme.set_color("font_color", "Label", TEXT)
	theme.set_color("font_shadow_color", "Label", Color(0, 0, 0, 0.52))
	theme.set_constant("shadow_offset_x", "Label", 1)
	theme.set_constant("shadow_offset_y", "Label", 2)

	theme.set_color("font_color", "Button", TEXT)
	theme.set_color("font_hover_color", "Button", GOLD_BRIGHT)
	theme.set_color("font_pressed_color", "Button", INK)
	theme.set_color("font_disabled_color", "Button", Color(0.48, 0.52, 0.59, 0.58))
	theme.set_font_size("font_size", "Button", 15)
	theme.set_stylebox("normal", "Button", _box(PANEL_RAISED, BORDER, 7, 1, 12))
	theme.set_stylebox("hover", "Button", _box(Color("252e3d"), Color("b28a49"), 7, 1, 12))
	theme.set_stylebox("pressed", "Button", _box(GOLD, GOLD_BRIGHT, 7, 1, 12))
	theme.set_stylebox("focus", "Button", _box(Color(0, 0, 0, 0), GOLD, 7, 2, 10))
	theme.set_stylebox("disabled", "Button", _box(Color("111720"), Color("283140"), 7, 1, 12))

	theme.set_color("font_color", "LineEdit", TEXT)
	theme.set_color("font_placeholder_color", "LineEdit", Color(0.55, 0.60, 0.68, 0.72))
	theme.set_color("caret_color", "LineEdit", GOLD)
	theme.set_stylebox("normal", "LineEdit", _box(Color("0e141e"), BORDER, 6, 1, 12))
	theme.set_stylebox("focus", "LineEdit", _box(Color("111923"), GOLD, 6, 1, 12))

	theme.set_color("font_color", "OptionButton", TEXT)
	theme.set_stylebox("normal", "OptionButton", _box(Color("111923"), BORDER, 6, 1, 10))
	theme.set_stylebox("hover", "OptionButton", _box(PANEL_RAISED, Color("9b7844"), 6, 1, 10))
	theme.set_stylebox("pressed", "OptionButton", _box(Color("242c38"), GOLD, 6, 1, 10))

	theme.set_stylebox("panel", "PanelContainer", _box(Color(0.07, 0.09, 0.13, 0.96), BORDER, 10, 1, 0))
	theme.set_stylebox("background", "ProgressBar", _box(Color("0a0e15"), Color("2d3746"), 4, 1, 0))
	theme.set_stylebox("fill", "ProgressBar", _box(Color("b85d50"), Color("ed8a77"), 4, 0, 0))
	theme.set_color("font_color", "ProgressBar", Color.WHITE)
	theme.set_font_size("font_size", "ProgressBar", 11)
	theme.set_stylebox("panel", "TooltipPanel", _box(Color("0b1018"), BORDER_WARM, 6, 1, 10))
	theme.set_color("font_color", "TooltipLabel", TEXT)
	return theme


static func panel_style(accent := Color("374356"), raised := false) -> StyleBoxFlat:
	var color := Color("1a2230") if raised else Color("111720")
	return _box(color, accent, 10, 1, 0)


static func primary_button_style() -> StyleBoxFlat:
	return _box(Color("8d642d"), GOLD_BRIGHT, 8, 1, 16)


static func _box(
	background: Color,
	border: Color,
	radius: int,
	border_width: int,
	content_margin: float,
) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = border
	style.set_border_width_all(border_width)
	style.set_corner_radius_all(radius)
	style.content_margin_left = content_margin
	style.content_margin_top = content_margin
	style.content_margin_right = content_margin
	style.content_margin_bottom = content_margin
	return style

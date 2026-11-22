class_name InspectOverlay
extends "res://scripts/ui/phase_modal.gd"

signal close_requested
signal restore_requested

const MapUse = preload("res://scripts/ui/map_scroll_use.gd")
const Playback = preload("res://scripts/anim/playback_controller.gd")
const Visual = preload("res://scripts/anim/visual_state.gd")

var scroll_heading := Label.new()
var scrolls := ActionList.new()
var equipment_heading := Label.new()
var equipment := ActionList.new()
var blessings := Label.new()
var details := Label.new()
var parameter := SpinBox.new()
var preview := Label.new()
var use_card := Button.new()
var back := Button.new()
var close_button := Button.new()
var restore := Button.new()

var _page := ""
var _player_id := ""
var _selected_id := ""
var _equipment_kind := ""
var _region_id := ""
var _state: Dictionary
var _viewer := ""
var _playback: Playback
var _config := ""
var _configured_id := ""


func _ready() -> void:
	skip.hide()
	for label: Label in [blessings, details, preview]:
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	for control: Control in [details, parameter, preview, use_card, scroll_heading, scrolls, equipment_heading, equipment, blessings]:
		body.add_child(control)
	var footer := HBoxContainer.new()
	body_scroll.get_parent().add_child(footer)
	for button: Button in [back, restore, close_button]:
		footer.add_child(button)
	back.text = "返回资源"
	close_button.text = "关闭"
	restore.text = "返回当前决策"
	close_button.pressed.connect(close_requested.emit)
	restore.pressed.connect(restore_requested.emit)
	back.pressed.connect(func() -> void: open_resources(_player_id, _selected_id))
	scrolls.chosen.connect(func(card: Dictionary) -> void:
		_selected_id = card.id
		_render()
		body_scroll.scroll_vertical = 0)
	equipment.chosen.connect(func(item: Dictionary) -> void:
		_equipment_kind = item.kind
		_page = "equipment"
		body_scroll.scroll_vertical = 0
		_render())
	parameter.step = 1
	parameter.rounded = true
	parameter.update_on_text_changed = true
	parameter.value_changed.connect(func(_value: float) -> void: _update_preview())
	use_card.pressed.connect(_use_selected)


func open_resources(player_id: String, selected_id := "") -> void:
	_page = "resources"
	_player_id = player_id
	_selected_id = selected_id
	body_scroll.scroll_vertical = 0
	show()
	_render()


func open_boss(region_id: String) -> void:
	_page = "boss"
	_region_id = region_id
	body_scroll.scroll_vertical = 0
	show()
	_render()


func dismiss() -> void:
	hide()
	_page = ""
	_selected_id = ""
	_configured_id = ""
	_config = ""
	scrolls.keep_order([])
	equipment.keep_order([])


func sync(state: Dictionary, viewer: String, playback: Playback, can_restore: bool) -> void:
	_state = state
	_viewer = viewer
	_playback = playback
	restore.visible = can_restore
	if visible:
		_render()


func _render() -> void:
	var resources := _page == "resources"
	for control: Control in [scroll_heading, scrolls, equipment_heading, equipment, blessings]:
		control.visible = resources
	back.visible = _page == "equipment"
	details.show()
	_config = ""
	if not resources:
		_show_scroll_controls(false, false)
	match _page:
		"resources":
			_show_resources()
		"equipment":
			var info := Catalog.equipment_info(_equipment_kind)
			kicker.text = "%s · %s" % [info.categoryName, info.rarity]
			title.text = info.name
			details.text = "\n".join(PackedStringArray([info.description]) + _keyword_rules(info.keywords))
		"boss":
			_show_boss()


func _show_resources() -> void:
	var player: Dictionary = _state.players[_player_id]
	var mine := _player_id == _viewer
	kicker.text = "持有资源"
	title.text = player.name
	var pending := _playback.queue.pending_events()
	var ids := []
	var count := 0
	var selected: Dictionary
	for card: Dictionary in player.scrolls:
		if not Visual.is_revealed(card.instanceId, pending):
			continue
		count += 1
		if mine and not card.get("hidden", false):
			ids.append(card.instanceId)
			scrolls.set_action(card.instanceId, Catalog.scroll_name(card.kind), {"id": card.instanceId})
			if card.instanceId == _selected_id:
				selected = card
	scrolls.keep_order(ids)
	scroll_heading.text = "卷轴手牌 · %d 张" % count if mine else "卷轴手牌 · %d 张暗牌" % count
	if selected.is_empty():
		_selected_id = ""
		_configured_id = ""
		_show_scroll_controls(false, false)
		details.text = "选择一张卷轴查看说明" if not ids.is_empty() else ""
	else:
		_show_scroll(Catalog.scroll_info(selected.kind), player)
	details.visible = not details.text.is_empty()
	equipment_heading.text = "装备 · %d 件" % player.equipment.size()
	var equipped := []
	for item: Dictionary in player.equipment:
		equipped.append(item.instanceId)
		equipment.set_action(item.instanceId, Catalog.equipment_info(item.kind).name, {"kind": item.kind})
	equipment.keep_order(equipped)
	var lines := PackedStringArray(["赐福 · %d/%d" % [player.blessings.size(), _state.playerDerived[_player_id].blessingCapacity]])
	for blessing: Dictionary in player.blessings:
		var info := Catalog.blessing_info(blessing.kind)
		lines.append("%s · %s" % [info.name, info.description])
	blessings.text = "\n".join(lines)


func _show_scroll(info: Dictionary, player: Dictionary) -> void:
	var reason := MapUse.disabled_reason(_state, _viewer, _selected_id, info, _playback.is_playing())
	details.text = "%s · %s · %s\n%s" % [info.rarity, info.categoryName, info.name, card_description(info)]
	var configurable: bool = reason.is_empty() and info.mapConfig != "none"
	_show_scroll_controls(true, configurable)
	use_card.disabled = not reason.is_empty()
	use_card.text = "立即使用"
	if not reason.is_empty():
		details.text += "\n" + reason
		return
	_config = info.mapConfig
	if _config == "none":
		return
	var region := _player_region(player)
	var low := 1
	var high: int
	match _config:
		"chooseMovement":
			high = _state.playerDerived[_viewer].movementSides
		"teleport":
			high = info.teleportMaxDistance
		"teleportAnywhere":
			low = region.startIndex
			high = region.endIndex
	var initial: int = player.position if _config == "teleportAnywhere" else high
	var value := int(parameter.value) if _configured_id == _selected_id else initial
	parameter.set_block_signals(true)
	if parameter.min_value != low:
		parameter.min_value = low
	if parameter.max_value != high:
		parameter.max_value = high
	var next_value := clampi(value, low, high)
	if parameter.value != next_value:
		parameter.value = next_value
	parameter.set_block_signals(false)
	var prefix := "目标格" if _config == "teleportAnywhere" else "移动格数"
	if parameter.prefix != prefix:
		parameter.prefix = prefix
	_configured_id = _selected_id
	use_card.text = "确认使用"
	_update_preview()


func _show_scroll_controls(selected: bool, configuring: bool) -> void:
	use_card.visible = selected
	parameter.visible = configuring
	preview.visible = configuring


func _player_region(player: Dictionary) -> Dictionary:
	for region: Dictionary in _state.map.regions:
		if region.startIndex <= player.position and player.position <= region.endIndex:
			return region
	return {}


func _update_preview() -> void:
	if not parameter.visible:
		return
	var target := int(parameter.value)
	if _config != "teleportAnywhere":
		var player: Dictionary = _state.players[_viewer]
		var region := _player_region(player)
		target = wrapi(int(player.position) + target, int(region.startIndex), int(region.endIndex) + 1)
	preview.text = "预计落点 · %02d · %s" % [target, _state.map.tiles[target].label]


func _use_selected() -> void:
	if not use_card.is_visible_in_tree() or use_card.disabled:
		return
	var action := {"type": "useMapScroll", "instanceId": _selected_id}
	if _config != "none":
		action["targetPosition" if _config == "teleportAnywhere" else "distance"] = int(parameter.value)
		close_requested.emit()
	action_requested.emit(action)


func _show_boss() -> void:
	for region: Dictionary in _state.map.regions:
		if region.id != _region_id:
			continue
		var boss := Catalog.enemy_info(region.bossEnemyId)
		kicker.text = "%s · 首领情报" % region.name
		title.text = boss.name
		var lines := PackedStringArray([
			"生命 %d · 攻击 %d · 防御 %d" % [boss.maxHp, boss.attack, boss.defense],
			"攻击骰 %s · 防御骰 %s" % [_dice(boss.attackDice, boss.attackSides), _dice(boss.defenseDice, boss.defenseSides)],
			"特殊能力",
		])
		for ability: Dictionary in boss.abilities:
			lines.append("%s · %s" % [ability.name, ability.description])
			lines.append_array(_keyword_rules(ability.keywords))
		if boss.abilities.is_empty():
			lines.append("无特殊能力")
		lines.append("挑战条件")
		for req: Dictionary in region.requirements:
			lines.append(req.label)
		if region.requirements.is_empty():
			lines.append("无需阶段任务，购买首领钥匙即可挑战")
		lines.append("战败后恢复至半血并返回本阶段检查点。")
		lines.append("胜利即赢得本局。" if region.id == "summit" else "胜利后进入下一阶段。")
		details.text = "\n".join(lines)
		return


static func _keyword_rules(keywords: Array) -> PackedStringArray:
	var rules := PackedStringArray()
	for keyword: String in keywords:
		var info := Catalog.keyword_info(keyword)
		rules.append("【%s】%s" % [info.label, info.rule])
	return rules


static func _dice(count: int, sides: int) -> String:
	return "%d×D%d" % [count, sides] if count > 1 else "D%d" % sides

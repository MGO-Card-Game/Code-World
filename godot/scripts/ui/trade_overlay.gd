class_name TradeOverlay
extends "res://scripts/ui/phase_modal.gd"

const Playback = preload("res://scripts/anim/playback_controller.gd")


class ResourceChoices extends VBoxContainer:
	signal selection_changed

	var selected_ids: Array[String] = []
	var _buttons: Dictionary[String, Button] = {}
	var _empty := Label.new()

	func _init(caption: String) -> void:
		var heading := Label.new()
		heading.text = caption
		add_child(heading)
		_empty.text = "没有可报价的" + caption
		add_child(_empty)

	func set_cards(cards: Dictionary) -> void:
		for id: String in _buttons.keys():
			if id not in cards:
				var old := _buttons[id]
				remove_child(old)
				old.queue_free()
				_buttons.erase(id)
				selected_ids.erase(id)
		_empty.visible = cards.is_empty()
		var index := 2 # Heading and empty notice precede the cards.
		for id: String in cards:
			if id not in _buttons:
				var button := Button.new()
				button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				button.toggle_mode = true
				button.pressed.connect(_toggle.bind(id))
				add_child(button)
				_buttons[id] = button
			var button := _buttons[id]
			button.text = cards[id]
			if button.get_index() != index:
				move_child(button, index)
			index += 1

	func _toggle(id: String) -> void:
		if id in selected_ids:
			selected_ids.erase(id)
		else:
			selected_ids.append(id)
		_buttons[id].set_pressed_no_signal(id in selected_ids)
		selection_changed.emit()


var details := Label.new()
var error_label := Label.new()
var summary := Label.new()
var waiting := Label.new()
var editor := VBoxContainer.new()
var gold_label := Label.new()
var gold := SpinBox.new()
var scrolls := ResourceChoices.new("卷轴")
var equipment := ResourceChoices.new("装备")
var primary := Button.new()
var cancel := Button.new()
var _phase_key: Array = []
var _side := ""
var _own_status := ""


func _ready() -> void:
	skip.hide()
	for label: Label in [details, error_label, summary, waiting]:
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		body.add_child(label)
	error_label.add_theme_color_override("font_color", Palette.DANGER)
	waiting.add_theme_color_override("font_color", Palette.MUTED)
	body.add_child(editor)
	gold.min_value = 0
	gold.step = 1
	gold.rounded = true
	gold.update_on_text_changed = true
	for control: Control in [gold_label, gold, scrolls, equipment]:
		editor.add_child(control)
	cancel.text = "取消交易"
	body.add_child(primary)
	body.add_child(cancel)
	primary.pressed.connect(_on_primary)
	cancel.pressed.connect(_on_cancel)
	gold.value_changed.connect(func(_value: float) -> void: _update_submit())
	scrolls.selection_changed.connect(_update_submit)
	equipment.selection_changed.connect(_update_submit)


func set_game_state(state: Dictionary, viewer: String, playback: Playback) -> void:
	var kind: String = "" if state.is_empty() else state.phase.kind
	if kind not in ["tradeOffer", "tradeConfirmation"]:
		_set_phase_key([])
		hide()
		return
	var trade: Dictionary = state.phase.trade
	_set_phase_key([kind, state.turn, trade.tileIndex, trade.aPlayerId, trade.bPlayerId, viewer])
	if viewer == trade.aPlayerId:
		_side = "a"
	elif viewer == trade.bPlayerId:
		_side = "b"
	visible = playback.lingering_battle.is_empty() and not playback.is_playing()
	summary.visible = kind == "tradeConfirmation"
	if kind == "tradeOffer":
		_show_offer(state, trade, viewer)
	else:
		_show_confirmation(state, trade)


func _set_phase_key(key: Array) -> void:
	if key == _phase_key:
		return
	_phase_key = key
	_side = ""
	_own_status = ""
	_reset_draft()
	error_label.text = ""
	summary.text = ""
	body_scroll.scroll_vertical = 0


func _reset_draft() -> void:
	gold.value = 0
	scrolls.set_cards({})
	equipment.set_cards({})


func _show_offer(state: Dictionary, trade: Dictionary, viewer: String) -> void:
	kicker.text = "秘密报价"
	title.text = "准备你的交易报价"
	details.text = "双方提交前互相看不到内容；报价都提交后会公开，再进行最终确认。"
	error_label.text = trade.get("error", "")
	error_label.visible = not error_label.text.is_empty()
	var status: String = "" if _side.is_empty() else trade["offer" + _side.to_upper()].status
	if status == "pending" and _own_status not in ["", "pending"]:
		_reset_draft()
	_own_status = status
	editor.visible = status == "pending"
	primary.visible = editor.visible
	cancel.visible = not _side.is_empty()
	waiting.visible = not editor.visible
	waiting.text = "等待交易双方提交报价……" if _side.is_empty() else "报价已提交，等待对方……"
	if not editor.visible:
		return
	var player: Dictionary = state.players[viewer]
	gold_label.text = "金币（持有 %d）" % player.gold
	gold.max_value = player.gold
	var scroll_cards := {}
	for item: Dictionary in player.scrolls:
		if not item.get("hidden", false):
			scroll_cards[item.instanceId] = _card_text(Catalog.scroll_info(item.kind))
	scrolls.set_cards(scroll_cards)
	var equipment_cards := {}
	for item: Dictionary in player.equipment:
		equipment_cards[item.instanceId] = _card_text(Catalog.equipment_info(item.kind))
	equipment.set_cards(equipment_cards)
	primary.text = "提交报价"
	_update_submit()


static func _card_text(info: Dictionary) -> String:
	return "%s\n%s" % [info.name, card_description(info)]


func _update_submit() -> void:
	primary.disabled = gold.value == 0 and scrolls.selected_ids.is_empty() and equipment.selected_ids.is_empty()


func _show_confirmation(state: Dictionary, trade: Dictionary) -> void:
	kicker.text = "最终确认"
	title.text = "核对双方报价"
	details.text = "两人都确认后才会原子交换；任一方取消，所有资源保持原样。"
	summary.text = "%s\n\n%s" % [
		_offer_summary(state.players[trade.aPlayerId].name, trade.offerA, trade.confirmationA),
		_offer_summary(state.players[trade.bPlayerId].name, trade.offerB, trade.confirmationB),
	]
	editor.hide()
	error_label.hide()
	primary.text = "确认交易"
	primary.disabled = false
	primary.visible = not _side.is_empty() and trade["confirmation" + _side.to_upper()] == "pending"
	cancel.visible = primary.visible
	waiting.visible = not primary.visible
	waiting.text = "等待尚未确认的一方……"


static func _offer_summary(player_name: String, offer: Dictionary, confirmation: String) -> String:
	var lines := PackedStringArray(["%s交出" % player_name])
	if offer.gold > 0:
		lines.append("金币 · %d" % offer.gold)
	for item: Dictionary in offer.scrolls:
		lines.append("卷轴 · %s" % Catalog.scroll_name(item.kind))
	for item: Dictionary in offer.equipment:
		lines.append("装备 · %s" % Catalog.equipment_info(item.kind).name)
	lines.append("%s：%s" % [player_name, "已确认" if confirmation == "accepted" else "待确认"])
	return "\n".join(lines)


func _on_primary() -> void:
	if not primary.is_visible_in_tree() or primary.disabled:
		return
	if _phase_key[0] == "tradeOffer":
		action_requested.emit({"type": "submitTradeOffer", "side": _side, "gold": int(gold.value),
			"scrollInstanceIds": scrolls.selected_ids.duplicate(), "equipmentInstanceIds": equipment.selected_ids.duplicate()})
	else:
		action_requested.emit({"type": "confirmTrade", "side": _side, "accept": true})


func _on_cancel() -> void:
	if not cancel.is_visible_in_tree():
		return
	if _phase_key[0] == "tradeOffer":
		action_requested.emit({"type": "cancelTrade", "side": _side})
	else:
		action_requested.emit({"type": "confirmTrade", "side": _side, "accept": false})

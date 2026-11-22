class_name BattlePanel
extends "res://scripts/ui/phase_modal.gd"

const Playback = preload("res://scripts/anim/playback_controller.gd")
const Visual = preload("res://scripts/anim/visual_state.gd")
const KIND_LABELS := {"pve": "山路遭遇", "boss": "最终决战", "pvp": "旅者相遇战"}

var initiative := Label.new()
var side_a := CombatantCard.new()
var side_b := CombatantCard.new()
var prompt := Label.new()
var hand := HFlowContainer.new()
var confirm := Button.new()
var log_text := Label.new()
var _buttons: Dictionary[String, Button] = {}
var _selected: Array[String] = []
var _draft_key: Array = []
var _choosing_side := ""


class CombatantCard extends PanelContainer:
	var heading := Label.new()
	var health := Label.new()
	var bar := ProgressBar.new()
	var change := Label.new()
	var status := Label.new()
	var roll := Label.new()

	func _init() -> void:
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var style := Palette.panel_style(Palette.BORDER, true)
		for edge in [SIDE_LEFT, SIDE_RIGHT, SIDE_TOP, SIDE_BOTTOM]:
			style.set_content_margin(edge, 12)
		add_theme_stylebox_override("panel", style)
		var column := VBoxContainer.new()
		add_child(column)
		heading.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		heading.add_theme_font_size_override("font_size", 18)
		column.add_child(heading)
		var line := HBoxContainer.new()
		column.add_child(line)
		health.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(health)
		line.add_child(change)
		bar.show_percentage = false
		bar.custom_minimum_size.y = 10
		column.add_child(bar)
		status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		status.add_theme_color_override("font_color", Palette.GOLD_BRIGHT)
		column.add_child(status)
		roll.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		column.add_child(roll)

	func show_stats(actor: Dictionary, hp: int, side: String, attacker: String, event: Dictionary, dice: Dictionary) -> void:
		var attacking := side == attacker
		var role := "攻击" if attacking else "防守"
		heading.text = "%s · %s方" % [actor.get("name", "—"), role]
		bar.max_value = maxi(1, int(actor.get("maxHp", 1)))
		bar.value = hp
		health.text = "生命  %d / %d" % [hp, bar.max_value]
		var hit := Visual.active_damage(event)
		var heal := Visual.active_healing(event)
		change.text = ""
		if hit.get("targetSide") == side and hit.get("amount", 0) > 0:
			change.text = "-%d" % hit.amount
			change.add_theme_color_override("font_color", Palette.DANGER)
		elif heal.get("targetSide") == side and heal.get("amount", 0) > 0:
			change.text = "+%d" % heal.amount
			change.add_theme_color_override("font_color", Color("81d7a2"))
		change.visible = not change.text.is_empty()

		var faces := PackedStringArray()
		if dice.get("side") != side:
			dice = {}
		for face in dice.get("dice", []):
			faces.append(str(int(face)))
		var subtotal := "—" if faces.is_empty() else str(int(dice.total))
		roll.text = "%s · D%d   %s   合计 %s" % [
			"攻击" if attacking else "防御", int(dice.get("sides", 6)),
			"—" if faces.is_empty() else " + ".join(faces), subtotal,
		]


func _ready() -> void:
	body.add_child(initiative)
	var sides := HBoxContainer.new()
	sides.add_theme_constant_override("separation", 12)
	body.add_child(sides)
	sides.add_child(side_a)
	sides.add_child(side_b)
	prompt.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(prompt)
	body.add_child(hand)
	body.add_child(confirm)
	confirm.add_theme_stylebox_override("normal", Palette.primary_button_style())
	confirm.pressed.connect(_submit)
	var log_heading := Label.new()
	log_heading.text = "战斗日志"
	body.add_child(log_heading)
	var log_scroll := ScrollContainer.new()
	log_scroll.custom_minimum_size.y = 100
	log_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(log_scroll)
	log_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	log_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	log_text.add_theme_color_override("font_color", Palette.MUTED)
	log_scroll.add_child(log_text)


func set_game_state(state: Dictionary, viewer: String, playback: Playback) -> void:
	var battle := playback.lingering_battle
	visible = not battle.is_empty()
	if not visible:
		_draft_key.clear()
		_selected.clear()
		_sync_cards({}, false)
		return
	var players: Dictionary = state.get("players", {})
	var a: Dictionary = players.get(battle.get("aPlayerId", ""), {})
	var b: Dictionary = players.get(battle.get("bPlayerId", ""), {})
	if battle.has("enemyId"):
		b = playback.lingering_battle_enemy
		if b.is_empty():
			b = Catalog.enemy_info(battle.enemyId)

	var pending := playback.queue.pending_events()
	var current := playback.queue.current_event()
	var timeline := Visual.battle_timeline(playback.queue.seen_events())
	var attacker := Visual.visual_attacker(battle, pending)
	var shown_round := Visual.visual_battle_round(battle, pending)
	kicker.text = KIND_LABELS.get(battle.get("kind", ""), "山路遭遇")
	title.text = "%s VS %s" % [a.get("name", "—"), b.get("name", "—")]
	initiative.text = "先攻 %d : %d   ·   第 %d 轮" % [battle.get("initiativeA", 0), battle.get("initiativeB", 0), shown_round]
	var attack := Visual.visual_roll("attack", timeline, pending)
	var defense := Visual.visual_roll("defense", timeline, pending)
	side_a.show_stats(a, Visual.visual_battle_hp(battle, "a", pending), "a", attacker, current, attack if attacker == "a" else defense)
	side_b.show_stats(b, Visual.visual_battle_hp(battle, "b", pending), "b", attacker, current, attack if attacker == "b" else defense)
	_show_status(battle)
	log_text.text = "\n".join(battle.get("log", []))
	skip.visible = playback.is_playing()

	var choosing_side := ""
	if state.phase.kind == "battle" and shown_round == int(battle.get("round", 0)):
		choosing_side = _pending_side(battle)
	var key := [
		playback.battle_instance, state.get("turn"), battle.get("kind"), battle.get("aPlayerId"),
		battle.get("bPlayerId"), battle.get("enemyId"), battle.get("round"), choosing_side, viewer,
	]
	if _draft_key != key:
		_selected.clear()
		_draft_key = key
	_choosing_side = choosing_side
	_show_choice(state, battle, viewer, playback.is_playing())


func _show_status(battle: Dictionary) -> void:
	var penalty := int(battle.get("nextPlayerAttackPenalty", 0))
	side_a.status.visible = penalty > 0
	side_a.status.text = "霜冻侵蚀 · 下一次攻击 -%d" % penalty if penalty > 0 else ""
	var lines := PackedStringArray()
	if battle.get("enemyId") == "uncannyFlesh":
		lines.append("崩解倒计时 %d / 3 次攻击" % mini(3, int(battle.get("enemyAttacksPerformed", 0))))
	var affix := Catalog.affix_info(battle.get("enemyAffix", ""))
	if not affix.is_empty():
		lines.append("%s · 怪物词条 · %s  %s" % [affix.rarity, affix.name, card_description(affix)])
	side_b.status.text = "\n".join(lines)
	side_b.status.visible = not lines.is_empty()


func _pending_side(battle: Dictionary) -> String:
	var attacker: String = battle.get("attacker", "a")
	for side: String in [attacker, "b" if attacker == "a" else "a"]:
		if battle.get("choice" + side.to_upper(), {}).get("status") == "pending":
			return side
	return ""


func _show_choice(state: Dictionary, battle: Dictionary, viewer: String, playing: bool) -> void:
	var owner: String = battle.get(_choosing_side + "PlayerId", "")
	var mine := not _choosing_side.is_empty() and owner == viewer and not viewer.is_empty()
	var cards := {}
	prompt.visible = not _choosing_side.is_empty()
	if mine:
		var timing := "beforeAttackRoll" if _choosing_side == battle.attacker else "beforeDefenseRoll"
		var allowed: Array = state.get("viewerPlayableScrollIds", {}).get(timing, [])
		for scroll: Dictionary in state.players[viewer].get("scrolls", []):
			if scroll.get("hidden", false) or not scroll.has("kind"):
				continue
			var info := Catalog.scroll_info(scroll.kind)
			var playable: bool = scroll.instanceId in allowed if state.has("viewerPlayableScrollIds") else timing in info.get("timings", [])
			if playable:
				cards[scroll.instanceId] = info
		prompt.text = "选择本轮卷轴，可多选。" if not cards.is_empty() else "本轮无可用卷轴"
		var other := "choiceB" if _choosing_side == "a" else "choiceA"
		if battle.get(other, {}).get("status", "pending") != "pending":
			prompt.text += "  对方已提交"
	elif prompt.visible:
		prompt.text = "等待%s决定是否使用卷轴……" % state.players.get(owner, {}).get("name", "旅者")
	_sync_cards(cards, playing)
	hand.visible = mine and not cards.is_empty()
	confirm.visible = mine
	confirm.disabled = playing or not mine
	_update_confirm_text()


func _sync_cards(cards: Dictionary, playing: bool) -> void:
	for id: String in _buttons.keys():
		if not cards.has(id):
			var old := _buttons[id]
			hand.remove_child(old)
			old.queue_free()
			_buttons.erase(id)
			_selected.erase(id)
	var index := 0
	for id: String in cards:
		if not _buttons.has(id):
			var button := Button.new()
			button.custom_minimum_size.x = 220
			button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			button.toggle_mode = true
			button.pressed.connect(_toggle.bind(id))
			hand.add_child(button)
			_buttons[id] = button
		var button := _buttons[id]
		var info: Dictionary = cards[id]
		button.text = "%s · %s · %s\n%s" % [info.name, info.rarity, info.categorySigil, card_description(info)]
		button.disabled = playing
		button.set_pressed_no_signal(id in _selected)
		if button.get_index() != index:
			hand.move_child(button, index)
		index += 1


func _toggle(id: String) -> void:
	if not is_visible_in_tree() or not _buttons.has(id) or _buttons[id].disabled:
		return
	if id in _selected:
		_selected.erase(id)
	else:
		_selected.append(id)
	_buttons[id].set_pressed_no_signal(id in _selected)
	_update_confirm_text()


func _update_confirm_text() -> void:
	confirm.text = "直接投骰" if _selected.is_empty() else "打出并确认 · %d" % _selected.size()


func _submit() -> void:
	if confirm.is_visible_in_tree() and not confirm.disabled:
		action_requested.emit({"type": "submitScrollChoice", "side": _choosing_side, "instanceIds": _selected.duplicate()})

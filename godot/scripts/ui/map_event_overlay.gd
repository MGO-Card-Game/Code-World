class_name MapEventOverlay
extends "res://scripts/ui/phase_modal.gd"

const Playback = preload("res://scripts/anim/playback_controller.gd")
const Router = preload("res://scripts/ui/phase_overlay_router.gd")
const CATEGORIES := {"recovery": "休整", "hazard": "险情", "reward": "机遇", "boon": "际遇", "casino": "赌局"}
const CONTINUE_LABELS := {
	"casino": "走进赌场", "equipmentChoice": "处理装备", "mapEventScrollChoice": "选择卷轴",
	"mapEventEquipmentChoice": "决定是否交易", "mapEventTravelChoice": "决定是否启程",
	"mapEventHarmonyChoice": "选择调和方向", "resolveTile": "追踪精英",
}

var details := Label.new()
var waiting := Label.new()
var options := ActionList.new()


func _ready() -> void:
	details.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(details)
	body.add_child(waiting)
	body.add_child(options)
	options.chosen.connect(action_requested.emit)


func set_game_state(state: Dictionary, viewer: String, playback: Playback, router: Router) -> void:
	var phase: Dictionary = state.get("phase", {})
	var kind: String = phase.get("kind", "")
	var key := []
	var decision: Dictionary
	var ready_to_show := not playback.is_playing()
	match kind:
		"mapEventNotice":
			decision = phase.notice
			key = [kind, state.turn, viewer, decision.playerId, decision.kind, decision.get("revealAfterEventId")]
			ready_to_show = router.presentation_ready(decision.get("revealAfterEventId"))
		"mapEventScrollChoice", "mapEventEquipmentChoice", "mapEventTravelChoice", "mapEventHarmonyChoice":
			decision = phase.choice
			key = [kind, state.turn, viewer, decision.playerId, decision.eventKind, decision.effectIndex,
				decision.get("targetTileIndex")]
	if key != phase_key:
		options.keep_order([])
		body_scroll.scroll_vertical = 0
		phase_key = key
	visible = not key.is_empty() and playback.lingering_battle.is_empty() and ready_to_show
	if not visible:
		return
	var player: Dictionary = state.players[decision.playerId]
	var mine: bool = decision.playerId == viewer
	var event := Catalog.map_event_info(decision.kind if kind == "mapEventNotice" else decision.eventKind)
	waiting.visible = not mine
	options.visible = mine
	options.locked = playback.is_playing()
	skip.visible = options.locked
	kicker.text = event.name
	waiting.text = "等待%s确认……" % player.name
	match kind:
		"mapEventNotice":
			kicker.text = CATEGORIES[event.category]
			title.text = event.name
			var lines := PackedStringArray([event.description])
			for line: Dictionary in decision.lines:
				lines.append(line.text)
			details.text = "\n".join(lines)
			if mine:
				var label: String = CONTINUE_LABELS.get(decision.get("resume", {}).get("kind", ""), "继续前行")
				options.set_action("ack", "事件结算中……" if options.locked else label, {"type": "acknowledgeMapEvent"})
		"mapEventScrollChoice", "mapEventEquipmentChoice":
			_show_cards(kind == "mapEventScrollChoice", player, decision, mine)
		"mapEventTravelChoice":
			var target: String = state.map.tiles[int(decision.targetTileIndex)].label
			title.text = "%s是否搭乘商队？" % player.name
			details.text = "支付 %d 金币前往%s并进入商店。当前持有 %d 金币。" % [decision.price, target, player.gold]
			waiting.text = "等待%s决定是否启程……" % player.name
			if mine:
				options.set_action("accept", "支付 %d 金币 · 前往%s" % [decision.price, target],
					{"type": "chooseMapEventTravel", "accept": true}, player.gold < decision.price)
				options.set_action("decline", "放弃行程", {"type": "chooseMapEventTravel", "accept": false})
		"mapEventHarmonyChoice":
			var amount: int = decision.amount
			title.text = "%s要如何调和攻守？" % player.name
			details.text = "当前基础攻击 %d，基础防御 %d。可以转换 %d 点属性。" % [player.baseAttack, player.baseDefense, amount]
			waiting.text = "等待%s选择调和方向……" % player.name
			if mine:
				options.set_action("attack", "基础攻击 -%d → 基础防御 +%d" % [amount, amount],
					{"type": "chooseMapEventHarmony", "option": "attackToDefense"}, player.baseAttack < amount)
				options.set_action("defense", "基础防御 -%d → 基础攻击 +%d" % [amount, amount],
					{"type": "chooseMapEventHarmony", "option": "defenseToAttack"}, player.baseDefense < amount)
				options.set_action("decline", "放弃调和", {"type": "chooseMapEventHarmony", "option": "decline"})


func _show_cards(scrolls: bool, player: Dictionary, choice: Dictionary, mine: bool) -> void:
	title.text = ("%s选择要复制的卷轴" if scrolls else "%s是否交出一件装备？") % player.name
	details.text = "保留原卷轴，复制品加入手牌。" if scrolls else "交出的装备会永久失去，基础防御永久 +1。"
	waiting.text = ("等待%s选择卷轴……" if scrolls else "等待%s决定是否交易……") % player.name
	if not mine:
		return
	var keys := []
	for card: Dictionary in (player.scrolls if scrolls else player.equipment):
		if card.instanceId not in choice.candidateIds or card.get("hidden", false):
			continue
		var info := Catalog.scroll_info(card.kind) if scrolls else Catalog.equipment_info(card.kind)
		keys.append(card.instanceId)
		var verb := "复制" if scrolls else "交出 · %s" % info.categoryName
		options.set_action(card.instanceId, "%s · %s\n%s" % [verb, info.name, card_description(info)],
			{"type": "chooseMapEventScroll" if scrolls else "chooseMapEventEquipment", "instanceId": card.instanceId})
	if not scrolls:
		keys.append("decline")
		options.set_action("decline", "拒绝交易", {"type": "chooseMapEventEquipment"})
	options.keep_order(keys)

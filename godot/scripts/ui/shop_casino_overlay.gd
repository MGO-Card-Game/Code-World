class_name ShopCasinoOverlay
extends "res://scripts/ui/phase_modal.gd"

signal camp_exit_requested

const Playback = preload("res://scripts/anim/playback_controller.gd")
const RESULT_TITLES := {"bust": "一无所获", "gold": "金币入袋", "scroll": "获得卷轴", "equipment": "获得装备", "statGrowth": "永久成长"}

var details := Label.new()
var options := ActionList.new()
var waiting := Label.new()
var leave_camp := Button.new()
var camp_shop_open := false
var _camp_turn := -1
var _known_scrolls := {}
var _receipt := ""
var _receipt_after_playback := false


func _ready() -> void:
	skip.hide()
	details.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	details.add_theme_constant_override("line_spacing", 6)
	waiting.add_theme_color_override("font_color", Palette.MUTED)
	leave_camp.text = "离开旅商"
	for control: Control in [details, options, waiting, leave_camp]:
		body.add_child(control)
	options.chosen.connect(action_requested.emit)
	leave_camp.pressed.connect(func() -> void:
		if leave_camp.is_visible_in_tree():
			camp_exit_requested.emit())


func open_camp_shop(state: Dictionary) -> void:
	camp_shop_open = true
	_camp_turn = state.turn
	var player: Dictionary = state.players[state.activePlayerId]
	for card: Dictionary in player.scrolls:
		_known_scrolls[card.instanceId] = true


func close_camp_shop() -> void:
	camp_shop_open = false
	_camp_turn = -1
	_known_scrolls.clear()
	_receipt = ""
	_receipt_after_playback = false


func set_game_state(state: Dictionary, viewer: String, playback: Playback) -> void:
	var kind: String = "" if state.is_empty() else state.phase.kind
	var playing := playback.is_playing()
	var battle_clear := playback.lingering_battle.is_empty()
	if _camp_turn >= 0:
		if kind != "turnComplete" or state.turn != _camp_turn or not state.get("canUseCampShop", false) or not battle_clear:
			close_camp_shop()
		else:
			_sync_camp_purchase(state.players[viewer], playing)
	visible = battle_clear and not playing and (kind in ["shop", "casino"] or camp_shop_open)
	if not visible:
		return
	leave_camp.visible = camp_shop_open
	waiting.hide()
	match kind:
		"shop":
			var shop: Dictionary = state.phase.shop
			_show_shop(shop, state.players[shop.playerId], shop.playerId == viewer)
		"casino":
			var casino: Dictionary = state.phase.casino
			_show_casino(casino, state.players[casino.playerId], casino.playerId == viewer, state.casinoSpinPrice)
		"turnComplete":
			_show_camp(state.players[viewer])


func _sync_camp_purchase(player: Dictionary, playing: bool) -> void:
	for card: Dictionary in player.scrolls:
		if card.instanceId not in _known_scrolls:
			_known_scrolls[card.instanceId] = true
			var info := Catalog.scroll_info(card.kind)
			_receipt = "获得卷轴 · %s\n%s" % [info.name, card_description(info)]
			_receipt_after_playback = playing
	if playing:
		camp_shop_open = false
		if not _receipt_after_playback:
			close_camp_shop()
	elif _receipt_after_playback:
		# The server delivered the new card together with its purchase animation.
		camp_shop_open = true
		_receipt_after_playback = false


func _show_camp(player: Dictionary) -> void:
	var prices := Catalog.camp_shop_info()
	kicker.text = "安全营地 · 旅商补给"
	title.text = "%s持有 %d 金币" % [player.name, player.gold]
	details.text = "生命 %d/%d" % [player.hp, player.maxHp]
	if not _receipt.is_empty():
		details.text += "\n" + _receipt
	options.set_action("scroll", "神秘卷轴 · %d 金币" % prices.scrollPrice,
		{"type": "buyShopItem", "item": "scroll"}, player.gold < prices.scrollPrice)
	options.set_action("healing", "恢复生命 · %d 点 · %d 金币" % [prices.healingAmount, prices.healingPrice],
		{"type": "buyShopItem", "item": "healing"}, player.hp >= player.maxHp or player.gold < prices.healingPrice)
	options.keep_order(["scroll", "healing"])


func _show_shop(shop: Dictionary, player: Dictionary, mine: bool) -> void:
	kicker.text = "沿途商栈"
	title.text = "%s正在挑选商品" % player.name
	details.text = "持有 %d 金币" % player.gold
	var keys := []
	for offer: Dictionary in shop.offers:
		var key := "offer-%d" % offer.id
		keys.append(key)
		var sold: bool = offer.get("sold", false)
		var price := "已售罄" if sold else "%d 金币" % offer.price
		if not sold and mine and player.gold < offer.price:
			price += " · 金币不足"
		options.set_action(key, "%s\n%s" % [_stock_text(offer.stock), price],
			{"type": "buyShopOffer", "offerId": int(offer.id)}, not mine or sold or player.gold < offer.price)
	if mine:
		keys.append("leaveShop")
		options.set_action("leaveShop", "离开商栈", {"type": "leaveShop"})
	else:
		waiting.text = "等待%s选购……" % player.name
		waiting.show()
	options.keep_order(keys)


func _stock_text(stock: Dictionary) -> String:
	var info: Dictionary
	var category: String
	match stock.type:
		"scroll":
			if not stock.has("kind"):
				return "一张卷轴 · 牌面仅对正在选购的玩家可见"
			info = Catalog.scroll_info(stock.kind)
			category = "明牌卷轴"
		"equipment":
			info = Catalog.equipment_info(stock.kind)
			category = info.categoryName
		"statGrowth":
			info = Catalog.stat_growth_info(stock.option)
			return "永久成长 · %s\n%s" % [info.name, info.description]
	return "%s · %s · %s\n%s" % [category, info.rarity, info.name, card_description(info)]


func _show_casino(casino: Dictionary, player: Dictionary, mine: bool, price: int) -> void:
	var result_ready := casino.has("result")
	if result_ready:
		var result: Dictionary = casino.result
		kicker.text = "赌场转盘 · 第 %d 次转动" % casino.spins
		title.text = RESULT_TITLES[result.kind]
		match result.kind:
			"bust":
				details.text = "投入 %d 金币，指针停在空格。" % result.price
			"gold":
				details.text = "投入 %d 金币，赢得 %d 金币。" % [result.price, result.amount]
			"scroll", "equipment":
				details.text = "%s已放入行囊。" % result.name
			"statGrowth":
				var growth := Catalog.stat_growth_info(result.option)
				details.text = "%s\n%s" % [growth.name, growth.description]
	else:
		kicker.text = "赌场转盘 · 第 %d 次转动" % (casino.spins + 1)
		title.text = "%s持有 %d 金币" % [player.name, player.gold]
		details.text = "本次价格 · %d 金币" % price
	if not mine:
		waiting.text = "等待%s确认转盘结果……" % player.name if result_ready else "等待%s决定是否转动轮盘……" % player.name
		waiting.show()
		options.keep_order([])
	elif result_ready:
		options.set_action("result", "确认结果", {"type": "acknowledgeCasinoResult"})
		options.keep_order(["result"])
	else:
		options.set_action("spin", "转动轮盘", {"type": "spinCasino"}, player.gold < price)
		options.set_action("leaveCasino", "离开赌场", {"type": "leaveCasino"})
		options.keep_order(["spin", "leaveCasino"])

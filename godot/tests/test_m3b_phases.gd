extends RefCounted

const Catalog = preload("res://scripts/data/content_catalog.gd")
const Router = preload("res://scripts/ui/phase_overlay_router.gd")
const Outcome = preload("res://scripts/ui/outcome_overlay.gd")
const ShopCasino = preload("res://scripts/ui/shop_casino_overlay.gd")
const A := "player1"
const B := "player2"

var check: Callable
var main: Node
var dock: Router
var outcome: Outcome
var shop: ShopCasino
var state: Dictionary
var hero: Dictionary
var actions: Array[Dictionary] = []


func _init(check_fn: Callable, scene: Node, fixture: Dictionary) -> void:
	check = check_fn
	main = scene
	dock = main.router
	outcome = main.outcome_overlay
	shop = main.shop_casino_overlay
	state = fixture
	hero = state.players[A]


func run() -> void:
	dock.dispatch_callable = func(action: Dictionary) -> void: actions.append(action)
	_test_dock_and_gate()
	_test_blessings()
	_test_treasure()
	_test_shop()
	_test_camp()
	_test_casino()
	main.get_node("/root/GameClient").room_closed.emit("房间已关闭")
	check.call(not main.overlay_host.visible and not shop.visible, "leaving the room closes casino")


func _broadcast(viewer := A) -> void:
	var view := state.duplicate(true)
	if viewer != view.activePlayerId or view.phase.kind not in ["awaitingRoll", "turnComplete"]:
		view.erase("viewerPlayableScrollIds")
	if view.phase.kind == "battle":
		view.viewerPlayableScrollIds = {"beforeAttackRoll": [], "beforeDefenseRoll": []}
	for id: String in state.turnOrder:
		if id != viewer:
			view.players[id].scrolls = state.players[id].scrolls.map(func(card: Dictionary) -> Dictionary:
				return {"hidden": true, "instanceId": card.instanceId})
	if viewer != A:
		view.erase("canOpenBossGate")
		view.erase("canUseCampShop")
		match view.phase.kind:
			"shop":
				for offer: Dictionary in view.phase.shop.offers:
					if offer.stock.type == "scroll":
						offer.stock.erase("kind")
			"treasureReward":
				for reward: Dictionary in view.phase.notice.rewards:
					reward.name = reward.publicName
			"casino":
				var result: Dictionary = view.phase.casino.get("result", {})
				if result.get("kind") == "scroll":
					result.name = result.publicName
	var room := {"code": "MTHRB", "status": "playing", "capacity": 2, "hostSeat": B, "seat": viewer, "state": view,
		"members": [{"seat": A, "name": hero.name, "connected": true}, {"seat": B, "name": state.players[B].name, "connected": true}]}
	main.get_node("/root/GameClient").room_changed.emit(JSON.parse_string(JSON.stringify(room)))


func _press(button: Button, expected: Dictionary) -> void:
	check.call(button.is_visible_in_tree() and not button.disabled, "available M3b action %s" % expected)
	actions.clear()
	button.pressed.emit()
	check.call(actions == [expected], "exact action %s, received %s" % [expected, actions])


func _locked(button: Button) -> void:
	check.call(button.is_visible_in_tree() and button.disabled, "visible disabled action: " + button.text)
	actions.clear()
	button.pressed.emit()
	check.call(actions.is_empty(), "disabled action cannot dispatch")


func _events(events: Array) -> void:
	state.lastEvents = events
	for event: Dictionary in events:
		event.id = state.nextEventId
		state.nextEventId += 1


func _narration() -> Dictionary:
	return {"type": "narration", "text": "旅者行动中"}


func _step() -> void:
	main._process(main.playback.queue.remaining_ms() / 1000.0)


func _test_dock_and_gate() -> void:
	_broadcast()
	check.call(dock.primary_action.text == "投掷 D6" and not dock.boss_gate.visible, "default movement die, gate unavailable")
	hero.equipment = [{"instanceId": "boots", "kind": "postRoadBoots"}, {"instanceId": "bracelet", "kind": "inkBambooBracelet"}]
	state.playerDerived[A].movementSides = 8
	state.playerDerived[A].movementDiceCount = 2
	state.map.regions[0].requirements.append({"type": "eliteVictories", "target": 1, "label": "精英胜场"})
	var progress: Dictionary = hero.stageProgress.foothill
	progress.laps = 3
	progress.eliteVictories = 1
	state.canOpenBossGate = true
	_events([_narration()])
	_broadcast()
	check.call(not dock.boss_gate.visible and dock.primary_action.disabled, "gate waits during playback")
	_step()
	check.call(dock.primary_action.text == "投掷 2D8" and dock.boss_gate.text == "首领入口", "dock reads published dice")
	_press(dock.boss_gate, {"type": "openBossGate"})
	_broadcast(B)
	check.call(not dock.boss_gate.visible and dock.primary_action.disabled, "other seat has no gate action")

	state.erase("canOpenBossGate")
	state.phase = {"kind": "bossGateChoice", "choice": {"playerId": A, "stageId": "foothill", "bossEnemyId": "banditChief",
		"gateTileIndex": 0, "source": "standing"}}
	state.bossGateKeyPrice = 100
	_events([_narration()])
	_broadcast()
	check.call(not outcome.visible, "gate modal waits for playback")
	_step()
	check.call(outcome.is_visible_in_tree() and outcome.kicker.text.contains("山脚") and outcome.title.text.contains("山匪头目"), "gate names stage and boss")
	check.call(outcome.details.text.contains("尚未购买钥匙") and outcome.details.text.contains("山脚环数 · 2/2")
		and outcome.details.text.contains("精英胜场 · 1/1"), "both requirement types and key status")
	var buy: Button = outcome.options.get_child(0)
	var decline: Button = outcome.options.get_child(1)
	check.call(buy.text == "金币不足 · 需要 100" and decline.text == "暂不购买", "gate shortfall")
	_locked(buy)
	_press(decline, {"type": "chooseBossChallenge", "challenge": false})
	hero.gold = state.bossGateKeyPrice
	_broadcast()
	check.call(outcome.options.get_children() == [buy, decline] and buy.text == "购买钥匙 · 100 金币", "gate updates and reuses buttons at exact price")
	_press(buy, {"type": "buyBossKey"})
	progress.bossKeyPurchased = true
	_broadcast()
	var challenge: Button = outcome.options.get_child(0)
	check.call(challenge.text == "挑战山匪头目" and decline.text == "暂不进入" and outcome.details.text.contains("已购钥匙"), "purchased key changes actions")
	_broadcast()
	check.call(outcome.options.get_children() == [challenge, decline], "purchased gate buttons persist")
	_press(challenge, {"type": "chooseBossChallenge", "challenge": true})
	_press(decline, {"type": "chooseBossChallenge", "challenge": false})
	_broadcast(B)
	check.call(outcome.waiting.is_visible_in_tree() and outcome.waiting.text == "等待青岚处理首领入口……" and not outcome.options.visible, "spectator waits at gate")
	state.erase("bossGateKeyPrice")


func _test_blessings() -> void:
	hero.stageProgress.foothill.bossDefeated = true
	hero.blessings = [{"instanceId": "b-1", "kind": "giantStrength"}, {"instanceId": "b-2", "kind": "dragonScale"}]
	state.playerDerived[A].merge({"attack": 6, "defense": 4, "blessingCapacity": 2}, true)
	var offered := {"instanceId": "b-3", "kind": "favoredByFate"}
	var choice := {"source": "pvp", "winnerId": A, "loserId": B, "offered": offered, "tileIndex": 0}
	# The choice arrives with the final combat events and a subsequent narration.
	state.phase = {"kind": "battle", "battle": {"kind": "pvp", "aPlayerId": A, "bPlayerId": B, "tileIndex": 0,
		"attacker": "a", "hpA": 16, "hpB": 1, "initiativeA": 4, "initiativeB": 2, "round": 1, "log": [],
		"scrollsUsedA": 0, "scrollsUsedB": 0, "enemyAttacksPerformed": 0, "nextPlayerAttackPenalty": 0,
		"choiceA": {"status": "pending"}, "choiceB": {"status": "submitted"}}}
	_broadcast()
	_events([{"type": "battleEnded", "battleKind": "pvp", "winnerSide": "a", "outcome": "pvpDecided"}, _narration()])
	state.phase = {"kind": "blessingChoice", "choice": choice}
	_broadcast()
	check.call(main.battle_panel.is_visible_in_tree() and not outcome.visible, "lingering battle precedes blessing choice")
	_step()
	check.call(outcome.is_visible_in_tree() and outcome.title.text.contains("白石") and outcome.details.text.contains("2/2"), "PvP blessing choice includes loser and derived slots")
	for kind: String in ["giantStrength", "dragonScale", "favoredByFate"]:
		var info := Catalog.blessing_info(kind)
		check.call(outcome.details.text.contains(info.name) and outcome.details.text.contains(info.description), "comparison includes " + kind)
	for button: Button in outcome.options.get_children():
		_locked(button)
	_step()
	_press(outcome.options.get_child(0), {"type": "chooseBlessing", "replace": false})
	for i in hero.blessings.size():
		var button: Button = outcome.options.get_child(i + 1)
		check.call(button.text == "替换%s" % Catalog.blessing_info(hero.blessings[i].kind).name, "replacement names owned blessing")
		_press(button, {"type": "chooseBlessing", "replace": true, "replaceInstanceId": hero.blessings[i].instanceId})
	choice.source = "tile"
	choice.erase("loserId")
	choice.tileLabel = "远古祭坛"
	_broadcast()
	check.call(outcome.title.text.contains("远古祭坛"), "tile blessing title")
	_broadcast(B)
	check.call(outcome.waiting.text == "等待青岚选择赐福……" and not outcome.options.visible, "other seat cannot choose a blessing")

	hero.blessings = [offered]
	state.playerDerived[A].merge({"attack": 4, "defense": 2}, true)
	state.phase = {"kind": "blessingReward", "notice": {"playerId": A, "tileLabel": "远古祭坛", "blessing": offered}}
	_reveal_reward("acknowledgeBlessingReward", "确认赐福")
	check.call(outcome.title.text.contains("命运垂青") and outcome.details.text == Catalog.blessing_info(offered.kind).description, "blessing reward shows full definition")
	_broadcast(B)
	check.call(outcome.waiting.text == "等待青岚确认新赐福……" and not outcome.options.visible, "other seat waits for blessing receipt")


func _reveal_reward(action_type: String, caption: String) -> void:
	_events([_narration(), _narration(), _narration()])
	state.phase.notice.revealAfterEventId = state.lastEvents[1].id
	_broadcast()
	check.call(not outcome.visible, "pending reveal boundary hides " + action_type)
	_step()
	check.call(not outcome.visible, "current reveal boundary hides " + action_type)
	_step()
	check.call(outcome.is_visible_in_tree() and outcome.options.get_child(0).text == caption, "receipt opens after boundary " + caption)
	_locked(outcome.options.get_child(0))
	_step()
	_press(outcome.options.get_child(0), {"type": action_type})


func _test_treasure() -> void:
	var notice := {"playerId": A, "tileLabel": "旧木宝箱", "empty": true, "rewards": []}
	state.phase = {"kind": "treasureReward", "notice": notice}
	_reveal_reward("acknowledgeTreasureReward", "收下奖励")
	check.call(outcome.kicker.text == "空宝箱" and outcome.details.text.contains("空空如也"), "empty chest")
	notice.empty = false
	notice.erase("revealAfterEventId")
	notice.rewards = [{"source": "treasure", "name": "力量卷轴", "publicName": "一张卷轴", "resourceType": "scroll"},
		{"source": "blessing", "name": "铁剑", "publicName": "铁剑", "resourceType": "equipment"}]
	_broadcast()
	check.call(outcome.kicker.text == "宝箱已开启" and outcome.details.text.contains("宝箱收获 · 力量卷轴 · 卷轴")
		and outcome.details.text.contains("宝物猎人 · 铁剑 · 装备"), "chest names, sources and resource types")
	_press(outcome.options.get_child(0), {"type": "acknowledgeTreasureReward"})
	_broadcast(B)
	check.call(outcome.details.text.contains("一张卷轴") and not outcome.details.text.contains("力量卷轴")
		and outcome.waiting.text == "等待青岚确认开箱结果……" and not outcome.options.visible, "redacted treasure receipt for other seat")


func _test_shop() -> void:
	var offers := [
		{"id": 0, "price": 100, "stock": {"type": "scroll", "kind": "plunder"}},
		{"id": 1, "price": 150, "stock": {"type": "equipment", "kind": "bloodthirstyBattleplate"}},
		{"id": 2, "price": 200, "stock": {"type": "statGrowth", "option": "maxHp"}, "sold": true},
	]
	hero.gold = 100
	state.phase = {"kind": "shop", "shop": {"playerId": A, "tileIndex": hero.position, "offers": offers}}
	_events([_narration()])
	_broadcast()
	check.call(not shop.visible and not main.overlay_host.visible, "shop waits for playback")
	_step()
	check.call(shop.is_visible_in_tree() and shop.details.text.contains("100 金币") and not dock.guidance.text.contains("仅展示"), "dock routes to shop")
	var shelf := shop.options.get_children()
	check.call(shelf.size() == 4 and shelf[3].text == "离开商栈", "three offers and leave shop")
	for label: String in ["搜刮", "明牌卷轴", "R", "【", Catalog.scroll_info("plunder").description]:
		check.call(shelf[0].text.contains(label), "scroll offer shows " + label)
	for label: String in ["嗜血战甲", "防具", "SR", "【无视防御】", Catalog.equipment_info("bloodthirstyBattleplate").description]:
		check.call(shelf[1].text.contains(label), "equipment offer shows " + label)
	var growth := Catalog.stat_growth_info("maxHp")
	check.call(shelf[2].text.contains(growth.name) and shelf[2].text.contains(growth.description) and shelf[2].text.contains("已售罄"), "sold permanent growth")
	_locked(shelf[1])
	_locked(shelf[2])
	_press(shelf[0], {"type": "buyShopOffer", "offerId": 0})
	check.call(typeof(actions[0].offerId) == TYPE_INT, "wire offer ID dispatches as integer")
	_press(shelf[3], {"type": "leaveShop"})
	offers[0].sold = true
	hero.gold = 150
	shelf[1].grab_focus()
	_broadcast()
	check.call(shelf == shop.options.get_children() and shelf[1].has_focus(), "purchase broadcast preserves shelf nodes and focus")
	_locked(shelf[0])
	_press(shelf[1], {"type": "buyShopOffer", "offerId": 1})
	offers.reverse()
	_broadcast()
	check.call(shop.options.get_child(0) == shelf[2] and shop.options.get_child(2) == shelf[0], "offer IDs survive shelf reorder")
	_broadcast(B)
	check.call(shop.options.get_child_count() == 3 and shop.waiting.is_visible_in_tree() and shop.waiting.text == "等待青岚选购……", "spectator sees stock and waits")
	check.call(shelf[0].text.contains("一张卷轴 · 牌面仅对正在选购的玩家可见") and not shelf[0].text.contains("搜刮"), "private name removed on seat change")
	for button: Button in shop.options.get_children():
		_locked(button)


func _open_camp() -> void:
	check.call(dock.camp_shop.is_visible_in_tree() and dock.camp_shop.text == "旅商补给", "camp entry available")
	actions.clear()
	dock.camp_shop.pressed.emit()
	check.call(shop.camp_shop_open and shop.is_visible_in_tree() and shop.leave_camp.is_visible_in_tree() and actions.is_empty(), "camp opens locally through main")


func _test_camp() -> void:
	var prices := Catalog.camp_shop_info()
	state.phase = {"kind": "turnComplete"}
	hero.position = 1
	hero.gold = prices.scrollPrice + prices.healingPrice
	state.canUseCampShop = true
	_broadcast(B)
	check.call(not dock.camp_shop.visible and not shop.visible, "only active seat gets camp entry")
	_events([_narration()])
	_broadcast()
	check.call(not dock.camp_shop.visible, "camp entry hidden during playback")
	_step()
	_open_camp()
	var scroll: Button = shop.options.get_child(0)
	var healing: Button = shop.options.get_child(1)
	check.call(scroll.text.contains("神秘卷轴 · %d 金币" % prices.scrollPrice)
		and healing.text.contains("恢复生命 · %d 点 · %d 金币" % [prices.healingAmount, prices.healingPrice]), "camp terms from catalog")
	check.call(not shop.details.text.contains("获得卷轴"), "existing hand produces no receipt")
	_press(scroll, {"type": "buyShopItem", "item": "scroll"})
	hero.scrolls.append({"instanceId": "s-camp", "kind": "plunder"})
	hero.gold -= prices.scrollPrice
	_events([{"type": "goldChanged", "playerId": A, "from": prices.scrollPrice + prices.healingPrice, "to": hero.gold, "reason": "shop"},
		{"type": "scrollGranted", "instanceId": "s-camp", "kind": "plunder", "playerId": A}, _narration()])
	_broadcast()
	check.call(not shop.camp_shop_open and not shop.visible and not dock.camp_shop.visible, "purchase playback closes camp")
	dock.skip_playback.pressed.emit()
	check.call(shop.is_visible_in_tree() and shop.details.text.contains("获得卷轴 · 搜刮")
		and shop.details.text.contains(Catalog.scroll_info("plunder").description), "new instance of an owned kind reveals its receipt after playback")
	_broadcast()
	check.call(shop.details.text.count("获得卷轴") == 1, "duplicate broadcast preserves a single receipt")
	_locked(scroll)
	_press(healing, {"type": "buyShopItem", "item": "healing"})
	hero.hp = hero.maxHp
	_broadcast()
	_locked(healing)
	hero.hp -= 1
	hero.gold = prices.healingPrice - 1
	_broadcast()
	_locked(healing)
	actions.clear()
	shop.leave_camp.pressed.emit()
	check.call(actions.is_empty() and not shop.visible and not main.overlay_host.visible, "leaving camp is local")
	_open_camp()
	check.call(not shop.details.text.contains("获得卷轴"), "new visit starts with current hand")
	hero.gold = prices.scrollPrice
	_broadcast()
	_press(shop.options.get_child(0), {"type": "buyShopItem", "item": "scroll"})
	hero.gold = 0
	hero.scrolls.append({"instanceId": "s-camp-2", "kind": "remoteDice"})
	state.lastEvents = []
	_broadcast()
	check.call(shop.camp_shop_open and shop.details.text.contains("获得卷轴 · 灵活行动")
		and shop.details.text.contains(Catalog.scroll_info("remoteDice").description), "receipt updates immediately on a snapshot without playback")
	state.erase("canUseCampShop")
	_broadcast()
	check.call(not shop.visible and not shop.camp_shop_open and not dock.camp_shop.visible, "revoked eligibility closes camp")
	state.canUseCampShop = true
	_broadcast()
	_open_camp()
	_events([_narration()])
	_broadcast()
	_step()
	check.call(not shop.camp_shop_open and not shop.visible, "unrelated playback does not reopen camp")
	_open_camp()
	state.erase("canUseCampShop")
	state.turn += 1
	state.activePlayerId = B
	state.phase = {"kind": "awaitingRoll"}
	_broadcast()
	check.call(not shop.visible and not shop.camp_shop_open, "next turn closes camp")


func _test_casino() -> void:
	state.activePlayerId = A
	state.turn += 1
	var casino := {"playerId": A, "tileIndex": hero.position, "spins": 1}
	state.phase = {"kind": "casino", "casino": casino}
	state.casinoSpinPrice = 130
	hero.gold = 129
	_events([_narration()])
	_broadcast()
	check.call(not shop.visible, "casino waits for playback")
	_step()
	check.call(shop.is_visible_in_tree() and shop.title.text.contains("129 金币") and shop.details.text.contains("130 金币"), "spin shows balance and next price")
	var spin: Button = shop.options.get_child(0)
	check.call(spin.text == "转动轮盘" and shop.options.get_child(1).text == "离开赌场", "spin and leave actions")
	_locked(spin)
	hero.gold = 130
	_broadcast()
	_press(spin, {"type": "spinCasino"})
	_press(shop.options.get_child(1), {"type": "leaveCasino"})
	_broadcast(B)
	check.call(shop.options.get_child_count() == 0 and shop.waiting.is_visible_in_tree() and shop.waiting.text.contains("青岚"), "spectator waits for spin")
	casino.spins = 2
	state.casinoSpinPrice = 200
	var results := [
		[{"kind": "bust", "price": 130}, "一无所获", "投入 130 金币"],
		[{"kind": "gold", "price": 130, "amount": 195}, "金币入袋", "赢得 195 金币"],
		[{"kind": "scroll", "price": 130, "name": "力量卷轴", "publicName": "一张卷轴"}, "获得卷轴", "力量卷轴"],
		[{"kind": "equipment", "price": 130, "name": "铁剑"}, "获得装备", "铁剑"],
		[{"kind": "statGrowth", "price": 130, "option": "defense"}, "永久成长", Catalog.stat_growth_info("defense").description],
	]
	for row: Array in results:
		casino.result = row[0]
		_broadcast()
		check.call(shop.title.text == row[1] and shop.details.text.contains(row[2]), "casino result details: " + row[1])
		check.call(shop.options.get_child_count() == 1 and shop.options.get_child(0).text == "确认结果", "only acknowledgement for " + row[1])
		_press(shop.options.get_child(0), {"type": "acknowledgeCasinoResult"})
		_broadcast(B)
		check.call(shop.options.get_child_count() == 0 and shop.waiting.text == "等待青岚确认转盘结果……", "casino receipt belongs to spinner")
		if casino.result.kind == "scroll":
			check.call(shop.details.text.contains("一张卷轴") and not shop.details.text.contains("力量卷轴"), "casino shows only server-redacted scroll name")
	casino.erase("result")
	_broadcast()
	check.call(shop.details.text.contains("200 金币") and shop.options.get_child_count() == 2, "acknowledgement returns to next spin price")

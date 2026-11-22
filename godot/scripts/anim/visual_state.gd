class_name VisualState
extends RefCounted

const REVEAL_EVENTS := [
	"scrollGranted", "equipmentGranted", "blessingGranted",
	"scrollTransferred", "equipmentTransferred", "blessingTransferred",
]


## The first matching pending event holds the value until it becomes current.
static func _player_value(player: Dictionary, pending: Array, field: String, types: Array, stat := "") -> int:
	for event: Dictionary in pending:
		if event.get("type") in types and event.get("playerId") == player.get("id"):
			if stat.is_empty() or event.get("stat") == stat:
				return int(event.from)
	return int(player.get(field, -1 if field == "position" else 0))


static func visual_hp(player: Dictionary, pending: Array) -> int:
	return _player_value(player, pending, "hp", ["playerHpChanged"])


static func visual_max_hp(player: Dictionary, pending: Array) -> int:
	return _player_value(player, pending, "maxHp", ["maxHpChanged"])


static func visual_base_stat(player: Dictionary, stat: String, pending: Array) -> int:
	var field := "baseAttack" if stat == "attack" else "baseDefense"
	return _player_value(player, pending, field, ["baseStatChanged"], stat)


static func visual_gold(player: Dictionary, pending: Array) -> int:
	return _player_value(player, pending, "gold", ["goldChanged"])


static func visual_position(player: Dictionary, pending: Array) -> int:
	return _player_value(player, pending, "position", ["playerMoved", "playerRetreated"])


static func visual_battle_hp(battle: Dictionary, side: String, pending: Array) -> int:
	for event: Dictionary in pending:
		if event.get("type") in ["battleDamage", "battleHealed"] and event.get("targetSide") == side:
			return int(event.hpBefore)
	return int(battle.get("hpA" if side == "a" else "hpB", 0))


static func _first_of_type(events: Array, type: String) -> Dictionary:
	for event: Dictionary in events:
		if event.get("type") == type:
			return event
	return {}


static func visual_battle_round(battle: Dictionary, pending: Array) -> int:
	return int(_first_of_type(pending, "battleRoundAdvanced").get("fromRound", battle.get("round", 0)))


static func visual_attacker(battle: Dictionary, pending: Array) -> String:
	return _first_of_type(pending, "battleRoundAdvanced").get("fromAttacker", battle.get("attacker", ""))


static func battle_timeline(seen: Array) -> Array[Dictionary]:
	var start := 0
	for index in range(seen.size() - 1, -1, -1):
		if seen[index].get("type") == "battleStarted":
			start = index
			break
	var events: Array[Dictionary] = []
	events.assign(seen.slice(start))
	return events


static func visual_roll(role: String, events: Array, pending: Array) -> Dictionary:
	var wanted := "attackRolled" if role == "attack" else "defenseRolled"
	var pending_ids := {}
	for event: Dictionary in pending:
		pending_ids[int(event.id)] = true
	var roll: Dictionary = {}
	for index in range(events.size() - 1, -1, -1):
		var event: Dictionary = events[index]
		if event.get("type") == wanted and not pending_ids.has(int(event.id)):
			roll = event
			break
	if not roll.is_empty():
		for event: Dictionary in events:
			if event.get("type") == "battleRoundAdvanced" and int(event.id) > int(roll.id):
				return roll if pending_ids.has(int(event.id)) else {}
	return roll


static func is_battle_ending(current_event: Dictionary, pending: Array) -> bool:
	return current_event.get("type") == "battleEnded" or not _first_of_type(pending, "battleEnded").is_empty()


static func battle_with_damage(battle: Dictionary, events: Array) -> Dictionary:
	var hp_a = battle.get("hpA")
	var hp_b = battle.get("hpB")
	for event: Dictionary in events:
		if event.get("type") in ["battleDamage", "battleHealed"]:
			if event.targetSide == "a":
				hp_a = event.hpAfter
			else:
				hp_b = event.hpAfter
	if hp_a == battle.get("hpA") and hp_b == battle.get("hpB"):
		return battle
	return battle.merged({"hpA": hp_a, "hpB": hp_b}, true)


static func is_revealed(instance_id: String, pending: Array) -> bool:
	for event: Dictionary in pending:
		if event.get("type") in REVEAL_EVENTS and event.get("instanceId") == instance_id:
			return false
	return true


static func active_damage(current_event: Dictionary) -> Dictionary:
	return current_event if current_event.get("type") == "battleDamage" else {}


static func active_healing(current_event: Dictionary) -> Dictionary:
	return current_event if current_event.get("type") == "battleHealed" else {}


static func presentation_ready(current_event: Dictionary, pending: Array, reveal_after_event_id: Variant) -> bool:
	if reveal_after_event_id == null:
		return true
	var boundary := int(reveal_after_event_id)
	if not current_event.is_empty() and int(current_event.id) <= boundary:
		return false
	for event: Dictionary in pending:
		if int(event.id) <= boundary:
			return false
	return true

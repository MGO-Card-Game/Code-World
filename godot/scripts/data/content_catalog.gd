class_name ContentCatalog
extends RefCounted

const CATALOG_PATH := "res://data/content_catalog.json"

static var _data: Dictionary = {}
static var _loaded := false


static func load_catalog(force_reload: bool = false) -> Dictionary:
	if force_reload or not _loaded:
		_loaded = true
		_data = {}
		var file := FileAccess.open(CATALOG_PATH, FileAccess.READ)
		if file == null:
			push_error("无法读取内容目录 %s：%s" % [CATALOG_PATH, error_string(FileAccess.get_open_error())])
		else:
			var json := JSON.new()
			if json.parse(file.get_as_text()) == OK and json.data is Dictionary and json.data.get("schemaVersion") == 1:
				_data = json.data
			else:
				push_error("内容目录格式无效：%s" % CATALOG_PATH)
	return _data


static func _info(table: String, kind: String) -> Dictionary:
	return load_catalog().get(table, {}).get(kind, {})


static func scroll_info(kind: String) -> Dictionary:
	return _info("scrolls", kind)


static func scroll_name(kind: String) -> String:
	return scroll_info(kind).get("name", kind)


static func is_interference_scroll(kind: String) -> bool:
	return scroll_info(kind).get("group", "") == "interference"


static func enemy_info(kind: String) -> Dictionary:
	return _info("enemies", kind)


static func enemy_name(kind: String) -> String:
	return enemy_info(kind).get("name", kind)


static func affix_info(kind: String) -> Dictionary:
	return _info("eliteAffixes", kind)


static func equipment_info(kind: String) -> Dictionary:
	return _info("equipment", kind)


static func blessing_info(kind: String) -> Dictionary:
	return _info("blessings", kind)


static func stat_growth_info(option: String) -> Dictionary:
	return _info("statGrowth", option)


static func camp_shop_info() -> Dictionary:
	return load_catalog().campShop


static func map_event_info(kind: String) -> Dictionary:
	return _info("mapEvents", kind)


static func keyword_info(kind: String) -> Dictionary:
	return _info("keywords", kind)


static func rule_term_info(kind: String) -> Dictionary:
	return _info("ruleTerms", kind)

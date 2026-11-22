class_name PlaybackController
extends RefCounted

const Queue = preload("res://scripts/anim/event_queue.gd")
const Visual = preload("res://scripts/anim/visual_state.gd")

var queue := Queue.new()
var _caption := ""
var _live_battle := false
var _remembered_battle: Dictionary = {}
var _remembered_battle_enemy: Dictionary = {}
var battle_instance := 0

var lingering_battle: Dictionary:
	get:
		if _live_battle:
			return _remembered_battle
		if _remembered_battle.is_empty() or not Visual.is_battle_ending(queue.current_event(), queue.pending_events()):
			return {}
		return Visual.battle_with_damage(_remembered_battle, Visual.battle_timeline(queue.seen_events()))

var lingering_battle_enemy: Dictionary:
	get:
		return {} if lingering_battle.is_empty() else _remembered_battle_enemy


func _init() -> void:
	queue.event_started.connect(_on_event_started)
	queue.restarted.connect(_clear_presentation)


func sync_state(state: Dictionary) -> void:
	var events: Array = state.get("lastEvents", [])
	var previous_id := queue.watermark()
	queue.enqueue(events)
	var phase: Dictionary = state.get("phase", {})
	if phase.get("kind") == "battle":
		if not _live_battle or events.any(func(e: Dictionary) -> bool: return e.type == "battleStarted" and int(e.id) > previous_id):
			battle_instance += 1
		_live_battle = true
		_remembered_battle = phase.get("battle", {}).duplicate(true)
		_remembered_battle_enemy = state.get("battleEnemy", {}).duplicate(true)
	else:
		_live_battle = false
		_release_finished_battle()


func _release_finished_battle() -> void:
	if not _live_battle and not _remembered_battle.is_empty() and not Visual.is_battle_ending(queue.current_event(), queue.pending_events()):
		_remembered_battle = {}
		_remembered_battle_enemy = {}


func _on_event_started(event: Dictionary) -> void:
	if event.get("type") == "narration":
		_caption = event.get("text", "")


func dock_message(state: Dictionary) -> String:
	if is_playing() and not _caption.is_empty():
		return _caption
	return state.get("message", {}).get("text", "")


func is_playing() -> bool:
	return queue.is_playing()


## A single refresh covers every event crossed this frame.
func advance(delta_ms: float) -> bool:
	var previous_length := queue.queue_length()
	queue.advance(delta_ms)
	if queue.queue_length() == previous_length:
		return false
	_release_finished_battle()
	return true


func drain() -> bool:
	var changed := queue.drain()
	_release_finished_battle()
	return changed


func reset() -> void:
	queue.reset()
	_clear_presentation()


## The next seat receives its own redacted events. Keep the battle for its ending animation.
func change_viewer() -> void:
	queue.reset()
	_caption = ""


func _clear_presentation() -> void:
	_caption = ""
	_live_battle = false
	_remembered_battle = {}
	_remembered_battle_enemy = {}

class_name PlaybackController
extends RefCounted

const Queue = preload("res://scripts/anim/event_queue.gd")
const Visual = preload("res://scripts/anim/visual_state.gd")

var queue := Queue.new()
var _caption := ""
var _live_battle := false
var _remembered_battle: Dictionary = {}

var lingering_battle: Dictionary:
	get:
		if _live_battle:
			return _remembered_battle
		if _remembered_battle.is_empty() or not Visual.is_battle_ending(queue.current_event(), queue.pending_events()):
			return {}
		return Visual.battle_with_damage(_remembered_battle, Visual.battle_timeline(queue.seen_events()))


func _init() -> void:
	queue.event_started.connect(_on_event_started)


func sync_state(state: Dictionary) -> void:
	queue.enqueue(state.get("lastEvents", []))
	var phase: Dictionary = state.get("phase", {})
	_live_battle = phase.get("kind") == "battle"
	if _live_battle:
		_remembered_battle = phase.get("battle", {}).duplicate(true)


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
	return queue.queue_length() != previous_length


func drain() -> bool:
	return queue.drain()


func reset() -> void:
	queue.reset()
	_caption = ""
	_live_battle = false
	_remembered_battle = {}

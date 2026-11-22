class_name EventQueue
extends RefCounted

signal event_started(event: Dictionary)

const DEFAULT_DURATIONS := {
	"narration": 420,
	"gameStarted": 900,
	"turnStarted": 320,
	"movementRolled": 700,
	"playerMoved": 520,
	"playerRetreated": 620,
	"playerHpChanged": 480,
	"maxHpChanged": 380,
	"baseStatChanged": 380,
	"goldChanged": 380,
	"scrollGranted": 560,
	"scrollConsumed": 440,
	"scrollTransferred": 620,
	"equipmentGranted": 620,
	"equipmentTransferred": 620,
	"blessingGranted": 620,
	"blessingTransferred": 620,
	"battleStarted": 700,
	"initiativeRolled": 760,
	"attackRolled": 640,
	"defenseRolled": 640,
	"battleDamage": 560,
	"battleHealed": 560,
	"battleRoundAdvanced": 300,
	"battleEnded": 700,
	"gameOver": 600,
}
const SEEN_LIMIT := 200

var _current: Dictionary = {}
var _elapsed := 0.0
var _pending: Array[Dictionary] = []
var _seen: Array[Dictionary] = []
var _watermark := 0


func enqueue(events: Array, speed: float = 1.0) -> bool:
	if events.is_empty():
		return false
	var highest := int(events[-1].get("id", 0))
	var restarted := highest < _watermark
	if restarted:
		reset()

	var added := false
	for event: Dictionary in events:
		if not restarted and int(event.get("id", 0)) <= _watermark:
			continue
		var base := int(DEFAULT_DURATIONS.get(event.get("type"), 0))
		var duration := maxi(0, roundi(float(base) / speed)) if speed > 0.0 else 0
		_pending.append({"event": event, "duration": duration})
		_seen.append(event)
		added = true
	if not added:
		return false
	if _seen.size() > SEEN_LIMIT:
		_seen = _seen.slice(-SEEN_LIMIT)
	_watermark = highest
	if _current.is_empty():
		_promote()
	return true


func _promote() -> void:
	_elapsed = 0.0
	if _pending.is_empty():
		_current = {}
	else:
		_current = _pending.pop_front()
		event_started.emit(_current.event)


## True for either elapsed time or an event transition (including zero-duration events).
func advance(delta_ms: float) -> bool:
	var remaining := maxf(0.0, delta_ms)
	var changed := false
	while not _current.is_empty():
		var left := float(_current.duration) - _elapsed
		if remaining < left:
			_elapsed += remaining
			return changed or remaining > 0.0
		remaining -= left
		_promote()
		changed = true
	return changed


func drain() -> bool:
	var changed := is_playing()
	_current = {}
	_elapsed = 0.0
	_pending.clear()
	return changed


func reset() -> void:
	drain()
	_seen.clear()
	_watermark = 0


func is_playing() -> bool:
	return not _current.is_empty()


func current_event() -> Dictionary:
	return _current.get("event", {})


func pending_events() -> Array[Dictionary]:
	var events: Array[Dictionary] = []
	for queued in _pending:
		events.append(queued.event)
	return events


func seen_events() -> Array[Dictionary]:
	return _seen.duplicate()


func remaining_ms() -> Variant:
	return null if _current.is_empty() else maxf(0.0, float(_current.duration) - _elapsed)


func progress() -> float:
	if _current.is_empty() or _current.duration == 0:
		return 1.0
	return clampf(_elapsed / float(_current.duration), 0.0, 1.0)


func queue_length() -> int:
	return _pending.size() + int(is_playing())


func watermark() -> int:
	return _watermark

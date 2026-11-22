extends Logger

# Script errors can abort one callback without stopping the SceneTree.
var count := 0


func _log_error(_function: String, _file: String, _line: int, _code: String,
		_rationale: String, _editor_notify: bool, error_type: int,
		_script_backtraces: Array[ScriptBacktrace]) -> void:
	if error_type != Logger.ERROR_TYPE_WARNING:
		count += 1

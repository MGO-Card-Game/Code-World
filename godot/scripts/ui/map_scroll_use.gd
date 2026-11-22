extends RefCounted

## Callers pass only a revealed card owned by the viewer.
static func disabled_reason(state: Dictionary, viewer: String, id: String, info: Dictionary, playing: bool) -> String:
	if "map" not in info.timings:
		return "只能在战斗中使用"
	var phase: String = state.phase.kind
	if viewer != state.activePlayerId or phase not in ["awaitingRoll", "turnComplete"]:
		return "现在不是你的地图阶段"
	if playing:
		return "等待演出结束"
	var player: Dictionary = state.players[viewer]
	if info.healsHp and player.hp >= player.maxHp:
		return "生命已满"
	if info.forfeitsMovement and phase == "turnComplete":
		return "已经移动，不能再放弃移动"
	if info.replacesMovement and phase == "turnComplete":
		return "本回合已经移动，不能再使用这张牌"
	if info.retracesPosition and player.get("previousStopPosition", player.position) == player.position:
		return "还没有可折返的上一次停留位置"
	if id not in state.viewerPlayableScrollIds.map:
		return "当前无法使用这张地图卷轴"
	return ""

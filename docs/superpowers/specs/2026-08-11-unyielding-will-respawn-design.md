# 不屈意志改为原地复活

## 背景

不屈意志当前的效果是"相遇战战败免除正常惩罚，改为损失 1 点生命"，作用域只在 PvP
结算里。改成"战败时原地以半血复活"后，它的作用域整体搬到 PvE / 首领战的战败分支，
PvP 侧的免罚逻辑全部撤除。

同时统一战败退回点：不再回退到最近一次到达的泉水或营地，一律回到当前阶段的初始营地。

## 规则变更

| | 改前 | 改后 |
|---|---|---|
| 不屈意志 | 相遇战战败免罚，改扣 1 点生命 | PvE / 首领战战败时不退回，原地以半血复活 |
| 战败退回点 | 最近一次到达的泉水或营地（开战时锁定） | 当前阶段的初始营地 |
| 泉水 | 回血 5 点 + 存档点 | 只回血 5 点 |
| 相遇战战败 | 持有不屈意志时免除代价 | 一律照常支付代价 |

不变的部分：战败恢复至半血；战败不发任何奖励；退回落点不触发格子效果，所以退回营地
不会触发营地的回满血。相遇战不移动位置，因此"原地复活"对 PvP 没有意义。

不屈意志永久生效，不消耗、不占用额外状态，仍可在相遇战中被夺取。

## 实现

**赐福定义**：`BlessingEffectDefinition` 用无参数的 `respawnInPlaceOnDefeat` 替换
`replacePvpPenaltyWithHpLoss`。`blessings.ts` 用 `respawnsInPlaceOnDefeat(player)`
替换 `applyPvpPenaltyReplacement`——后者要写生命账本，前者只是一个判定。

**战败分支**（`battle.ts` 的 `finishBattle`）：

```
hp = ceil(maxHp / 2)
position = respawnsInPlaceOnDefeat(player)
  ? player.position
  : regionForPosition(map, player.position).entryIndex
```

原地复活时 `from === to`，不再发 `playerRetreated` 事件，避免 UI 播一段没有位移的动画。

**PvP 侧回退**：`finishPvp` 删除 `unyieldingWillTriggered` 相关的免罚分支与"优先转移
不屈意志"逻辑；`noPayablePenalty` 分支保留。`waiveReason` / `penaltyWaiveReason` 的联合
类型收窄为 `"noPayable"`。`detachBlessing` 的 `instanceId` 参数保留——赢家满槽替换仍在用。

**删除 checkpoint 链路**：退回点变成由位置推导的常量后，以下状态与函数不再有读者，
全部删除：

- `Player.checkpointTileId`（含 `state.ts` 初始化、`tiles.ts` 泉水写入、`battle.ts`
  击败首领后的写入）
- `BattleState.retreatTo` 与 `startBattle` 的 `context.retreatTo`
- `map.ts` 的 `findPreviousRestTile` / `findRestTileAtOrBefore`

`retreatTo` 原本要在开战时锁定，是为了不把本次掷骰途中越过的泉水算进退回点。阶段营地
在一次移动内不会改变（跨阶段只发生在击败首领时），锁定的理由随之消失。

## 测试

- `blessings.test.ts`：不屈意志的两条旧用例（免罚、优先转移）替换为 PvE 战败原地复活、
  首领战战败原地复活，以及未持有时退回阶段营地的对照。
- `engine.test.ts` / `events.test.ts` / `stages.test.ts`：`retreatTo` 与 checkpoint 断言
  改为断言退回 `region.entryIndex`。
- `interferenceScrolls.test.ts`：删除传送落在泉水后更新 checkpoint 的断言。
- `map.test.ts`：删除 `findPreviousRestTile` / `findRestTileAtOrBefore` 用例。

## 影响与取舍

泉水失去存档点作用后只剩回血 5 点，价值明显下降，后续可能需要单独调整泉水或其密度——
不在本次范围内。

首领战战败改回阶段营地通常比改前更严厉：守关门在 `gateIndex`、营地在 `gateIndex + 1`，
退回营地意味着要重新绕满一圈才能再次挑战，而改前的最近泉水往往在半圈以内。

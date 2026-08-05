# 卡牌与装备扩展约定

## 普通卷轴/道具

道具与卷轴使用同一套内容系统。直接在 `src/game/content/scrolls.ts` 增加一个配置项即可，`ScrollKind` 会从配置键自动推导，不需要再维护枚举。

`effects` 可以组合多个通用效果，目前支持：固定加值、替换骰面、增加骰子、设置最低骰值和掷骰前直接伤害。引擎按数组顺序执行。

```ts
example: {
  name: "示例牌",
  description: "本次攻击额外投 1 个骰子，并获得 +2",
  sigil: "例",
  rarity: "R",
  timings: ["beforeAttackRoll"],
  effects: [
    { type: "extraDice", count: 1 },
    { type: "flatBonus", value: 2 },
  ],
}
```

## 无法通用配置的卷轴

不要把卡牌名称或 kind 写进战斗引擎的条件分支。为这张牌声明自定义效果，并在 `src/game/effects/customScrollEffects.ts` 注册同名解析器：

```ts
effects: [{
  type: "custom",
  resolver: "exampleSpecial",
  parameters: { value: 2 },
}]
```

解析器可以读取对局、战斗、来源和目标，修改本次投骰参数，并通过上下文提供的函数造成伤害或写入战斗记录。配置只保存解析器名称和普通参数，函数不会进入 `GameState`，所以存档、重放和联机状态仍可序列化。

如果新卡需要当前尚未暴露的时机（例如投骰后、受伤后或战斗结束），应给解析器上下文增加一个明确的生命周期钩子，并由引擎在该阶段统一调用；不要为单张牌在引擎中增加特判。只有两个以上效果共享同一种稳定语义时，才把它提升为新的通用 `ScrollEffectDefinition`。

## 普通装备

在 `src/game/content/equipment.ts` 增加配置项即可，`EquipmentKind` 同样由配置键自动推导。装备必须声明稀有度、分类和修正列表。

通用修正支持基础攻防、攻击/防御/移动骰面、攻防骰数量和生命上限。分类槽位固定为：武器 1、防具 1、鞋具 1、饰品 2。

复杂装备使用 `customResolver`，解析器集中注册在 `src/game/effects/customEquipmentEffects.ts`。当前支持动态修正以及装备、卸下生命周期；后续需要战斗阶段被动时，沿用上面的生命周期钩子原则扩展。

## 稀有度与抽取

卷轴和装备共用 `src/game/content/rarity.ts` 的 N/R/SR 权重（70/25/5）：先抽稀有度，再在该稀有度的内容中等概率抽取。增加同稀有度卡牌不会改变其他稀有度的总概率。

新增效果或解析器后，应至少覆盖以下测试：使用时机、骰面/骰数、结算顺序、伤害下限、槽位约束、同种子重放，以及联机动作归属。

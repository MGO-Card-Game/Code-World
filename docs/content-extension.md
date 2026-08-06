# 卡牌与装备扩展约定

## 内容目录结构

卡牌配置按类别拆成目录，每个类别一张表，卡牌的效果代码就写在它自己那条配置里：

```
src/game/content/
  rarity.ts                 N/R/SR 权重与抽取
  equipment/
    definition.ts           EquipmentBody / 分类元数据 / defineEquipment
    weapons.ts   armor.ts   shoes.ts   accessories.ts
    index.ts                合并出 EQUIPMENT 与 EquipmentKind
  scrolls/
    definition.ts           ScrollDefinition / 攻防类型推导
    diceBoost.ts            骰子强化类
    combatSwing.ts          攻防转换类
    index.ts                合并出 SCROLLS 与 ScrollKind
```

新增一张卡 = 改对应的那张表。新增一个类别/主题 = 建一个表文件，再在 `index.ts` 里合并进来。`EquipmentKind` 和 `ScrollKind` 始终由配置键推导，不需要另外维护枚举。

各表之间的 kind **不能重名**——合并是对象展开，撞键会静默覆盖。两边的 `category.test.ts` 各有一条数量断言守着这件事。

## 卡牌定义里可以直接写函数

`GameState` 只保存 `{ instanceId, kind }`，卡牌定义只活在模块常量里，永远不会被 `structuredClone` 或 JSON 序列化。所以效果代码直接挂在定义上，不需要"解析器名字 + 注册表"这层跳板。

这条前提由 `equipmentBattleHooks.test.ts` 的一条用例守着：装上带函数的装备后，整个 state 仍然能 clone、能序列化，且序列化结果里不含钩子名。

## 卷轴

```ts
// scrolls/combatSwing.ts
export const COMBAT_SWING_SCROLLS = {
  example: {
    name: "示例牌",
    description: "本次攻击额外投 1 个骰子，并获得 +2",
    rarity: "R",
    timings: ["beforeAttackRoll"],
    effects: [
      { type: "extraDice", count: 1 },
      { type: "flatBonus", value: 2 },
    ],
  },
} satisfies Record<string, ScrollDefinition>;
```

`effects` 可以组合多个通用效果，目前支持：固定加值、替换骰面、增加骰子、设置最低骰值和掷骰前直接伤害。引擎按数组顺序执行。

牌面左上角圆圈里的攻／防／通由 `scrollCategory()` 从 `timings` 推导，不要单独配置：只声明 `beforeAttackRoll` 是攻击牌，只声明 `beforeDefenseRoll` 是防守牌，两个都声明是通用牌。

**注意这和文件分组是两个维度**：文件按效果主题分（骰子强化、攻防转换……），攻防类型只看 `timings`。同一张主题表里可以同时有攻击牌和防守牌。

### 无法通用配置的卷轴

不要把卡牌名称或 kind 写进战斗引擎的条件分支。用 `custom` 效果直接挂函数：

```ts
effects: [{
  type: "custom",
  resolve({ modifiers, dealDamage, addBattleLog }) {
    modifiers.flatBonus += 2;
  },
}]
```

上下文可以读取对局、战斗、来源和目标，修改本次投骰参数，并通过 `dealDamage` / `addBattleLog` 造成伤害或写入战斗记录。

如果新卡需要当前尚未暴露的时机（例如受伤后或战斗结束），应给上下文增加一个明确的生命周期钩子，并由引擎在该阶段统一调用；不要为单张牌在引擎中增加特判。只有两个以上效果共享同一种稳定语义时，才把它提升为新的通用 `ScrollEffectDefinition`。

## 装备

```ts
// equipment/weapons.ts
export const WEAPONS = defineEquipment("weapon", {
  example: {
    name: "示例武器",
    description: "攻击骰上限 +1",
    rarity: "N",
    modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
  },
});
```

`category` 由 `defineEquipment` 按文件盖章，**不要写在卡上**——卡片自己声明分类时它可以和所在文件对不上，盖章之后这种漂移在结构上就不存在了。

通用修正支持基础攻防、攻击/防御/移动骰面、攻防骰数量和生命上限。分类槽位固定为：武器 1、防具 1、鞋具 1、饰品 2。

### 装备的战斗钩子

通用修正不够用时，在卡上加 `effects`。四个时机：`modifiers`（动态修正）、`onEquip` / `onUnequip`（装备与卸下）、以及战斗内的 `beforeRoll` / `afterRoll`。

```ts
oldKnightSword: {
  name: "旧骑士长剑",
  rarity: "N",
  modifiers: [{ type: "dieSides", die: "attack", value: 1 }],
  effects: {
    afterRoll({ dieKind, roll, modifiers, addBattleLog }) {
      if (dieKind !== "attack") return;
      if (!roll.dice.includes(roll.sides)) return;
      modifiers.bonusDamage += 1;
      addBattleLog(`旧骑士长剑掷出 ${roll.sides}，额外造成 1 点伤害。`);
    },
  },
},
```

几条约定：

* **`modifiers` 与卷轴共用一份**，字段是加值、骰面替换、额外骰子、最低骰值、追加伤害。结算顺序固定为先卷轴后装备。
* **`beforeRoll` 是唯一能读到对手状态的时机**，`afterRoll` 能额外读到 `roll`（骰面上限、每颗点数、总和）。`afterRoll` 里改加值仍会计入本次合计。
* **血量一律读上下文给的 `ownHp` / `opponentHp` / `ownMaxHp` / `opponentMaxHp`**，不要读 `player.hp`。PvP 的战斗生命值存在 `battle.hpA` / `hpB` 上，战斗期间 `player.hp` 不动，直接读会拿到开战前的数值。
* **`bonusDamage` 是攻防差之外的追加伤害**，防御挡不住。目前只结算攻击方那一份——防守方的反伤需要自己的 `battleDamage` 事件和击倒判定顺序，还没做。
* 钩子只对有归属玩家的一侧调用；PvE 的敌人没有装备，会安静跳过。

纯数值的骰面/属性修正仍然走 `modifiers` 配置，不要为它写 `effects`。

## 稀有度与抽取

卷轴和装备共用 `src/game/content/rarity.ts` 的 N/R/SR 权重（70/25/5）：先抽稀有度，再在该稀有度的内容中等概率抽取。增加同稀有度卡牌不会改变其他稀有度的总概率。

## 验证

改完跑 `npm run build`（它会依次做两份 tsconfig 的类型检查再构建）和 `npm test`。注意光跑 `tsc --noEmit` 不带 `-p` 是**无效的**——根 tsconfig 是 `files: []` 的引用壳，什么都不会检查。

新增效果后应至少覆盖：使用时机、骰面/骰数、结算顺序、伤害下限、槽位约束、同种子重放，以及联机动作归属。

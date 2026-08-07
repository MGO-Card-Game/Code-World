# 卡牌与装备扩展约定

## 内容目录结构

卡牌配置按类别拆成目录，每个类别一张表，卡牌的效果代码就写在它自己那条配置里：

```
src/game/content/
  rarity.ts                 N/R/SR/PR 权重与抽取
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

`effects` 可以组合多个通用效果，目前支持：固定加值、替换骰面、增加骰子、设置最低骰值、视为最高面和掷骰前直接伤害。引擎按数组顺序执行。

**一回合可以打任意张卷轴**（GameRule 8.5），所以新增效果类型时必须先想清楚它多张叠加怎么合并。累加类求和、`dieSides` 与 `minimumRoll` 取最大——这几种换顺序结果都不变，因此不需要给卡牌配优先级。只有 `directDamage` 和 `custom` 带副作用，按提交顺序结算。`rollModifiers.test.ts` 有一条排列测试和一条登记表测试挡着漏项。

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

通用修正不够用时，在卡上加 `effects`。五个时机：`modifiers`（动态修正）、`onEquip` / `onUnequip`（装备与卸下）、`onBattleStart`（战斗开始）、以及战斗内的 `beforeRoll` / `afterRoll`。

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

### 跨回合效果：装备实例的战斗内暗格

「和上一回合比较」这类效果需要记忆。`OwnedEquipment` 上有一个 `battleMemo?: number`，钩子拿到的 `item` 就是状态里那个对象，直接读写它即可：

```ts
// equipment/weapons.ts —— 双生刺剑
afterRoll({ dieKind, roll, item, modifiers }) {
  if (dieKind !== "attack") return;
  const previous = item.battleMemo;
  item.battleMemo = roll.dice[0];
  if (previous === undefined || previous === roll.dice[0]) return;
  modifiers.flatBonus += 1;
},
```

三条约定：

* **只放数字。** 它跟着 `GameState` 一起 `structuredClone`、JSON 广播，还要在同种子重放里逐位复现。
* **不能放暗牌情报。** 装备是公开的，暗格也就是公开的。两把剑记的都是 `attackRolled` 已经播出去的骰点。
* **生命周期由引擎负责**，`clearBattleMemos` 在 `finishBattle` 开头统一清空，卡牌不必自己收尾。所以它只能表达**战斗内**的记忆；真要跨场记东西，得另开一个字段并想清楚它什么时候失效。

攻防每轮交替，所以「下一次攻击」隔着对手的一轮。**读写暗格时一律先判 `dieKind`**，否则中间那一轮的防御会把攒下的东西花掉——断星剑的 `beforeRoll` / `afterRoll` 两处都带这个判断。

### 「每场战斗一次的主动技」怎么写

不要为它新建一套装备发动交互。**战斗开始时发一张战斗限定的临时卷轴**，让它落到已有的选牌阶段上：

```ts
// equipment/accessories.ts
fateCrown: {
  name: "命运王冠",
  rarity: "PR",
  modifiers: [],
  effects: {
    onBattleStart({ grantBattleScroll }) {
      grantBattleScroll("fateCrownDecree");
    },
  },
},
```

```ts
// scrolls/diceBoost.ts
fateCrownDecree: {
  name: "命运王冠",
  description: "本场战斗限定 · 本次攻或防的第一颗骰直接视为最高面",
  rarity: "PR",
  timings: ["beforeAttackRoll", "beforeDefenseRoll"],
  effects: [{ type: "maxRoll", count: 1 }],
  drawable: false,   // ← 关键
},
```

这样白拿三件事：**每场一次**（一场只发一张，打掉就没了）、**玩家自己挑时机**（选牌阶段现成）、**暗牌与联机归属**（卷轴那套已经处理好）。

两个必须记住的点：

* **`drawable: false` 不能忘**，否则宝箱和战斗奖励会把这张战斗限定牌当普通卷轴发出去，变成永久卡。
* 发出的牌带 `temporary: true`，由 `dropTemporaryScrolls` 在 `finishBattle` **开头**统一回收——必须早于任何阶段切换。晚一步的话，相遇战代价阶段里败方就能把这张本不属于他的牌交给赢家，凭空变成一张常驻卡。

## 稀有度与抽取

卷轴和装备共用 `src/game/content/rarity.ts` 的四档权重：**N 50 / R 30 / SR 15 / PR 5**。先抽稀有度，再在该稀有度的内容中等概率抽取。增加同稀有度卡牌不会改变其他稀有度的总概率。

`CARD_RARITY_WEIGHTS` 的**键序就是由低到高的档位顺序**，抽取按这个顺序走票，`CARD_RARITY_ORDER` 导出同一份顺序供展示排序使用。

空档不参加抽取，其权重由剩下的档位按比例承接——所以上面四个数字只有在每一档都至少有一张卡时才等于实际概率。装备四档现已齐全，正好是 50 / 30 / 15 / 5；卷轴的 PR 档只有 `drawable: false` 的命运王冠，不参与抽取，因此实际是 N 52.6% / R 31.6% / SR 15.8%。

> 改权重会打乱整个随机流。「整局跑通」类测试（`engine.test.ts`、`events.test.ts`、`multiplayer.test.ts`）用的是 `testSupport.ts` 里的 `PLAYTHROUGH_SEED` / `PLAYTHROUGH_CAP`，同一颗种子的对局长度可能从一千多步跳到一万六。跑挂了先确认是不是这个原因，再决定是换种子还是抬上限。

## 验证

改完跑 `npm run build`（它会依次做两份 tsconfig 的类型检查再构建）和 `npm test`。注意光跑 `tsc --noEmit` 不带 `-p` 是**无效的**——根 tsconfig 是 `files: []` 的引用壳，什么都不会检查。

新增效果后应至少覆盖：使用时机、骰面/骰数、结算顺序、伤害下限、槽位约束、同种子重放，以及联机动作归属。

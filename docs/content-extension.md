# 卡牌与装备扩展约定

## 规则层的模块划分

卡牌效果要挂到某个时机上，先看那个时机住在哪个文件：

```
src/game/
  state.ts            随机数、事件流、旁白、实例 ID、建局
  resources.ts        卷轴与装备的增、减、槽位（含 rewardSecret 与生命上限联动）
  mapEvents.ts        事件格效果的结算
  battle.ts           战斗生命周期与血量：开战、结束、伤害、治疗、双方查询
  battleRound.ts      一个攻击回合：卷轴效果、投骰、装备与怪物钩子的分发
  mapActions.ts       地图阶段动作：移动、地图卷轴、守关门与首领选择
  actionResult.ts     把规则模块交回的 ActionResult 折算成 reducer 返回值
  disconnectPolicy.ts 掉线时替谁兜底、怎么兜
  engine.ts           动作分发，以及对外门面
```

依赖只朝一个方向走：`state` ← `resources` ← {`mapEvents`, `battle`} ← `battleRound` ← {`mapActions`, `disconnectPolicy`} ← `engine`。**新增效果词汇和钩子时机基本都落在 `battleRound.ts`**；跨回合的东西（开战发牌、战斗结束回收）在 `battle.ts`；只影响地图位置和落点结算的新动作放 `mapActions.ts`。

`engine.ts` 只回答「一个 action 该派给谁」，不再自己实现规则——往它里面加规则实现之前，先看看该去哪个旁边的模块。

界面、联机服务器和测试一律从 `engine.ts` import，内部怎么拆都不影响它们。

## 内容目录结构

卡牌配置按类别拆成目录，每个类别一张表，卡牌的效果代码就写在它自己那条配置里：

```
src/game/content/
  rarity.ts                 N/R/SR/PR 权重与抽取
  blessings/
    definition.ts           BlessingDefinition / 声明式赐福效果
    index.ts                赐福内容池、权重抽取与 BlessingKind
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

新增一张卡 = 改对应的那张表。新增一个类别/主题 = 建一个表文件，再在 `index.ts` 里合并进来。`BlessingKind`、`EquipmentKind` 和 `ScrollKind` 始终由配置键推导，不需要另外维护枚举。

## 赐福

赐福集中定义在 `content/blessings/index.ts`。`modifiers` 负责永久攻防等通用数值，`effects` 负责战斗骰保底、移动结果、额外奖励和 PvP 惩罚替代等生命周期效果。玩家状态只保存一个 `{ instanceId, kind }`；每名玩家同时最多持有一个，PvP 覆盖时整份实例转移。

依赖尚未上线系统的赐福可以先写入定义并设置 `enabled: false`。它会保留类型和说明，但不会进入随机池；对应系统完成后再启用，避免玩家抽到当前没有实际作用的奖励。

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

`effects` 可以组合多个通用效果，目前支持：固定加值、替换骰面、增加骰子、投两次取高、设置最低骰值、视为最高面、钉死点数、最终伤害减免和掷骰前直接伤害。引擎按数组顺序执行。

**一回合可以打任意张卷轴**（GameRule 8.5），所以新增效果类型时必须先想清楚它多张叠加怎么合并。累加类求和，`dieSides`、`minimumRoll` 与 `fixedRoll` 的点数取最大，`rollTwice` 只启用一次——这几种换顺序结果都不变，因此不需要给卡牌配优先级。只有 `directDamage` 和 `custom` 带副作用，按提交顺序结算。`rollModifiers.test.ts` 有一条排列测试和一条登记表测试挡着漏项。

改单颗骰子的三种效果容易混，分工是这样的：

| 效果 | 作用范围 | 结果 |
| --- | --- | --- |
| `minimumRoll` | **每一颗**骰子 | 抬高下限，配上满载骰池会把三颗一起拉起来 |
| `maxRoll` | 前 `count` 颗 | 视为骰面上限，只赚不亏 |
| `fixedRoll` | 接着的 `count` 颗 | 钉死在 `value`，**可能比随机结果更差** |

`fixedRoll` 不是 `minimumRoll` 的变体：引擎里所有卷轴决策都发生在投骰**之前**，所以钉死一个中间值是真取舍——用 5、6、7 的可能性换掉 1、2、3。它也不受 `minimumRoll` 抬举，否则「改为 4」就退化成一张只赚不亏的牌。骰面比 `value` 还小时会钳到骰面上限。

`maxRoll` 与 `fixedRoll` 同场时按这个顺序分配骰子，不抢同一颗：好的那份先发出去，玩家两张一起打时拿到的是唯一说得通的分配。

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

通用修正不够用时，在卡上加 `effects`。七个时机：`modifiers`（动态修正）、`onEquip` / `onUnequip`（装备与卸下）、`onBattleStart`（战斗开始）、战斗内的 `beforeRoll` / `afterRoll`、受击时的 `beforeDamage`，以及打出卷轴后的 `onScrollUsed`。

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
* **`bonusDamage` 是攻防差之外的追加伤害**，防御挡不住，且只结算攻击方那一份。防守方的反伤（荆棘铠甲那类）现在只差一半：`dealBattleDamage` 已经能对任意一侧发伤害，但"反伤打死攻击者、同一回合防守方自己也倒下"该判谁赢还没有规则。
* 钩子只对有归属玩家的一侧调用；PvE 的敌人没有装备，会安静跳过。

纯数值的骰面/属性修正仍然走 `modifiers` 配置，不要为它写 `effects`。

### 受击时的效果：beforeDamage

护甲的减免、致命拦截这类效果关心的是**结果**，不是自己那次投骰——防守方的 `afterRoll` 读不到对手的合计，压根不知道这一下会不会挨到。它们挂在 `beforeDamage`：攻防差、追加伤害和卷轴直伤都折算完了，血还没扣。

```ts
// equipment/armor.ts —— 灰铁胸甲
beforeDamage({ incoming, item, reduceDamage, addBattleLog }) {
  if (item.battleMemo !== undefined) return;   // 本场已用过
  if (incoming <= 0) return;                    // 没挨到就不算次数
  item.battleMemo = 1;
  reduceDamage(1);
  addBattleLog("灰铁胸甲卸掉了第一次冲击，伤害减少 1。");
},
```

三条约定：

* **只能把伤害改小。** 改伤只有 `reduceDamage(by)` 和 `keepAtLeast(hp)` 两个口，引擎都会钳一遍。顺序无关是靠这条成立的（多件装备一起挂钩子时谁先谁后不影响结果），而且减伤时机不该能加伤——真要加伤，加在攻击方的 `bonusDamage` 上，那里公开算进合计。用函数而不是可写字段，还挡掉了 `beforeDamage({ ...ctx })` 之后改副本这个坑。
* **`incoming` 是任何钩子动手之前的快照**，用它判断"这一击有没有真的打到"；它不随其他装备的减免变化。
* **只对受击方调用**，敌人没有装备会安静跳过。全部伤害都从 `dealBattleDamage` 落地——攻防结算和卷轴直伤共用它，所以钩子对巨龙打击一样生效。但**「损失生命」不走这条路**（见下一节的 `onScrollUsed`），那类自损从 `applyBattleHpLoss` 直接扣血，不该被减伤装备接管。

### 打出卷轴之后：onScrollUsed

「每次使用道具后……」这类代价挂在 `onScrollUsed`，每张打出的牌各调用一次：

```ts
// equipment/accessories.ts —— 黑日碎片
onScrollUsed({ player, loseHp }) {
  loseHp(1, `黑日碎片吞下余烬，${player.name}损失 1 点生命。`);
},
```

它是**唯一一个战斗和地图都会触发**的装备钩子——卷轴两个地方都能用，代价不该只在战斗里收。两处的血账本不一样（战斗读 `battle.hpA` / `hpB`，地图读 `player.hp`），所以扣血由调用方接好的 `loseHp(amount, logLine)` 负责，卡牌不必自己分辨自己在哪；上下文里的 `battle` 只在战斗中有值。

三条约定：

* **代价排在效果结算之后**，两处一致。反过来的话，残血时打疗牌会因为扣血下限白嫖掉代价——恰恰是它最该疼的时候。牌已经把对手打倒时战斗已经结束，代价自然不再发生。
* **战斗里可以把自己扣倒**，引擎会接着判负，本回合中止、对面选好的牌留在手里。**地图上至少保留 1 点**：那边根本没有战败规则，山路落石用的是同一个约定（`hazards.ts` 的 `minimumHp`）。
* **「损失生命」不是「受到伤害」。** 战斗里扣血走 `applyBattleHpLoss` 而不是 `dealBattleDamage`，因此不触发 `beforeDamage`。走伤害管线的话，灰铁胸甲会拿自损当"本场第一次受到伤害"白吃掉一次充能，不灭王铠还会替你挡住自己的代价——两件护甲反而让高代价装备变安全，正好把它的设计意图倒过来。

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

### 开战时抽签：onBattleStart 的 random

「每场战斗开始时随机 X」这类卡从上下文拿随机源，**不要自己 import**：

```ts
// equipment/accessories.ts —— 空白护符
onBattleStart({ item, random, addBattleLog }) {
  const engraved = random() < 0.5 ? TALISMAN_ATTACK : TALISMAN_DEFENSE;
  item.battleMemo = engraved;
  addBattleLog("空白护符浮现出攻击的纹路，本场攻击骰上限 +2。");
},
beforeRoll({ dieKind, item, modifiers }) {
  if (item.battleMemo !== (dieKind === "attack" ? TALISMAN_ATTACK : TALISMAN_DEFENSE)) return;
  modifiers.sidesOverride = (modifiers.sidesOverride ?? 6) + 2;
},
```

`random` 就是 `GameState` 上那条种子流（`nextRandom`），和地图事件抽取用的是同一条。换成 `Math.random` 的话同一局在两台机器上会分叉，重放与联机都对不上。

抽到的结果存进[暗格](#跨回合效果装备实例的战斗内暗格)，整场按它算——抽签只发生一次，不是每轮重抽，`clearBattleMemos` 会在战斗结束时把它清掉。**抽完立刻 `addBattleLog`**，别等第一次投骰时才说：抽到攻击那一面的对局里，防御骰从头到尾没有任何变化，玩家不该只能靠"没动静"反推抽到了什么。

## 稀有度与抽取

卷轴和装备共用 `src/game/content/rarity.ts` 的抽取通路：先抽稀有度，再在该稀有度的内容中等概率抽取。增加同稀有度卡牌不会改变其他稀有度的总概率。

**所有成组的稀有度权重都在 `REWARD_RARITY_TIERS` 这一张表里**，调用方只选档位名，不要在别处另写一组四个数字：

| 档位 | N / R / SR / PR | 用在哪 |
|---|---|---|
| `meager` | 85 / 10 / 5 / 0 | 可反复刷的来源（重复开箱）；唯一拿不到 PR 的一档 |
| `basic` | 80 / 15 / 4 / 1 | 无词条漫游怪 |
| `standard` | 50 / 30 / 15 / 5 | 通用档，`DEFAULT_RARITY_TIER` 指向它 |
| `premium` | 40 / 30 / 20 / 10 | 精英怪、阶段首领 |
| `highQuality` | 20 / 50 / 25 / 5 | 石中武器事件；不是 premium 之上的一级，而是牺牲 PR 换 R 的另一种形状 |

`CARD_RARITY_ORDER` 是**由低到高这件事的唯一定义**，`CardRarity` 类型由它推导；抽取按这个顺序走票，展示排序和 `withRarityFloor`（「必出 R 及以上」这类保底）也都读它。

`pickByRarity(items, rarityOf, random, weights?)` 是唯一的抽取入口，省略 `weights` 就是通用档。

空档不参加抽取，其权重由剩下的档位按比例承接——所以上面四个数字只有在每一档都至少有一张卡时才等于实际概率。装备与卷轴四档现已齐全，当前都正好是 50 / 30 / 15 / 5；装备发放的临时卷轴继续用 `drawable: false` 排除在随机卡池外。

> 改权重会打乱整个随机流，**加一张卡也一样**。「整局跑通」类测试（`engine.test.ts`、`events.test.ts`、`multiplayer.test.ts`）用的是 `testSupport.ts` 里的 `PLAYTHROUGH_SEED` / `PLAYTHROUGH_CAP`，同一颗种子的对局长度可能从一千多步跳到两万多。跑挂了先确认是不是这个原因，再决定怎么办。
>
> 顺序是固定的：**先量，再抬上限，永远不换种子**。补一批 N 档装备时 `PLAYTHROUGH_SEED` 从 17433 步涨到 24562 步，烧穿了当时 20000 的上限——这说明上限贴着实际步数定得太紧，不说明种子有问题。`engine.test.ts` 里 skip 的那条用例写了为什么不能靠换种子糊过去。
>
> 另一类症状是**超时而不是烧穿上限**：某条用例在循环体里做了随步数增长的活（`multiplayer.test.ts` 每步都要 `viewFor` 再全量扫一遍 `history`，整体 O(步数²)），那它本来就不该跑到步数上限。给这种用例一个自己的、写死的步数预算，再配一条"确实覆盖到了"的断言守着，别把它挂在全局上限上。

## 验证

改完跑 `npm run build`（它会依次做两份 tsconfig 的类型检查再构建）和 `npm test`。注意光跑 `tsc --noEmit` 不带 `-p` 是**无效的**——根 tsconfig 是 `files: []` 的引用壳，什么都不会检查。

测试放哪里按一条判据分：**测单张表自身形状的**跟着那张表放（`content/*/category.test.ts`），**跨模块的行为规格**放 `src/game/__tests__/`。后者没有单一归属模块——比如卷轴时机同时牵动 engine、battleRound 和 resources——散在模块旁边只会让 `src/game/` 的模块划分被测试文件埋掉。`testSupport.ts` 不是测试文件，留在 `src/game/`。

新增效果后应至少覆盖：使用时机、骰面/骰数、结算顺序、伤害下限、槽位约束、同种子重放，以及联机动作归属。

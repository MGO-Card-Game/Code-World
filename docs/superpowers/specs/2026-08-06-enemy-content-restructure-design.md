# 怪物内容结构重构设计

日期：2026-08-06

> **实现后记（2026-08-06）**：结构部分按本文实现。数值和两处结构在实测后作了调整，
> 见文末「14. 实现与设计的差异」。强敌格尚未放上地图，等分布方案确定。

## 1. 背景

装备和卷轴已经收敛到同一套内容结构：`definition.ts` 放定义类型与盖章工具，若干张分表放内容，`index.ts` 负责合并、推导 kind 类型、提供抽取与访问器，`category.test.ts` 守住结构性质。

怪物没有跟上。目前全部内容是 `src/game/content/enemies.ts` 里的 10 行：

```ts
export const ENEMIES: Record<string, EnemyDefinition> = {
  slime: { id: "slime", name: "史莱姆", maxHp: 8, attack: 2, defense: 1, reward: "scroll" },
  ...
};
```

由此产生五个具体问题：

1. **kind 不是推导类型。** `Record<string, EnemyDefinition>` 配上 `MapTile.enemyId?: string`，拼错的怪物名不报错，直接在 `engine.ts:350` 取 `.maxHp` 时崩掉。装备和卷轴用 `keyof typeof` 已经在编译期消掉了这类错误。
2. **没有访问器。** engine 里 6 处裸下标 `ENEMIES[battle.enemyId!]`（321 / 350 / 511 / 522 / 609 / 1406 行）。
3. **投放规则写在调用方。** `map.ts` 的 `ENEMY_POOLS` 手写怪物名单，boss 硬编码 `"dragon"`——等价于把卡池写在宝箱里。
4. **`reward: "boss"` 是死配置。** `finishBattle` 先判 `battle.kind === "boss"` 就返回了，巨龙那一行的 reward 永远读不到。这个字段现在混着表达「奖励什么」和「这是不是 Boss」两件事。
5. **没有效果钩子。** GameRule 8.6 规划了精英固定被动与 Boss 技能，而战斗侧的基建（`RollModifiers`、beforeRoll / afterRoll 上下文）装备已经铺好，怪物完全可以复用。

## 2. 目标与非目标

**目标**

- 怪物内容按装备/卷轴的目录与定义结构重组，kind 由配置键推导。
- 引入精英词缀：一组可以贴在任意漫游怪身上的强化，结构对标装备卡。
- 抽出装备与怪物共用的战斗钩子公共层。
- 新增强敌档与精英战斗格，落到地图生成里。

**非目标**

- 不做 Boss 多阶段机制。那需要在 `BattleState` 上存阶段状态、发新事件、走联机同步与动画编排，是引擎状态改动，与内容结构重构不是同一件事。
- 不做怪物卡牌 AI（GameRule 8.6 明确排除）。
- 不改玩家侧的数值与规则。

## 3. 分类模型

两个正交维度：

```
怪物本体（tier: roaming | apex | boss） × 精英词缀（affix，可选）
```

- **漫游怪 roaming**：进战斗格随机池，按区域权重抽取。slime / wolf / golem。
- **强敌 apex**：不进随机池，只在强敌格出现。
- **Boss**：只在 boss 格出现，击败即胜利，不发奖励。

「精英」不是本体的一档，而是贴在漫游怪身上的标志——和「稀有度是卡的属性、不是宝箱的属性」同构。任何漫游怪都可能出现精英个体。

## 4. 内容目录与定义

```
src/game/content/enemies/
  definition.ts      # EnemyBody / EnemyDefinition / EnemyTier / defineEnemies
  roaming.ts         # slime, wolf, golem
  apex.ts            # banditChief, frostFang
  boss.ts            # dragon
  affixes.ts         # 精英词缀表
  index.ts           # 合并 + EnemyKind 推导 + 区域抽取 + 访问器
  category.test.ts   # 结构守卫
```

`content/enemies.ts` 删除。`EnemyDefinition` 从 `types.ts` 搬进 `definition.ts`，`types.ts` 只留 `GameState` 相关的类型——与装备/卷轴的现状一致。

### 4.1 定义类型

```ts
export type EnemyTier = "roaming" | "apex" | "boss";

export interface EnemyBody {
  name: string;
  maxHp: number;
  attack: number;
  defense: number;
  /** 出现在哪些区域，值是该区域内的相对权重。boss 档不写——它由固定格投放。 */
  regions?: Partial<Record<MapRegionId, number>>;
  /** boss 档不写：击败即胜利，engine 走不到发奖励那一步。 */
  reward?: "scroll" | "equipment";
  effects?: EnemyEffects;
}

export type EnemyDefinition = EnemyBody & { tier: EnemyTier };

export function defineEnemies<T extends EnemyTier, R extends Record<string, EnemyBody>>(
  tier: T,
  table: R,
): { [K in keyof R]: R[K] & { tier: T } };
```

`defineEnemies` 与 `defineEquipment` 同形：档位由所在文件盖章，卡片不自己声明，结构上就不存在「卡片的 tier 和它所在的表对不上」这种漂移。

三处与现状不同，都是有意的：

- **删掉 `id` 字段。** 现在 `slime: { id: "slime", ... }` 把同一件事写了两遍，可以漂移。键即 kind，`EnemyKind = keyof typeof ENEMIES`。
- **`reward` 变成可选，`"boss"` 这个值消失。** 「这是不是 Boss」由 tier 表达。
- **区域投放写在怪身上。** 由 index 推导出池子，`map.ts` 不再持有怪物名单。

### 4.2 内容

漫游怪的区域权重就是现有 `ENEMY_POOLS` 的转置，手感不变：

| kind | 名字 | maxHp | attack | defense | regions | reward |
| --- | --- | --- | --- | --- | --- | --- |
| `slime` | 史莱姆 | 8 | 2 | 1 | foothill 2 | scroll |
| `wolf` | 山狼 | 11 | 3 | 2 | foothill 1 / mountainside 2 / summit 1 | scroll |
| `golem` | 石像守卫 | 15 | 4 | 3 | mountainside 1 / summit 2 | equipment |

强敌（新内容，均 `reward: "equipment"`）：

| kind | 名字 | maxHp | attack | defense | regions | 被动 |
| --- | --- | --- | --- | --- | --- | --- |
| `banditChief` | 山匪头目 | 18 | 5 | 3 | foothill 1 | **重斧**：攻击骰掷出最高面时额外造成 2 点伤害（`afterRoll`） |
| `frostFang` | 霜牙巨兽 | 22 | 5 | 4 | mountainside 1 | **霜息**：自身生命高于一半时，攻击 +2（`beforeRoll`） |

Boss：

| kind | 名字 | maxHp | attack | defense | 被动 |
| --- | --- | --- | --- | --- | --- |
| `dragon` | 峰顶巨龙 | 24 | 5 | 4 | **龙鳞**：防守时防御骰上限 +2（`beforeRoll`）<br>**暴怒**：自身生命低于一半时攻击 +2（`beforeRoll`） |

数值参照：玩家开局 18 / 攻 4 / 防 2。精英漫游怪折算后为史莱姆 14/3/2、山狼 17/4/3、石像守卫 21/5/4，强敌略高于同区精英，巨龙叠上两个被动仍是最硬的一个。

### 4.3 index 导出

```ts
export const ENEMIES = { ...ROAMING_ENEMIES, ...APEX_ENEMIES, ...BOSS_ENEMIES };
export type EnemyKind = keyof typeof ENEMIES;

export const ENEMIES_BY_TIER = { roaming: ..., apex: ..., boss: ... };

export function enemyDefinition(kind: EnemyKind): EnemyDefinition;
export function pickRoamingEnemy(region: MapRegionId, random: () => number): EnemyKind;
export function pickApexEnemy(region: MapRegionId, random: () => number): EnemyKind;
export function pickEliteAffix(random: () => number): EliteAffixKind;
```

`pickRoamingEnemy` / `pickApexEnemy` 在对应档位里按 `regions[region]` 权重抽取，权重缺省或为 0 表示该区域不出这只怪。`pickEliteAffix` 走现有的 `pickByRarity`。

分表之间键必须互不重复——展开合并时后者会静默覆盖前者，由 `category.test.ts` 的数量断言守着，与装备/卷轴同一条防线。

## 5. 精英词缀与钩子公共层

### 5.1 钩子公共层

新建 `src/game/effects/battleHooks.ts`，装 `cardEffects.ts` 里与「谁持有这个效果」无关的部分：

```ts
export type DiceKind = "attack" | "defense" | "movement";

/** 原 EquipmentModifier。装备和精英词缀共用，名字里不该再挂 Equipment。 */
export type StatModifier =
  | { type: "statBonus"; stat: "attack" | "defense"; value: number }
  | { type: "dieSides"; die: DiceKind; value: number }
  | { type: "diceCount"; die: Exclude<DiceKind, "movement">; value: number }
  | { type: "maxHp"; value: number };

export interface RollModifiers { /* 原样搬 */ }
export interface RollResult { /* 原 EquipmentRollResult */ }

/** 一次投骰里，与持有者无关的那部分上下文。 */
export interface BattleHookContext {
  state: GameState;
  battle: BattleState;
  side: CombatSide;
  opponentSide: CombatSide;
  dieKind: Exclude<DiceKind, "movement">;
  modifiers: RollModifiers;
  ownHp: number;
  ownMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  addBattleLog: (text: string) => void;
}

/** 怪物没有实例、不会被装备卸下，上下文就是公共层本身。 */
export interface EnemyEffects {
  beforeRoll?: (context: BattleHookContext) => void;
  afterRoll?: (context: BattleHookContext & { roll: RollResult }) => void;
}
```

`cardEffects.ts` 保留卷轴与装备专属的部分，`EquipmentBattleContext = BattleHookContext & { player: Player; item: OwnedEquipment }`。`EnemyEffects` 放在 `battleHooks.ts` 而不是 `content/enemies/definition.ts`，是为了避开循环引用——定义表要 import 效果类型，效果类型就不能反过来依赖定义表。

`DynamicEquipmentModifier`（排除 maxHp 的那个）留在 `cardEffects.ts`：它排除 maxHp 是因为装备穿脱要同步真实生命值，而怪物词缀在刷怪时就定死了，不存在这个问题，用完整的 `StatModifier`。

怪物**不提供** `onBattleStart`。装备那个钩子的存在理由是 `grantBattleScroll`，而 GameRule 8.6 明确怪物不使用卷轴。真有需求时再加，届时是一处改动。

改 import 的文件共四个：`engine.ts`、`selectors.ts`、`content/equipment/definition.ts`、`content/scrolls/definition.ts`。

### 5.2 精英词缀

```ts
// content/enemies/affixes.ts
export interface EliteAffixDefinition {
  name: string;                    // 拼在本体名前面：「狂暴的山狼」
  description: string;
  rarity: CardRarity;              // 复用 pickByRarity 的权重
  modifiers: readonly StatModifier[];
  effects?: EnemyEffects;
}

/** 所有精英个体共享的强化。词缀只负责特色，不必每条都重复抄血量。 */
export const ELITE_BASE_MODIFIERS: readonly StatModifier[] = [
  { type: "maxHp", value: 6 },
  { type: "statBonus", stat: "attack", value: 1 },
  { type: "statBonus", stat: "defense", value: 1 },
];
```

五条词缀，前三条走 modifier 通路，后两条走钩子通路：

| kind | 名字 | 效果 | 稀有度 | 实现 |
| --- | --- | --- | --- | --- |
| `frenzied` | 狂暴的 | 攻击 +2 | N | `statBonus` |
| `ironclad` | 坚甲的 | 防御 +2 | N | `statBonus` |
| `swift` | 迅捷的 | 攻击骰 +1 颗 | R | `diceCount` |
| `venomous` | 淬毒的 | 攻击时额外 1 点无视防御的伤害 | R | `afterRoll` |
| `cornered` | 濒死反扑 | 自身生命低于一半时攻击 +3 | SR | `beforeRoll` |

`venomous` 只在 `dieKind === "attack"` 时加 `bonusDamage`——`RollModifiers` 的注释写明防守侧的反伤还没有独立的伤害事件与击倒判定顺序，这条约束必须守住。

`cornered` 的半血判定用乘法（`ownHp * 2 < ownMaxHp`）而不是除法，避免卡在浮点边界上，与 `monsterHunterBlade` 的写法一致。

### 5.3 结算顺序

一只怪身上最多两组效果：本体的和词缀的，按「本体先、词缀后」遍历。累加类修正与顺序无关；`bonusDamage` 是累加的，也不受顺序影响。这一点与装备遍历同理。

## 6. 引擎改动

### 6.1 数值折算

`selectors.ts` 现有五个 getter（`getAttack` / `getDefense` / `getDieSidesBonus` / `getDiceCountBonus` / `getMaxHpBonus`）是同一个 filter + reduce 形状抄了五遍。抽一个私有 `foldModifiers(mods, predicate)`，玩家侧与怪物侧共用，并新增：

```ts
export function enemyStats(kind: EnemyKind, affix?: EliteAffixKind): {
  name: string;      // 「狂暴的山狼」
  maxHp: number;
  attack: number;
  defense: number;
};
export function enemyDieSidesBonus(kind, affix, die): number;
export function enemyDiceCountBonus(kind, affix, die): number;
export function enemyEffects(kind, affix): readonly EnemyEffects[];
```

### 6.2 必须跟着改的三处

怪物能带 modifier 之后，下面三处现在是写死的，不改的话新效果会**静默失效**：

- `rollForSide`（engine.ts:800）现在是 `player ? getDieSidesBonus(...) : 0`，怪物恒定 1 颗 d6。要加怪物分支，否则 `swift` 不起作用。
- `sideStats`（engine.ts:505）与 `sideMaxHp`（engine.ts:519）要走 `enemyStats`，折算 `ELITE_BASE_MODIFIERS` 与词缀。
- `startBattle` 的 `hpB` 跟着用折算后的 maxHp。

### 6.3 其余

- `combatantName` 走 `enemyStats().name`。
- 6 处裸下标改用 `enemyDefinition()` / `enemyStats()`。
- 新增 `applyEnemyBeforeRoll` / `applyEnemyAfterRoll`，与 `applyEquipmentBeforeRoll` / `applyEquipmentAfterRoll` 在投骰流程里同一位置调用（卷轴 → 装备/怪物）。
- `equipmentBattleContext()` 拆成「建公共层」+「补 player / item」，怪物那条路复用前半段。
- `getBattleParticipants` 现在直接把 `EnemyDefinition` 交给 UI，改成返回 `enemyStats()` 的折算结果（含词缀名与折算后的 maxHp），`BattlePanel` 不用改。

## 7. 地图投放

三种战斗格：

| 格子类型 | 怪从哪来 | 位置 |
| --- | --- | --- |
| `battle` | `pickRoamingEnemy(region)` | 随机池 |
| `elite` | `pickRoamingEnemy(region)` + `pickEliteAffix()` | 随机池 |
| `apex` | `pickApexEnemy(region)` | 固定在区域末格 |

强敌不进随机池，占山脚和山腰的末格（第 35、71 格）当区域关卡；峰顶末格本来就是 Boss，所以一局固定两个强敌格。精英只出现在精英格，普通战斗格不会随机升级——需要的话以后加一个概率即可，不影响结构。

强敌格走 `pve` 战斗，和普通战斗格是同一条结算路径：胜利按 `reward` 发奖励，战败退回休整点。只有 Boss 格用 `boss` 战斗（击败即胜利）。强敌格与精英格都不是安全区，照常触发相遇战判定。

区域容量因为多了强敌格从 35 / 36 / 35 变成 34 / 35 / 35。`MAP_TILE_LIMITS` 重新分配：

```ts
battle:   { min: 8,  max: 11 },   // 原 10~13，让出名额
elite:    { min: 2,  max: 3  },   // 新增
event:    { min: 8,  max: 11 },
treasure: { min: 6,  max: 8  },
spring:   { min: 4,  max: 6  },
```

min 合计仍是 28，max 合计 39 ≥ 35，`chooseCounts` 的可行性不变。每区 2~3 个精英格，一局 6~9 次精英遭遇。

`RandomTileType` 要跟着改成 `Exclude<TileType, "start" | "boss" | "apex">`——强敌格和起点、Boss 格一样是固定放置的，不进随机池，`MAP_TILE_LIMITS` 里不该有它的位置。

「不允许连续三个战斗格」的判定改成按**战斗类**算（`battle | elite`）。连打三场，是不是精英对手感没有区别。

强敌格本身不计入这条判定：它的位置是固定的，洗牌回避不了，写进去只会让约束在某些种子下无解。但它前面的格子照常受约束，所以最坏情况是「战斗、战斗、强敌」三连——这是可接受的，区域末尾本来就该是一段爬坡。

`ENEMY_POOLS` 删除。

## 8. 状态与事件

```ts
// MapTile
enemyId?: EnemyKind;          // 原 string
eliteAffix?: EliteAffixKind;  // 新增，只有 elite 格有

// BattleState
enemyId?: EnemyKind;
enemyAffix?: EliteAffixKind;

// GameEventBody.battleStarted
enemyAffix?: EliteAffixKind;

// TileType
"start" | "battle" | "elite" | "apex" | "event" | "treasure" | "spring" | "boss"
```

`startBattle` 多接一个 `affix` 参数，`resolveTile` 的 `battle` / `elite` / `apex` 三个分支把 `tile.eliteAffix` 传进去。

**联机侧零改动。** 怪物信息全部公开，不是暗牌：`redactPhase` 用 spread 保留其余字段，`redactEvent` 只裁卷轴 kind，新字段自动透传。精英词缀在地图生成时定死并随 `GameState` 广播，「同种子生成相同地图」和「双端一致」两条性质不受影响。

## 9. 界面

- `content/tiles.ts` 的 `TILE_ICON` 加 `elite` / `apex` 两个图标。它是 `Record<MapTile["type"], string>`，漏了会编译报错。
- `Board.tsx:9` 的 `tileClassNames` 是裸对象字面量，加格子类型不会报错、只会静默掉样式。标注成同一个 `Record<MapTile["type"], string>`，并补两条样式。
- 战斗面板显示的怪物名由 `getBattleParticipants` 给出，精英个体自然显示为「狂暴的山狼」。

## 10. 测试

**`content/enemies/category.test.ts`**（对标装备那份）

- 合并后不丢卡：分表键数之和等于 `ENEMIES` 键数。
- 每只怪的 tier 就是它所在的表。
- 每只怪都有名字，`maxHp` / `attack` / `defense` 均为正数。
- roaming 与 apex 都至少声明一个区域权重；boss 档不带 `regions`，也不带 `reward`。
- 每个区域的漫游池非空，每个会放强敌格的区域（除峰顶外的所有区域）强敌池非空——空池会让 `pickByRarity` 直接抛。
- 每条精英词缀都有名字、描述、合法稀有度和 modifiers 数组。

**`enemyBattleHooks.test.ts`**（对标 `equipmentBattleHooks.test.ts`）

- `swift` 真的多投一颗攻击骰。
- `venomous` 只在攻击侧追加伤害，防守侧不追加。
- `cornered` 的半血阈值判定正确，且恰好半血时不触发。
- 精英的 maxHp 加成折算进 `startBattle` 的 `hpB`。
- 强敌与 Boss 的被动各有一条断言。

**`map.test.ts`** 补充

- 精英格数量在每个区域都落在上下限内。
- 强敌格固定在山脚与山腰的末格，峰顶末格是 Boss。
- 每个精英格都带 `eliteAffix`，每个战斗类格子都带 `enemyId`。
- 同种子生成的精英词缀完全一致。
- 「不会产生连续三个战斗格」改成按战斗类判定。

## 11. 改动清单

| 文件 | 改动 |
| --- | --- |
| `content/enemies.ts` | 删除 |
| `content/enemies/*` | 新建（6 个文件 + 1 个测试） |
| `effects/battleHooks.ts` | 新建 |
| `effects/cardEffects.ts` | 移出公共部分，改为 import |
| `types.ts` | 移出 `EnemyDefinition`；`TileType` 加两项；`MapTile` / `BattleState` / `battleStarted` 加字段；`enemyId` 收紧为 `EnemyKind` |
| `selectors.ts` | 抽 `foldModifiers`；新增怪物侧折算函数 |
| `engine.ts` | 6 处裸下标改访问器；`rollForSide` / `sideStats` / `sideMaxHp` / `startBattle` 折算词缀；新增怪物钩子调用；`equipmentBattleContext` 拆分；`getBattleParticipants` 返回折算结果 |
| `map.ts` | 删 `ENEMY_POOLS`；`MAP_TILE_LIMITS` 重分配；生成精英格与强敌格；三连判定改按战斗类 |
| `content/tiles.ts` | 加两个图标 |
| `ui/Board.tsx` | `tileClassNames` 加类型标注与两条样式 |
| `map.test.ts` | 按上节补充 |
| `docs/GameRule.md` | 6.3 敌人数据、5 格子类型表、4.2 数量限制表同步 |

## 12. 风险

- **数值未经实测。** 强敌与精英词缀的具体数字是按现有梯度推的，`ELITE_BASE_MODIFIERS` 的 +6 血 / +1 攻 / +1 防 尤其需要试玩后调整。这些数字集中在两个常量里，调起来是改一处。
- **地图容量是硬约束。** 加了强敌格之后每区只剩 34~35 个随机位，`MAP_TILE_LIMITS` 的 min 合计（28）与 max 合计（39）必须继续夹住容量，否则 `chooseCounts` 会抛「地图格数量规则无法填满」。改这张表时要连带核对。
- **`rollForSide` 的怪物分支容易漏。** 那里现在把「没有玩家」等同于「没有任何修正」，是 `swift` 这类词缀唯一的失效点，且失效是静默的——所以测试里专门有一条断言盯着它。

---

# 14. 实现与设计的差异

实现过程中有五处偏离本文，四处是实测数据推翻了设计里的猜测。

## 14.1 `EnemyBody` 增加了 `modifiers` 字段

设计里只有精英词缀带 `StatModifier`，怪物本体只有 maxHp / attack / defense 三个基础字段。
写巨龙时才发现骰面和骰数没有对应的基础字段，本体想表达「防御骰是 d8」只能去占用钩子——
而无条件的数值改动不该占用钩子。加了 `modifiers?: readonly StatModifier[]`，与 `EquipmentBody` 对齐。

## 14.2 精英数值大幅下调

设计里的 `ELITE_BASE_MODIFIERS` 是 +6 血 / +1 攻 / +1 防，词缀再各加 +2。实测：
基础玩家（18 血 / 攻 4 / 防 2、无装备无卷轴）对精英怪的胜率

| | 无词缀 | 狂暴 | 坚甲 | 迅捷 | 淬毒 | 濒死 |
| --- | --- | --- | --- | --- | --- | --- |
| 史莱姆 | 100% | 45% | 30% | 16% | 62% | 63% |
| 山狼 | 95% | 3% | 0% | 0% | 7% | 5% |
| 石像守卫 | 33% | 0% | 0% | 0% | 0% | 0% |

自动对局的中位步数从改动前的 1910 涨到 65349，PvE 战败数千次。原因是攻防差配上 d6 的结算里，
每 1 点攻防都非常贵——「+2 防御」听起来是小数字，实际能把胜率打到个位数。

改成：基础只 +4 血，攻防全部交给词缀，狂暴 / 坚甲各 +1。改后同一张表：

| | 无词缀 | 狂暴 | 坚甲 | 锋锐 | 淬毒 | 濒死 |
| --- | --- | --- | --- | --- | --- | --- |
| 史莱姆 | 100% | 99% | 99% | 96% | 97% | 95% |
| 山狼 | 95% | 66% | 64% | 61% | 57% | 56% |
| 石像守卫 | 33% | 5% | 2% | 5% | 4% | 3% |

精英山狼落在 56~66%，是想要的「硬仗但打得过」。精英石像守卫仍然很硬，
但它只出现在山腰和峰顶，那时玩家已经有装备——自动对局里带装备的机器人对
坚甲的山狼是 78%、对石像守卫是 57%。

## 14.3 「迅捷的」改成「锋锐的」，走骰面而不是骰数

`diceCount: +1` 是多掷一整颗 d6，期望值直接 +3.5，对一条 R 档词缀太重：
精英山狼胜率 11%。改成 `dieSides: +2`（期望值 +1）。

代价是正式内容里不再有人用 `diceCount` 这条通路。它仍然是有效的修正类型，
所以 `enemyBattleHooks.test.ts` 用一条探针词缀把这条分支守住。

## 14.4 巨龙不加被动

设计里给巨龙加「龙鳞」（防御骰上限 +2）与「暴怒」（半血后攻击 +2）。实测不能加：

| 巨龙配置 | 四颗种子的整局步数 |
| --- | --- |
| 改动前（无被动） | 1200 / 1866 / 3914 / 1910 |
| 龙鳞 + 暴怒 | 2904 / 未完成 / 未完成 / 32027 |

这场仗本来就极其吃装备：改动前跑十颗种子，机器人要 7～462 次才打得过巨龙，
Boss 战尝试次数本身就是整局步数的主要来源。再加两个被动之后变成 1668～4441 次，
四颗种子里两颗八万步都打不完。

峰顶平衡是独立的一件事，得先单独调；调完再谈给巨龙加被动。
钩子通路并不因此失去覆盖——精英词缀和强敌都在用。

## 14.5 强敌格尚未放上地图

强敌怪（山匪头目、霜牙巨兽）的内容、区域权重和 `pickApexEnemy` 都已就位，
但 `TileType` 没有加 `apex`，地图上也没有强敌格——分布方案待定。
因此区域容量维持 35 / 36 / 35，第 7 节里按「多一个强敌格」算的 34 / 35 / 35 暂不适用；
`MAP_TILE_LIMITS` 的 min 28 / max 39 对这两组容量都成立，加强敌格时不必再改这张表。

顺带：第 7 节说的「按战斗类判定三连」落在 `types.ts` 的 `isCombatTile`，
地图生成、地图测试和以后的界面共用同一份定义，免得各写一份对不上。

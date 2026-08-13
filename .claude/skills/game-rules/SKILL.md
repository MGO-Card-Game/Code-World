---
name: game-rules
description: 骰境登峰的规则与卡面关键字。加改卷轴、装备、赐福、怪物词条、敌人或事件内容时使用；写或改卡面 description 时使用；被问「XX 规则是怎么定的」时使用；调平衡数值或 review 内容改动时使用。它管两件事：规则真相在哪一层（代码 / README / GameRule / 草稿各自算数到什么程度），以及牌面措辞与关键字该怎么写。纯 UI、动画、联机传输和构建改动不需要它。
user-invocable: true
---

# 骰境登峰：规则与关键字

规则真相散在五处，牌面措辞没有类型系统兜底。这份 skill 管的就是这两件事。

## 一、规则真相优先级

冲突时从上往下认，**上面的赢**：

| 层 | 位置 | 算什么 |
|---|---|---|
| 1 | `src/game/` 代码 | **已实现行为的唯一真相**。跑得出来的就是规则 |
| 2 | `docs/content-extension.md` | 架构与扩展约定：新东西该加在哪、为什么这么切 |
| 3 | `README.md#当前原型规则` | 原型对 GameRule 的**有意偏离**，已经落地 |
| 4 | `docs/GameRule.md` §26 当前已确定规则 | 企划正式内容 |
| 5 | `docs/GameRule.md` 正文 + §27 当前暂定规则 | 设计意图，其中有未实现的，也有已经被实现绕过的 |
| 6 | `docs/superpowers/specs/*.md` | 单个特性的设计决策记录，写完那天为准 |
| 7 | `docs/buff.md`、`docs/newCard.md` | **草稿**。里面既有早已实现的，也有永远不会做的 |

判据只有一条：**代码与文档冲突时，先判定这是有意偏离还是 bug，不要自动改代码。**

- 有意偏离 → 补一条 `README#当前原型规则` 或 GameRule §27，让偏离本身被记下来
- bug → 改代码，并补一条用例

`docs/寰宇之剑.md` 是空文件。

章节索引、已知过期段落和已知冲突见 [references/rules-map.md](references/rules-map.md)。

## 二、卡面关键字

关键字表是**运行时代码**：`src/game/content/keywords.ts`。每条三列——`label`（牌面印的字）、`rule`（玩家点开读到的规则）、`engine`（它在引擎里落在哪）。

文档不抄这张表。要查有哪些词、每个词什么意思，**直接读那个文件**；抄一份只会把漂移从「代码 vs 牌面」搬到「代码 vs 文档」。

收词判据、推导与声明的分界、措辞标准，见 [references/keywords.md](references/keywords.md)。

## 三、加一张卡

1. **先定它落在哪张表**。卷轴按效果主题分（`scrolls/diceBoost.ts` 等），装备按分类分（`equipment/weapons.ts` 等），分类由文件盖章，不写在卡上。跨表 kind 不能重名——展开合并会静默覆盖。
2. **能用声明式 `effects` 就别写函数**。写不了才用 `custom` / 装备钩子；只有两个以上效果共享同一种稳定语义时，才把它提升成新的通用效果类型。
3. **想清楚多张叠加怎么合并**。一回合可以打任意张卷轴（GameRule §8.5），累加类求和、`dieSides`/`minimumRoll`/`fixedRoll` 取最大、`rollTwice` 只启用一次——这几种换顺序结果不变，所以不需要优先级。带副作用的 `directDamage` 和 `custom` 按提交顺序结算。
4. **按 [references/keywords.md](references/keywords.md) 写描述**，该声明的关键字声明上。能推导的不要手写。
5. **跑 `npm run build` 和 `npm test`**。`tsc --noEmit` 不带 `-p` 是无效的，根 tsconfig 是 `files: []` 的引用壳。

### 新增卡会打乱随机流

加一张卡就会让同一颗种子的对局长度整个变样（补一批 N 档装备时从 17433 步涨到 24562 步）。整局跑通类测试挂了先确认是不是这个原因。

顺序是固定的：**先量，再抬 `PLAYTHROUGH_CAP`，永远不换种子**。`engine.test.ts` 里 skip 的那条用例写了为什么不能靠换种子糊过去。

## 四、两条容易踩的语义

这两条在引擎里是不同管线，写卡和读卡都不能混：

- **「损失生命」不是「受到伤害」**。损失走 `applyBattleHpLoss`，不触发 `beforeDamage`，减伤装备接不住；伤害走 `dealBattleDamage`。走错管线的话，灰铁胸甲会拿自损白吃掉一次充能，不灭王铠还会替你挡住自己的代价。
- **「攻击 +2」不是「本次攻击 +3」**。前者是 `statBonus`（永久属性），后者是 `flatBonus`（单次投骰）。牌面上只差两个字，量纲完全不同。

血量一律读上下文的 `ownHp` / `opponentHp`，不要读 `player.hp`——PvP 期间战斗血量在 `battle.hpA` / `hpB` 上，`player.hp` 不动。

更细的钩子时机、暗格、临时牌约定在 `docs/content-extension.md`，那份是权威，不要在这里重复。

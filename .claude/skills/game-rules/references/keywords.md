# 卡面关键字与措辞

## 两类词表在代码里

特殊机制关键字在 `src/game/content/keywords.ts`，通用规则术语在
`src/game/content/ruleTerms.ts`。要知道有哪些词、每个词什么意思，读这两个文件——
这里不抄一份，抄了就是第二个会过期的地方。

- **特殊机制关键字**：`无视防御`、`自损`、`代替移动`，在描述前印成标签
- **通用规则术语**：`攻击骰上限`、`移动骰`、`骰点总值`、`生命上限`，留在原句中用点状下划线标识

基础数值不要收成 `attackDieSidesUp` 这类静态关键字。`ruleTermsForModifiers()` 会把
`dieSides`、`diceCount`、`maxHp` 映射到参数化的术语概念，测试再核对卡面有没有使用
对应标准词。这样攻击／防御／移动／先攻共用一种规则，而不是复制四套关键字。

`keywords.ts` 每条三列：

- `label` 牌面印的字
- `rule` 玩家点开详情读到的规则，也是标签的悬停文本
- `engine` 它在引擎里落在哪，给内容作者看，不进界面

`ruleTerms.ts` 每条四列：`label`、`aliases`（只兼容自然语序，不是新概念）、`rule`、`group`（决定正文里的着色分组）。

## 收一个新词的判据

**复现，不是「这个机制重要」。** 只有一张卡用得上的规则，在那张卡的描述里说清楚就够了；印成关键字反而要玩家多背一个词。

参照：`minimumDamage`（攻击被完全挡下仍造成固定伤害）只有鬼切一张在用，所以**没有**收进词表。`selfCost` 只有两张卡，但它背后是「损失生命 ≠ 受到伤害」这条最容易写错的语义，收了。

`keywords.test.ts` 有一条「每条关键字都至少有一张卡在用」挡着词表长草。

## 推导还是声明

**能看出来的一律推导，不许手写。** 判据和「卡牌类型由 `timings` 推导」「装备 category 由文件盖章」是同一条：手写一份就等于多出一处能和实际不符的地方。

| 来源 | 怎么来 |
|---|---|
| 卷轴的 `needsTarget` / `replacesMovement` / `skipsPath` | 从 `effects` 数组推导，**手写会被用例拦下** |
| 卷轴的 `directDamage` | 从声明式 `directDamage` 效果推导 |
| 其余全部 | 手写 `keywords: [...]` |

装备和怪只能手写：效果都住在 `effects` 的函数体里，静态看不出它做了什么。

出口统一走 `scrollKeywords()` / `equipmentKeywords()`，它们会把手写和推导的合并、去重、排成固定顺序。**不要自己拼 `definition.keywords`**——那样只拿到手写的一半。

## 牌面措辞

### 标准写法

| 写这个 | 引擎里是 | 别写 |
|---|---|---|
| 额外造成 N 点伤害 + `无视防御` 标签 | `modifiers.bonusDamage` | 「无视防御」写进描述、「附加 N 点伤害」 |
| 造成 N 点伤害，减去其当前防御 + `掷骰前伤害` 标签 | `directDamage` 效果或钩子里的 `dealDamage` | 描述里再写一遍「掷骰前」 |
| 攻击骰上限 +N | `dieSides` 修正（叠加在基础骰面上） | 「D6 提升为 D8」「（D6 → D7）」——基数会被别的装备改掉 |
| 本次攻击或防御骰改为 DN | 卷轴的 `dieSides` 效果（替换基础骰面） | 「由 D6 变为 D20」 |
| 每颗X骰最低视为 N | `minimumRoll`（作用于**每一颗**） | 「最低点数为 N」、「每个骰」 |
| 前 N 颗骰视为最高面 | `maxRoll`（只赚不亏） | — |
| 接着 N 颗骰定为 X | `fixedRoll`（**可能比随机更差**，是真取舍） | 「最低视为 X」 |
| 攻击永久 +N / 防御永久 +N | `statBonus` | 「攻击力+2」、「防御+1」 |
| 本次攻击 +N / 本次防御 +N | `flatBonus`（单次投骰） | 和上一行混用 |
| 生命上限 +N | `maxHp` | 「最大生命 +N」 |
| 直接前进 N 格 | `advanceTiles` / `chooseMovement`，**逐格**走，触发营地回血与守关门计次 | 「传送」 |
| 跃至前方至多 N 格 | `teleport`，**只结算落点** | 「前进」 |

### 三条硬规矩

1. **能被关键字整句替代的短语，从描述里删掉。** 「无视防御」「本场战斗限定 ·」「精英与首领限定 ·」现在由标签承担，界面上标签就贴在描述前面，留着会并排说同一件事。
2. **带这张卡自己数值和条件的说明留着。** 「减去其当前防御」「损失 N 点生命」关键字表达不了共性之外的部分。
3. **卡面和能力说明不带句末句号。** 事件文本不在此列——那是叙述句，本来就该带。

### 量词

骰子用「颗」（每颗攻击骰）。「个」只用于计数（额外投 1 个骰子）。

## 校验

`src/game/content/keywords.test.ts`、`src/game/content/ruleTerms.test.ts`（数据层）和
`src/ui/keywordSurfaces.test.ts`（界面层）。

数据层这几条最容易撞上：

- **「用了 X 却没声明 Y」**：它读的是钩子的**源码字符串**（`Function.prototype.toString`），因为 `bonusDamage` 这类词只在函数体里出现。加了 `modifiers.bonusDamage += n` 就必须声明 `ignoreDefense`，反向也查。
- **「装备发的牌都印着本场战斗限定」**：从装备源码里挖 `grantBattleScroll("X")`，逐张断言 `battleOnly` + `drawable: false`。忘了 `drawable: false`，宝箱和战斗奖励会把战斗限定牌当普通卷轴发出去，变成永久卡。
- **措辞黑名单**：上面那张表的「别写」列。
- **modifier 对术语**：装备、赐福和怪物词条的 `dieSides` / `diceCount` / `maxHp`
  必须在卡面出现对应通用术语。多种骰子各写完整，例如
  `攻击骰上限 +1；防御骰上限 +1`，不要压成 `攻击和防御骰上限各 +1`。

界面层两条查的是**渲染点有没有漏**。描述里那句已经删了，只渲染 `description` 的地方玩家读到的就是残缺的卡：

- 直接从表里取 `description`（`EQUIPMENT[kind].description`）必须交给 `CardBlurb`
- 渲染了卡面说明的文件必须引 `CardBlurb` / `KeywordRules` / `blurbText`

`PlayerPanel.tsx` 在文件级检查里有一条具名豁免，理由写在测试里。

## 界面上怎么渲染

按空间分工，加新渲染点时照着选：

- **紧凑处**（手牌 96px、战斗卡 118px、商店货架、交易清单、奖励选项）用 `CardBlurb`，标签内联嵌在描述前面，规则靠悬停
- **详情弹层**（装备详情、首领情报，720px）用 `KeywordRules`，标签下面摊开规则原文
- **只有通用术语、没有特殊关键字的说明**（赐福、事件、成长）用 `RuleText`
- **读屏与 title** 用 `blurbText`，把标签念进 `aria-label`

四条都在 `src/ui/shared.tsx`。

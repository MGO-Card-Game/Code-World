# 商店格设计

日期：2026-08-08

## 1. 背景

地图上现在有一个商店，但它不在地图上——`canUseShop` 判定玩家站在安全区（营地或守关之门）且处于 `turnComplete`，底部操作条就多出一颗「旅商补给」按钮，卖两样固定商品：100 金币的暗牌卷轴、40 金币恢复 5 点生命。价格固定，商品固定，永远开张。

这套设计有它的位置——它是保底补给，随时可取，所以定价偏贵、不给选择。但它填不了另一个空缺：金币现在的出口太窄。战斗、宝箱、事件稳定产金，装备槽满了还会折算变现，而能花钱的地方只有那两样，后期金币会单向堆积。

商店格补的是这个缺口：一个会出现在路上的、有货架的、看得见牌面的商店。它和营地商店互补而不是替代——营地卖的是「随时买得到」，商店格卖的是「看得见自己在买什么」。

## 2. 目标与非目标

**目标**

- 新增 `shop` 格子类型，每阶段地图恰好一格。
- 踩上去打开一个 6 货位的货架：随机卷轴 ×1、四个部位的装备各 ×1、基础属性提升 ×1。
- 每次进入重新刷新库存。
- 价格按品质分档并带浮动。
- 给金币一个能持续消耗的出口，但不让它退化成「钱换永久面板」的兑换机。

**非目标**

- 不做卖出（把自己的卷轴/装备换钱）。折算变现已经由装备槽位满时的 `salvageEquipment` 承担，再开一个卖出口会让「攒装备变现」重新变得划算，这正是 `equipmentSalvage` 的注释刻意压价要避免的事。
- 不改营地商店的商品和定价。本设计只改它的**判据**（见 4.3），因为商店格要占用 `safeZone` 这个语义。
- 不做跨玩家的共享货架。库存是每次进入各自生成的（见 5.1）。

## 3. 玩法规则

**位置**：每个阶段区域恰好一个商店格，位置随机，和其它随机格子一起洗牌。

**不触发玩家互动**：商店格是安全区。同格有对手也不会进入相遇、交易或相遇战。

**库存**：踩上去时一次性掷出 6 个货位，顺序固定：

| 货位 | 内容 |
| --- | --- |
| 1 | 随机卷轴（明牌，从可抽取卷轴池按稀有度权重抽） |
| 2 | 随机武器 |
| 3 | 随机护甲 |
| 4 | 随机鞋子 |
| 5 | 随机饰品 |
| 6 | 基础属性提升，在攻击 +1 / 防御 +1 / 生命上限 +3 中随机一项 |

装备按各自部位的卡池抽取，用现有的 `pickEquipmentKind(random, { category })`。属性提升的数值直接复用 `growth.ts` 的 `STAT_GROWTH`，不另立一套。

**购买**：钱够就能买，可以连买，买过的货位标记售罄并留在架上。玩家主动离店，或买空后离店，回到 `turnComplete`。

**刷新**：库存随 phase 一起消失，下次踩上来重新掷。同一个玩家反复路过会拿到不同的货架，不同玩家看到的也是各自的货架。

## 4. 定价

### 4.1 基价与浮动

```
装备  N 60 / R 120 / SR 220 / PR 400
卷轴  N 40 / R 80  / SR 150 / PR 280
属性  250 × 1.6^(该玩家累计已购次数)  →  250 / 400 / 640 / 1020 …
```

卷轴和装备各自独立掷一个 **75% ~ 125%** 的系数，乘上基价后按下面的公式取整到 `GOLD_SCALE`（10）的倍数：

```ts
Math.round(basePrice * factor / GOLD_SCALE) * GOLD_SCALE
```

浮动让同一件卷轴或装备在不同的货架上值不同的钱，「这次要不要买」才成为一个判断，而不是查表。**属性提升不参与浮动**，只按累计购买次数计算递增基价并取整到 `GOLD_SCALE`；因此购买后下一次属性提升的实际售价一定上升，不会被两次独立浮动抵消。

### 4.2 两条数值约束

这两条是定价必须守住的边界，不是调优空间：

**不能反手套利。** 装备买进来之后，将来槽位满时会走 `salvageEquipment` 折算成金币。折算价会吃赐福「点石成金」的 1.2 倍率，所以每一档的实际折算上限是 N 24 / R 48 / SR 96 / PR 180。每一档的**最低售价**必须高于该档折算价的**上限**：

| 档 | 最低售价 | 折算价上限 | 差 |
| --- | --- | --- | --- |
| N | 50 | 24 | +26 |
| R | 90 | 48 | +42 |
| SR | 170 | 96 | +74 |
| PR | 300 | 180 | +120 |

否则「买进来再挤掉」就成了一台印钞机。

**和营地商店不打架。** 营地暗牌卷轴固定 100；商店格明牌卷轴按稀有度权重（N 50 / R 30 / SR 15 / PR 5）算出的期望价是 80.5。营地贵约两成，买的是「随时能买、不用绕路」；商店格便宜一点，买的是「看得见牌面」。两边各有各的理由，谁也不废掉谁。

### 4.3 属性提升的节流

金币是稳定流入的，永久属性如果只受钱限制，后期必然滑向无限堆面板。节流用的是递增定价而不是硬上限：基价每买一次乘 1.6，想继续堆就得放弃越来越多张卡。次数记在 `Player.statPurchases`，跨阶段累计，一局不清零。

一次进店最多买一次属性——货位只有一个，买了就售罄。这本身已是一层节流。

## 5. 实现

### 5.1 状态结构

库存放在 phase 里，不放地图、不放 GameState：

```ts
export type ShopStock =
  | { type: "scroll"; kind?: ScrollKind }        // kind 缺失 = 视图里被裁掉
  | { type: "equipment"; kind: EquipmentKind }
  | { type: "statGrowth"; option: StatGrowthOption };

export interface ShopOffer {
  /** 货位在 offers 数组中的下标，0~5。货架在一个 phase 内不重排，所以下标够稳定。 */
  id: number;
  price: number;
  sold?: true;
  stock: ShopStock;
}

export interface ShopState {
  playerId: PlayerId;
  tileIndex: number;
  offers: ShopOffer[];
}
```

`GamePhase` 加一支 `{ kind: "shop"; shop: ShopState }`。

这么放的理由是生命周期：「每次进入刷新」变成结构保证的事实，离店时 phase 换掉，库存跟着消失，没有需要手动清理的残留。挂在 `GameState` 上的话，漏清一次就会把上一个人的货架漏给下一个人；挂在 `MapTile` 上则直接和「每次进入刷新」冲突，还会变成多人共享货架。相遇、交易、奖励弹层用的都是同一套做法。

`ShopStock` 的 scroll 分支用可选 `kind`，和 `scrollGranted` 事件同一种写法：引擎产生的值一定带 `kind`，缺失只出现在 `viewFor` 裁剪之后。

### 5.2 新增模块 `src/game/shop.ts`

放定价表、库存生成和两个动作处理：

- `SHOP_PRICES` —— 4.1 的三张基价表。
- `rollShopStock(state, player): ShopState` —— 掷出 6 个货位。全部走 `nextRandom(state)`，同种子重放一致。
- `buyShopOffer(state, offerId): ActionResult`
- `leaveShop(state): boolean` —— phase 设回 `turnComplete`，不结束回合（玩家还要自己点「结束回合」，和其它格子一致）。

金币变动沿用已有的 `GoldChangeReason` 的 `"shop"`，不新增归因。

`buyShopOffer` 的顺序是：校验 phase 与货位 → `spendGold` → 标 `sold` → 发货。三类货各自发货：

- **卷轴**：`grantScroll(state, player, kind)`，旁白走 `rewardSecret`（牌名对旁观者裁成「一张卷轴」）。
- **装备**：`grantEquipment(state, player, kind, { kind: "shop", shop })`。槽位满时它会把 phase 切到 `equipmentChoice`，选完回到同一个货架——金币和 `sold` 在切走之前就已经落定，所以回来时货架状态是对的。
- **属性**：`applyStatGrowth(state, player, option)`，然后 `player.statPurchases += 1`。

### 5.3 各处接入点

| 文件 | 改动 |
| --- | --- |
| `types.ts` | `TileType` 加 `"shop"`；`ShopStock` / `ShopOffer` / `ShopState`；`GamePhase` 加 `shop` 分支；`GameAction` 加 `buyShopOffer` / `leaveShop`；`EquipmentChoiceState.resume` 加 `{ kind: "shop"; shop: ShopState }`；`Player` 加 `statPurchases: number` |
| `state.ts` | `createInitialGame` 里给每名玩家的 `statPurchases` 置 0 |
| `map.ts` | `MAP_TILE_LIMITS` 加 `shop: { min: 1, max: 1 }`；三个区域各 4 个候选格名；`makeRandomTile` 为 `shop` 写入 `safeZone: true` |
| `content/tiles.ts` | `TILE_ICON.shop = "¤"` |
| `tiles.ts` | `resolveTile` 加 `case "shop"`：掷库存、设 phase |
| `rewards.ts` | `resumeAfterEquipmentChoice` 加 `case "shop"`：phase 设回 `{ kind: "shop", shop }` |
| `engine.ts` | 分发两个新 action；`handleDisconnectTimeout` 加 `case "shop"`，并补齐商店装备选择恢复后的连续兜底 |
| `multiplayer.ts` | `canAct` 两个新 action；`currentActor` 加 `case "shop"`；`redactPhase` 裁剪卷轴货位的 `kind` |
| `economy.ts` | `canUseShop` 判据改按格子类型（见下） |

**格数可行性**：商店格加入、泉水调整为固定两个后，释放的容量暂时转给事件格（6～7 → 7～9）。`MAP_TILE_LIMITS` 的 min 合计为 23、max 合计为 29；区域容量（28 - 守关门 - 营地 = 26）落在 `[23, 29]` 内，`chooseCounts` 不会抛「地图格数量规则无法填满」。`RandomTileType` 由 `Exclude<TileType, "start" | "boss" | "gate">` 推导，`shop` 自动进池，无需另改。

**`canUseShop` 的判据**：`safeZone` 现在有三个使用点——`tiles.ts` 与 `encounters.ts` 的相遇检查（本义），以及 `economy.ts` 借它当营地商店的开张条件。商店格要用 `safeZone: true` 拿到「不触发玩家互动」，但那样营地商店的按钮会在商店格上一并冒出来，两个商店叠在同一格。所以把营地商店的判据改回按格子类型：

```ts
const tile = state.map.tiles[player.position];
return state.phase.kind === "turnComplete"
  && state.activePlayerId === player.id
  && (tile?.type === "start" || tile?.type === "gate");
```

营地商店本来就只在营地和守关之门开张，这么写和它实际想表达的一致；`safeZone` 也回到单一含义——「这一格不发生玩家互动」。

**掉线兜底**：`handleDisconnectTimeout` 的 `case "shop"`，超时的若不是店里那名玩家则原样返回；是的话直接离店（phase → `turnComplete`），若他同时是行动方就 `advanceCompletedTurn`。和 `bossGateChoice` 的兜底同形。

还要覆盖「在商店买装备后进入 `equipmentChoice` 才掉线」这一条嵌套链路。服务器的掉线计时器只触发一次，不能指望恢复到 `shop` 后再等第二次超时。因此 `equipmentChoice` 的现有兜底调用 `chooseEquipment(next)` 后，如果恢复出的 phase 是该玩家的 `shop`，必须在同一次 `handleDisconnectTimeout` 中继续 `leaveShop(next)`；随后若他是行动方，立即 `advanceCompletedTurn(next)`。最终返回的状态不能停在 `shop`，否则无人能够再提交「离开商栈」而锁住房间。

**授权**：`canAct` 里两个新动作都要求 `state.phase.kind === "shop" && state.phase.shop.playerId === actor`——店是私人的，别人不能替他花钱。

### 5.4 界面

现有 `ShopModal.tsx` 是营地专用的两颗固定按钮，结构对不上 6 格货架，另开 `ShopTileModal.tsx`，共用 `ModalBackdrop` / `SPRING` 与 `.shop-*` 样式。货架按 5.1 的固定顺序渲染，每格显示品名、稀有度、价格；售罄置灰；买不起置灰；底部一颗「离开商栈」。卷轴货位在非买家视图里显示为「一张卷轴」加价格。

商店格是 phase 驱动的弹层，由 `GameScreen` 按 `state.phase.kind === "shop"` 挂载，不经过 `ActionDock` 的按钮。

## 6. 测试

新增 `src/game/__tests__/shopTile.test.ts`：

- 同种子踩同一个商店格，库存逐位相同；两次进入之间库存重新掷。
- 货架恰好 6 位，顺序为卷轴 / 武器 / 护甲 / 鞋子 / 饰品 / 属性，装备部位各对得上。
- 每一档的最低售价高于该档折算价上限（4.2 的表，用 `equipmentSalvageValue` 算上点石成金）。
- 售罄的货位再买被拒；金币不足被拒；两者都维持「非法动作不产生新状态」。
- 满槽买装备切到 `equipmentChoice`，选完回到同一个货架且保持 `sold`；购买费用不会重复扣除，离场装备仍按现有规则折算金币。
- 买属性后 `statPurchases` 递增；属性货位不掷价格浮动，下一次进店按新的累计次数计算，实际售价按 1.6 倍抬升并取整到 `GOLD_SCALE`。
- 商店买装备进入 `equipmentChoice` 后，买家掉线超时会在同一次兜底中放弃新装备、离开商店并轮转回合，不会停回无人可操作的 `shop` phase。
- 非买家视图里卷轴货位没有 `kind`，价格照常可见。
- 地图生成出的每个 `shop` 都带 `safeZone: true`；同格有对手时踩商店格不进入相遇，直接进商店。

改动现有测试：

- `economy.test.ts:166` 用 `safeZone = false` 断言营地商店拒绝购买，改为改 `type`。
- `map.test.ts` 若有按类型统计格数的断言，补上 `shop`。

## 7. 遗留的取舍

**卷轴明牌会泄露信息。** 金币是公开的，卷轴按品质定价，对手看到你花了多少钱就能反推买到的是什么档次的牌。这是明知并接受的：`viewFor` 只裁掉牌名，价格照常公开。备选方案是让价格档位互相重叠到猜不出来，代价是同档商品价差过大；或者干脆做成暗牌固定价，代价是「刷新看货」对卷轴这一格失去意义。选择明牌是因为看得见牌面正是商店格相对营地商店的全部价值。

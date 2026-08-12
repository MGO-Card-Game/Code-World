import type { EliteAffixKind, EnemyKind } from "./content/enemies";
import type { EquipmentKind } from "./content/equipment";
import type { CardRarity, RewardRarityTier } from "./content/rarity";
import type { MapEventKind } from "./content/events";

import type { ScrollKind } from "./content/scrolls";
import type { BlessingKind } from "./content/blessings";

export type { BlessingKind, EliteAffixKind, EnemyKind, EquipmentKind, MapEventKind, ScrollKind };

export type PlayerId = "player1" | "player2" | "player3" | "player4";

/**
 * 卷轴的使用时机（GameRule 8.9）。
 *
 * 决定一张牌归攻击方还是防守方打的是 timing，不是 kind——
 * 8.8 中力量/精准/狂暴属于 beforeAttackRoll，护盾/坚守/闪避属于
 * beforeDefenseRoll；D20 与巨龙打击同时支持两个时机。
 * 疗牌额外开放地图阶段；在战斗中仍复用攻、防两种选牌时机。
 */
export type ScrollTiming = "map" | "beforeAttackRoll" | "beforeDefenseRoll";
export type TileType =
  | "start"
  | "battle"
  | "elite"
  | "treasure"
  | "blessing"
  | "spring"
  | "event"
  | "shop"
  | "tunnel"
  | "gate"
  | "boss";

/** 会打起来的格子。三处判定（结算、地图约束、界面）共用，免得各写一份对不上。 */
export const COMBAT_TILE_TYPES = ["battle", "elite"] as const satisfies readonly TileType[];

export function isCombatTile(type: TileType) {
  return (COMBAT_TILE_TYPES as readonly TileType[]).includes(type);
}
export type MapRegionId = "foothill" | "mountainside" | "summit";

export type StageRequirement = {
  type: "laps" | "eliteVictories";
  target: number;
  label: string;
};

export interface StageProgress {
  laps: number;
  eliteVictories: number;
  bossKeyPurchased: boolean;
  /**
   * 已经从哪些宝箱里拿到过东西。宝箱可以反复开，这份记录只用来区分
   * 首次（standard 档）和重开（basic 档），不再是「开过就锁死」。
   * 空箱不计入，第一次踩空不会烧掉首次那一档。
   */
  openedTreasureTileIds: number[];
  bossDefeated: boolean;
}

export interface OwnedScroll {
  instanceId: string;
  kind: ScrollKind;
  /**
   * 战斗开始时由装备临时发放的牌，战斗结束时统一回收。
   *
   * 回收必须发生在相遇战代价阶段**之前**，否则败方可以把这张本不属于他的
   * 临时牌交给赢家，凭空变成一张常驻卡。
   */
  temporary?: true;
}

export interface OwnedEquipment {
  instanceId: string;
  kind: EquipmentKind;
  /**
   * 这一件装备的战斗内暗格，供「和上一回合比较」这类跨回合效果使用。
   *
   * 只能存数字：它要跟着 GameState 一起 structuredClone、JSON 广播，
   * 还要在同种子重放里逐位复现。存的内容也不能是暗牌情报——它随装备一起公开，
   * 目前两把剑记的都是已经由 attackRolled 公开过的骰点。
   *
   * 生命周期由引擎保证：finishBattle 开头统一清空，卡牌不必自己收尾。
   * 交给每张卡在 onBattleStart 自己清的话，漏清不会报错，只会让效果在下一场
   * 的第一轮偷偷多触发一次。
   */
  battleMemo?: number;
}

/** 赐福在持有期间永久生效；持有上限为 1 + 已击败阶段首领数。 */
export interface OwnedBlessing {
  instanceId: string;
  kind: BlessingKind;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  hp: number;
  maxHp: number;
  baseAttack: number;
  baseDefense: number;
  /** 公开货币；通过战斗、宝箱和事件获得，可在安全营地购买补给。 */
  gold: number;
  /** 商店格累计购买的永久属性次数；跨阶段保留，用于递增定价。 */
  statPurchases: number;
  position: number;
  /** 三个阶段各自独立的环数、目标和一次性格子状态。 */
  stageProgress: Record<MapRegionId, StageProgress>;
  /**
   * 下一次自己的地图行动会失去移动机会。
   *
   * reason 是给玩家看的短语（"战地药剂"、"沼泽"……），回合开始的旁白直接引用它。
   * 战斗里的代价和地图事件用的是同一个字段，因为两者对玩家来说是同一件事——
   * 各存一份状态的话，同时中招时就会漏掉一次。
   */
  skipNextMovement?: { reason: string };
  /**
   * 下一次掷骰移动的点数被钉死成这个值（绊倒）。
   *
   * 只作用于真正掷骰的那一次：用移动卷轴代替掷骰时这个标记原样留着，等到下次
   * 真掷骰才兑现——"下次掷骰点数为 1"说的就是掷骰，没掷就还没发生。
   */
  forcedMovementRoll?: number;
  scrolls: OwnedScroll[];
  equipment: OwnedEquipment[];
  blessings: OwnedBlessing[];
}

export interface MapTile {
  id: number;
  region: MapRegionId;
  type: TileType;
  label: string;
  /** 显式配置敌人的特殊格使用；随机地图的普通与精英格在每次开战时抽取。 */
  enemyId?: EnemyKind;
  /** 显式配置遭遇时使用；随机地图不会保存普通怪词条。 */
  eliteAffix?: EliteAffixKind;
  safeZone?: boolean;
}

export interface MapRegion {
  id: MapRegionId;
  name: string;
  startIndex: number;
  endIndex: number;
  gateIndex: number;
  entryIndex: number;
  bossEnemyId: EnemyKind;
  /**
   * 该阶段首领掉落装备的保底档位；不写表示不设下限。
   *
   * 放在区域配置里而不是战斗里按阶段序号推，是因为「这一阶段的首领长什么样」
   * 已经由 bossEnemyId 和 requirements 描述在这里了，保底属于同一件事。
   */
  bossEquipmentFloor?: CardRarity;
  requirements: StageRequirement[];
}

/** 一局实际使用的地图。地图随状态广播，客户端不会各自重新随机。 */
export interface GameMap {
  seed: number;
  columns: number;
  regions: MapRegion[];
  tiles: MapTile[];
}

export type CombatSide = "a" | "b";

/**
 * 一侧在本次攻击回合的卷轴选择（GameRule 8.3）。
 *
 * 暗牌之下攻防双方在各自设备上独立决定，所以必须能区分
 * “还没提交”和“提交了但不使用”——前者要继续等，后者可以直接结算。
 *
 * submitted 是**只在视图里出现**的状态，引擎永远不会产生它：
 * viewFor 会把对手的 chosen / declined 一律折叠成 submitted。
 * 「选了哪张」和「到底选没选」都是情报，8.3 要求双方在互相不知情的
 * 前提下决定，所以对手那一侧只能透出“已提交”这一个事实。
 */
export type ScrollChoice =
  | { status: "pending" }
  | { status: "declined" }
  | { status: "chosen"; instanceIds: string[] }
  | { status: "submitted" };

export interface BattleState {
  kind: "pve" | "boss" | "pvp";
  aPlayerId: PlayerId;
  bPlayerId?: PlayerId;
  enemyId?: EnemyKind;
  enemyAffix?: EliteAffixKind;
  stageId?: MapRegionId;
  tileIndex?: number;
  hpA: number;
  hpB: number;
  attacker: CombatSide;
  round: number;
  initiativeA: number;
  initiativeB: number;
  log: string[];
  /**
   * 本场战斗中各方累计打出的卷轴张数。
   *
   * 记在战斗上而不是玩家上：这是"这一场里你已经用掉多少"，战斗结束即作废；
   * 怪物那些「玩家每用一张卷轴……」的效果只有从这里才数得出来。
   */
  scrollsUsedA: number;
  scrollsUsedB: number;
  /** 本场敌人已经完整结算的攻击次数；用于攻击次数型怪物能力。 */
  enemyAttacksPerformed: number;
  /** Boss 能力施加的下一次玩家攻击减值；玩家完成一次攻击后清零。 */
  nextPlayerAttackPenalty: number;
  /** 本回合双方的卷轴选择，两侧都非 pending 时才结算 */
  choiceA: ScrollChoice;
  choiceB: ScrollChoice;
}

export interface PvpPenaltyState {
  winnerId: PlayerId;
  loserId: PlayerId;
  tileIndex: number;
  /** 当前无可支付项；正常惩罚应由引擎直接跳过。 */
  waived?: true;
  waiveReason?: "noPayable";
}

/** 移动结束时同格有多名对手，由本回合行动者选择本次只与其中一人互动。 */
export interface EncounterChoiceState {
  challengerId: PlayerId;
  opponentIds: PlayerId[];
  tileIndex: number;
}

export type EncounterIntent = "trade" | "greet" | "battle";

/** submitted 只用于对手视图，避免后选者根据先选者的和平意向改选战斗。 */
export type EncounterIntentChoice =
  | { status: "pending" }
  | { status: "chosen"; intent: EncounterIntent }
  | { status: "submitted" };

export interface EncounterDecisionState {
  aPlayerId: PlayerId;
  bPlayerId: PlayerId;
  tileIndex: number;
  choiceA: EncounterIntentChoice;
  choiceB: EncounterIntentChoice;
}

/** 双方各自拿出的完整报价；进入确认阶段后对双方公开。 */
export interface TradeOffer {
  gold: number;
  scrolls: OwnedScroll[];
  equipment: OwnedEquipment[];
}

/** offered 是引擎真实状态，submitted 是对手视图中的隐藏状态。 */
export type TradeOfferChoice =
  | { status: "pending" }
  | { status: "offered"; offer: TradeOffer }
  | { status: "submitted" };

export interface TradeOfferState {
  aPlayerId: PlayerId;
  bPlayerId: PlayerId;
  tileIndex: number;
  offerA: TradeOfferChoice;
  offerB: TradeOfferChoice;
  /** 装备槽位不兼容时双方重新报价，并显示原因。 */
  error?: string;
}

export type TradeConfirmationChoice = "pending" | "accepted";

export interface TradeConfirmationState {
  aPlayerId: PlayerId;
  bPlayerId: PlayerId;
  tileIndex: number;
  offerA: TradeOffer;
  offerB: TradeOffer;
  confirmationA: TradeConfirmationChoice;
  confirmationB: TradeConfirmationChoice;
}

export interface BossGateChoiceState {
  playerId: PlayerId;
  stageId: MapRegionId;
  gateTileIndex: number;
  bossEnemyId: EnemyKind;
  /**
   * 入口是被移动拦停打开的，还是玩家站在门上主动打开的。
   *
   * 决定放弃挑战后回到哪里：拦停发生在移动之后，回合到此为止；主动打开发生在掷骰前，
   * 放弃就该退回掷骰阶段，否则点开看一眼就白扔一个回合。
   */
  source: "arrival" | "standing";
}

/** PvP 赢家赐福槽位已满时，决定是否接纳败方失去的赐福。 */
export interface PvpBlessingChoiceState {
  source: "pvp";
  winnerId: PlayerId;
  loserId: PlayerId;
  offered: OwnedBlessing;
  tileIndex: number;
  penaltyWaived?: true;
  penaltyWaiveReason?: "noPayable";
}

/** 赐福槽位已满的玩家再次踩中赐福格时，决定是否换成新抽到的赐福。 */
export interface TileBlessingChoiceState {
  source: "tile";
  winnerId: PlayerId;
  offered: OwnedBlessing;
  tileIndex: number;
  tileLabel: string;
}

export type BlessingChoiceState = PvpBlessingChoiceState | TileBlessingChoiceState;

export type PveRewardSource = "battle" | "affix" | "elite" | "boss" | "blessing";

/** PvE 胜利弹层中的一项奖励；卷轴同时保存私密名称和旁观者可见名称。 */
export interface PveRewardItem {
  source: PveRewardSource;
  resourceType: "scroll" | "equipment" | "gold";
  name: string;
  publicName: string;
}

/** 战斗奖励必须由获奖玩家确认，保证日志之外还有不会一闪而过的醒目反馈。 */
export interface PveRewardNoticeState {
  playerId: PlayerId;
  enemyName: string;
  elite: boolean;
  rewards: PveRewardItem[];
  /**
   * 确认奖励后还要接一次自主加点。
   *
   * 加点写在奖励弹层之后而不是和它并列：装备槽满时奖励会先绕去 equipmentChoice，
   * 让加点跟在确认动作后面，这条链路无论绕不绕路都只有一个出口。
   */
  statGrowth?: true;
}

/**
 * 事件格结算必须由当事人确认。
 *
 * 事件的结果只写进历史日志的话，玩家几乎无从感知：金币和卷轴静默进包，日志又只留
 * 最近 12 条。这里把事件名、描述和本次结算逐条产生的旁白一起停在屏幕上，
 * 和 PvE 胜利的战利品弹层是同一个理由。
 */
export interface MapEventNoticeState {
  playerId: PlayerId;
  kind: MapEventKind;
  /** 逐条旁白，顺序即发生顺序；带 secret 的按观看者裁剪，规则同 history。 */
  lines: LogEntry[];
  /**
   * 确认后要交棒的阶段。
   *
   * 赌场和装备取舍本来就会自己接管阶段，事件通知插在它们前面：先把「发生了什么」
   * 讲完，再让玩家去做后续选择。
   */
  resume?:
    | { kind: "casino"; casino: CasinoState }
    | { kind: "equipmentChoice"; choice: EquipmentChoiceState }
    | { kind: "mapEventScrollChoice"; choice: MapEventScrollChoiceState }
    | { kind: "mapEventEquipmentChoice"; choice: MapEventEquipmentChoiceState };
}

/** 地图事件要求玩家从自己的暗牌中选择一张卷轴时使用。 */
export interface MapEventScrollChoiceState {
  playerId: PlayerId;
  /** 只允许选择事件触发瞬间已经在手里的牌，复制品本身不会反复成为候选。 */
  candidateIds: string[];
  /** 回内容表读取选择完成后的私密旁白，避免把函数塞进可广播的 GameState。 */
  eventKind: MapEventKind;
  effectIndex: number;
}

/** 地图事件允许玩家交出一件已有装备时使用。 */
export interface MapEventEquipmentChoiceState {
  playerId: PlayerId;
  candidateIds: string[];
  eventKind: MapEventKind;
  effectIndex: number;
}

/** 三选一的永久成长；数值和文案在 growth.ts 的 STAT_GROWTH。 */
export type StatGrowthOption = "attack" | "defense" | "maxHp";

export type ShopStock =
  | { type: "scroll"; kind?: ScrollKind }
  | { type: "equipment"; kind: EquipmentKind }
  | { type: "statGrowth"; option: StatGrowthOption };

export interface ShopOffer {
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

export interface StatGrowthChoiceState {
  playerId: PlayerId;
  stageId: MapRegionId;
}

/** 赌场转盘一次已经结算、但尚未由玩家确认的结果。 */
export type CasinoResult =
  | { kind: "bust"; price: number }
  | { kind: "gold"; price: number; amount: number }
  | { kind: "scroll"; price: number; name: string; publicName: string }
  | { kind: "equipment"; price: number; name: string }
  | { kind: "statGrowth"; price: number; option: StatGrowthOption };

/** 赌场转盘的进店状态；spins 决定下一次转动的价格，见 casinoSpinPrice。 */
export interface CasinoState {
  playerId: PlayerId;
  tileIndex: number;
  spins: number;
  /** 存在时必须先确认结果，不能直接再次转动或离场。 */
  result?: CasinoResult;
}

/**
 * 打出的卷轴要求出牌者从其余玩家里挑一个目标。
 *
 * 存的是「哪张牌的第几条效果」而不是效果本身：GameState 要能 structuredClone、
 * JSON 广播、按同种子重放，而效果定义里可以挂函数——和卷轴、装备只存
 * { instanceId, kind } 是同一条约定，结算时回内容表查。
 *
 * 牌在开这个阶段之前就已经消耗掉了，所以这里不留 instanceId：打出去的牌不退回，
 * 和战斗里 consumeScrolls 的约定一致。
 */
export interface ScrollTargetChoiceState {
  /** 做选择的人，也就是出牌的人 */
  playerId: PlayerId;
  /**
   * 可选目标。掉线的玩家照样在名单里——他不需要做任何操作，
   * 掉线不该换来一层免疫。
   */
  candidateIds: PlayerId[];
  scrollKind: ScrollKind;
  effectIndex: number;
  /** 选完之后回到哪个阶段；换位这类代替移动的牌不用它，落点结算会自己定阶段。 */
  resume: "awaitingRoll" | "turnComplete";
}

export interface EquipmentChoiceState {
  playerId: PlayerId;
  offered: OwnedEquipment;
  source: "reward" | "transfer";
  resume:
    | { kind: "turnComplete" }
    | { kind: "resolveTile"; tileIndex: number }
    // 档位随 remaining 一起过河：装备槽满会把发奖打断一轮，回来时不能落回默认档
    | { kind: "grantTreasureEquipment"; remaining: number; tier: RewardRarityTier }
    | { kind: "showPveReward"; notice: PveRewardNoticeState }
    | { kind: "shop"; shop: ShopState }
    | { kind: "casino"; casino: CasinoState };
}

export type GamePhase =
  | { kind: "awaitingRoll" }
  | { kind: "turnComplete" }
  | { kind: "encounterChoice"; choice: EncounterChoiceState }
  | { kind: "scrollTargetChoice"; choice: ScrollTargetChoiceState }
  | { kind: "encounterDecision"; encounter: EncounterDecisionState }
  | { kind: "tradeOffer"; trade: TradeOfferState }
  | { kind: "tradeConfirmation"; trade: TradeConfirmationState }
  | { kind: "bossGateChoice"; choice: BossGateChoiceState }
  | { kind: "battle"; battle: BattleState }
  | { kind: "blessingChoice"; choice: BlessingChoiceState }
  | { kind: "pvpPenalty"; penalty: PvpPenaltyState }
  | { kind: "equipmentChoice"; choice: EquipmentChoiceState }
  | { kind: "pveReward"; notice: PveRewardNoticeState }
  | { kind: "mapEventNotice"; notice: MapEventNoticeState }
  | { kind: "mapEventScrollChoice"; choice: MapEventScrollChoiceState }
  | { kind: "mapEventEquipmentChoice"; choice: MapEventEquipmentChoiceState }
  | { kind: "statGrowthChoice"; choice: StatGrowthChoiceState }
  | { kind: "shop"; shop: ShopState }
  | { kind: "casino"; casino: CasinoState }
  | { kind: "gameOver"; winnerId: PlayerId };

export type HpChangeReason =
  | "camp"
  | "growth"
  | "spring"
  | "event"
  | "equipment"
  | "blessing"
  | "scroll"
  | "shop"
  | "defeatRecovery"
  | "pvpTransfer";

export type GoldChangeReason =
  | "pveReward"
  | "treasure"
  | "event"
  | "salvage"
  | "shop"
  | "bossKey"
  | "trade"
  | "pvpTransfer";

/**
 * 一条可按接收方裁剪的文案。
 *
 * 暗牌之下「打开宝箱，获得力量卷轴」这种句子会直接泄露手牌，
 * 所以带上 secret 的条目由 viewFor 按观看者替换成 publicText。
 * 只裁剪卷轴数组和事件是不够的——文案是最容易漏掉的泄露面。
 */
export interface LogEntry {
  text: string;
  secret?: { owner: PlayerId; publicText: string };
}

/**
 * 引擎在一次 action 中产生的结构化事件。
 *
 * 与 `history` 的区别：`history` 是给玩家看的持久文字记录，
 * 事件流是给界面做动画编排的时间线——每条事件对应一个可播放的动画片段。
 * 规则引擎依然是原子结算的，事件只描述“发生了什么、顺序如何”，
 * 界面负责把它们拉长到时间轴上播放。
 */
export type GameEventBody =
  /** 与 addHistory 同步产生，用于把旁白文字对齐到动画节点上 */
  | { type: "narration"; text: string; secret?: { owner: PlayerId; publicText: string } }
  | {
      type: "gameStarted";
      starterId: PlayerId;
      rolls: Partial<Record<PlayerId, number>>;
      turnOrder: PlayerId[];
    }
  | { type: "turnStarted"; playerId: PlayerId; turn: number }
  | {
      type: "movementRolled";
      playerId: PlayerId;
      value: number;
      sides: number;
      dice: number[];
    }
  | { type: "playerMoved"; playerId: PlayerId; from: number; to: number }
  | { type: "playerRetreated"; playerId: PlayerId; from: number; to: number }
  /** 玩家真实生命值变化。战斗中的临时生命值请看 battleDamage */
  | {
      type: "playerHpChanged";
      playerId: PlayerId;
      from: number;
      to: number;
      maxHp: number;
      reason: HpChangeReason;
    }
  | { type: "maxHpChanged"; playerId: PlayerId; from: number; to: number }
  | {
      type: "baseStatChanged";
      playerId: PlayerId;
      stat: "attack" | "defense";
      from: number;
      to: number;
    }
  | {
      type: "goldChanged";
      playerId: PlayerId;
      from: number;
      to: number;
      reason: GoldChangeReason;
    }
  /** kind 会被 viewFor 对非持有者裁掉，否则对手抽到什么会从动画事件泄露 */
  | {
      type: "scrollGranted";
      playerId: PlayerId;
      instanceId: string;
      kind?: ScrollKind;
    }
  | {
      type: "scrollConsumed";
      playerId: PlayerId;
      instanceId: string;
      kind: ScrollKind;
    }
  /** kind 会被 viewFor 对交接双方之外的人裁掉，理由同 scrollGranted */
  | {
      type: "scrollTransferred";
      fromId: PlayerId;
      toId: PlayerId;
      instanceId: string;
      kind?: ScrollKind;
    }
  | {
      type: "equipmentGranted";
      playerId: PlayerId;
      instanceId: string;
      kind: EquipmentKind;
    }
  | {
      type: "equipmentTransferred";
      fromId: PlayerId;
      toId: PlayerId;
      instanceId: string;
      kind: EquipmentKind;
    }
  | {
      type: "blessingGranted";
      playerId: PlayerId;
      instanceId: string;
      kind: BlessingKind;
    }
  | {
      type: "blessingTransferred";
      fromId: PlayerId;
      toId: PlayerId;
      instanceId: string;
      kind: BlessingKind;
    }
  | {
      type: "battleStarted";
      battleKind: BattleState["kind"];
      aPlayerId: PlayerId;
      bPlayerId?: PlayerId;
      enemyId?: EnemyKind;
      enemyAffix?: EliteAffixKind;
    }
  | {
      type: "initiativeRolled";
      rollA: number;
      rollB: number;
      firstAttacker: CombatSide;
    }
  | {
      type: "attackRolled";
      side: CombatSide;
      die: number;
      dice: number[];
      sides: number;
      base: number;
      flatBonus: number;
      total: number;
    }
  | {
      type: "defenseRolled";
      side: CombatSide;
      die: number;
      dice: number[];
      sides: number;
      base: number;
      flatBonus: number;
      total: number;
    }
  /** 战斗内临时生命值变化，PvP 时不代表真实生命值 */
  | {
      type: "battleDamage";
      targetSide: CombatSide;
      amount: number;
      hpBefore: number;
      hpAfter: number;
      hpMax: number;
    }
  /** 战斗内治疗；和 battleDamage 一样，PvP 时只改变临时战斗生命。 */
  | {
      type: "battleHealed";
      targetSide: CombatSide;
      amount: number;
      hpBefore: number;
      hpAfter: number;
      hpMax: number;
    }
  /** fromRound / fromAttacker 供界面在动画播到之前按住上一轮的攻防归属 */
  | {
      type: "battleRoundAdvanced";
      round: number;
      attacker: CombatSide;
      fromRound: number;
      fromAttacker: CombatSide;
    }
  | {
      type: "battleEnded";
      battleKind: BattleState["kind"];
      outcome: "playerWon" | "playerLost" | "pvpDecided";
      winnerSide: CombatSide;
    }
  | { type: "gameOver"; winnerId: PlayerId };

type WithEventId<T> = T extends unknown ? T & { id: number } : never;

/**
 * 事件带上自增 id，既方便界面做 React key，也便于播放队列去重。
 *
 * 这里用分配式条件类型而不是直接写交叉，保证 GameEvent 展开后依然是联合类型，
 * 消费方才能用 `Extract<GameEvent, { type: "playerMoved" }>` 按事件种类收窄。
 */
export type GameEvent = WithEventId<GameEventBody>;

export interface GameState {
  /** 只包含本局实际入座的玩家；顺序由 turnOrder 定义。 */
  players: Record<string, Player>;
  turnOrder: PlayerId[];
  /** 联机掉线席位；本地模式恒为空。不会成为新的相遇战目标或后续回合行动者。 */
  unavailablePlayerIds: PlayerId[];
  map: GameMap;
  activePlayerId: PlayerId;
  startingPlayerId: PlayerId;
  turn: number;
  phase: GamePhase;
  rngSeed: number;
  nextInstanceId: number;
  lastMovementRoll?: number;
  /** 当前回合掷骰移动前的位置，用来锁定随后 PvE 战败的检查点回退。 */
  movementOrigin?: number;
  message: LogEntry;
  history: LogEntry[];
  /** 仅包含最近一次 action 产生的事件，每次 action 开始时清空 */
  lastEvents: GameEvent[];
  nextEventId: number;
}

export type GameAction =
  | { type: "restart"; seed?: number }
  | { type: "rollMovement" }
  /**
   * distance 只有 chooseMovement / teleport 效果的卷轴需要；
   * targetPosition 只有 teleportAnywhere 效果的卷轴需要（当前阶段内的绝对格子编号）。
   * 其余卷轴都会忽略这两个字段。
   */
  | { type: "useMapScroll"; instanceId: string; distance?: number; targetPosition?: number }
  | { type: "endTurn" }
  | { type: "chooseEncounterOpponent"; opponentId: PlayerId }
  | { type: "chooseScrollTarget"; targetId: PlayerId }
  | { type: "chooseEncounterIntent"; side: CombatSide; intent: EncounterIntent }
  | {
      type: "submitTradeOffer";
      side: CombatSide;
      gold: number;
      scrollInstanceIds: readonly string[];
      equipmentInstanceIds: readonly string[];
    }
  | { type: "cancelTrade"; side: CombatSide }
  | { type: "confirmTrade"; side: CombatSide; accept: boolean }
  | { type: "buyBossKey" }
  | { type: "openBossGate" }
  | { type: "chooseBossChallenge"; challenge: boolean }
  | { type: "chooseBlessing"; replace: boolean; replaceInstanceId?: string }
  | { type: "acknowledgePveReward" }
  | { type: "acknowledgeMapEvent" }
  | { type: "chooseMapEventScroll"; instanceId: string }
  /** 省略 instanceId 表示拒绝收藏家的可选交易。 */
  | { type: "chooseMapEventEquipment"; instanceId?: string }
  | { type: "buyShopItem"; item: "scroll" | "healing" }
  | { type: "buyShopOffer"; offerId: number }
  | { type: "leaveShop" }
  /** 赌场转盘：花费本次价格转一次，奖励是一张卷轴或一件装备。 */
  | { type: "spinCasino" }
  | { type: "acknowledgeCasinoResult" }
  | { type: "leaveCasino" }
  /**
   * 提交本侧本回合要打的全部卷轴（GameRule 8.5，张数不限）。
   * 省略或传空数组表示不使用。两侧都提交后引擎自动结算本回合。
   *
   * 数组顺序即结算顺序。绝大多数效果的合并规则与顺序无关（见 RollModifiers），
   * 只有 directDamage 和 custom 这类带副作用的效果会受顺序影响。
   */
  | { type: "submitScrollChoice"; side: CombatSide; instanceIds?: readonly string[] }
  /**
   * 支付相遇战代价：resource 交一张卷轴或装备，hp 转移真实生命。
   * 金币、资源和生命都无法支付时直接免除代价。
   */
  | {
      type: "choosePvpPenalty";
      choice: "resource" | "hp" | "gold";
      resourceType?: "scroll" | "equipment";
      instanceId?: string;
    }
  /** 装备槽已满时，省略 replaceInstanceId 表示放弃新装备。 */
  | { type: "chooseEquipment"; replaceInstanceId?: string }
  /** 击败阶段首领后的自主加点，三选一。 */
  | { type: "chooseStatGrowth"; option: StatGrowthOption };

/**
 * 规则模块处理完一个动作之后的结果。
 *
 * false 表示这是个非法动作，调用方要维持「非法动作不产生新状态」的约定；
 * true 表示已经处理完；带 resolveTile 的表示还欠一次格子结算。
 *
 * 最后一种存在的理由是依赖方向：格子结算住在 engine.ts，而相遇、交易、相遇战代价
 * 这些流程都以「回到那一格继续走」收尾。让它们直接调 resolveTile 就要反向依赖
 * engine，于是这里把「接下来做什么」交成数据，由 engine 自己去解释——
 * 和 EquipmentChoiceState.resume 是同一个办法。
 */
export type ActionResult = boolean | { resolveTile: number };

/**
 * 裁剪后的卷轴：对手只看得到牌背。
 *
 * 保留 instanceId 是有意的——界面用它做动画 key，牌背才能各自进出，
 * 而 instanceId 本身只暴露发牌顺序，不暴露牌面。
 */
export interface HiddenScroll {
  instanceId: string;
  hidden: true;
}

export type ScrollView = OwnedScroll | HiddenScroll;

/**
 * 玩家身上与手牌无关的部分。
 *
 * 属性计算和动画显示都用不到 scrolls，让它们接受这个类型，
 * Player 和 PlayerView 就能共用同一套函数，不必为暗牌视图另写一份。
 */
export type PlayerStats = Omit<Player, "scrolls">;

/** 玩家的可见视图，scrolls 可能是裁剪过的 */
export type PlayerView = PlayerStats & { scrolls: ScrollView[] };

/** 发给某一名玩家的状态视图 */
export type GameStateView = Omit<GameState, "players"> & {
  players: Record<string, PlayerView>;
};
